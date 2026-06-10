import { DEFAULT_CONTINGENCY } from '../config/decision.js'
import { createBattlePlan, validateBattlePlan } from './BattlePlan.js'
import { DECIDER_ACTIONS, INCIDENT_TYPES, normalizeInitialPlan } from './IDecider.js'
import { parsePlayerInstruction } from './PlayerIntervention.js'

export const RuleDecider = {
  createBattlePlan(cards, context = {}) {
    const cardList = Array.isArray(cards) ? cards : []
    const gasPool = Math.max(0, Math.round(Number(context.gasPool) || 0))
    const maxCards = Math.max(0, Math.round(Number(context.maxCards ?? cardList.length) || 0))
    const selectedCards = chooseCards(cardList, gasPool, maxCards)
    const gasAllocations = allocateGas(selectedCards, gasPool)
    const contingencies = Object.fromEntries(selectedCards.map((card) => [card.id, contingencyFor(card, selectedCards)]))
    const battlePlan = createBattlePlan({ selectedCards, gasAllocations, contingencies })
    const validation = validateBattlePlan(battlePlan, { gasPool, maxCards })

    return {
      battlePlan,
      validation,
      reasoning: validation.valid
        ? 'RuleDecider selected affordable cards, assigned player-side gas, and set contingency preferences.'
        : 'RuleDecider could not produce a legal battle plan.',
    }
  },

  async planInitial(input = {}) {
    return normalizeInitialPlan(
      {
        reasoning: 'RuleDecider orders selected cards by expected value and keeps player gas allocations unchanged.',
        executionOrder: [...(input.cards ?? [])].sort((a, b) => expectedValue(b) - expectedValue(a)).map((card) => card.id),
      },
      input.cards ?? [],
    )
  },

  async decideOnIncident(snapshot = {}) {
    const eventType = snapshot.trigger?.type ?? snapshot.event
    const affectedCardId = snapshot.affectedCardId ?? snapshot.trigger?.cardId
    const playerContingency = snapshot.playerContingency ?? 'fight'
    const remainingGasPool = Math.max(0, Math.round(Number(snapshot.remainingGasPool) || 0))
    const affected = (snapshot.allCardStatuses ?? []).find((card) => card.id === affectedCardId)
    const currentGas = Math.max(0, Math.round(Number(affected?.allocatedGas) || 0))

    if (eventType === INCIDENT_TYPES.PLAYER_INTERVENTION) {
      return decideOnPlayerIntervention(snapshot)
    }

    if (eventType === INCIDENT_TYPES.GAS_INSUFFICIENT) {
      const affordable = buildAffordableAllocations(snapshot.allCardStatuses ?? [], remainingGasPool)
      if (affordable.length > 0) {
        return {
          action: DECIDER_ACTIONS.REALLOCATE_GAS,
          targetCardId: affectedCardId,
          gasAllocations: affordable,
          updatedExecutionOrder: affordable.map((item) => item.cardId),
          reasoning: 'Gas pool is short, so RuleDecider reallocates remaining gas to affordable pending cards.',
        }
      }

      return {
        action: DECIDER_ACTIONS.ABANDON_CARD,
        targetCardId: affectedCardId,
        reasoning: 'Gas pool is exhausted; RuleDecider abandons the affected card.',
      }
    }

    if (eventType === INCIDENT_TYPES.TARGET_STOLEN && playerContingency === 'fight' && remainingGasPool > 0) {
      const competitorBid = Math.max(0, Math.round(Number(snapshot.trigger?.competitorGasBid) || 0))
      const gas = Math.min(currentGas + remainingGasPool, Math.max(currentGas + 1, Math.ceil(competitorBid * 1.1)))
      return {
        action: DECIDER_ACTIONS.REPLACE_TX,
        targetCardId: affectedCardId,
        gas,
        reasoning: 'Player contingency is fight; RuleDecider attempts one replacement bid if the card is still actionable.',
      }
    }

    if (playerContingency === 'abandon' || eventType === INCIDENT_TYPES.TX_FAILED) {
      return {
        action: DECIDER_ACTIONS.ABANDON_CARD,
        targetCardId: affectedCardId,
        reasoning: 'The player contingency or failed transaction favors abandoning this target and preserving the rest.',
      }
    }

    if (playerContingency === 'transfer') {
      const pending = (snapshot.allCardStatuses ?? [])
        .filter((card) => card.status === 'pending' && card.id !== affectedCardId)
        .sort((a, b) => expectedValue(b) - expectedValue(a))
        .map((card) => card.id)
      return {
        action: DECIDER_ACTIONS.CONTINUE,
        targetCardId: affectedCardId,
        updatedExecutionOrder: pending,
        reasoning: 'The player contingency is transfer; RuleDecider prioritizes the best remaining pending target.',
      }
    }

    return {
      action: DECIDER_ACTIONS.CONTINUE,
      targetCardId: affectedCardId,
      reasoning: 'RuleDecider keeps the remaining plan unchanged.',
    }
  },

  async summarize(input = {}) {
    const completedCards = input.completedCards ?? []
    const netProfit = roundEth(completedCards.reduce((sum, card) => sum + (Number(card.actualProfit) || 0), 0))
    const incidents = input.executionLog?.filter((entry) => entry.incident).length ?? 0

    return {
      reasoning: 'RuleDecider summarizes deterministic semi-loop execution.',
      summary: `Semi-loop execution complete: ${completedCards.length} cards, ${incidents} replanning incidents, net ${formatSignedEth(netProfit)}.`,
      netProfit,
      decisionHighlights: [
        {
          momentLabel: incidents > 0 ? 'iterative_repair' : 'workflow_closure',
          description:
            incidents > 0
              ? 'Executor only replanned after simulator incidents and otherwise followed the player battle plan.'
              : 'Executor completed the planned order without unnecessary replanning calls.',
        },
      ],
    }
  },
}

