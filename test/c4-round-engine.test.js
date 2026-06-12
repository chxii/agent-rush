import test from 'node:test'
import assert from 'node:assert/strict'

import { RoundEngine } from '../src/game/RoundEngine.js'
import { UIRenderer } from '../src/ui/UIRenderer.js'
import { ExecutionEngine } from '../src/game/ExecutionEngine.js'

test('tutorial helper is gated by tutorialSeen and only disables timers for active tutorial runs', () => {
  const originalState = RoundEngine.gameState

  try {
    RoundEngine.gameState = { currentLayer: 1, tutorialSeen: false }
    assert.equal(RoundEngine.isActiveTutorial(), true)

    RoundEngine.gameState = { currentLayer: 1, tutorialSeen: true }
    assert.equal(RoundEngine.isActiveTutorial(), false)

    RoundEngine.gameState = { currentLayer: 4, tutorialSeen: false }
    assert.equal(RoundEngine.isActiveTutorial(), false)
  } finally {
    RoundEngine.gameState = originalState
  }
})

test('decision changes re-render hand constraints so lowered Gas can re-enable blocked cards', () => {
  const originalState = captureRoundEngineState()
  const originalRenderHand = UIRenderer.renderHand
  const originalSetSelectionStatus = UIRenderer.setSelectionStatus
  const originalSetPlayEnabled = UIRenderer.setPlayEnabled
  const calls = []

  try {
    UIRenderer.renderHand = (cards, selectedIds, options) => {
      calls.push({ cards, selectedIds, options })
    }
    UIRenderer.setSelectionStatus = () => {}
    UIRenderer.setPlayEnabled = () => {}

    RoundEngine.gameState = { currentLayer: 4, gasPool: 200 }
    RoundEngine.currentHand = [
      card('selected', 150),
      card('candidate-a', 80),
      card('candidate-b', 80),
    ]
    RoundEngine.selectedIds = new Set(['selected'])
    RoundEngine.decisionDraft = {
      gasAllocations: { selected: 150 },
      contingencies: { selected: 'fight' },
    }

    RoundEngine.handleDecisionChange({ gasAllocations: { selected: 50 } })

    const rendered = calls.at(-1)
    assert.ok(rendered, 'renderHand should be called after decision change')
    assert.equal(rendered.options.constraints.selectedGas, 50)
    assert.equal(rendered.options.constraints.disabledReasons['candidate-a'], undefined)
    assert.equal(rendered.options.constraints.disabledReasons['candidate-b'], undefined)
  } finally {
    Object.assign(RoundEngine, originalState)
    UIRenderer.renderHand = originalRenderHand
    UIRenderer.setSelectionStatus = originalSetSelectionStatus
    UIRenderer.setPlayEnabled = originalSetPlayEnabled
  }
})

test('execute completion waits for explicit settle confirmation before settlement starts', async () => {
  const originalState = captureRoundEngineState()
  const originalRun = ExecutionEngine.runSemiLoopMode
  const originalRenderHand = UIRenderer.renderHand
  const originalSetPlayEnabled = UIRenderer.setPlayEnabled
  const originalSetSelectionStatus = UIRenderer.setSelectionStatus
  const originalSetTimerText = UIRenderer.setTimerText
  const originalSetExecutionMode = UIRenderer.setExecutionMode
  const originalInitPipeline = UIRenderer.initPipeline
  const originalSetInterventionState = UIRenderer.setInterventionState
  const originalSetPlayButtonLabel = UIRenderer.setPlayButtonLabel
  const originalTransition = RoundEngine.transition
  const labels = []
  const transitions = []

  try {
    ExecutionEngine.runSemiLoopMode = async (_battlePlan, _gameState, options) => {
      options.onExecutionComplete?.()
      return { cards: [], netProfit: 0, gasUsed: 0 }
    }
    UIRenderer.renderHand = () => {}
    UIRenderer.setPlayEnabled = () => {}
    UIRenderer.setSelectionStatus = () => {}
    UIRenderer.setTimerText = () => {}
    UIRenderer.setExecutionMode = () => {}
    UIRenderer.initPipeline = () => {}
    UIRenderer.setInterventionState = () => {}
    UIRenderer.setPlayButtonLabel = (label) => labels.push(label)
    RoundEngine.transition = (phase) => transitions.push(phase)

    RoundEngine.gameState = { currentLayer: 4, phase: 'execute', tutorialSeen: true, gasPool: 200 }
    RoundEngine.currentHand = [card('selected', 40)]
    RoundEngine.selectedIds = new Set(['selected'])
    RoundEngine.decisionDraft = {
      gasAllocations: { selected: 40 },
      contingencies: { selected: 'fight' },
    }
    RoundEngine.battlePlan = null

    await RoundEngine.startExecute()

    assert.equal(RoundEngine._settlementReady, true)
    assert.deepEqual(transitions, [])
    assert.equal(labels.at(-1), '结算')

    RoundEngine.confirmSettle()
    assert.deepEqual(transitions, ['settle'])
    assert.equal(RoundEngine._settlementReady, false)
  } finally {
    Object.assign(RoundEngine, originalState)
    ExecutionEngine.runSemiLoopMode = originalRun
    UIRenderer.renderHand = originalRenderHand
    UIRenderer.setPlayEnabled = originalSetPlayEnabled
    UIRenderer.setSelectionStatus = originalSetSelectionStatus
    UIRenderer.setTimerText = originalSetTimerText
    UIRenderer.setExecutionMode = originalSetExecutionMode
    UIRenderer.initPipeline = originalInitPipeline
    UIRenderer.setInterventionState = originalSetInterventionState
    UIRenderer.setPlayButtonLabel = originalSetPlayButtonLabel
    RoundEngine.transition = originalTransition
  }
})

