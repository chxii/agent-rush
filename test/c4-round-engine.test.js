import test from 'node:test'
import assert from 'node:assert/strict'

import { RoundEngine } from '../src/game/RoundEngine.js'
import { UIRenderer } from '../src/ui/UIRenderer.js'
import { ExecutionEngine } from '../src/game/ExecutionEngine.js'
import { createInterventionState } from '../src/core/PlayerIntervention.js'
import { ThoughtChainPanel } from '../src/ui/ThoughtChainPanel.js'

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
  const originalUpdateHandConstraints = UIRenderer.updateHandConstraints
  const originalSetSelectionStatus = UIRenderer.setSelectionStatus
  const originalSetTutorialFeedback = UIRenderer.setTutorialFeedback
  const originalSetPlayEnabled = UIRenderer.setPlayEnabled
  const calls = []

  try {
    UIRenderer.updateHandConstraints = (cards, selectedIds, constraints) => {
      calls.push({ cards, selectedIds, constraints })
    }
    UIRenderer.setSelectionStatus = () => {}
    UIRenderer.setTutorialFeedback = () => {}
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
    assert.ok(rendered, 'updateHandConstraints should be called after decision change')
    assert.equal(rendered.constraints.selectedGas, 50)
    assert.equal(rendered.constraints.disabledReasons['candidate-a'], undefined)
    assert.equal(rendered.constraints.disabledReasons['candidate-b'], undefined)
  } finally {
    Object.assign(RoundEngine, originalState)
    UIRenderer.updateHandConstraints = originalUpdateHandConstraints
    UIRenderer.setSelectionStatus = originalSetSelectionStatus
    UIRenderer.setTutorialFeedback = originalSetTutorialFeedback
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

test('tutorial layers 1 and 2 use scripted decider without intervention delay/config', async () => {
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
  const captured = []

  try {
    ExecutionEngine.runSemiLoopMode = async (_battlePlan, _gameState, options) => {
      captured.push({ layer: _gameState.currentLayer, options })
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

    for (const layer of [1, 2]) {
      RoundEngine.gameState = { currentLayer: layer, phase: 'execute', tutorialSeen: false, gasPool: 150 }
      RoundEngine.currentHand = [card(`selected-${layer}`, 40)]
      RoundEngine.selectedIds = new Set([`selected-${layer}`])
      RoundEngine.decisionDraft = {
        gasAllocations: { [`selected-${layer}`]: 40 },
        contingencies: { [`selected-${layer}`]: 'fight' },
      }
      RoundEngine.battlePlan = null

      await RoundEngine.startExecute()
    }

    assert.equal(captured.length, 2)
    captured.forEach(({ options }) => {
      assert.ok(options.decider, 'active tutorial execution should pass scripted decider')
      assert.equal(options.config, undefined)
      assert.equal(options.delay, undefined)
    })
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

test('tutorial shortcut intervention resumes execution without requiring custom prompt', () => {
  const originalState = captureRoundEngineState()
  const originalSetInterventionState = UIRenderer.setInterventionState
  const originalAppendLog = ThoughtChainPanel.appendLog
  let resumed = false

  try {
    UIRenderer.setInterventionState = () => {}
    ThoughtChainPanel.appendLog = () => {}
    RoundEngine.gameState = { currentLayer: 3, phase: 'execute', tutorialSeen: false }
    RoundEngine.interventionState = createInterventionState()
    RoundEngine._interventionOpen = true
    RoundEngine._tutorialExecutionPaused = true
    RoundEngine._tutorialCustomPromptOpen = false
    RoundEngine._tutorialExecutionResume = () => {
      resumed = true
    }

    const result = RoundEngine.handleInterventionRequest({ type: 'shortcut', shortcutId: 'abandon_highest_risk' })

    assert.equal(result.accepted, true)
    assert.equal(resumed, true)
    assert.equal(RoundEngine._tutorialExecutionResume, null)
    assert.equal(RoundEngine._tutorialExecutionPaused, false)
    assert.equal(RoundEngine._tutorialCustomPromptOpen, false)
  } finally {
    Object.assign(RoundEngine, originalState)
    UIRenderer.setInterventionState = originalSetInterventionState
    ThoughtChainPanel.appendLog = originalAppendLog
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
    _tutorialLogQueue: RoundEngine._tutorialLogQueue,
    _tutorialLogTimerId: RoundEngine._tutorialLogTimerId,
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
