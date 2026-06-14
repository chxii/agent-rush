import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { runBatchSimulation } from '../sim/run-batch.js'
import { createToolSimulator } from '../src/core/ToolSimulator.js'
import { createSequenceRng } from '../src/core/rng.js'

test('tool simulator can execute all A1 tools with structured results', () => {
  const cards = createCards()
  const simulator = createToolSimulator({
    cards,
    gasPool: 220,
    layer: 8,
    rng: createSequenceRng([0.95, 0.5, 0.2, 0.1, 0.1, 0.5]),
    allocations: [
      { cardId: 'card_A', gas: 45 },
      { cardId: 'card_B', gas: 40 },
    ],
  })

  const fetchResult = simulator.execute('fetch_prices', { cardId: 'card_A' })
  assert.equal(fetchResult.tool, 'fetch_prices')
  assert.equal(typeof fetchResult.success, 'boolean')
  assert.equal(typeof fetchResult.message, 'string')
  assert.equal(typeof fetchResult.priceGapEth, 'number')

  const mempoolResult = simulator.execute('monitor_mempool', { cardId: 'card_A' })
  assert.equal(mempoolResult.tool, 'monitor_mempool')
  assert.equal(typeof mempoolResult.competitorDetected, 'boolean')
  assert.equal(typeof mempoolResult.stealProbability, 'number')

  const replacementResult = simulator.execute('scan_replacement', { cardId: 'card_A' })
  assert.equal(replacementResult.tool, 'scan_replacement')
  assert.equal(replacementResult.foundReplacement, true)
  assert.equal(replacementResult.replacementCardId, 'card_B')

  const reallocateResult = simulator.execute('reallocate_gas', {
    allocations: [
      { cardId: 'card_A', gas: 55 },
      { cardId: 'card_B', gas: 35 },
    ],
  })
  assert.equal(reallocateResult.tool, 'reallocate_gas')
  assert.equal(reallocateResult.success, true)
  assert.deepEqual(reallocateResult.updatedAllocations, [
    { cardId: 'card_A', gas: 55 },
    { cardId: 'card_B', gas: 35 },
  ])

  const replaceResult = simulator.execute('replace_tx', { cardId: 'card_A', newGas: 85 })
  assert.equal(replaceResult.tool, 'replace_tx')
  assert.equal(typeof replaceResult.suppressSucceeded, 'boolean')
  assert.equal(replaceResult.newAllocatedGas, 85)

  const abandonResult = simulator.execute('abandon_card', { cardId: 'card_B' })
  assert.equal(abandonResult.tool, 'abandon_card')
  assert.equal(abandonResult.success, true)
  assert.equal(abandonResult.abandoned, true)

  const broadcastResult = simulator.execute('broadcast_tx', { cardId: 'card_A', gas: 85 })
  assert.equal(broadcastResult.tool, 'broadcast_tx')
  assert.equal(typeof broadcastResult.actualProfit, 'number')
  assert.equal(typeof broadcastResult.actualGasConsumed, 'number')
  assert.ok(['success', 'failed'].includes(broadcastResult.status))
})

test('broadcast_tx mutates card status and gas pool deterministically', () => {
  const simulator = createToolSimulator({
    cards: [createCards()[0]],
    gasPool: 100,
    botName: null,
    rng: createSequenceRng([0.1, 0.5]),
    allocations: [{ cardId: 'card_A', gas: 40 }],
  })

  const result = simulator.execute('broadcast_tx', { cardId: 'card_A', gas: 40 })
  const snapshot = simulator.snapshot()

  assert.equal(result.success, true)
  assert.equal(result.status, 'success')
  assert.equal(result.actualGasConsumed, 40)
  assert.equal(snapshot.gasPool, 60)
  assert.equal(snapshot.gasUsed, 40)
  assert.equal(snapshot.cards[0].status, 'success')
  assert.equal(snapshot.cards[0].actualProfit, result.actualProfit)
})

test('illegal tool actions are rejected without mutating state', () => {
  const simulator = createToolSimulator({
    cards: [createCards()[0]],
    gasPool: 30,
    seed: 1,
  })
  const before = simulator.snapshot()

  const unknown = simulator.execute('not_a_tool', { cardId: 'card_A' })
  const insufficientGas = simulator.execute('broadcast_tx', { cardId: 'card_A', gas: 999 })
  const after = simulator.snapshot()

  assert.equal(unknown.success, false)
  assert.equal(unknown.invalid, true)
  assert.equal(insufficientGas.success, false)
  assert.equal(insufficientGas.invalid, true)
  assert.deepEqual(after, before)
})

