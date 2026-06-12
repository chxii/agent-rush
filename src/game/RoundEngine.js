import { generateHand, injectScamCardNextHand } from '../core/CardGenerator.js'
import { EnemyBotAI } from '../core/EnemyBotAI.js'
import { createBattlePlan, validateBattlePlan } from '../core/BattlePlan.js'
import { createInterventionState, requestPlayerIntervention } from '../core/PlayerIntervention.js'
import { RuleDecider } from '../core/RuleDecider.js'
import { maxSelectedCardsForLayer } from '../config/decision.js'
import { LAYER_CONFIG } from '../config/scenes.js'
import { WIN_LOSS_CONFIG } from '../config/winloss.js'
import { SettlementPanel } from '../ui/SettlementPanel.js'
import { ThoughtChainPanel } from '../ui/ThoughtChainPanel.js'
import { OverlayManager } from '../ui/OverlayManager.js'
import { UIRenderer } from '../ui/UIRenderer.js'
import { ExecutionEngine } from './ExecutionEngine.js'
import { ProgressionEngine } from './ProgressionEngine.js'

const DEFAULT_PLAY_MS = 25000
const REVEAL_INTERVAL_MS = 900
const SCAN_BUFFER_MS = 900
const DEMO_SEED = 'agent-rush-c3-demo'

