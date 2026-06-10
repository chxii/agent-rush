import test from 'node:test'
import assert from 'node:assert/strict'

import { createBattlePlan } from '../src/core/BattlePlan.js'
import { RuleDecider } from '../src/core/RuleDecider.js'
import { runSemiLoopExecution } from '../src/core/SemiLoopExecutor.js'
import { createToolSimulator } from '../src/core/ToolSimulator.js'
import { runBatchSimulation } from '../sim/run-batch.js'

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
              message: 'Insufficient gas pool for broadcast.',
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
  card.resultReason = stolen ? 'Target stolen by Phantom.' : status === 'success' ? 'Transaction confirmed on chain.' : 'Transaction reverted.'

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
    gasCost: overrides.gasCost ?? 30,
    timeWindowSec: overrides.timeWindowSec ?? 30,
    competitionLevel: 1,
    status: 'pending',
    actualProfit: 0,
  }
}
