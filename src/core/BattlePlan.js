import { CONTINGENCY_ACTIONS, DECISION_LIMITS, DEFAULT_CONTINGENCY } from '../config/decision.js'

const CONTINGENCY_SET = new Set(CONTINGENCY_ACTIONS)

export function createBattlePlan(input = {}) {
  const selectedCards = Array.isArray(input.selectedCards) ? input.selectedCards : []
  const gasAllocations = normalizeGasAllocations(input.gasAllocations)
  const contingencies = normalizeContingencies(input.contingencies, selectedCards)

  return {
    selectedCards,
    gasAllocations,
    contingencies,
  }
}

export function validateBattlePlan(plan, constraints = {}) {
  const selectedCards = Array.isArray(plan?.selectedCards) ? plan.selectedCards : []
  const gasAllocations = plan?.gasAllocations && typeof plan.gasAllocations === 'object' ? plan.gasAllocations : {}
  const contingencies = plan?.contingencies && typeof plan.contingencies === 'object' ? plan.contingencies : {}
  const gasPool = clampNumber(constraints.gasPool ?? 0, 0)
  const maxCards = clampInt(constraints.maxCards ?? Number.MAX_SAFE_INTEGER, 0)
  const errors = []

  if (selectedCards.length === 0) {
    errors.push({ code: 'NO_SELECTED_CARDS', message: 'Select at least one card.' })
  }

  if (selectedCards.length > maxCards) {
    errors.push({
      code: 'TOO_MANY_CARDS',
      message: `Selected ${selectedCards.length} cards, max is ${maxCards}.`,
      selectedCount: selectedCards.length,
      maxCards,
    })
  }

  let totalGas = 0
  const selectedIds = selectedCards.map(cardIdOf)

  for (const cardId of selectedIds) {
    if (!Object.hasOwn(gasAllocations, cardId)) {
      errors.push({ code: 'MISSING_GAS_ALLOCATION', message: `Missing gas allocation for ${cardId}.`, cardId })
      continue
    }

    const gas = gasAllocations[cardId]
    if (!Number.isFinite(gas) || gas < DECISION_LIMITS.minGasPerSelectedCard) {
      errors.push({ code: 'NEGATIVE_GAS', message: `Invalid gas allocation for ${cardId}.`, cardId, gas })
      continue
    }

    totalGas += gas
  }

  const allocationIds = Object.keys(gasAllocations)
  for (const cardId of allocationIds) {
    if (!selectedIds.includes(cardId)) {
      errors.push({ code: 'UNKNOWN_ALLOCATION_CARD', message: `Gas allocated to unselected card ${cardId}.`, cardId })
    }
  }

  if (totalGas > gasPool) {
    errors.push({
      code: 'GAS_OVER_POOL',
      message: `Allocated ${totalGas} Gas, pool is ${gasPool} Gas.`,
      totalGas,
      gasPool,
    })
  }

  for (const cardId of selectedIds) {
    if (!Object.hasOwn(contingencies, cardId)) {
      errors.push({ code: 'MISSING_CONTINGENCY', message: `Missing contingency for ${cardId}.`, cardId })
      continue
    }

    if (!CONTINGENCY_SET.has(contingencies[cardId])) {
      errors.push({
        code: 'INVALID_CONTINGENCY',
        message: `Invalid contingency for ${cardId}.`,
        cardId,
        contingency: contingencies[cardId],
      })
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    selectedCount: selectedCards.length,
    maxCards,
    totalGas,
    gasPool,
    remainingGas: Math.max(0, gasPool - totalGas),
  }
}

export function battlePlanToGasAllocationArray(plan) {
  return Object.entries(plan?.gasAllocations ?? {}).map(([cardId, gas]) => ({ cardId, gas }))
}

export function cardIdOf(card) {
  return typeof card === 'string' ? card : card?.id
}

function normalizeGasAllocations(gasAllocations = {}) {
  if (Array.isArray(gasAllocations)) {
    return Object.fromEntries(gasAllocations.map((item) => [item.cardId, clampNumber(item.gas ?? 0, Number.NEGATIVE_INFINITY)]))
  }

  if (!gasAllocations || typeof gasAllocations !== 'object') return {}

  return Object.fromEntries(
    Object.entries(gasAllocations).map(([cardId, gas]) => [cardId, clampNumber(gas, Number.NEGATIVE_INFINITY)]),
  )
}

function normalizeContingencies(contingencies = {}, selectedCards = []) {
  const normalized = {}
  const source = contingencies && typeof contingencies === 'object' ? contingencies : {}

  for (const card of selectedCards) {
    const cardId = cardIdOf(card)
    normalized[cardId] = Object.hasOwn(source, cardId) ? source[cardId] : DEFAULT_CONTINGENCY
  }

  return normalized
}

function clampNumber(value, min) {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.max(min, Math.round(number))
}

function clampInt(value, min) {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.max(min, Math.round(number))
}
