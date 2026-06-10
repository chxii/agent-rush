import { DEFAULT_CONTINGENCY } from '../config/decision.js'
import { createBattlePlan, validateBattlePlan } from './BattlePlan.js'

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