export const RoundEngine = {
  gameState: null,
  roundConfig: {},
  currentHand: [],
  selectedIds: new Set(),
  gasAllocations: [],
  battlePlan: null,
  decisionDraft: { gasAllocations: {}, contingencies: {} },
  interventionState: createInterventionState(),
  roundResult: null,
  _timerId: null,
  _intervalId: null,
  _revealTimers: [],
  _timerEndAt: 0,
  _timerRemainingMs: 0,
  _timerDone: null,
  _paused: false,
  _interventionOpen: false,
  _settlementReady: false,
  _tutorialExecutionPaused: false,
  _tutorialCustomPromptOpen: false,
  _tutorialExecutionResume: null,
  _roundSeenBots: new Set(),
  _demoSeed: readSeedFromUrl(),

  startRound(gameState, roundConfig = {}) {
    this.gameState = gameState
    this.roundConfig = roundConfig
    this.currentHand = []
    this.selectedIds.clear()
    this.gasAllocations = []
    this.battlePlan = null
    this.decisionDraft = { gasAllocations: {}, contingencies: {} }
    this.interventionState = createInterventionState()
    this.roundResult = null
    this._interventionOpen = false
    this._settlementReady = false
    this._tutorialExecutionPaused = false
    this._tutorialCustomPromptOpen = false
    this._tutorialExecutionResume = null
    UIRenderer.renderPipeline([])
    this.transition('scan')
  },

  resetRunIntroState() {
    this._roundSeenBots.clear()
  },

  transition(newPhase) {
    this.clearTimers()
    this._paused = false
    this._timerRemainingMs = 0
    this._timerDone = null
    this._interventionOpen = newPhase === 'execute' ? this._interventionOpen : false
    this.gameState.setPhase(newPhase)
    UIRenderer.setPhase(newPhase)
    if (newPhase !== 'play') UIRenderer.setSelectionStatus(null)
    if (newPhase !== 'execute') UIRenderer.renderPipeline([])
    UIRenderer.renderHeader(this.gameState)

    if (newPhase === 'scan') this.startScan()
    if (newPhase === 'play') this.startPlay()
    if (newPhase === 'execute') this.startExecute()
    if (newPhase === 'settle') this.startSettle(this.roundResult)
  },

  startScan() {
    ThoughtChainPanel.clear()
    this.selectedIds.clear()
    UIRenderer.setExecutionMode('semi-loop')
    UIRenderer.renderHand([], [])
    UIRenderer.setPlayEnabled(false)
    UIRenderer.setTimerText('扫描中')

    const activeBotType = EnemyBotAI.getActiveBot(this.gameState.currentLayer)
    if (activeBotType && !this._roundSeenBots.has(activeBotType)) {
      OverlayManager.showBotIntro(activeBotType, () => {
        this._roundSeenBots.add(activeBotType)
        this.runScan(activeBotType)
      })
      return
    }

    this.runScan(activeBotType)
  },

  runScan(activeBotType) {
    this.currentHand = generateHand(
      this.gameState.currentScene,
      this.gameState.role,
      this.gameState.roleLevel,
      {
        seed: this._demoSeed,
        tutorialCards: LAYER_CONFIG[this.gameState.currentLayer]?.tutorialCards,
      },
    )

    const fixedCards = LAYER_CONFIG[this.gameState.currentLayer]?.fixedCards
    if (fixedCards && !LAYER_CONFIG[this.gameState.currentLayer]?.tutorialCards) {
      this.currentHand = this.currentHand.slice(0, fixedCards)
    }

    ThoughtChainPanel.appendLog({
      timestampMs: Date.now(),
      source: 'system',
      text: `扫描 mempool：第 ${this.gameState.currentLayer} 层${activeBotType ? `，检测到 ${activeBotType}` : ''}`,
      isStreaming: false,
    })
    if (LAYER_CONFIG[this.gameState.currentLayer]?.isBoss) {
      ThoughtChainPanel.appendLog({
        timestampMs: Date.now(),
        source: 'system',
        text: bossWarningFor(this.gameState.currentLayer, activeBotType),
        isStreaming: false,
      })
    }

    this.currentHand.forEach((_, index) => {
      const timerId = window.setTimeout(() => {
        UIRenderer.renderHand(this.currentHand.slice(0, index + 1), [...this.selectedIds], {
          phase: 'scan',
          enteringId: this.currentHand[index]?.id,
        })
      }, index * REVEAL_INTERVAL_MS)
      this._revealTimers.push(timerId)
    })

    if (this.isActiveTutorial()) {
      UIRenderer.setTimerText('练习中')
      const revealMs = this.currentHand.length * REVEAL_INTERVAL_MS + SCAN_BUFFER_MS
      const timerId = window.setTimeout(() => this.transition('play'), revealMs)
      this._revealTimers.push(timerId)
      return
    }

    const scanMs = this.roundConfig.scanMs ?? this.currentHand.length * REVEAL_INTERVAL_MS + SCAN_BUFFER_MS
    this.startPhaseTimer(scanMs, () => this.transition('play'), '扫描中')
  },

  startPlay() {
    this.renderPlayableHand()
    if (this.isActiveTutorial()) {
      UIRenderer.setTimerText('练习中')
      return
    }
    this.startPhaseTimer(this.roundConfig.playMs ?? DEFAULT_PLAY_MS, () => this.transition('execute'))
  },

  async startExecute() {
    const battlePlan =
      this.battlePlan ??
      createBattlePlan({
        selectedCards: this.getSelectedCards(),
        gasAllocations: this.decisionDraft.gasAllocations,
        contingencies: this.decisionDraft.contingencies,
      })
    const selectedCards = battlePlan.selectedCards

    UIRenderer.renderHand(this.currentHand, [...this.selectedIds], { phase: 'execute' })
    UIRenderer.setPlayEnabled(false)
    UIRenderer.setSelectionStatus(null)
    UIRenderer.setTimerText('执行中')
    UIRenderer.setExecutionMode('semi-loop')
    UIRenderer.initPipeline(selectedCards, {
      gasAllocations: battlePlan.gasAllocations,
      contingencies: battlePlan.contingencies,
    })
    this._interventionOpen = true
    this.renderInterventionState('本回合可干预一次。')

    try {
      this.roundResult = await ExecutionEngine.runSemiLoopMode(battlePlan, this.gameState, {
        interventionState: this.interventionState,
        forceSteal: createForceStealHook(this),
        seed: this._demoSeed,
        config: this.isTutorialInterventionLayer()
          ? { toolDelayMs: 1, simulatedToolElapsedSec: 1, maxReplansPerRound: 4 }
          : undefined,
        decider: this.isTutorialInterventionLayer() ? tutorialLayerDecider : undefined,
        delay: this.isTutorialInterventionLayer() ? () => this.waitForTutorialIntervention() : undefined,
        pipeline: {
          init: (cards) => UIRenderer.initPipeline(cards, {
            gasAllocations: battlePlan.gasAllocations,
            contingencies: battlePlan.contingencies,
          }),
          start: (card) => UIRenderer.updatePipelineCard(card.id, { status: 'running' }),
          update: (card) => UIRenderer.updatePipelineCard(card.id, {
            status: card.status,
            gasUsed: card.gasUsed,
            actualProfit: card.actualProfit,
          }),
          incident: (card) => UIRenderer.updatePipelineCard(card.id, { status: 'incident' }),
          decision: (card, decision) => {
            UIRenderer.reorderPipeline(decision?.updatedExecutionOrder)
            UIRenderer.updatePipelineCard(card.id, { status: card.status || 'running' })
          },
          complete: (result) => UIRenderer.completePipeline(result?.cards ?? []),
        },
        onExecutionComplete: () => {
          this._interventionOpen = false
          UIRenderer.setInterventionState(null)
        },
      })
    } catch (error) {
      ThoughtChainPanel.appendLog({
        timestampMs: Date.now(),
        source: 'system',
        text: `[执行异常] ${error.message}。已进入安全结算，避免回合卡死。`,
        isStreaming: false,
      })
      this.roundResult = buildEmergencyResult(selectedCards, error)
    }
    this._interventionOpen = false
    UIRenderer.setInterventionState(null)
    this._settlementReady = true
    UIRenderer.setTimerText('等待结算')
    UIRenderer.setPlayButtonLabel('结算')
    UIRenderer.setPlayEnabled(true)
  },

  startSettle(roundResult) {
    const safeResult = applySkipPenalty(roundResult ?? { cards: [], netProfit: 0, gasUsed: 0 })
    const finalGasPool = Number(safeResult.finalState?.gasPool)
    this.gameState.gasPool = Number.isFinite(finalGasPool)
      ? Math.max(0, Math.round(finalGasPool))
      : Math.max(0, this.gameState.gasPool - safeResult.gasUsed)
    UIRenderer.renderHeader(this.gameState)
    UIRenderer.setTimerText('已结算')
    SettlementPanel.show(safeResult, this.gameState, () => {
      ProgressionEngine.afterRound(safeResult, this.gameState)
      UIRenderer.renderHeader(this.gameState)
    })
  },

  toggleCard(cardId) {
    if (this.gameState?.phase !== 'play') return

    if (this.selectedIds.has(cardId)) {
      this.selectedIds.delete(cardId)
      delete this.decisionDraft.gasAllocations[cardId]
      delete this.decisionDraft.contingencies[cardId]
    } else {
      const card = this.currentHand.find((item) => item.id === cardId)
      const validation = this.validateAddCard(card)
      if (!validation.valid) {
        this.renderPlayableHand(validation.message)
        return
      }

      this.selectedIds.add(cardId)
      this.decisionDraft.gasAllocations[cardId] = card.gasCost
      this.decisionDraft.contingencies[cardId] = 'fight'
    }

    this.renderPlayableHand()
  },

  confirmPlay(options = {}) {
    if (!this.gameState || this.gameState.phase !== 'play') return

    if (options.skip) {
      this.selectedIds.clear()
    }

    if (options.battlePlanInput) {
      this.updateDecisionDraft(options.battlePlanInput)
    }

    const selection = this.getSelectionState()
    if (!options.skip && !selection.isValid) {
      this.renderPlayableHand(selection.message)
      return
    }

    this.battlePlan = options.skip
      ? createBattlePlan()
      : createBattlePlan({
          selectedCards: this.getSelectedCards(),
          gasAllocations: this.decisionDraft.gasAllocations,
          contingencies: this.decisionDraft.contingencies,
        })
    this.gasAllocations = Object.entries(this.battlePlan.gasAllocations).map(([cardId, gas]) => ({ cardId, gas }))
    this.transition('execute')
  },

  updateDecisionDraft(input = {}) {
    this.decisionDraft = {
      gasAllocations: {
        ...this.decisionDraft.gasAllocations,
        ...(input.gasAllocations ?? {}),
      },
      contingencies: {
        ...this.decisionDraft.contingencies,
        ...(input.contingencies ?? {}),
      },
    }
  },

  handleDecisionChange(input = {}) {
    this.updateDecisionDraft(input)
    const selection = this.getSelectionState()
    selection.tutorial = this.buildTutorialFeedback(selection)
    UIRenderer.renderHand(this.currentHand, [...this.selectedIds], {
      phase: 'play',
      constraints: selection,
    })
    UIRenderer.setSelectionStatus(selection)
    UIRenderer.setPlayEnabled(this.selectedIds.size > 0 && selection.isValid)
  },

  confirmSettle() {
    if (!this.gameState || this.gameState.phase !== 'execute' || !this._settlementReady) return
    this._settlementReady = false
    this.transition('settle')
  },

  handleInterventionRequest(input = {}) {
    if (this.gameState?.phase !== 'execute' || !this._interventionOpen) {
      const result = { accepted: false, message: '只能在执行阶段干预。' }
      this.renderInterventionState(result.message)
      return result
    }

    if (this._tutorialCustomPromptOpen && (input.type ?? input.mode) !== 'shortcut') {
      const text = String(input.text ?? input.instruction ?? '').trim()
      const result = text
        ? { accepted: true, message: '自定义干预示例已记录。真实回合仍然每回合只生效一次干预。' }
        : { accepted: false, message: '先写一句自定义干预。' }
      this.renderInterventionState(result.message)
      if (result.accepted && this._tutorialExecutionResume) {
        ThoughtChainPanel.appendLog({
          timestampMs: Date.now(),
          source: 'system',
          text: `[教学自定义干预示例] ${text}`,
          isStreaming: false,
        })
        this._tutorialExecutionResume()
        this._tutorialExecutionResume = null
        this._tutorialExecutionPaused = false
        this._tutorialCustomPromptOpen = false
      }
      return result
    }

    const result = requestPlayerIntervention(this.interventionState, input)
    this.renderInterventionState(result.message)
    if (result.accepted && this._tutorialExecutionResume) {
      if ((result.instruction?.mode ?? input.type ?? input.mode) === 'shortcut') {
        this._tutorialCustomPromptOpen = true
        ThoughtChainPanel.appendLog({
          timestampMs: Date.now(),
          source: 'system',
          text: `[干预已排队] ${result.instruction.text}`,
          isStreaming: false,
        })
        this.renderInterventionState('快捷干预已排队。再写一句自定义干预示例，观察真实回合只能生效一次干预。')
        return result
      }
      ThoughtChainPanel.appendLog({
        timestampMs: Date.now(),
        source: 'system',
        text: `[干预已排队] ${result.instruction.text}`,
        isStreaming: false,
      })
      this._tutorialExecutionResume()
      this._tutorialExecutionResume = null
      this._tutorialExecutionPaused = false
      return result
    }
    ThoughtChainPanel.appendLog({
      timestampMs: Date.now(),
      source: 'system',
      text: result.accepted ? `[干预已排队] ${result.instruction.text}` : `[干预被拒绝] ${result.message}`,
      isStreaming: false,
    })
    return result
  },

  renderInterventionState(message = '') {
    if (!this._interventionOpen) {
      UIRenderer.setInterventionState(null)
      return
    }

    UIRenderer.setInterventionState({
      phase: this.gameState?.phase,
      used: this.interventionState.interventionUsed,
      pending: Boolean(this.interventionState.pendingInstruction),
      allowCustomPrompt: this._tutorialCustomPromptOpen,
      message,
    })
  },

  renderPlayableHand(message = '') {
    const selection = this.getSelectionState(message)
    selection.tutorial = this.buildTutorialFeedback(selection)
    UIRenderer.renderHand(this.currentHand, [...this.selectedIds], {
      phase: 'play',
      constraints: selection,
    })
    UIRenderer.setSelectionStatus(selection)
    UIRenderer.setPlayEnabled(this.selectedIds.size > 0 && selection.isValid)
  },

  validateAddCard(card) {
    if (!card) return { valid: false, message: '未找到这张机会牌。' }

    const selection = this.getSelectionState()
    if (selection.selectedCount >= selection.maxCards) {
      return { valid: false, message: `本层最多选择 ${selection.maxCards} 张机会牌。` }
    }

    if (selection.selectedGas + card.gasCost > selection.gasPool) {
      return { valid: false, message: `Gas 预算不足：还剩 ${selection.gasPool - selection.selectedGas} Gas。` }
    }

    return { valid: true, message: '' }
  },

  getSelectionState(message = '') {
    const maxCards = maxSelectedCardsForLayer(this.gameState?.currentLayer)
    const gasPool = this.gameState?.gasPool ?? 0
    const selectedCards = this.getSelectedCards()
    const selectedGas = selectedCards.reduce((sum, card) => sum + (this.decisionDraft.gasAllocations[card.id] ?? card.gasCost), 0)
    const disabledReasons = {}
    const battlePlan = createBattlePlan({
      selectedCards,
      gasAllocations: this.decisionDraft.gasAllocations,
      contingencies: this.decisionDraft.contingencies,
    })
    const validation = validateBattlePlan(battlePlan, { gasPool, maxCards })

    this.currentHand.forEach((card) => {
      if (this.selectedIds.has(card.id)) return
      if (selectedCards.length >= maxCards) {
        disabledReasons[card.id] = `已达本层上限 ${maxCards} 张`
        return
      }
      if (selectedGas + card.gasCost > gasPool) {
        disabledReasons[card.id] = `Gas 不足，还剩 ${gasPool - selectedGas} Gas`
      }
    })

    const isValid = validation.valid
    return {
      maxCards,
      gasPool,
      selectedCount: selectedCards.length,
      selectedGas,
      remainingGas: validation.remainingGas,
      gasAllocations: { ...this.decisionDraft.gasAllocations },
      contingencies: { ...this.decisionDraft.contingencies },
      validationErrors: validation.errors,
      disabledReasons,
      isValid,
      message: message || (isValid ? '' : validation.errors[0]?.message ?? '当前作战方案无效。'),
    }
  },

  pauseTimers() {
    if (this._paused || !this.isPausablePhase() || !this._timerDone || !this._timerEndAt) return

    this._paused = true
    this._timerRemainingMs = Math.max(0, this._timerEndAt - Date.now())
    this.clearRunningTimers()

    if (this.gameState.phase === 'scan') {
      UIRenderer.renderHand(this.currentHand, [...this.selectedIds], { phase: 'scan' })
    }

    UIRenderer.setTimerText('已暂停')
  },

  resumeTimers() {
    if (!this._paused || !this.isPausablePhase() || !this._timerDone) return

    this._paused = false
    this.startPhaseTimer(this._timerRemainingMs, this._timerDone, this.gameState.phase === 'scan' ? '扫描中' : null)
  },

  isPausablePhase() {
    return this.gameState?.phase === 'scan' || this.gameState?.phase === 'play'
  },

  getSelectedCards() {
    return this.currentHand.filter((card) => this.selectedIds.has(card.id))
  },

  jumpToLayer(layer) {
    if (!this.gameState) return

    const targetLayer = Math.max(1, Math.min(WIN_LOSS_CONFIG.victory.targetLayer, Number(layer) || 1))
    const layerConfig = LAYER_CONFIG[targetLayer] ?? LAYER_CONFIG[20]
    this.clearTimers()

    this.gameState.currentLayer = targetLayer
    this.gameState.currentScene = layerConfig.scene ?? layerConfig.scenes?.[0] ?? 'dex_arb'
    this.gameState.gasPoolMax = this.gameState.gasPoolMaxForStage(targetLayer)
    this.gameState.gasPool = this.gameState.gasPoolMax
    this.gameState.saveProgress()

    ProgressionEngine.startRun(this.gameState)
  },

  injectPhantomSteal() {
    EnemyBotAI.forceNextSteal()
    ThoughtChainPanel.appendLog({
      timestampMs: Date.now(),
      source: 'system',
      text: '[Debug] 下一次 Bot 竞争将强制抢占',
      isStreaming: false,
    })
  },

  injectScamCard() {
    injectScamCardNextHand()
    ThoughtChainPanel.appendLog({
      timestampMs: Date.now(),
      source: 'system',
      text: '[Debug] 下一轮扫描将注入一张骗局牌',
      isStreaming: false,
    })
  },

  buildTutorialFeedback(selection) {
    if (!this.isActiveTutorial()) return null
    return UIRenderer.buildTutorialFeedback({
      layer: this.gameState.currentLayer,
      cards: this.currentHand,
      selectedCards: this.getSelectedCards(),
      gasAllocations: selection.gasAllocations,
      role: this.gameState.role,
      roleLevel: this.gameState.roleLevel,
    })
  },

  isActiveTutorial() {
    return Boolean(LAYER_CONFIG[this.gameState?.currentLayer]?.isTutorial && !this.gameState?.tutorialSeen)
  },

  isTutorialInterventionLayer() {
    return this.isActiveTutorial() && this.gameState?.currentLayer === 3
  },

  waitForTutorialIntervention() {
    if (!this.isTutorialInterventionLayer() || !this._tutorialExecutionPaused) return Promise.resolve()
    this.renderInterventionState('教学暂停：点一个快捷干预，或写一句自定义干预。越早下令，可调整的牌和 Gas 越多。')
    return new Promise((resolve) => {
      this._tutorialExecutionResume = resolve
    })
  },

  toggleDemoSeed() {
    this._demoSeed = this._demoSeed ? null : DEMO_SEED
    ThoughtChainPanel.appendLog({
      timestampMs: Date.now(),
      source: 'system',
      text: this._demoSeed ? `[Debug] 固定随机种子已启用：${this._demoSeed}` : '[Debug] 固定随机种子已关闭',
      isStreaming: false,
    })
  },

  startPhaseTimer(durationMs, onDone, label = null) {
    this.clearPhaseTimer()
    this._timerDone = onDone
    this._timerRemainingMs = durationMs
    this._timerEndAt = Date.now() + durationMs

    const update = () => {
      const remainingMs = Math.max(0, this._timerEndAt - Date.now())
      UIRenderer.setTimerText(label ?? `${Math.ceil(remainingMs / 1000)}s`)
      if (remainingMs <= 0 && this._intervalId) {
        window.clearInterval(this._intervalId)
        this._intervalId = null
      }
    }

    update()
    this._intervalId = window.setInterval(update, 250)
    this._timerId = window.setTimeout(onDone, durationMs)
  },

  clearRunningTimers() {
    this.clearPhaseTimer()
    this._revealTimers.forEach((timerId) => window.clearTimeout(timerId))
    this._revealTimers = []
  },

  clearPhaseTimer() {
    if (this._timerId) window.clearTimeout(this._timerId)
    if (this._intervalId) window.clearInterval(this._intervalId)
    this._timerId = null
    this._intervalId = null
  },

  clearTimers() {
    this.clearRunningTimers()
    this._timerEndAt = 0
    this._timerRemainingMs = 0
    this._timerDone = null
    this._paused = false
  },
}

