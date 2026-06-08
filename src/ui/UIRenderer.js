import { SCENES } from '../config/scenes.js'

const elements = {
  header: null,
  agentPanel: null,
  handArea: null,
  logPanel: null,
  playButton: null,
  skipButton: null,
  timer: null,
  actionBar: null,
}

let cardClickCallback = null
let playClickCallback = null

export const UIRenderer = {
  init() {
    elements.header = document.querySelector('#header')
    elements.agentPanel = document.querySelector('#agent-panel')
    elements.handArea = document.querySelector('#hand-area')
    elements.logPanel = document.querySelector('#log-panel')
    elements.playButton = document.querySelector('#play-button')
    elements.skipButton = document.querySelector('#skip-button')
    elements.timer = document.querySelector('#round-timer')
    elements.actionBar = document.querySelector('#action-bar')

    elements.handArea?.addEventListener('click', (event) => {
      const cardButton = event.target.closest('[data-card-id]')
      if (cardButton && cardClickCallback) {
        cardClickCallback(cardButton.dataset.cardId)
      }
    })

    elements.playButton?.addEventListener('click', () => {
      if (playClickCallback) playClickCallback()
    })

    elements.skipButton?.addEventListener('click', () => {
      if (playClickCallback) playClickCallback({ skip: true })
    })
  },

  renderHeader(gameState) {
    const sceneName = SCENES[gameState.currentScene]?.name ?? gameState.currentScene
    elements.header.innerHTML = `
      <div>
        <p class="label">Layer</p>
        <strong>${gameState.currentLayer}</strong>
      </div>
      <div>
        <p class="label">Scene</p>
        <strong>${sceneName}</strong>
      </div>
      <div>
        <p class="label">Gas Pool</p>
        <strong>${gameState.gasPool} / ${gameState.gasPoolMax}</strong>
      </div>
      <div>
        <p class="label">Profit</p>
        <strong>${formatEth(gameState.cumulativeProfit)}</strong>
      </div>
    `

    this.renderAgents(gameState)
  },

  renderAgents(gameState) {
    elements.agentPanel.innerHTML = gameState.unlockedAgents
      .map((agentId) => {
        const isActive = gameState.activeAgents.includes(agentId)
        const level = gameState.agentLevels[agentId] ?? 1
        return `
          <div class="agent ${isActive ? 'active' : ''}">
            <span>${agentLabel(agentId)}</span>
            <b>Lv.${level}</b>
          </div>
        `
      })
      .join('')
  },

  renderHand(cards, selectedIds = [], options = {}) {
    const selectedSet = new Set(selectedIds)
    const phase = options.phase ?? 'play'
    const isPlayable = phase === 'play'

    elements.handArea.innerHTML = cards
      .map((card) => {
        const riskPercent = Math.round(card.displayedRisk * 100)
        return `
          <button class="card ${selectedSet.has(card.id) ? 'selected' : ''} ${card.rarity}" data-card-id="${card.id}" type="button" ${isPlayable ? '' : 'disabled'}>
            <span class="card-top">
              <span>${typeLabel(card.type)}</span>
              <span class="rarity">${card.rarity}</span>
            </span>
            <strong>${formatEth(card.expectedProfit)}</strong>
            <span class="metric">Gas ${card.gasCost} Gwei</span>
            <span class="metric risk-${riskBucket(card.displayedRisk)}">Risk ${riskPercent}%</span>
            <span class="metric">Window ${card.timeWindowSec}s</span>
            <span class="reason">${card.isScam ? '! ' : ''}${card.riskReason}</span>
          </button>
        `
      })
      .join('')

    this.setPlayEnabled(isPlayable && selectedIds.length > 0)
  },

  setPlayEnabled(enabled) {
    if (elements.playButton) {
      elements.playButton.disabled = !enabled
    }
  },

  setTimerText(text) {
    if (elements.timer) elements.timer.textContent = text
  },

  setPhase(phase) {
    document.body.dataset.phase = phase
    if (elements.actionBar) {
      elements.actionBar.dataset.phase = phase
    }

    const isPlay = phase === 'play'
    if (elements.playButton) elements.playButton.disabled = !isPlay
    if (elements.skipButton) elements.skipButton.disabled = !isPlay
  },

  onCardClick(callback) {
    cardClickCallback = callback
  },

  onPlayClick(callback) {
    playClickCallback = callback
  },
}

function agentLabel(agentId) {
  const labels = {
    searcher: 'Searcher',
    riskAnalyzer: 'Risk Analyzer',
    executor: 'Executor',
    strategist: 'Strategist',
  }

  return labels[agentId] ?? agentId
}

function typeLabel(type) {
  const labels = {
    arbitrage: 'Arbitrage',
    sandwich: 'Sandwich',
    nft_snipe: 'NFT Snipe',
    front_run: 'Front-run',
    liquidation: 'Liquidation',
  }

  return labels[type] ?? type
}

function riskBucket(risk) {
  if (risk >= 0.65) return 'high'
  if (risk >= 0.35) return 'mid'
  return 'low'
}

function formatEth(value) {
  const number = Number(value) || 0
  return `${number >= 0 ? '+' : ''}${number.toFixed(2)} ETH`
}

