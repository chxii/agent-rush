import test from 'node:test'
import assert from 'node:assert/strict'

import { createBattlePlan } from '../src/core/BattlePlan.js'
import { RuleDecider } from '../src/core/RuleDecider.js'
import { runSemiLoopExecution } from '../src/core/SemiLoopExecutor.js'
import { createToolSimulator } from '../src/core/ToolSimulator.js'
import { runBatchSimulation } from '../sim/run-batch.js'
import { createInterventionState, requestPlayerIntervention } from '../src/core/PlayerIntervention.js'

test('semi-loop replans with a real snapshot when the second card is stolen', async () => {
  const cards = createCards()
  const battlePlan = createBattlePlan({
    selectedCards: cards,
    gasAllocations: { a: 30, b: 30, c: 30 },
    contingencies: { a: 'fight', b: 'transfer', c: 'fight' },
  })
  const decider = createSpyDecider()

  const result = await runSemiLoopExecution(
    battlePlan,
    { gasPool: 100, layer: 8, scene: 'nft_market' },
    {
      decider,
      fallbackDecider: RuleDecider,
      simulatorFactory: createScriptedSimulatorFactory({ broadcasts: ['success', 'stolen', 'success'] }),
      maxReplans: 3,
    },
  )

  assert.equal(decider.incidentSnapshots.length, 1)
  const snapshot = decider.incidentSnapshots[0]
  assert.equal(snapshot.event, 'target_stolen')
  assert.equal(snapshot.affectedCardId, 'b')
  assert.equal(snapshot.remainingGasPool, 40)
  assert.equal(snapshot.playerContingency, 'transfer')
  assert.equal(snapshot.trigger.stolen, true)
  assert.equal(snapshot.allCardStatuses.find((card) => card.id === 'a').status, 'success')
  assert.equal(snapshot.allCardStatuses.find((card) => card.id === 'b').status, 'failed')
  assert.equal(snapshot.allCardStatuses.find((card) => card.id === 'c').status, 'pending')
  assert.equal(result.telemetry.replans, 1)
})

test('semi-loop handles gas insufficiency through a narrow replan decision', async () => {
  const cards = createCards().slice(0, 2)
  const battlePlan = createBattlePlan({
    selectedCards: cards,
    gasAllocations: { a: 40, b: 40 },
    contingencies: { a: 'fight', b: 'fight' },
  })
  const decider = createSpyDecider()

  const result = await runSemiLoopExecution(
    battlePlan,
    { gasPool: 50, layer: 8, scene: 'nft_market' },
    {
      decider,
      fallbackDecider: RuleDecider,
      simulatorFactory: createScriptedSimulatorFactory({ broadcasts: ['success', 'insufficient'] }),
      maxReplans: 2,
    },
  )

  assert.equal(decider.incidentSnapshots.length, 1)
  assert.equal(decider.incidentSnapshots[0].event, 'gas_insufficient')
  assert.ok(['reallocate_gas', 'abandon_card', 'retry_broadcast'].includes(result.telemetry.incidentDecisions[0].decision.action))
})

test('semi-loop re-broadcasts a card after a replan tops up its gas', async () => {
  const cards = createCards().slice(0, 2)
  const battlePlan = createBattlePlan({
    selectedCards: cards,
    gasAllocations: { a: 40, b: 40 },
    contingencies: { a: 'fight', b: 'fight' },
  })

  const result = await runSemiLoopExecution(
    battlePlan,
    { gasPool: 50, layer: 8, scene: 'nft_market' },
    {
      decider: createReallocateDecider(),
      fallbackDecider: RuleDecider,
      // b 首次广播 Gas 不足，补足后重广播应当成交。
      simulatorFactory: createScriptedSimulatorFactory({ broadcasts: ['success', 'insufficient', 'success'] }),
      maxReplans: 3,
    },
  )

  const b = result.cards.find((card) => card.id === 'b')
  assert.equal(b.status, 'success')
  assert.equal(result.telemetry.incidents.length, 1)
  assert.equal(result.telemetry.incidents[0].event, 'gas_insufficient')
})

