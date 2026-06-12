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
        ? 'RuleDecider 已选择可负担的机会牌，分配玩家侧 Gas，并设置遇袭预案。'
        : 'RuleDecider 未能生成合法作战方案。',
    }
  },

  async planInitial(input = {}) {
    return normalizeInitialPlan(
      {
        reasoning: 'RuleDecider 按预期价值排序已选机会牌，并保持玩家 Gas 分配不变。',
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
          reasoning: 'Gas 池不足，RuleDecider 将剩余 Gas 重新分配给还能负担的待执行牌。',
        }
      }

      return {
        action: DECIDER_ACTIONS.ABANDON_CARD,
        targetCardId: affectedCardId,
        reasoning: 'Gas 池已经耗尽，RuleDecider 放弃受影响的机会牌。',
      }
    }

    if (eventType === INCIDENT_TYPES.TX_FAILED
      || eventType === INCIDENT_TYPES.TARGET_INVALID
      || eventType === INCIDENT_TYPES.WINDOW_EXPIRED) {
      const affordable = buildAffordableAllocations(snapshot.allCardStatuses ?? [], remainingGasPool)
      return {
        action: affordable.length > 0 ? DECIDER_ACTIONS.REALLOCATE_GAS : DECIDER_ACTIONS.CONTINUE,
        targetCardId: affectedCardId,
        gasAllocations: affordable,
        updatedExecutionOrder: affordable.map((item) => item.cardId),
        reasoning: affordable.length > 0
          ? '这张牌已经失败，RuleDecider 不尝试救回它，而是把剩余 Gas 重新调度给还能执行的牌。'
          : '这张牌已经失败，现场没有可继续调度的剩余资源，保持结果不变。',
      }
    }

    if (eventType === INCIDENT_TYPES.TARGET_STOLEN && playerContingency === 'fight' && remainingGasPool > 0) {
      const competitorBid = Math.max(0, Math.round(Number(snapshot.trigger?.competitorGasBid) || 0))
      const gas = Math.min(currentGas + remainingGasPool, Math.max(currentGas + 1, Math.ceil(competitorBid * 1.1)))
      return {
        action: DECIDER_ACTIONS.REPLACE_TX,
        targetCardId: affectedCardId,
        gas,
        reasoning: '玩家预案为硬刚，RuleDecider 在机会仍可处理时尝试一次替换出价。',
      }
    }

    if (playerContingency === 'abandon') {
      return {
        action: DECIDER_ACTIONS.ABANDON_CARD,
        targetCardId: affectedCardId,
        reasoning: '玩家预案或交易失败结果倾向于放弃当前目标，保留其余机会。',
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
        reasoning: '玩家预案为转移，RuleDecider 优先推进剩余待执行目标中预期价值最高的一张。',
      }
    }

    return {
      action: DECIDER_ACTIONS.CONTINUE,
      targetCardId: affectedCardId,
      reasoning: 'RuleDecider 保持剩余计划不变。',
    }
  },

  async summarize(input = {}) {
    const completedCards = input.completedCards ?? []
    const netProfit = roundEth(completedCards.reduce((sum, card) => sum + (Number(card.actualProfit) || 0), 0))
    const incidents = input.executionLog?.filter((entry) => entry.incident).length ?? 0

    return {
      reasoning: 'RuleDecider 汇总确定性半闭环执行结果。',
      summary: `半闭环执行完成：${completedCards.length} 张牌，${incidents} 次重规划事件，净收益 ${formatSignedEth(netProfit)}。`,
      netProfit,
      decisionHighlights: [
        {
          momentLabel: incidents > 0 ? 'iterative_repair' : 'workflow_closure',
          description:
            incidents > 0
              ? 'Executor 只在模拟器事件后触发重规划，其余时间遵循玩家作战方案。'
              : 'Executor 按计划顺序完成执行，没有发起不必要的重规划调用。',
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
        ? `快捷指令已解析：放弃最高风险牌 ${target.id}。`
        : '快捷指令已解析，但没有可放弃的可行动牌。',
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
        ? `快捷指令已解析：将剩余 Gas 集中到 ${target.id}。`
        : '快捷指令已解析，但没有可集中 Gas 的可行动牌。',
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
        ? '快捷指令已解析：保留所有剩余目标，并在它们之间分配 Gas。'
        : '快捷指令已解析，但没有剩余可行动牌。',
    }
  }

  return {
    action: DECIDER_ACTIONS.CONTINUE,
    targetCardId: snapshot.affectedCardId,
    reasoning: '未知快捷指令，保持当前计划。',
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
