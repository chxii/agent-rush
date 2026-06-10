import test from 'node:test'
import assert from 'node:assert/strict'

import { createToolSimulator } from '../src/core/ToolSimulator.js'
import { createSequenceRng } from '../src/core/rng.js'

test('liquidation fails immediately when the hard time window is missed', () => {
  const simulator = createToolSimulator({
    cards: [cardOfType('liquidation')],
    gasPool: 100,
    botName: null,
    rng: createSequenceRng([0]),
  })

  const result = simulator.execute('broadcast_tx', {
    cardId: 'liquidation_card',
    gas: 40,
    elapsedSec: 31,
  })

  assert.equal(result.success, false)
  assert.equal(result.status, 'failed')
  assert.equal(result.windowExpired, true)
  assert.equal(result.successProbability, 0)
  assert.equal(simulator.snapshot().cards[0].status, 'failed')
})

test('liquidation inside the window still uses the normal broadcast result shape', () => {
  const simulator = createToolSimulator({
    cards: [cardOfType('liquidation')],
    gasPool: 100,
    botName: null,
    rng: createSequenceRng([0.01, 0.5]),
  })

  const result = simulator.execute('broadcast_tx', {
    cardId: 'liquidation_card',
    gas: 40,
    elapsedSec: 12,
  })

  assert.equal(result.windowExpired, false)
  assert.equal(typeof result.successProbability, 'number')
  assert.equal(typeof result.actualProfit, 'number')
  assert.ok(['success', 'failed'].includes(result.status))
})

test('front_run success probability has distinct overbid and underbid branches', () => {
  const overbid = runBroadcast('front_run', {
    gas: 80,
    competitorGasBid: 60,
  })
  const underbid = runBroadcast('front_run', {
    gas: 40,
    competitorGasBid: 60,
  })

  assert.equal(overbid.result.bidPosition, 'overbid')
  assert.equal(underbid.result.bidPosition, 'underbid')
  assert.ok(overbid.result.successProbability - underbid.result.successProbability > 0.4)
})

test('sandwich gets more marginal success probability from gas than arbitrage', () => {
  const sandwichLow = runBroadcast('sandwich', { gas: 20 }).result.successProbability
  const sandwichHigh = runBroadcast('sandwich', { gas: 50 }).result.successProbability
  const arbitrageLow = runBroadcast('arbitrage', { gas: 20 }).result.successProbability
  const arbitrageHigh = runBroadcast('arbitrage', { gas: 50 }).result.successProbability

  const sandwichDelta = sandwichHigh - sandwichLow
  const arbitrageDelta = arbitrageHigh - arbitrageLow
  assert.ok(sandwichDelta > arbitrageDelta * 1.5, `sandwich=${sandwichDelta}, arbitrage=${arbitrageDelta}`)
})

test('nft_snipe has wider successful profit variance than arbitrage', () => {
  const nftProfits = collectSuccessfulProfits('nft_snipe')
  const arbitrageProfits = collectSuccessfulProfits('arbitrage')

  assert.ok(stddev(nftProfits) > stddev(arbitrageProfits) * 2)
})

test('arbitrage has lower steal probability than nft_snipe under the same pressure', () => {
  const arbitrage = monitor('arbitrage')
  const nft = monitor('nft_snipe')

  assert.ok(nft.stealProbability > arbitrage.stealProbability * 2)
})

test('unknown card type falls back to default mechanics without crashing', () => {
  const simulator = createToolSimulator({
    cards: [
      {
        ...cardOfType('arbitrage'),
        id: 'unknown_card',
        type: 'bridge_arb',
      },
    ],
    gasPool: 100,
    botName: null,
    rng: createSequenceRng([0.1, 0.5]),
  })

  const result = simulator.execute('broadcast_tx', { cardId: 'unknown_card', gas: 40 })
  assert.equal(result.invalid, undefined)
  assert.equal(typeof result.successProbability, 'number')
})

function runBroadcast(type, overrides = {}) {
  const gas = overrides.gas ?? 40
  const simulator = createToolSimulator({
    cards: [cardOfType(type)],
    gasPool: 120,
    botName: null,
    rng: createSequenceRng([0.99, 0.5]),
    allocations: [{ cardId: `${type}_card`, gas }],
  })
  const result = simulator.execute('broadcast_tx', {
    cardId: `${type}_card`,
    gas,
    competitorGasBid: overrides.competitorGasBid,
  })
  return { simulator, result }
}

function monitor(type) {
  const simulator = createToolSimulator({
    cards: [cardOfType(type)],
    gasPool: 120,
    layer: 8,
    rng: createSequenceRng([0]),
    allocations: [{ cardId: `${type}_card`, gas: 40 }],
  })
  return simulator.execute('monitor_mempool', { cardId: `${type}_card` })
}

function collectSuccessfulProfits(type) {
  const profits = []
  for (let index = 0; index < 500; index += 1) {
    const simulator = createToolSimulator({
      cards: [
        {
          ...cardOfType(type),
          trueRisk: 0.01,
          displayedRisk: 0.01,
          expectedProfit: 1,
        },
      ],
      gasPool: 200,
      botName: null,
      seed: `${type}-${index}`,
      allocations: [{ cardId: `${type}_card`, gas: 100 }],
    })
    const result = simulator.execute('broadcast_tx', { cardId: `${type}_card`, gas: 100 })
    if (result.success) profits.push(result.actualProfit)
  }
  return profits
}

function cardOfType(type) {
  return {
    id: `${type}_card`,
    type,
    rarity: 'rare',
    expectedProfit: 1,
    displayedRisk: 0.2,
    trueRisk: 0.2,
    gasCost: 40,
    timeWindowSec: 30,
    competitionLevel: 2,
    status: 'pending',
    actualProfit: 0,
  }
}

function stddev(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}
