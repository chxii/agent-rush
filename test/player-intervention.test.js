import test from 'node:test'
import assert from 'node:assert/strict'

import { createBattlePlan } from '../src/core/BattlePlan.js'
import { INCIDENT_TYPES } from '../src/core/IDecider.js'
import {
  createInterventionState,
  requestPlayerIntervention,
} from '../src/core/PlayerIntervention.js'
import { RuleDecider } from '../src/core/RuleDecider.js'
import { runSemiLoopExecution } from '../src/core/SemiLoopExecutor.js'
import { createToolSimulator } from '../src/core/ToolSimulator.js'

test('player intervention can only be accepted once per round', () => {
  const state = createInterventionState()
  const first = requestPlayerIntervention(state, { type: 'natural', text: 'Protect the second card' })
  const second = requestPlayerIntervention(state, { type: 'shortcut', shortcutId: 'fight_all' })

  assert.equal(first.accepted, true)
  assert.equal(state.interventionUsed, true)
  assert.equal(second.accepted, false)
  assert.match(second.message, /already used/i)
})

test('RuleDecider parses all intervention shortcuts into narrow decisions', async () => {
  const snapshot = interventionSnapshot()

  const fightAll = await RuleDecider.decideOnIncident({
    ...snapshot,
    playerInstruction: 'shortcut:fight_all',
  })
  assert.equal(fightAll.action, 'reallocate_gas')
  assert.equal(fightAll.gasAllocations.length, 3)

  const abandonHighestRisk = await RuleDecider.decideOnIncident({
    ...snapshot,
    playerInstruction: 'shortcut:abandon_highest_risk',
  })
  assert.equal(abandonHighestRisk.action, 'abandon_card')
  assert.equal(abandonHighestRisk.targetCardId, 'high_risk')

  const focusBest = await RuleDecider.decideOnIncident({
    ...snapshot,
    playerInstruction: 'shortcut:focus_best_gas',
  })
  assert.equal(focusBest.action, 'reallocate_gas')
  assert.deepEqual(focusBest.gasAllocations, [{ cardId: 'best_ev', gas: 90 }])

  const focusTarget = await RuleDecider.decideOnIncident({
    ...snapshot,
    playerInstruction: 'shortcut:focus_best_gas:low_ev',
  })
  assert.equal(focusTarget.action, 'reallocate_gas')
  assert.deepEqual(focusTarget.gasAllocations, [{ cardId: 'low_ev', gas: 90 }])
})

test('pending intervention enters the semi-loop through PLAYER_INTERVENTION incident snapshots', async () => {
  const cards = [card('first'), card('second')]
  const battlePlan = createBattlePlan({
    selectedCards: cards,
    gasAllocations: { first: 30, second: 30 },
    contingencies: { first: 'fight', second: 'fight' },
  })
  const interventionState = createInterventionState()
  const request = requestPlayerIntervention(interventionState, {
    type: 'shortcut',
    shortcutId: 'abandon_highest_risk',
  })
  const decider = createSpyDecider()

  assert.equal(request.accepted, true)

  const result = await runSemiLoopExecution(
    battlePlan,
    { gasPool: 100, layer: 1, scene: 'dex_arb' },
    {
      decider,
      fallbackDecider: RuleDecider,
      interventionState,
      simulatorFactory: createScriptedSimulatorFactory(),
      maxReplans: 2,
    },
  )

  assert.equal(decider.incidentSnapshots.length, 1)
  assert.equal(decider.incidentSnapshots[0].event, INCIDENT_TYPES.PLAYER_INTERVENTION)
  assert.equal(decider.incidentSnapshots[0].playerInstruction, 'shortcut:abandon_highest_risk')
  assert.equal(result.telemetry.interventionUsed, true)
})

test('RuleDecider fallback keeps shortcuts useful and rejects natural-language intervention', async () => {
  const shortcutDecision = await RuleDecider.decideOnIncident({
    ...interventionSnapshot(),
    playerInstruction: 'shortcut:abandon_highest_risk',
  })
  const naturalDecision = await RuleDecider.decideOnIncident({
    ...interventionSnapshot(),
    playerInstruction: 'Move gas away from the risky card',
  })

  assert.equal(shortcutDecision.action, 'abandon_card')
  assert.equal(naturalDecision.action, 'continue')
  assert.match(naturalDecision.reasoning, /快捷指令/)
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

function createScriptedSimulatorFactory() {
  return (options = {}) => {
    const simulator = createToolSimulator({ ...options, seed: options.seed ?? 'player-intervention', botName: null })

    return {
      state: simulator.state,

      snapshot() {
        return simulator.snapshot()
      },

      execute(toolName, params = {}) {
        if (toolName === 'broadcast_tx') return settleSuccess(simulator.state, params)
        return simulator.execute(toolName, params)
      },
    }
  }
}

function settleSuccess(state, params) {
  const target = state.cards.find((item) => item.id === params.cardId)
  const gas = Math.max(0, Math.round(Number(params.gas) || 0))
  state.gasPool = Math.max(0, state.gasPool - gas)
  state.gasUsed += gas
  target.gasUsed = (target.gasUsed ?? 0) + gas
  target.status = 'success'
  target.actualProfit = target.expectedProfit
  target.resultReason = 'Transaction confirmed on chain.'
  return {
    success: true,
    tool: 'broadcast_tx',
    cardId: target.id,
    message: target.resultReason,
    status: 'success',
    stolen: false,
    actualProfit: target.actualProfit,
    actualGasConsumed: gas,
    remainingGasPool: state.gasPool,
    successProbability: 1,
    stealProbability: 0,
    windowExpired: false,
  }
}

function interventionSnapshot() {
  return {
    event: INCIDENT_TYPES.PLAYER_INTERVENTION,
    affectedCardId: 'best_ev',
    remainingGasPool: 90,
    allCardStatuses: [
      card('best_ev', { expectedProfit: 3, displayedRisk: 0.2, gasCost: 30 }),
      card('high_risk', { expectedProfit: 1, displayedRisk: 0.85, gasCost: 30 }),
      card('low_ev', { expectedProfit: 0.5, displayedRisk: 0.1, gasCost: 30 }),
    ].map((item) => ({
      ...item,
      allocatedGas: item.gasCost,
      gasUsed: 0,
      status: 'pending',
    })),
    trigger: {
      type: INCIDENT_TYPES.PLAYER_INTERVENTION,
      cardId: 'best_ev',
      tool: 'player_intervention',
      message: 'Player intervention queued.',
    },
    playerContingency: 'fight',
    competitors: {},
  }
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
    timeWindowSec: 30,
    competitionLevel: 1,
    status: 'pending',
    actualProfit: 0,
  }
}
