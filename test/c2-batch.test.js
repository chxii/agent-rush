import test from 'node:test'
import assert from 'node:assert/strict'

import {
  STRATEGY_NAMES,
  createStrategyDecider,
  runBatchGames,
  runFullGameSimulation,
} from '../sim/run-batch.js'

test('C2 strategy deciders create distinct legal battle plans', () => {
  const cards = [
    card('safe', { expectedProfit: 0.8, displayedRisk: 0.1, trueRisk: 0.1, gasCost: 20 }),
    card('greedy', { expectedProfit: 4, displayedRisk: 0.8, trueRisk: 0.8, gasCost: 20 }),
    card('middle', { expectedProfit: 1.5, displayedRisk: 0.3, trueRisk: 0.3, gasCost: 20 }),
  ]
  const plans = STRATEGY_NAMES.map((strategy) => createStrategyDecider(strategy, { seed: strategy }).createBattlePlan(cards, {
    gasPool: 80,
    maxCards: 2,
  }))

  assert.equal(plans.length, 4)
  for (const plan of plans) assert.equal(plan.validation.valid, true)
  assert.equal(plans[1].battlePlan.selectedCards[0].id, 'greedy')
  assert.equal(plans[3].battlePlan.selectedCards[0].id, 'middle')
  assert.notDeepEqual(plans[0].battlePlan.gasAllocations, plans[1].battlePlan.gasAllocations)
})

test('C2 full game simulation advances through layers headlessly', async () => {
  const result = await runFullGameSimulation({
    seed: 'c2-full-smoke',
    strategy: 'expert',
    role: 'scout',
    fromLayer: 1,
    toLayer: 20,
  })

  assert.equal(result.status, 'ok')
  assert.ok(result.layersCompleted >= 1)
  assert.ok(result.layersCompleted <= 20)
  assert.ok(['victory', 'failed', 'completed_range', 'completed_no_victory'].includes(result.outcome))
  assert.equal(result.layers[0].layer, 1)
  assert.equal(result.layers.every((layer) => layer.battlePlan.valid), true)
})

test('C2 batch aggregation reports strategy, role, card, gas, and half-loop metrics', async () => {
  const first = await runBatchGames({
    seed: 'c2-batch',
    runs: 2,
    strategies: 'random,expert',
    roles: 'scout,resist',
    toLayer: 4,
  })
  const second = await runBatchGames({
    seed: 'c2-batch',
    runs: 2,
    strategies: 'random,expert',
    roles: 'scout,resist',
    toLayer: 4,
  })

  assert.deepEqual(first.metrics, second.metrics)
  assert.equal(first.status, 'ok')
  assert.equal(first.metrics.totalGames, 8)
  assert.equal(typeof first.metrics.byStrategy.random.passRate, 'number')
  assert.equal(typeof first.metrics.byStrategy.expert.averageLayersCompleted, 'number')
  assert.equal(typeof first.metrics.byRole.scout.passRate, 'number')
  assert.equal(typeof first.metrics.cardTypes.arbitrage.useRate, 'number')
  assert.equal(typeof first.metrics.gasHealth.averageGasUsedRate, 'number')
  assert.equal(typeof first.metrics.halfLoopTriggerRate, 'number')
  assert.equal(typeof first.metrics.averageHalfLoopTriggersPerGame, 'number')
  assert.equal(Array.isArray(first.metrics.cumulativeProfitCurve), true)
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
    timeWindowSec: overrides.timeWindowSec ?? 30,
    competitionLevel: 1,
    status: 'pending',
    actualProfit: 0,
  }
}