function chooseCards(cards = [], gasPool, maxCards) {
  const sortedCards = [...cards].sort((a, b) => expectedValue(b) - expectedValue(a))
  const selected = []
  let reservedGas = 0

  for (const card of sortedCards) {
    if (selected.length >= maxCards) break
    const minimumGas = Math.max(0, Math.round(card.gasCost ?? 0))
    if (reservedGas + minimumGas > gasPool) continue
    selected.push(card)
    reservedGas += minimumGas
  }

  return selected
}

function allocateGas(cards, gasPool) {
  if (cards.length === 0) return {}

  const baseAllocations = Object.fromEntries(cards.map((card) => [card.id, Math.max(0, Math.round(card.gasCost ?? 0))]))
  let remainingGas = gasPool - Object.values(baseAllocations).reduce((sum, gas) => sum + gas, 0)
  const rankedCards = [...cards].sort((a, b) => expectedValue(b) - expectedValue(a))

  while (remainingGas > 0 && rankedCards.length > 0) {
    for (const card of rankedCards) {
      if (remainingGas <= 0) break
      const increment = Math.min(remainingGas, Math.max(1, Math.ceil((card.gasCost ?? 1) * 0.1)))
      baseAllocations[card.id] += increment
      remainingGas -= increment
    }
  }

  return baseAllocations
}

function contingencyFor(card, selectedCards) {
  if ((card.displayedRisk ?? card.trueRisk ?? 0) >= 0.65) return selectedCards.length > 1 ? 'transfer' : 'abandon'
  if (card.type === 'front_run' || card.type === 'sandwich') return 'fight'
  return DEFAULT_CONTINGENCY
}

function expectedValue(card) {
  return (card.expectedProfit ?? 0) * (1 - (card.displayedRisk ?? card.trueRisk ?? 0)) - (card.gasCost ?? 0) * 0.001
}

function buildAffordableAllocations(cards, remainingGasPool) {
  const allocations = []
  let reserved = 0
  const pending = cards
    .filter((card) => card.status === 'pending' || card.status === 'in_progress')
    .sort((a, b) => expectedValue(b) - expectedValue(a))

  for (const card of pending) {
    const gas = Math.max(0, Math.round(Number(card.allocatedGas ?? card.gasCost) || 0))
    if (gas === 0 || reserved + gas > remainingGasPool) continue
    allocations.push({ cardId: card.id, gas })
    reserved += gas
  }

  return allocations
}

