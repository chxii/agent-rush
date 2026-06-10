import { generateHand, injectScamCardNextHand } from '../core/CardGenerator.js'
import { EnemyBotAI } from '../core/EnemyBotAI.js'
import { battlePlanToGasAllocationArray, createBattlePlan, validateBattlePlan } from '../core/BattlePlan.js'
import { ExecutorAI } from '../ai/ExecutorAI.js'
import { LAYER_CONFIG } from '../config/scenes.js'
import { SettlementPanel } from '../ui/SettlementPanel.js'
import { ThoughtChainPanel } from '../ui/ThoughtChainPanel.js'
import { OverlayManager } from '../ui/OverlayManager.js'
import { UIRenderer } from '../ui/UIRenderer.js'
import { ExecutionEngine } from './ExecutionEngine.js'
import { ProgressionEngine } from './ProgressionEngine.js'

const DEFAULT_PLAY_MS = 25000
const REVEAL_INTERVAL_MS = 900
const SCAN_BUFFER_MS = 900

export const RoundEngine = {
  gameState: null,
  roundConfig: {},
  currentHand: [],
  selectedIds: new Set(),
  gasAllocations: [],
  battlePlan: null,
  decisionDraft: { gasAllocations: {}, contingencies: {} },
  roundResult: null,
  _timerId: null,
  _intervalId: null,
  _revealTimers: [],
  _timerEndAt: 0,
  _timerRemainingMs: 0,
  _timerDone: null,
  _paused: false,

  startRound(gameState, roundConfig = {}) {
    this.gameState = gameState
    this.roundConfig = roundConfig
    this.currentHand = []
    this.selectedIds.clear()
    this.gasAllocations = []
    this.battlePlan = null
    this.decisionDraft = { gasAllocations: {}, contingencies: {} }
    this.roundResult = null
    this.transition('scan')
  },

  transition(newPhase) {
    this.clearTimers()
    this._paused = false
    this._timerRemainingMs = 0
    this._timerDone = null
    this.gameState.setPhase(newPhase)
    UIRenderer.setPhase(newPhase)
    if (newPhase !== 'play') UIRenderer.setSelectionStatus(null)
    UIRenderer.renderHeader(this.gameState)

    if (newPhase === 'scan') this.startScan()
    if (newPhase === 'play') this.startPlay()
    if (newPhase === 'execute') this.startExecute()
    if (newPhase === 'settle') this.startSettle(this.roundResult)
  },

  startScan() {
    ThoughtChainPanel.clear()
    this.selectedIds.clear()
    UIRenderer.setExecutionMode('rigid')
    UIRenderer.renderHand([], [])
    UIRenderer.setPlayEnabled(false)
    UIRenderer.setTimerText('Scanning')

    const activeBotType = EnemyBotAI.getActiveBot(this.gameState.currentLayer)
    if (activeBotType && !this.gameState.hasSeenBot(activeBotType)) {
      OverlayManager.showBotIntro(activeBotType, () => {
        this.gameState.markBotSeen(activeBotType)
        this.runScan(activeBotType)
      })
      return
    }

    this.runScan(activeBotType)
  },

  runScan(activeBotType) {
    this.currentHand = generateHand(
      this.gameState.currentScene,
      this.gameState.activeAgents,
      this.gameState.agentLevels,
    )

    const fixedCards = LAYER_CONFIG[this.gameState.currentLayer]?.fixedCards
    if (fixedCards) this.currentHand = this.currentHand.slice(0, fixedCards)

    ThoughtChainPanel.appendLog({
      timestampMs: Date.now(),
      source: 'system',
      text: `扫描 mempool：Layer ${this.gameState.currentLayer}${activeBotType ? `，检测到 ${activeBotType}` : ''}`,
      isStreaming: false,
    })

    this.currentHand.forEach((_, index) => {
      const timerId = window.setTimeout(() => {
        UIRenderer.renderHand(this.currentHand.slice(0, index + 1), [...this.selectedIds], {
          phase: 'scan',
          enteringId: this.currentHand[index]?.id,
        })
      }, index * REVEAL_INTERVAL_MS)
      this._revealTimers.push(timerId)
    })

    const scanMs = this.roundConfig.scanMs ?? this.currentHand.length * REVEAL_INTERVAL_MS + SCAN_BUFFER_MS
    this.startPhaseTimer(scanMs, () => this.transition('play'), 'Scanning')
  },

  startPlay() {
    this.renderPlayableHand()
    this.startPhaseTimer(this.roundConfig.playMs ?? DEFAULT_PLAY_MS, () => this.transition('execute'))
  },

  async startExecute(
    selectedCards = this.battlePlan?.selectedCards ?? this.getSelectedCards(),
    gasAllocations = this.battlePlan ? battlePlanToGasAllocationArray(this.battlePlan) : this.getGasAllocations(selectedCards),
  ) {
    UIRenderer.renderHand(this.currentHand, [...this.selectedIds], { phase: 'execute' })
    UIRenderer.setPlayEnabled(false)
    UIRenderer.setSelectionStatus(null)
    UIRenderer.setTimerText('Executing')
    UIRenderer.setExecutionMode(this.isAdaptiveMode() ? 'adaptive' : 'rigid')

    try {
      this.roundResult = this.isAdaptiveMode()
        ? await ExecutionEngine.runAdaptiveMode(selectedCards, this.gameState, ExecutorAI, this.battlePlan)
        : await ExecutionEngine.runRigidMode(selectedCards, gasAllocations, this.gameState)
    } catch (error) {
      ThoughtChainPanel.appendLog({
        timestampMs: Date.now(),
        source: 'system',
        text: `[执行异常] ${error.message}。已进入安全结算，避免回合卡死。`,
        isStreaming: false,
      })
      this.roundResult = buildEmergencyResult(selectedCards, error)
    }
    this.transition('settle')
  },

  startSettle(roundResult) {
    const safeResult = roundResult ?? { cards: [], netProfit: 0, gasUsed: 0 }
    this.gameState.gasPool = Math.max(0, this.gameState.gasPool - safeResult.gasUsed)
    UIRenderer.renderHeader(this.gameState)
    UIRenderer.setTimerText('Settled')
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
    this.gasAllocations = this.battlePlan ? battlePlanToGasAllocationArray(this.battlePlan) : []
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
    UIRenderer.setSelectionStatus(selection)
    UIRenderer.setPlayEnabled(this.selectedIds.size > 0 && selection.isValid)
  },

  renderPlayableHand(message = '') {
    const selection = this.getSelectionState(message)
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
      return { valid: false, message: `Gas 预算不足：还剩 ${selection.gasPool - selection.selectedGas} Gwei。` }
    }

    return { valid: true, message: '' }
  },

  getSelectionState(message = '') {
    const layerConfig = LAYER_CONFIG[this.gameState?.currentLayer] ?? LAYER_CONFIG[20]
    const maxCards = layerConfig.slots ?? 1
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
        disabledReasons[card.id] = `Gas 不足，还剩 ${gasPool - selectedGas} Gwei`
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
    this.startPhaseTimer(this._timerRemainingMs, this._timerDone, this.gameState.phase === 'scan' ? 'Scanning' : null)
  },

  isPausablePhase() {
    return this.gameState?.phase === 'scan' || this.gameState?.phase === 'play'
  },

  getSelectedCards() {
    return this.currentHand.filter((card) => this.selectedIds.has(card.id))
  },

  getGasAllocations(cards) {
    return cards.map((card) => ({ cardId: card.id, gas: card.gasCost }))
  },

  isAdaptiveMode() {
    return this.gameState?.activeAgents.includes('executor')
  },

  jumpToLayer(layer) {
    if (!this.gameState) return

    const targetLayer = Math.max(1, Math.min(20, Number(layer) || 1))
    const layerConfig = LAYER_CONFIG[targetLayer] ?? LAYER_CONFIG[20]
    this.clearTimers()

    this.gameState.currentLayer = targetLayer
    this.gameState.currentScene = layerConfig.scene ?? layerConfig.scenes?.[0] ?? 'dex_arb'
    this.gameState.gasPoolMax = this.gameState.gasPoolMaxForStage(targetLayer)
    this.gameState.gasPool = this.gameState.gasPoolMax
    unlockAgentsForLayer(this.gameState, targetLayer)
    this.gameState.activeAgents = this.gameState.unlockedAgents.slice(0, layerConfig.slots)
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

function unlockAgentsForLayer(gameState, layer) {
  Object.entries(LAYER_CONFIG).forEach(([layerNumber, config]) => {
    if (Number(layerNumber) <= layer && config.unlocks) {
      gameState.unlockAgent(config.unlocks)
    }
  })
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