test('semi-loop abandons a card when a re-broadcast still cannot afford gas', async () => {
  const cards = createCards().slice(0, 2)
  const battlePlan = createBattlePlan({
    selectedCards: cards,
    gasAllocations: { a: 40, b: 40 },
    contingencies: { a: 'fight', b: 'fight' },
  })

  const result = await runSemiLoopExecution(
    battlePlan,
    { gasPool: 50, layer: 8, scene: 'nft_market' },
    {
      decider: createReallocateDecider(),
      fallbackDecider: RuleDecider,
      // b 持续 Gas 不足：重广播一次后仍失败，落回兜底放弃。
      simulatorFactory: createScriptedSimulatorFactory({ broadcasts: ['success', 'insufficient', 'insufficient', 'insufficient'] }),
      maxReplans: 3,
    },
  )

  const b = result.cards.find((card) => card.id === 'b')
  assert.equal(b.status, 'abandoned')
})

test('semi-loop limits re-broadcasts to one attempt per card', async () => {
  const cards = createCards().slice(0, 2)
  const battlePlan = createBattlePlan({
    selectedCards: cards,
    gasAllocations: { a: 40, b: 40 },
    contingencies: { a: 'fight', b: 'fight' },
  })

  const broadcastIds = []
  const result = await runSemiLoopExecution(
    battlePlan,
    { gasPool: 50, layer: 8, scene: 'nft_market' },
    {
      decider: createReallocateDecider(),
      fallbackDecider: RuleDecider,
      simulatorFactory: createScriptedSimulatorFactory({
        broadcasts: ['success', 'insufficient', 'insufficient', 'insufficient'],
        onBroadcast: (params) => broadcastIds.push(params.cardId),
      }),
      maxReplans: 3,
    },
  )

  // b: 初次广播 + 至多一次重广播 = 2 次，不会无限重试。
  assert.equal(broadcastIds.filter((id) => id === 'b').length, 2)
  assert.equal(result.cards.find((card) => card.id === 'b').status, 'abandoned')
})

test('semi-loop does not replan on a smooth round', async () => {
  const cards = createCards().slice(0, 2)
  const battlePlan = createBattlePlan({
    selectedCards: cards,
    gasAllocations: { a: 30, b: 30 },
    contingencies: { a: 'fight', b: 'fight' },
  })
  const decider = createSpyDecider()

  const result = await runSemiLoopExecution(
    battlePlan,
    { gasPool: 100, layer: 1, scene: 'dex_arb' },
    {
      decider,
      fallbackDecider: RuleDecider,
      simulatorFactory: createScriptedSimulatorFactory({ broadcasts: ['success', 'success'] }),
      maxReplans: 2,
    },
  )

  assert.equal(decider.incidentSnapshots.length, 0)
  assert.equal(result.incidents.length, 0)
  assert.equal(result.telemetry.deciderCalls.decideOnIncident, 0)
})

test('semi-loop emits normalized initial execution order before card execution', async () => {
  const cards = createCards()
  const battlePlan = createBattlePlan({
    selectedCards: cards,
    gasAllocations: { a: 30, b: 30, c: 30 },
    contingencies: { a: 'fight', b: 'fight', c: 'fight' },
  })
  const events = []
  const decider = {
    async planInitial() {
      return { reasoning: 'Run c first, then a; normalization appends b.', executionOrder: ['c', 'a'] }
    },
    async decideOnIncident(snapshot) {
      return RuleDecider.decideOnIncident(snapshot)
    },
    async summarize(input) {
      return RuleDecider.summarize(input)
    },
  }

  await runSemiLoopExecution(
    battlePlan,
    { gasPool: 100, layer: 1, scene: 'dex_arb' },
    {
      decider,
      fallbackDecider: RuleDecider,
      simulatorFactory: createScriptedSimulatorFactory({ broadcasts: ['success', 'success', 'success'] }),
      hooks: {
        onInitialPlan({ executionOrder }) {
          events.push(['initial', executionOrder])
        },
        onCardStart({ card }) {
          events.push(['start', card.id])
        },
      },
    },
  )

  assert.deepEqual(events[0], ['initial', ['c', 'a', 'b']])
  assert.deepEqual(events.slice(1).map((item) => item[1]), ['c', 'a', 'b'])
})