function decideOnPlayerIntervention(snapshot) {
  const instruction = parsePlayerInstruction(snapshot.playerInstruction)
  if (instruction.mode !== 'shortcut') {
    return {
      action: DECIDER_ACTIONS.CONTINUE,
      targetCardId: snapshot.affectedCardId,
      reasoning: '当前保底模式，请用快捷指令。',
    }
  }

  if (instruction.shortcutId === 'abandon_highest_risk') {
    const target = highestRiskCard(snapshot.allCardStatuses ?? [])
    return {
      action: target ? DECIDER_ACTIONS.ABANDON_CARD : DECIDER_ACTIONS.CONTINUE,
      targetCardId: target?.id ?? snapshot.affectedCardId,
      reasoning: target
        ? `Shortcut parsed: abandon highest-risk card ${target.id}.`
        : 'Shortcut parsed, but no actionable card remains to abandon.',
    }
  }

  if (instruction.shortcutId === 'focus_best_gas') {
    const target = instruction.targetCardId
      ? (snapshot.allCardStatuses ?? []).find((card) => card.id === instruction.targetCardId)
      : bestExpectedValueCard(snapshot.allCardStatuses ?? [])
    const gas = Math.max(0, Math.round(Number(snapshot.remainingGasPool) || 0))
    return {
      action: target && gas > 0 ? DECIDER_ACTIONS.REALLOCATE_GAS : DECIDER_ACTIONS.CONTINUE,
      targetCardId: target?.id ?? snapshot.affectedCardId,
      gasAllocations: target && gas > 0 ? [{ cardId: target.id, gas }] : [],
      updatedExecutionOrder: target ? [target.id] : [],
      reasoning: target
        ? `Shortcut parsed: focus remaining gas on ${target.id}.`
        : 'Shortcut parsed, but no actionable card remains for gas focus.',
    }
  }

  if (instruction.shortcutId === 'fight_all') {
    const allocations = distributeRemainingGas(snapshot.allCardStatuses ?? [], snapshot.remainingGasPool)
    return {
      action: allocations.length > 0 ? DECIDER_ACTIONS.REALLOCATE_GAS : DECIDER_ACTIONS.CONTINUE,
      targetCardId: snapshot.affectedCardId,
      gasAllocations: allocations,
      updatedExecutionOrder: allocations.map((item) => item.cardId),
      reasoning: allocations.length > 0
        ? 'Shortcut parsed: keep all remaining targets live and spread gas across them.'
        : 'Shortcut parsed, but no actionable cards remain.',
    }
  }

  return {
    action: DECIDER_ACTIONS.CONTINUE,
    targetCardId: snapshot.affectedCardId,
    reasoning: 'Unknown shortcut; keep the current plan.',
  }
}

function actionableCards(cards) {
  return cards.filter((card) => card.status === 'pending' || card.status === 'in_progress')
}

function highestRiskCard(cards) {
  return actionableCards(cards).sort((a, b) => (b.displayedRisk ?? b.trueRisk ?? 0) - (a.displayedRisk ?? a.trueRisk ?? 0))[0]
}

function bestExpectedValueCard(cards) {
  return actionableCards(cards).sort((a, b) => expectedValue(b) - expectedValue(a))[0]
}

function distributeRemainingGas(cards, remainingGasPool) {
  const actionable = actionableCards(cards)
  if (actionable.length === 0) return []

  const totalGas = Math.max(0, Math.round(Number(remainingGasPool) || 0))
  if (totalGas === 0) return []

  const base = Math.floor(totalGas / actionable.length)
  let remainder = totalGas - base * actionable.length

  return actionable.map((card) => {
    const extra = remainder > 0 ? 1 : 0
    remainder -= extra
    return { cardId: card.id, gas: base + extra }
  })
}

function roundEth(value) {
  return Math.round(value * 1000) / 1000
}

function formatSignedEth(value) {
  return `${value >= 0 ? '+' : ''}${Number(value ?? 0).toFixed(3)} ETH`
}