function applySkipPenalty(roundResult) {
  const hasCards = Array.isArray(roundResult?.cards) && roundResult.cards.length > 0
  if (hasCards) return roundResult

  const penalty = Math.max(0, Number(WIN_LOSS_CONFIG.skipPenaltyEth) || 0)
  if (penalty <= 0) return roundResult

  return {
    ...roundResult,
    netProfit: -penalty,
    skipPenaltyEth: penalty,
    aiSummary: roundResult.aiSummary ?? `本层没有出牌，机会窗口流失，记为 -${penalty.toFixed(2)} ETH。`,
    decisionHighlights: [
      ...(roundResult.decisionHighlights ?? []),
      {
        momentLabel: 'skip_penalty',
        description: `跳过本层会付出 ${penalty.toFixed(2)} ETH 的机会成本，连续躺平会拖低累计收益。`,
      },
    ],
  }
}

function createForceStealHook(engine) {
  let tutorialStealPending = true
  return () => {
    if (engine.isTutorialInterventionLayer() && tutorialStealPending) {
      tutorialStealPending = false
      engine._tutorialExecutionPaused = true
      return true
    }
    return EnemyBotAI.consumeForcedSteal()
  }
}

const tutorialLayerDecider = {
  async planInitial(input) {
    return RuleDecider.planInitial(input)
  },

  async decideOnIncident(snapshot) {
    return RuleDecider.decideOnIncident(snapshot)
  },

  async summarize(input) {
    return {
      summary: '教学执行结束：你看到了 Executor 排序、被抢暂停、预案响应和一次干预生效。',
      decisionHighlights: [
        {
          momentLabel: 'tutorial_intervention',
          description: '第 3 关使用脚本化执行，不调用真实 LLM；被抢后暂停等待玩家干预，再继续结算。',
        },
        ...(await RuleDecider.summarize(input)).decisionHighlights,
      ],
    }
  },
}