test('semi-loop hides trueRisk and isScam from decider inputs and incident snapshots', async () => {
  const cards = [
    card('a', { displayedRisk: 0.1, trueRisk: 0.95, isScam: true }),
    card('b', { displayedRisk: 0.2, trueRisk: 0.8 }),
  ]
  const inputs = []
  const battlePlan = createBattlePlan({
    selectedCards: cards,
    gasAllocations: { a: 30, b: 30 },
    contingencies: { a: 'fight', b: 'fight' },
  })
  const decider = createSpyDecider({
    async planInitial(input) {
      inputs.push(input)
      return RuleDecider.planInitial(input)
    },
    async decideOnIncident(snapshot) {
      return RuleDecider.decideOnIncident(snapshot)
    },
    async summarize(input) {
      return RuleDecider.summarize(input)
    },
  })

  await runSemiLoopExecution(
    battlePlan,
    { gasPool: 100, layer: 8, scene: 'nft_market' },
    {
      decider,
      fallbackDecider: RuleDecider,
      simulatorFactory: createScriptedSimulatorFactory({ broadcasts: ['stolen', 'success'] }),
      maxReplans: 2,
    },
  )

  assert.equal('trueRisk' in inputs[0].cards[0], false)
  assert.equal('isScam' in inputs[0].cards[0], false)
  assert.equal(inputs[0].cards[0].displayedRisk, 0.1)
  assert.equal('trueRisk' in decider.incidentSnapshots[0].allCardStatuses[0], false)
  assert.equal('isScam' in decider.incidentSnapshots[0].allCardStatuses[0], false)
})

test('semi-loop uses rule fallback after the replan limit is reached', async () => {
  const cards = createCards()
  const battlePlan = createBattlePlan({
    selectedCards: cards,
    gasAllocations: { a: 25, b: 25, c: 25 },
    contingencies: { a: 'fight', b: 'fight', c: 'fight' },
  })
  const primary = createSpyDecider()
  const fallback = createSpyDecider()

  const result = await runSemiLoopExecution(
    battlePlan,
    { gasPool: 100, layer: 8, scene: 'nft_market' },
    {
      decider: primary,
      fallbackDecider: fallback,
      simulatorFactory: createScriptedSimulatorFactory({ broadcasts: ['stolen', 'stolen', 'stolen'] }),
      maxReplans: 1,
    },
  )

  assert.equal(primary.incidentSnapshots.length, 1)
  assert.equal(fallback.incidentSnapshots.length, 2)
  assert.ok(result.telemetry.fallbackReasons.some((item) => item.reason === 'replan_limit'))
  assert.equal(result.telemetry.incidentDecisions.filter((item) => item.decision.fallback).length, 2)
})

test('semi-loop passes remaining time and competitor bid into broadcast_tx', async () => {
  const broadcastInputs = []
  const cards = [card('a', { type: 'front_run', gasCost: 80, timeWindowSec: 12 })]
  const battlePlan = createBattlePlan({
    selectedCards: cards,
    gasAllocations: { a: 80 },
    contingencies: { a: 'fight' },
  })

  await runSemiLoopExecution(
    battlePlan,
    { gasPool: 200, layer: 8, scene: 'nft_market' },
    {
      decider: RuleDecider,
      fallbackDecider: RuleDecider,
      simulatorFactory: createScriptedSimulatorFactory({
        broadcasts: ['success'],
        monitorBid: 55,
        onBroadcast(params) {
          broadcastInputs.push(params)
        },
      }),
      maxReplans: 1,
    },
  )

  assert.equal(broadcastInputs.length, 1)
  assert.equal(broadcastInputs[0].competitorGasBid, 55)
  assert.equal(typeof broadcastInputs[0].elapsedSec, 'number')
  assert.equal(broadcastInputs[0].remainingTimeWindowSec, 9)
})