test('reallocate_gas clamps over-pool requests to the remaining pool instead of rejecting', () => {
  // 回归：玩家/LLM 干预常按「原分配 + 追加」给出超过剩余池的绝对值（如要 78，池仅 33）。
  // 旧实现整体拒绝 → 受影响牌没补到 Gas → 干预看似生效实则改不动结局。
  // 现在应钳制到可用池：单牌请求超池则给到池上限，按请求顺序依次扣减。
  const simulator = createToolSimulator({ cards: createCards(), gasPool: 33, seed: 1 })

  const single = simulator.execute('reallocate_gas', { allocations: [{ cardId: 'card_A', gas: 78 }] })
  assert.equal(single.success, true)
  assert.deepEqual(single.updatedAllocations, [{ cardId: 'card_A', gas: 33 }])
  assert.equal(simulator.snapshot().cards.find((c) => c.id === 'card_A').allocatedGas, 33)

  // 多牌超池：按顺序填充，第一张吃满池后第二张拿到剩余 0。
  const sim2 = createToolSimulator({ cards: createCards(), gasPool: 33, seed: 1 })
  const multi = sim2.execute('reallocate_gas', {
    allocations: [
      { cardId: 'card_A', gas: 50 },
      { cardId: 'card_B', gas: 50 },
    ],
  })
  assert.deepEqual(multi.updatedAllocations, [
    { cardId: 'card_A', gas: 33 },
    { cardId: 'card_B', gas: 0 },
  ])
})

test('broadcast_tx success distribution tracks the configured probability', () => {
  const runs = 1000
  let successes = 0
  let expectedProbability = null

  for (let index = 0; index < runs; index += 1) {
    const simulator = createToolSimulator({
      cards: [createCards()[0]],
      gasPool: 100,
      botName: null,
      seed: `broadcast-${index}`,
      allocations: [{ cardId: 'card_A', gas: 40 }],
    })
    const result = simulator.execute('broadcast_tx', { cardId: 'card_A', gas: 40 })
    if (expectedProbability === null) expectedProbability = result.successProbability
    if (result.success) successes += 1
  }

  const observed = successes / runs
  assert.ok(Math.abs(observed - expectedProbability) < 0.05, `observed=${observed}, expected=${expectedProbability}`)
})

test('broadcast_tx failure reasons are localized and beginner-readable', () => {
  const simulator = createToolSimulator({
    cards: [createCards()[0]],
    gasPool: 100,
    botName: null,
    rng: createSequenceRng([0.999]),
    allocations: [{ cardId: 'card_A', gas: 40 }],
  })

  const result = simulator.execute('broadcast_tx', { cardId: 'card_A', gas: 40 })

  assert.equal(result.success, false)
  assert.equal(result.message, '没抢到这个区块，交易没打包成功。')
  assert.equal(/[A-Za-z]/.test(result.message), false)
})

test('fixed seed batch simulation is reproducible', async () => {
  const first = await runBatchSimulation({ seed: 'a1-seed' })
  const second = await runBatchSimulation({ seed: 'a1-seed' })
  const third = await runBatchSimulation({ seed: 'different-seed' })

  assert.deepEqual(first, second)
  assert.notDeepEqual(first, third)
})

test('ToolSimulator does not call Math.random directly', async () => {
  const source = await readFile(new URL('../src/core/ToolSimulator.js', import.meta.url), 'utf8')
  assert.equal(source.includes('Math.random'), false)
})

function createCards() {
  return [
    {
      id: 'card_A',
      type: 'arbitrage',
      rarity: 'rare',
      expectedProfit: 1.2,
      displayedRisk: 0.25,
      trueRisk: 0.3,
      gasCost: 40,
      timeWindowSec: 30,
      competitionLevel: 2,
      status: 'pending',
      actualProfit: 0,
    },
    {
      id: 'card_B',
      type: 'liquidation',
      rarity: 'rare',
      expectedProfit: 0.9,
      displayedRisk: 0.2,
      trueRisk: 0.25,
      gasCost: 35,
      timeWindowSec: 28,
      competitionLevel: 1,
      status: 'pending',
      actualProfit: 0,
    },
  ]
}