test('tutorial layer 3 uses scripted decider, forced steal hook, and delay hook', async () => {
  const originalState = captureRoundEngineState()
  const originalRun = ExecutionEngine.runSemiLoopMode
  const originalRenderHand = UIRenderer.renderHand
  const originalSetPlayEnabled = UIRenderer.setPlayEnabled
  const originalSetSelectionStatus = UIRenderer.setSelectionStatus
  const originalSetTimerText = UIRenderer.setTimerText
  const originalSetExecutionMode = UIRenderer.setExecutionMode
  const originalInitPipeline = UIRenderer.initPipeline
  const originalSetInterventionState = UIRenderer.setInterventionState
  const originalSetPlayButtonLabel = UIRenderer.setPlayButtonLabel
  let capturedOptions = null

  try {
    ExecutionEngine.runSemiLoopMode = async (_battlePlan, _gameState, options) => {
      capturedOptions = options
      return { cards: [], netProfit: 0, gasUsed: 0 }
    }
    UIRenderer.renderHand = () => {}
    UIRenderer.setPlayEnabled = () => {}
    UIRenderer.setSelectionStatus = () => {}
    UIRenderer.setTimerText = () => {}
    UIRenderer.setExecutionMode = () => {}
    UIRenderer.initPipeline = () => {}
    UIRenderer.setInterventionState = () => {}
    UIRenderer.setPlayButtonLabel = () => {}

    RoundEngine.gameState = { currentLayer: 3, phase: 'execute', tutorialSeen: false, gasPool: 150 }
    RoundEngine.currentHand = [card('selected', 40)]
    RoundEngine.selectedIds = new Set(['selected'])
    RoundEngine.decisionDraft = {
      gasAllocations: { selected: 40 },
      contingencies: { selected: 'fight' },
    }
    RoundEngine.battlePlan = null

    await RoundEngine.startExecute()

    assert.ok(capturedOptions.decider, 'tutorial execution should pass a scripted decider')
    assert.equal(capturedOptions.config.toolDelayMs, 1)
    assert.equal(typeof capturedOptions.delay, 'function')
    assert.equal(capturedOptions.forceSteal(), true)
    assert.equal(RoundEngine._tutorialExecutionPaused, true)
    assert.equal(capturedOptions.forceSteal(), false)
  } finally {
    Object.assign(RoundEngine, originalState)
    ExecutionEngine.runSemiLoopMode = originalRun
    UIRenderer.renderHand = originalRenderHand
    UIRenderer.setPlayEnabled = originalSetPlayEnabled
    UIRenderer.setSelectionStatus = originalSetSelectionStatus
    UIRenderer.setTimerText = originalSetTimerText
    UIRenderer.setExecutionMode = originalSetExecutionMode
    UIRenderer.initPipeline = originalInitPipeline
    UIRenderer.setInterventionState = originalSetInterventionState
    UIRenderer.setPlayButtonLabel = originalSetPlayButtonLabel
  }
})

function captureRoundEngineState() {
  return {
    gameState: RoundEngine.gameState,
    roundConfig: RoundEngine.roundConfig,
    currentHand: RoundEngine.currentHand,
    selectedIds: RoundEngine.selectedIds,
    gasAllocations: RoundEngine.gasAllocations,
    battlePlan: RoundEngine.battlePlan,
    decisionDraft: RoundEngine.decisionDraft,
    interventionState: RoundEngine.interventionState,
    roundResult: RoundEngine.roundResult,
    _interventionOpen: RoundEngine._interventionOpen,
    _settlementReady: RoundEngine._settlementReady,
    _tutorialExecutionPaused: RoundEngine._tutorialExecutionPaused,
    _tutorialCustomPromptOpen: RoundEngine._tutorialCustomPromptOpen,
    _tutorialExecutionResume: RoundEngine._tutorialExecutionResume,
  }
}

function card(id, gasCost) {
  return {
    id,
    type: 'arbitrage',
    rarity: 'common',
    expectedProfit: 1,
    displayedRisk: 0.1,
    trueRisk: 0.1,
    gasCost,
    timeWindowSec: 30,
    competitionLevel: 1,
    riskReason: 'test card',
  }
}
