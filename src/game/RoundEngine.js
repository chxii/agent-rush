import { generateHand, injectScamCardNextHand } from '../core/CardGenerator.js'
import { EnemyBotAI } from '../core/EnemyBotAI.js'
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
    UIRenderer.renderHand(this.currentHand, [...this.selectedIds], { phase: 'play' })
    UIRenderer.setPlayEnabled(this.selectedIds.size > 0)
    this.startPhaseTimer(this.roundConfig.playMs ?? DEFAULT_PLAY_MS, () => this.transition('execute'))
  },

  async startExecute(selectedCards = this.getSelectedCards(), gasAllocations = this.getGasAllocations(selectedCards)) {
    UIRenderer.renderHand(this.currentHand, [...this.selectedIds], { phase: 'execute' })
    UIRenderer.setPlayEnabled(false)
    UIRenderer.setTimerText('Executing')
    UIRenderer.setExecutionMode(this.isAdaptiveMode() ? 'adaptive' : 'rigid')

    this.roundResult = this.isAdaptiveMode()
      ? await ExecutionEngine.runAdaptiveMode(selectedCards, this.gameState, ExecutorAI)
      : await ExecutionEngine.runRigidMode(selectedCards, gasAllocations, this.gameState)
    this.transition('settle')
  },

  startSettle(roundResult) {
    const safeResult = roundResult ?? { cards: [], netProfit: 0, gasUsed: 0 }
    this.gameState.gasPool = Math.max(0, this.gameState.gasPool - safeResult.gasUsed)
    UIRenderer.renderHeader(this.gameState)
    UIRenderer.setTimerText('Settled')
    SettlementPanel.show(safeResult, () => {
      ProgressionEngine.afterRound(safeResult, this.gameState)
      UIRenderer.renderHeader(this.gameState)
    })
  },

  toggleCard(cardId) {
    if (this.gameState?.phase !== 'play') return

    if (this.selectedIds.has(cardId)) {
      this.selectedIds.delete(cardId)
    } else {
      this.selectedIds.add(cardId)
    }

    UIRenderer.renderHand(this.currentHand, [...this.selectedIds], { phase: 'play' })
    UIRenderer.setPlayEnabled(this.selectedIds.size > 0)
  },

  confirmPlay(options = {}) {
    if (!this.gameState || this.gameState.phase !== 'play') return

    if (options.skip) {
      this.selectedIds.clear()
    }

    this.gasAllocations = this.getGasAllocations(this.getSelectedCards())
    this.transition('execute')
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
    this.clearRunningTimers()
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
    if (this._timerId) window.clearTimeout(this._timerId)
    if (this._intervalId) window.clearInterval(this._intervalId)
    this._revealTimers.forEach((timerId) => window.clearTimeout(timerId))
    this._timerId = null
    this._intervalId = null
    this._revealTimers = []
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
