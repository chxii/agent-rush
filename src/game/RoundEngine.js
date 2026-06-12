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
const TUTORIAL_LOG_INTERVAL_MS = 600
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
  _tutorialSeenCardTypes: new Set(),
  _tutorialLogKeys: new Set(),
  _tutorialLogQueue: [],
  _tutorialLogTimerId: null,
  _tutorialPromptTimerId: null,
  _tutorialClosingLogged: false,
  _roundSeenBots: new Set(),
  _demoSeed: readSeedFromUrl(),

  startRound(gameState, roundConfig = {}) {
    this.clearTutorialLogQueue()
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
    this._tutorialSeenCardTypes = new Set()
    this._tutorialLogKeys = new Set()
    this._tutorialLogQueue = []
    this._tutorialLogTimerId = null
    this._tutorialPromptTimerId = null
    this._tutorialClosingLogged = false
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
    if (newPhase !== 'play') UIRenderer.setTutorialFeedback(null)
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
    const activeTutorial = this.isActiveTutorial()
    this.currentHand = generateHand(
      this.gameState.currentScene,
      this.gameState.role,
      this.gameState.roleLevel,
      {
        seed: this._demoSeed,
        tutorialCards: activeTutorial ? LAYER_CONFIG[this.gameState.currentLayer]?.tutorialCards : undefined,
      },
    )

    const fixedCards = LAYER_CONFIG[this.gameState.currentLayer]?.fixedCards
    if (fixedCards && !activeTutorial) {
      this.currentHand = this.currentHand.slice(0, fixedCards)
    }

    ThoughtChainPanel.appendLog({
      timestampMs: Date.now(),
      source: 'system',
      text: `扫描 mempool：第 ${this.gameState.currentLayer} 层${activeBotType ? `，检测到 ${activeBotType}` : ''}`,
      isStreaming: false,
    })
    this.appendTutorialLogs('scan')
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
    this.appendTutorialLogs('play')
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
    if (this.isTutorialInterventionLayer()) this.appendTutorialLogs('execute')

    try {
      this.roundResult = await ExecutionEngine.runSemiLoopMode(battlePlan, this.gameState, {
        interventionState: this.interventionState,
        forceSteal: createForceStealHook(this),
        seed: this._demoSeed,
        config: this.isTutorialInterventionLayer()
          ? { toolDelayMs: 1, simulatedToolElapsedSec: 1, maxReplansPerRound: 4 }
          : undefined,
        decider: this.isActiveTutorial() ? tutorialLayerDecider : undefined,
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
    this.appendTutorialSettlementLog(this.roundResult)
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
    this.clearTutorialLogQueue()

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
      this.handleTutorialCardSelected(card)
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
    this.appendTutorialOutcomeLog(options.skip)
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
    this.clearTutorialLogQueue()
    this.updateDecisionDraft(input)
    const selection = this.getSelectionState()
    selection.tutorial = this.buildTutorialFeedback(selection)
    UIRenderer.updateHandConstraints(this.currentHand, [...this.selectedIds], selection)
    UIRenderer.setSelectionStatus(selection)
    UIRenderer.setTutorialFeedback(selection.tutorial)
    UIRenderer.setPlayEnabled(this.selectedIds.size > 0 && selection.isValid)
    this.handleTutorialDecisionChange(input)
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
        appendTutorLog(`> 📑 收到你的指令："${text}"。`)
        appendTutorLog('> 🤖 提示：教学关用的是脚本化执行，不会真去解析你这句话。真实游戏里，接入 AI 后我会读懂你的自然语言并照做。这里先让你熟悉"打字下令"这个动作。')
        this.resumeTutorialExecution()
      }
      return result
    }

    const result = requestPlayerIntervention(this.interventionState, input)
    this.renderInterventionState(result.message)
    if (result.accepted && this._tutorialExecutionResume) {
      ThoughtChainPanel.appendLog({
        timestampMs: Date.now(),
        source: 'system',
        text: `[干预已排队] ${result.instruction.text}`,
        isStreaming: false,
      })
      this.resumeTutorialExecution()
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

  resumeTutorialExecution() {
    if (this._tutorialPromptTimerId && typeof window !== 'undefined') {
      window.clearTimeout(this._tutorialPromptTimerId)
    }
    this._tutorialPromptTimerId = null
    this._tutorialExecutionResume?.()
    this._tutorialExecutionResume = null
    this._tutorialExecutionPaused = false
    this._tutorialCustomPromptOpen = false
  },

  renderPlayableHand(message = '') {
    const selection = this.getSelectionState(message)
    selection.tutorial = this.buildTutorialFeedback(selection)
    UIRenderer.renderHand(this.currentHand, [...this.selectedIds], {
      phase: 'play',
      constraints: selection,
    })
    UIRenderer.setSelectionStatus(selection)
    UIRenderer.setTutorialFeedback(selection.tutorial)
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

  appendTutorialLogs(stage) {
    if (!this.isActiveTutorial()) return
    const layer = this.gameState?.currentLayer
    const key = `${layer}:${stage}`
    if (this._tutorialLogKeys.has(key)) return
    this._tutorialLogKeys.add(key)

    this.queueTutorialLogs(TUTORIAL_LOGS[layer]?.[stage] ?? [])
  },

  queueTutorialLogs(messages = []) {
    if (!this.isActiveTutorial() || messages.length === 0) return
    this._tutorialLogQueue.push(...messages)
    this.flushNextTutorialLog()
  },

  flushNextTutorialLog() {
    if (this._tutorialLogTimerId || this._tutorialLogQueue.length === 0) return

    const text = this._tutorialLogQueue.shift()
    appendTutorLog(text)

    if (this._tutorialLogQueue.length === 0) return
    if (typeof window === 'undefined') {
      this.flushNextTutorialLog()
      return
    }

    this._tutorialLogTimerId = window.setTimeout(() => {
      this._tutorialLogTimerId = null
      this.flushNextTutorialLog()
    }, TUTORIAL_LOG_INTERVAL_MS)
  },

  handleTutorialCardSelected(card) {
    if (!this.isActiveTutorial() || this.gameState?.currentLayer !== 1 || !card) return

    if (card.isScam) {
      appendTutorLog('> ⚠️ 这张就是坑。利润 x2 是诱饵，真实风险 80%+。记住手感：太美好的牌先怀疑。')
      return
    }

    if (this._tutorialSeenCardTypes.has(card.type)) return
    this._tutorialSeenCardTypes.add(card.type)
    const line = TUTORIAL_TYPE_LOGS[card.type]
    if (line) appendTutorLog(line)
  },

  handleTutorialDecisionChange(input = {}) {
    if (!this.isActiveTutorial()) return

    if (this.gameState?.currentLayer === 2 && input.gasAllocations?.tutorial_2_sandwich != null) {
      appendTutorLogOnce(this, 'layer2:gas-sensitive', '> 📊 看到没？夹击对 Gas 敏感，溢价喂下去成功率跳得快。这就是"喂对牌"。')
    }
  },

  appendTutorialOutcomeLog(skipped = false) {
    if (!this.isActiveTutorial()) return

    if (skipped) {
      appendTutorLog('> 🤹 跳过也行，但你会错过这手练习。真实战场跳过还要付机会成本。')
      return
    }

    const layer = this.gameState?.currentLayer
    const selectedCards = this.getSelectedCards()
    if (layer === 1) {
      const pickedScam = selectedCards.some((card) => card.isScam)
      appendTutorLog(pickedScam
        ? '> 💀 看，骗局牌烧光了 Gas，颗粒无收。这就是不排雷的代价。没关系，下一课记得先怀疑。'
        : '> 🎆 干净利落。第一课：排雷比抢钱重要。下一关教你喂 Gas。')
    }
    if (layer === 2) {
      const selection = this.getSelectionState()
      const feedback = this.buildTutorialFeedback(selection)
      const selectedNotes = feedback?.cards?.filter((note) => selectedCards.some((card) => note.name.includes(card.id.slice(-3)))) ?? []
      const negative = selectedNotes.some((note) => note.expectedValue < 0)
      appendTutorLog(negative
        ? '> 📉 EV 为负还硬打，结果就是亏。数字不会骗人。下次配到正再出手。'
        : '> 🎀 漂亮。第二课记住两件事：Gas 喂对牌，决策看 EV。下一关，玩点真的。')
    }
  },

  appendTutorialSettlementLog(roundResult) {
    if (!this.isTutorialInterventionLayer() || this._tutorialClosingLogged) return
    this._tutorialClosingLogged = true

    appendTutorLog((roundResult?.netProfit ?? 0) >= 0
      ? '> 👍 漂亮，你的干预保住了局面。看到没？同样被抢，下不下令、怎么下令，结果差很多。'
      : '> 🧐 这次没全保住，但你已经走完了完整流程。真实战场里，干预时机和选择就是这么影响结果的。')
    appendTutorLog('> 🤖 这就是 Executor：作为一个 AI Agent，我会自己拆任务、排序、调工具，被抢时按你的预案应对，你也能临场干预。')
    appendTutorLog('> 🎓 三课学完了：排雷、配 Gas 看 EV、预案与干预。')
    appendTutorLog('> 🚀 接下来是真实战场。Bot 会越来越凶，让我们一起合作，活到第 20 层，拿下胜利。')
  },

  waitForTutorialIntervention() {
    if (!this.isTutorialInterventionLayer() || !this._tutorialExecutionPaused) return Promise.resolve()
    this.appendTutorialLogs('stolen')
    this.renderInterventionState('教学暂停：点一个快捷干预，或写一句自定义干预。越早下令，可调整的牌和 Gas 越多。')
    return new Promise((resolve) => {
      if (typeof window !== 'undefined') {
        this._tutorialPromptTimerId = window.setTimeout(() => {
          appendTutorLog('> ⏳ 还在等你下令。点一个快捷干预，或在框里打字。')
        }, 10000)
      }
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
    this.clearTutorialLogQueue()
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

  clearTutorialLogQueue() {
    if (this._tutorialLogTimerId) window.clearTimeout(this._tutorialLogTimerId)
    this._tutorialLogTimerId = null
    this._tutorialLogQueue = []
  },
}

const TUTORIAL_LOGS = {
  1: {
    scan: [
      '> 🤖 Executor 已上线。这是练习场，我带你走一遍。',
      '> 📊 这层是 DEX 套利场，最稳的猎场。没人跟你抢，安心练手。',
      '> 🃏 桌上发了一手机会牌。每张写着能赚多少、要花多少 Gas、风险多大。先别急着选，点开一张张看。',
      '> 🕵️ 看到那张利润高得离谱、风险却低得反常的牌了吗？那是骗局牌。牌面给你看的是假风险，真打下去几乎血本无归。',
      '> 👀 剩下的是 5 种正经牌型。点开看看它们的说明。',
      '> ✅ 避开骗局、挑一张稳的，就过关。',
    ],
  },
  2: {
    scan: [
      '> ⛽ 第二课：Gas。它是你的插队费，也是每层的预算。这层给你一池，用不完不扣分，也不带到下一层。',
      '> 🎚️ 不同牌吃 Gas 的方式不一样。夹击、抢跑多喂 Gas 能明显提升成功率；套利、清算喂多了可能浪费。',
      '> 👉 试试选中那张夹击牌，把 Gas 往上拉，看右边成功率怎么变。',
      '> 🧮 EV 是这张牌打很多次的平均收益。EV 为正才值得长期打，EV 为负就是慢性亏损。',
      '> 🎲 EV 是平均值，不是这一把的结果。成败是掷骰子，成功后利润还会浮动。',
      '> ⚖️ 你博弈的不只是 EV，还有 Gas 怎么分、敢不敢赌成功率。',
      '> ✅ 把 Gas 配到 EV 为正，点执行。',
    ],
  },
  3: {
    scan: [
      '> 🧪 最后一课，也是最重要的。前两关没人动你，这次来真的。Bot-404 上线了，它要抢一手。',
      '> 🎛️ 这次你可以选 2 张牌一起打。它们共用一个 Gas 池，给一张多喂，另一张就少。',
      '> 🛡️ 选牌时，给每张设一个预案：万一这张被抢了，我要怎么办。',
      '> 💪🏳️ 给你想保的牌设"硬刚"，给次要的设"放弃"。设好就执行。',
    ],
    execute: [
      '> 🔁 注意看执行顺序。是我，Executor，排的，不是你选牌的顺序。我默认优先打更有价值的牌。',
      '> 🧠 你给的是方向，顺序和临场操作交给我。',
    ],
    stolen: [
      '> ⚠️ 被抢了！Bot-404 抢先成交第一张。执行已暂停，你还有一张牌在排队，现在能改它的命运。',
      '> 🗣️ 这就是"干预"：每回合一次机会，临场改打法。越早下令，能调整的牌和 Gas 越多。',
      '> 💪 全部硬刚：剩余 Gas 摊给所有还能动的牌，尽量都保住。',
      '> 🏳️ 放弃最高风险：砍掉最危险那张，把 Gas 省给稳的。',
      '> 🎯 Gas 集中最优：剩余 Gas 全压到当前 EV 最好的那张。',
      '> ↗️ 真实回合里你还能直接打字下令。我会用 AI 理解你的话。试着写一句，比如"把剩余 Gas 都给套利"。',
    ],
  },
}

const TUTORIAL_TYPE_LOGS = {
  arbitrage: '> 💰 套利：低买高卖赚差价。稳，但人人都看得见，利润薄。',
  sandwich: '> 🥪 夹击：卡在大单前后吃价差。最吃排序，也最吃 Gas。',
  front_run: '> 🏃 抢跑：纯拼出价高低。Gas 给够就排前面，给少就被盖。',
  liquidation: '> ⚖️ 清算：帮系统平坏账领赏金。稳，但堆 Gas 提升有限。',
  nft_snipe: '> 🖼️ NFT 抢购：抢限量名额。回报飘、窗口短，最容易扑空。',
}

function appendTutorLogOnce(engine, key, text) {
  if (engine._tutorialLogKeys.has(key)) return
  engine._tutorialLogKeys.add(key)
  appendTutorLog(text)
}

function appendTutorLog(text) {
  if (typeof document === 'undefined') return
  ThoughtChainPanel.appendLog({
    timestampMs: Date.now(),
    source: 'tutor',
    text,
    isStreaming: false,
  })
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
