import test from 'node:test'
import assert from 'node:assert/strict'

import { createBattlePlan, validateBattlePlan } from '../src/core/BattlePlan.js'
import { RuleDecider } from '../src/core/RuleDecider.js'
import { createToolSimulator } from '../src/core/ToolSimulator.js'
import { runBatchSimulation } from '../sim/run-batch.js'

test('battle plan validation rejects gas over pool', () => {
  const plan = createBattlePlan({
    selectedCards: [card('a'), card('b')],
    gasAllocations: { a: 80, b: 40 },
    contingencies: { a: 'fight', b: 'abandon' },
  })

  const validation = validateBattlePlan(plan, { gasPool: 100, maxCards: 3 })
  assert.equal(validation.valid, false)
  assert.ok(validation.errors.some((error) => error.code === 'GAS_OVER_POOL'))
})

test('battle plan validation rejects too many cards', () => {
  const plan = createBattlePlan({
    selectedCards: [card('a'), card('b'), card('c')],
    gasAllocations: { a: 20, b: 20, c: 20 },
    contingencies: { a: 'fight', b: 'abandon', c: 'transfer' },
  })

  const validation = validateBattlePlan(plan, { gasPool: 100, maxCards: 2 })
  assert.equal(validation.valid, false)
  assert.ok(validation.errors.some((error) => error.code === 'TOO_MANY_CARDS'))
})

test('battle plan validation rejects negative gas', () => {
  const plan = createBattlePlan({
    selectedCards: [card('a')],
    gasAllocations: { a: -1 },
    contingencies: { a: 'fight' },
  })

  const validation = validateBattlePlan(plan, { gasPool: 100, maxCards: 2 })
  assert.equal(validation.valid, false)
  assert.ok(validation.errors.some((error) => error.code === 'NEGATIVE_GAS'))
})

test('battle plan validation rejects empty allocation for a selected card', () => {
  const plan = createBattlePlan({
    selectedCards: [card('a')],
    gasAllocations: {},
    contingencies: { a: 'fight' },
  })

  const validation = validateBattlePlan(plan, { gasPool: 100, maxCards: 2 })
  assert.equal(validation.valid, false)
  assert.ok(validation.errors.some((error) => error.code === 'MISSING_GAS_ALLOCATION'))
})

test('battle plan validation rejects invalid contingency actions', () => {
  const plan = createBattlePlan({
    selectedCards: [card('a')],
    gasAllocations: { a: 20 },
    contingencies: { a: 'retry' },
  })

  const validation = validateBattlePlan(plan, { gasPool: 100, maxCards: 2 })
  assert.equal(validation.valid, false)
  assert.ok(validation.errors.some((error) => error.code === 'INVALID_CONTINGENCY'))
})

test('RuleDecider creates a legal battle plan and can enter a headless execution path', () => {
  const cards = [card('a', { expectedProfit: 1.2, gasCost: 30 }), card('b', { expectedProfit: 0.7, gasCost: 20 })]
  const decision = RuleDecider.createBattlePlan(cards, { gasPool: 80, maxCards: 2 })

  assert.equal(decision.validation.valid, true)
  assert.equal(decision.battlePlan.selectedCards.length > 0, true)
  assert.equal(Object.keys(decision.battlePlan.gasAllocations).length, decision.battlePlan.selectedCards.length)

  const simulator = createToolSimulator({
    cards: decision.battlePlan.selectedCards,
    gasPool: 80,
    botName: null,
    seed: 'rule-decision',
    allocations: Object.entries(decision.battlePlan.gasAllocations).map(([cardId, gas]) => ({ cardId, gas })),
  })
  const firstCard = decision.battlePlan.selectedCards[0]
  const result = simulator.execute('broadcast_tx', {
    cardId: firstCard.id,
    gas: decision.battlePlan.gasAllocations[firstCard.id],
  })

  assert.equal(result.invalid, undefined)
  assert.ok(['success', 'failed'].includes(result.status))
})

test('batch sim uses a valid RuleDecider battle plan', () => {
  const result = runBatchSimulation({ seed: 'a3-seed' })

  assert.equal(result.status, 'ok')
  assert.equal(result.battlePlan.valid, true)
  assert.equal(result.battlePlan.selectedCardIds.length > 0, true)
})

function card(id, overrides = {}) {
  return {
    id,
    type: overrides.type ?? 'arbitrage',
    rarity: 'rare',
    expectedProfit: overrides.expectedProfit ?? 1,
    displayedRisk: overrides.displayedRisk ?? 0.2,
    trueRisk: overrides.trueRisk ?? 0.2,
    gasCost: overrides.gasCost ?? 30,
    timeWindowSec: 30,
    competitionLevel: 1,
    status: 'pending',
    actualProfit: 0,
  }
}
