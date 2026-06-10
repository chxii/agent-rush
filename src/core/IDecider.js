export const INCIDENT_TYPES = {
  TARGET_STOLEN: 'target_stolen',
  GAS_INSUFFICIENT: 'gas_insufficient',
  PLAYER_INTERVENTION: 'player_intervention',
  TARGET_INVALID: 'target_invalid',
}

export const DECIDER_ACTIONS = {
  CONTINUE: 'continue',
  RETRY_BROADCAST: 'retry_broadcast',
  REPLACE_TX: 'replace_tx',
  ABANDON_CARD: 'abandon_card',
  REALLOCATE_GAS: 'reallocate_gas',
  SKIP_CARD: 'skip_card',
}

const ACTION_SET = new Set(Object.values(DECIDER_ACTIONS))

export function normalizeInitialPlan(plan = {}, cards = []) {
  const cardIds = cards.map((card) => card.id)
  const seen = new Set()
  const executionOrder = []

  for (const cardId of Array.isArray(plan.executionOrder) ? plan.executionOrder : []) {
    if (!cardIds.includes(cardId) || seen.has(cardId)) continue
    seen.add(cardId)
    executionOrder.push(cardId)
  }

  for (const cardId of cardIds) {
    if (!seen.has(cardId)) executionOrder.push(cardId)
  }

  return {
    reasoning: String(plan.reasoning ?? 'Using default execution order.'),
    executionOrder,
  }
}

export function normalizeIncidentDecision(decision = {}, fallback = {}) {
  const action = ACTION_SET.has(decision.action) ? decision.action : fallback.action ?? DECIDER_ACTIONS.CONTINUE
  return {
    action,
    targetCardId: decision.targetCardId ?? fallback.targetCardId ?? null,
    gas: finiteInteger(decision.gas, fallback.gas),
    gasAllocations: normalizeGasAllocations(decision.gasAllocations ?? fallback.gasAllocations),
    updatedExecutionOrder: Array.isArray(decision.updatedExecutionOrder) ? [...decision.updatedExecutionOrder] : [],
    reasoning: String(decision.reasoning ?? fallback.reasoning ?? 'Continue with the safest remaining action.'),
  }
}

export function isValidIncidentDecision(decision) {
  if (!decision || typeof decision !== 'object') return false
  if (!ACTION_SET.has(decision.action)) return false
  if (decision.gas !== undefined && (!Number.isFinite(Number(decision.gas)) || Number(decision.gas) < 0)) return false
  if (decision.gasAllocations !== undefined && !Array.isArray(decision.gasAllocations)) return false
  return true
}

function normalizeGasAllocations(allocations) {
  if (!Array.isArray(allocations)) return []
  return allocations
    .filter((item) => item && item.cardId && Number.isFinite(Number(item.gas)))
    .map((item) => ({ cardId: item.cardId, gas: Math.max(0, Math.round(Number(item.gas))) }))
}

function finiteInteger(value, fallback) {
  if (Number.isFinite(Number(value))) return Math.max(0, Math.round(Number(value)))
  if (Number.isFinite(Number(fallback))) return Math.max(0, Math.round(Number(fallback)))
  return undefined
}