test('shortcut player intervention does not spend LLM replan budget', async () => {
  const interventionState = createInterventionState()
  requestPlayerIntervention(interventionState, { type: 'shortcut', shortcutId: 'abandon_highest_risk' })
  const cards = [card('a', { trueRisk: 0.9, displayedRisk: 0.9 })]
  const battlePlan = createBattlePlan({
    selectedCards: cards,
    gasAllocations: { a: 30 },
    contingencies: { a: 'fight' },
  })

  const result = await runSemiLoopExecution(
    battlePlan,
    { gasPool: 100, layer: 1, scene: 'dex_arb' },
    {
      decider: createSpyDecider(),
      fallbackDecider: RuleDecider,
      simulatorFactory: createScriptedSimulatorFactory({ broadcasts: ['success'] }),
      interventionState,
      maxReplans: 1,
    },
  )

  assert.equal(result.incidents.length, 1)
  assert.equal(result.incidents[0].event, 'player_intervention')
  assert.equal(result.telemetry.replans, 0)
  assert.equal(result.telemetry.deciderCalls.decideOnIncident, 0)
})

test('meaningful stolen incident waits for intervention window and consumes player command first', async () => {
  const cards = createCards().slice(0, 2)
  const battlePlan = createBattlePlan({
    selectedCards: cards,
    gasAllocations: { a: 30, b: 30 },
    contingencies: { a: 'fight', b: 'fight' },
  })
  const interventionState = createInterventionState()
  const decider = createSpyDecider()

  const result = await runSemiLoopExecution(
    battlePlan,
    { gasPool: 100, layer: 8, scene: 'nft_market' },
    {
      decider,
      fallbackDecider: RuleDecider,
      simulatorFactory: createScriptedSimulatorFactory({ broadcasts: ['stolen', 'success'] }),
      interventionState,
      maxReplans: 2,
      interventionWindow: async () => {
        requestPlayerIntervention(interventionState, { type: 'shortcut', shortcutId: 'abandon_highest_risk' })
      },
    },
  )

  assert.equal(result.incidents.length, 2)
  assert.equal(result.incidents[0].event, 'target_stolen')
  assert.equal(result.incidents[1].event, 'player_intervention')
  assert.equal(decider.incidentSnapshots.length, 0)
  assert.equal(result.telemetry.interventionUsed, true)
  assert.equal(result.telemetry.deciderCalls.decideOnIncident, 0)
})

test('terminal tx failure with remaining cards opens guarded intervention window', async () => {
  const cards = createCards().slice(0, 2)
  const battlePlan = createBattlePlan({
    selectedCards: cards,
    gasAllocations: { a: 30, b: 30 },
    contingencies: { a: 'fight', b: 'fight' },
  })
  const interventionState = createInterventionState()
  let windowCalls = 0

  const result = await runSemiLoopExecution(
    battlePlan,
    { gasPool: 100, layer: 8, scene: 'nft_market' },
    {
      decider: createSpyDecider(),
      fallbackDecider: RuleDecider,
      simulatorFactory: createScriptedSimulatorFactory({ broadcasts: ['failed', 'success'] }),
      interventionState,
      maxReplans: 2,
      interventionWindow: async () => {
        windowCalls += 1
      },
    },
  )

  assert.equal(windowCalls, 1)
  assert.equal(result.incidents[0].event, 'tx_failed')
  assert.equal(result.cards.find((item) => item.id === 'a').status, 'failed')
})

test('terminal tx failure on the last schedulable card does not create a useless incident', async () => {
  const cards = [card('a')]
  const battlePlan = createBattlePlan({
    selectedCards: cards,
    gasAllocations: { a: 30 },
    contingencies: { a: 'fight' },
  })
  let windowCalls = 0

  const result = await runSemiLoopExecution(
    battlePlan,
    { gasPool: 100, layer: 8, scene: 'nft_market' },
    {
      decider: createSpyDecider(),
      fallbackDecider: RuleDecider,
      simulatorFactory: createScriptedSimulatorFactory({ broadcasts: ['failed'] }),
      interventionState: createInterventionState(),
      maxReplans: 2,
      interventionWindow: async () => {
        windowCalls += 1
      },
    },
  )

  assert.equal(windowCalls, 0)
  assert.equal(result.incidents.length, 0)
})

