import { generateHand } from '../core/CardGenerator.js'
import { EnemyBotAI } from '../core/EnemyBotAI.js'
import { ExecutorAI } from '../ai/ExecutorAI.js'
import { SettlementPanel } from '../ui/SettlementPanel.js'
import { ThoughtChainPanel } from '../ui/ThoughtChainPanel.js'
import { UIRenderer } from '../ui/UIRenderer.js'
import { ExecutionEngine } from './ExecutionEngine.js'
import { ProgressionEngine } from './ProgressionEngine.js'

const DEFAULT_SCAN_MS = 15000
const DEFAULT_PLAY_MS = 25000
const REVEAL_INTERVAL_MS = 300

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
    this.currentHand = generateHand(
      this.gameState.currentScene,
      this.gameState.activeAgents,
      this.gameState.agentLevels,
    )

    ThoughtChainPanel.appendLog({
      timestampMs: Date.now(),
      source: 'system',
      text: `扫描 mempool：Layer ${this.gameState.currentLayer}${activeBotType ? `，检测到 ${activeBotType}` : ''}`,
      isStreaming: false,
    })

    this.currentHand.forEach((_, index) => {
      const timerId = window.setTimeout(() => {
        UIRenderer.renderHand(this.currentHand.slice(0, index + 1), [...this.selectedIds], { phase: 'scan' })
      }, index * REVEAL_INTERVAL_MS)
      this._revealTimers.push(timerId)
    })

    this._timerId = window.setTimeout(() => this.transition('play'), this.roundConfig.scanMs ?? DEFAULT_SCAN_MS)
  },

  startPlay() {
    UIRenderer.renderHand(this.currentHand, [...this.selectedIds], { phase: 'play' })
    UIRenderer.setPlayEnabled(this.selectedIds.size > 0)
    this.startCountdown(this.roundConfig.playMs ?? DEFAULT_PLAY_MS, () => this.transition('execute'))
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

  getSelectedCards() {
    return this.currentHand.filter((card) => this.selectedIds.has(card.id))
  },

  getGasAllocations(cards) {
    return cards.map((card) => ({ cardId: card.id, gas: card.gasCost }))
  },

  isAdaptiveMode() {
    return this.gameState?.activeAgents.includes('executor')
  },

  startCountdown(durationMs, onDone) {
    const endAt = Date.now() + durationMs
    const update = () => {
      const remainingMs = Math.max(0, endAt - Date.now())
      UIRenderer.setTimerText(`${Math.ceil(remainingMs / 1000)}s`)
      if (remainingMs <= 0) {
        window.clearInterval(this._intervalId)
        this._intervalId = null
      }
    }

    update()
    this._intervalId = window.setInterval(update, 250)
    this._timerId = window.setTimeout(onDone, durationMs)
  },

  clearTimers() {
    if (this._timerId) window.clearTimeout(this._timerId)
    if (this._intervalId) window.clearInterval(this._intervalId)
    this._revealTimers.forEach((timerId) => window.clearTimeout(timerId))
    this._timerId = null
    this._intervalId = null
    this._revealTimers = []
  },
}