function readSeedFromUrl() {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  return params.get('seed') || null
}

function buildEmergencyResult(cards, error) {
  const failedCards = cards.map((card) => ({
    ...card,
    status: 'failed',
    actualProfit: 0,
    resultReason: `执行异常：${error.message}`,
    events: [
      {
        kind: 'failure',
        title: '执行链路异常',
        detail: error.message,
      },
    ],
  }))

  return {
    cards: failedCards,
    netProfit: 0,
    gasUsed: 0,
    aiSummary: `执行阶段出现异常：${error.message}。系统已安全进入结算。`,
    decisionHighlights: [
      {
        momentLabel: 'workflow_closure',
        description: '执行异常被捕获，回合没有停在执行阶段，而是安全进入结算。',
      },
    ],
  }
}

function bossWarningFor(layer, botName) {
  const warnings = {
    7: '⚠️ 段位收尾：Shadow 正在全力封锁这片猎场，这是甩开它的最后机会。',
    12: '⚠️ 段位收尾：Phantom 的算力碾压上来了，每一笔交易都在它的监视下。',
    17: '⚠️ 段位收尾：Phantom+ 多线施压，撑过这层你就摸到终局了。',
    20: '☠️ 最终战：Genesis 出价极凶、永远压不死。这是你证明自己的最后一战。',
  }
  return warnings[layer] ?? `⚠️ Boss 关：${botName ?? '未知对手'} 正在加压。`
}