test('meaningless or already-used incidents do not open an intervention window', async () => {
  const cards = [card('a')]
  const battlePlan = createBattlePlan({
    selectedCards: cards,
    gasAllocations: { a: 30 },
    contingencies: { a: 'fight' },
  })
  let windowCalls = 0

  await runSemiLoopExecution(
    battlePlan,
    { gasPool: 30, layer: 8, scene: 'nft_market' },
    {
      decider: createSpyDecider(),
      fallbackDecider: RuleDecider,
      simulatorFactory: createScriptedSimulatorFactory({ broadcasts: ['stolen'] }),
      maxReplans: 2,
      interventionState: createInterventionState(),
      interventionWindow: async () => {
        windowCalls += 1
      },
    },
  )

  assert.equal(windowCalls, 0)
})

test('intervention window timeout or skip falls back to automatic incident decision', async () => {
  const cards = createCards().slice(0, 2)
  const battlePlan = createBattlePlan({
    selectedCards: cards,
    gasAllocations: { a: 30, b: 30 },
    contingencies: { a: 'fight', b: 'fight' },
  })
  let windowCalls = 0
  const decider = createSpyDecider()

  const result = await runSemiLoopExecution(
    battlePlan,
    { gasPool: 100, layer: 8, scene: 'nft_market' },
    {
      decider,
      fallbackDecider: RuleDecider,
      simulatorFactory: createScriptedSimulatorFactory({ broadcasts: ['stolen', 'success'] }),
      maxReplans: 2,
      interventionState: createInterventionState(),
      interventionWindow: async () => {
        windowCalls += 1
      },
    },
  )

  assert.equal(windowCalls, 1)
  assert.equal(result.incidents.filter((item) => item.event === 'player_intervention').length, 0)
  assert.equal(decider.incidentSnapshots.length, 1)
  assert.equal(result.telemetry.deciderCalls.decideOnIncident, 1)
})

test('semi-loop formats reallocate gas trace params without object placeholders', async () => {
  const interventionState = createInterventionState()
  requestPlayerIntervention(interventionState, { type: 'shortcut', shortcutId: 'fight_all' })
  const cards = createCards().slice(0, 2)
  const battlePlan = createBattlePlan({
    selectedCards: cards,
    gasAllocations: { a: 10, b: 10 },
    contingencies: { a: 'fight', b: 'fight' },
  })

  const result = await runSemiLoopExecution(
    battlePlan,
    { gasPool: 100, layer: 1, scene: 'dex_arb' },
    {
      decider: createSpyDecider(),
      fallbackDecider: RuleDecider,
      simulatorFactory: createScriptedSimulatorFactory({ broadcasts: ['success', 'success'] }),
      interventionState,
      maxReplans: 1,
    },
  )

  const reallocateEvent = result.cards
    .flatMap((item) => item.events)
    .find((event) => event.title === 'reallocate_gas')

  assert.ok(reallocateEvent)
  assert.match(reallocateEvent.meta, /allocations=/)
  assert.match(reallocateEvent.meta, /a:\d+/)
  assert.doesNotMatch(reallocateEvent.meta, /\[object Object\]/)
})

test('headless 1000 RuleDecider runs do not crash and have bounded semi-loop incidents', async () => {
  const runs = 1000
  let incidents = 0

  for (let index = 0; index < runs; index += 1) {
    const result = await runBatchSimulation({ seed: `a4-${index}` })
    assert.equal(result.status, 'ok')
    incidents += result.summary.incidents
  }

  const incidentRate = incidents / runs
  assert.ok(incidentRate > 0.05, `incidentRate=${incidentRate}`)
  assert.ok(incidentRate < 2.5, `incidentRate=${incidentRate}`)
})

function createSpyDecider(base = RuleDecider) {
  return {
    incidentSnapshots: [],

    async planInitial(input) {
      return base.planInitial(input)
    },

    async decideOnIncident(snapshot) {
      this.incidentSnapshots.push(snapshot)
      return base.decideOnIncident(snapshot)
    },

    async summarize(input) {
      return base.summarize(input)
    },
  }
}

// 重规划时把全部剩余 Gas 池补给受影响牌（模拟玩家「集中保这张」或 LLM 补 Gas）。
function createReallocateDecider(base = RuleDecider) {
  return {
    async planInitial(input) {
      return base.planInitial(input)
    },

    async decideOnIncident(snapshot) {
      const eventType = snapshot.trigger?.type ?? snapshot.event
      if (eventType === 'gas_insufficient') {
        const affectedCardId = snapshot.affectedCardId ?? snapshot.trigger?.cardId
        const pool = Math.max(0, Math.round(Number(snapshot.remainingGasPool) || 0))
        return {
          action: 'reallocate_gas',
          targetCardId: affectedCardId,
          gasAllocations: [{ cardId: affectedCardId, gas: pool }],
          updatedExecutionOrder: [affectedCardId],
          reasoning: 'Top up the affected card with the whole remaining pool.',
        }
      }
      return base.decideOnIncident(snapshot)
    },

    async summarize(input) {
      return base.summarize(input)
    },
  }
}

