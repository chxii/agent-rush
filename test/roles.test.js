import test from 'node:test'
import assert from 'node:assert/strict'

import { ROLE_IDS } from '../src/config/roles.js'
import { generateHand, injectScamCardNextHand } from '../src/core/CardGenerator.js'
import { GameState } from '../src/core/GameState.js'
import { createMemoryStorage } from '../src/core/storage.js'
import { createToolSimulator } from '../src/core/ToolSimulator.js'
import { createSequenceRng } from '../src/core/rng.js'
import { runBatchSimulation } from '../sim/run-batch.js'

test('scout role scans more cards while other roles use the base count', () => {
  const base = generateHand('dex_arb', ROLE_IDS.RESIST, 1, { rng: createSequenceRng(repeating(0.5, 100)) })
  const scout = generateHand('dex_arb', ROLE_IDS.SCOUT, 1, { rng: createSequenceRng(repeating(0.5, 100)) })
  const efficiency = generateHand('dex_arb', ROLE_IDS.EFFICIENCY, 1, { rng: createSequenceRng(repeating(0.5, 100)) })

  assert.equal(base.length, 3)
  assert.equal(efficiency.length, 3)
  assert.ok(scout.length > base.length)
})

test('scout scan bonus scales by role level', () => {
  const level1 = generateHand('dex_arb', ROLE_IDS.SCOUT, 1, { rng: createSequenceRng(repeating(0.5, 100)) })
  const level2 = generateHand('dex_arb', ROLE_IDS.SCOUT, 2, { rng: createSequenceRng(repeating(0.5, 100)) })
  const level3 = generateHand('dex_arb', ROLE_IDS.SCOUT, 3, { rng: createSequenceRng(repeating(0.5, 100)) })

  assert.equal(level1.length, 4)
  assert.equal(level2.length, 5)
  assert.equal(level3.length, 6)
})

test('resist role reduces steal probability under the same mempool pressure', () => {
  const normal = monitorWithRole(ROLE_IDS.SCOUT)
  const resist = monitorWithRole(ROLE_IDS.RESIST)

  assert.ok(resist.stealProbability < normal.stealProbability)
})

test('resist role makes replace_tx cheaper and easier', () => {
  const normal = replaceWithRole(ROLE_IDS.SCOUT)
  const resist = replaceWithRole(ROLE_IDS.RESIST)

  assert.ok(resist.requiredBid < normal.requiredBid)
  assert.ok(resist.suppressProbability > normal.suppressProbability)
})

test('efficiency role raises gas pool cap for the same layer', () => {
  const storage = createMemoryStorage()
  GameState.init({ storage })
  GameState.setRole(ROLE_IDS.SCOUT)
  const base = GameState.gasPoolMaxForStage(8)

  GameState.setRole(ROLE_IDS.EFFICIENCY)
  const efficiency = GameState.gasPoolMaxForStage(8)

  assert.ok(efficiency > base)
})

test('scam cards remain disguised after risk analyzer removal', () => {
  injectScamCardNextHand()
  const cards = generateHand('new_token', ROLE_IDS.SCOUT, 1, { rng: createSequenceRng(repeating(0.5, 100)) })
  const scam = cards.find((card) => card.isScam)

  assert.ok(scam)
  assert.equal(scam.displayedRisk, 0.08)
  assert.ok(scam.trueRisk > 0.8)
  assert.ok(scam.expectedProfit >= 2.4)
})

test('all three roles can run headless batches without crashing', async () => {
  for (const role of Object.values(ROLE_IDS)) {
    let netProfit = 0
    let successes = 0
    for (let index = 0; index < 100; index += 1) {
      const result = await runBatchSimulation({ seed: `${role}-${index}`, role, roleLevel: 1 })
      assert.equal(result.status, 'ok')
      netProfit += result.summary.netProfit
      successes += result.summary.successes
    }

    assert.equal(Number.isFinite(netProfit), true)
    assert.ok(successes >= 0)
  }
})

function monitorWithRole(role) {
  const simulator = createToolSimulator({
    cards: [card()],
    gasPool: 120,
    layer: 8,
    role,
    roleLevel: 1,
    rng: createSequenceRng([0]),
    allocations: [{ cardId: 'role_card', gas: 40 }],
  })
  return simulator.execute('monitor_mempool', { cardId: 'role_card' })
}

function replaceWithRole(role) {
  const simulator = createToolSimulator({
    cards: [card()],
    gasPool: 200,
    layer: 8,
    role,
    roleLevel: 1,
    rng: createSequenceRng([0.99]),
    allocations: [{ cardId: 'role_card', gas: 40 }],
  })
  simulator.state.competitors.role_card = {
    competitorDetected: true,
    competitorGasBid: 60,
    stealProbability: 0.5,
  }
  return simulator.execute('replace_tx', { cardId: 'role_card', newGas: 70 })
}

function card() {
  return {
    id: 'role_card',
    type: 'front_run',
    rarity: 'rare',
    expectedProfit: 1,
    displayedRisk: 0.2,
    trueRisk: 0.2,
    gasCost: 40,
    timeWindowSec: 30,
    competitionLevel: 3,
    status: 'pending',
    actualProfit: 0,
  }
}

function repeating(value, count) {
  return Array.from({ length: count }, () => value)
}