function createScriptedSimulatorFactory(script = {}) {
  return (options = {}) => {
    const simulator = createToolSimulator({ ...options, botName: null })
    let broadcastIndex = 0

    return {
      state: simulator.state,

      snapshot() {
        return simulator.snapshot()
      },

      execute(toolName, params = {}) {
        if (toolName === 'monitor_mempool' && script.monitorBid) {
          simulator.state.competitors[params.cardId] = {
            competitorDetected: true,
            competitorGasBid: script.monitorBid,
            stealProbability: 0.5,
          }
          return {
            success: true,
            tool: 'monitor_mempool',
            cardId: params.cardId,
            message: 'Scripted competitor detected.',
            competitorDetected: true,
            competitorName: 'Phantom',
            competitorGasBid: script.monitorBid,
            stealProbability: 0.5,
          }
        }

        if (toolName === 'broadcast_tx') {
          script.onBroadcast?.(params)
          const outcome = script.broadcasts?.[broadcastIndex] ?? 'success'
          broadcastIndex += 1

          if (outcome === 'success') return settleScripted(simulator.state, params, 'success')
          if (outcome === 'failed') return settleScripted(simulator.state, params, 'failed')
          if (outcome === 'stolen') return settleScripted(simulator.state, params, 'failed', true)
          if (outcome === 'insufficient') {
            return {
              success: false,
              invalid: true,
              tool: 'broadcast_tx',
              cardId: params.cardId,
              message: 'Gas 池不足，无法广播交易。',
              requestedGas: params.gas,
              remainingGasPool: simulator.state.gasPool,
            }
          }
        }

        return simulator.execute(toolName, params)
      },
    }
  }
}

function settleScripted(state, params, status, stolen = false) {
  const card = state.cards.find((item) => item.id === params.cardId)
  const gas = Math.max(0, Math.round(Number(params.gas) || 0))
  state.gasPool = Math.max(0, state.gasPool - gas)
  state.gasUsed += gas
  card.gasUsed = (card.gasUsed ?? 0) + gas
  card.allocatedGas = gas
  card.status = status
  card.actualProfit = status === 'success' ? card.expectedProfit : -gas / 1000
  card.resultReason = stolen ? '目标被 Phantom 抢走。' : status === 'success' ? '交易已在链上确认。' : '交易回滚。'

  return {
    success: status === 'success',
    tool: 'broadcast_tx',
    cardId: card.id,
    message: card.resultReason,
    status,
    stolen,
    actualProfit: card.actualProfit,
    actualGasConsumed: gas,
    remainingGasPool: state.gasPool,
    successProbability: status === 'success' ? 1 : 0,
    stealProbability: stolen ? 1 : 0,
    bidPosition: params.competitorGasBid > 0 ? (gas >= params.competitorGasBid ? 'overbid' : 'underbid') : 'not_compared',
    windowExpired: false,
  }
}

function createCards() {
  return [
    card('a', { expectedProfit: 3, gasCost: 30 }),
    card('b', { expectedProfit: 2, gasCost: 30 }),
    card('c', { expectedProfit: 1, gasCost: 30 }),
  ]
}

function card(id, overrides = {}) {
  return {
    id,
    type: overrides.type ?? 'arbitrage',
    rarity: 'rare',
    expectedProfit: overrides.expectedProfit ?? 1,
    displayedRisk: overrides.displayedRisk ?? 0.2,
    trueRisk: overrides.trueRisk ?? 0.2,
    isScam: overrides.isScam ?? false,
    gasCost: overrides.gasCost ?? 30,
    timeWindowSec: overrides.timeWindowSec ?? 30,
    competitionLevel: 1,
    status: 'pending',
    actualProfit: 0,
  }
}
