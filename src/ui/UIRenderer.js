import { SCENES } from '../config/scenes.js'
import { INTERVENTION_SHORTCUTS } from '../config/execution.js'

const elements = {
  header: null,
  agentPanel: null,
  handArea: null,
  logPanel: null,
  playButton: null,
  skipButton: null,
  timer: null,
  actionBar: null,
  selectionStatus: null,
  interventionPanel: null,
}

let cardClickCallback = null
let playClickCallback = null
let decisionChangeCallback = null
let interventionRequestCallback = null

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
    elements.selectionStatus = document.querySelector('#selection-status')

    if (!elements.selectionStatus && elements.actionBar) {
      elements.selectionStatus = document.createElement('div')
      elements.selectionStatus.id = 'selection-status'
      elements.selectionStatus.className = 'selection-status'
      elements.actionBar.insertBefore(elements.selectionStatus, elements.actionBar.querySelector('#skip-button'))
    }

    if (!elements.interventionPanel && elements.actionBar) {
      elements.interventionPanel = document.createElement('div')
      elements.interventionPanel.id = 'intervention-panel'
      elements.interventionPanel.className = 'intervention-panel'
      elements.actionBar.insertBefore(elements.interventionPanel, elements.actionBar.querySelector('#skip-button'))
    }

    elements.handArea?.addEventListener('click', (event) => {
      if (event.target.closest('[data-decision-control]')) return
      const cardButton = event.target.closest('[data-card-id]')
      if (cardButton && cardClickCallback) {
        cardClickCallback(cardButton.dataset.cardId)
      }
    })

    elements.handArea?.addEventListener('keydown', (event) => {
      if (event.target.closest('[data-decision-control]')) return
      if (event.key !== 'Enter' && event.key !== ' ') return

      const cardButton = event.target.closest('[data-card-id]')
      if (cardButton && cardClickCallback) {
        event.preventDefault()
        cardClickCallback(cardButton.dataset.cardId)
      }
    })

    elements.handArea?.addEventListener('input', (event) => {
      if (!event.target.closest('[data-decision-control]')) return
      if (decisionChangeCallback) decisionChangeCallback(collectDecisionInput())
    })

    elements.handArea?.addEventListener('change', (event) => {
      if (!event.target.closest('[data-decision-control]')) return
      if (decisionChangeCallback) decisionChangeCallback(collectDecisionInput())
    })

    elements.playButton?.addEventListener('click', () => {
      if (playClickCallback) playClickCallback({ battlePlanInput: collectDecisionInput() })
    })

    elements.skipButton?.addEventListener('click', () => {
      if (playClickCallback) playClickCallback({ skip: true })
    })

    elements.interventionPanel?.addEventListener('click', (event) => {
      const shortcutButton = event.target.closest('[data-intervention-shortcut]')
      if (!shortcutButton || !interventionRequestCallback) return
      interventionRequestCallback({
        type: 'shortcut',
        shortcutId: shortcutButton.dataset.interventionShortcut,
      })
    })

    elements.interventionPanel?.addEventListener('submit', (event) => {
      event.preventDefault()
      if (!interventionRequestCallback) return
      const input = elements.interventionPanel.querySelector('[data-intervention-input]')
      interventionRequestCallback({
        type: 'natural',
        text: input?.value ?? '',
      })
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
    const enteringId = options.enteringId
    const constraints = options.constraints ?? null
    const isPlayable = phase === 'play'

    elements.handArea.innerHTML = cards
      .map((card) => {
        const riskPercent = Math.round(card.displayedRisk * 100)
        const disabledReason = constraints?.disabledReasons?.[card.id] ?? ''
        const isSelected = selectedSet.has(card.id)
        const isDisabled = !isPlayable || Boolean(disabledReason)
        const tagName = isSelected && isPlayable ? 'article' : 'button'
        const gasValue = constraints?.gasAllocations?.[card.id] ?? card.gasCost
        const contingencyValue = constraints?.contingencies?.[card.id] ?? 'fight'
        return `
          <${tagName} class="card ${isSelected ? 'selected' : ''} ${disabledReason ? 'blocked' : ''} ${card.id === enteringId ? 'entering' : ''} ${card.rarity}" data-card-id="${card.id}" ${tagName === 'button' ? `type="button" ${isDisabled ? 'disabled' : ''}` : 'role="button" tabindex="0"'}>
            <span class="card-top">
              <span>${typeLabel(card.type)}</span>
              <span class="rarity">${card.rarity}</span>
            </span>
            <strong>${formatEth(card.expectedProfit)}</strong>
            <span class="metric">Gas ${card.gasCost} Gwei</span>
            <span class="metric risk-${riskBucket(card.displayedRisk)}">Risk ${riskPercent}%</span>
            <span class="metric">Window ${card.timeWindowSec}s</span>
            <span class="reason">${card.isScam ? '! ' : ''}${card.riskReason}</span>
            ${isSelected && isPlayable ? renderDecisionControls(card, gasValue, contingencyValue) : ''}
            ${disabledReason ? `<span class="blocked-reason">${disabledReason}</span>` : ''}
          </${tagName}>
        `
      })
      .join('')

    this.setPlayEnabled(isPlayable && selectedIds.length > 0 && (constraints?.isValid ?? true))
  },

  setPlayEnabled(enabled) {
    if (elements.playButton) {
      elements.playButton.disabled = !enabled
    }
  },

  setTimerText(text) {
    if (elements.timer) elements.timer.textContent = text
  },

  setSelectionStatus(status) {
    if (!elements.selectionStatus) return

    if (!status) {
      elements.selectionStatus.innerHTML = ''
      elements.selectionStatus.hidden = true
      return
    }

    elements.selectionStatus.hidden = false
    elements.selectionStatus.innerHTML = `
      <p class="label">选牌限制</p>
      <strong>${status.selectedCount} / ${status.maxCards} 张 · ${status.selectedGas} / ${status.gasPool} Gwei</strong>
      <small>Remaining ${status.remainingGas ?? Math.max(0, status.gasPool - status.selectedGas)} Gwei</small>
      ${status.message ? `<span>${status.message}</span>` : ''}
    `
  },

  setInterventionState(state = null) {
    if (!elements.interventionPanel) return

    if (!state || state.phase !== 'execute') {
      elements.interventionPanel.hidden = true
      elements.interventionPanel.innerHTML = ''
      return
    }

    const disabled = state.used || state.pending
    elements.interventionPanel.hidden = false
    elements.interventionPanel.innerHTML = `
      <form class="intervention-form">
        <label>
          <span class="label">Intervention</span>
          <input data-intervention-input type="text" placeholder="Tell Executor what to change" ${disabled ? 'disabled' : ''}>
        </label>
        <button class="secondary-button" type="submit" ${disabled ? 'disabled' : ''}>Send</button>
      </form>
      <div class="intervention-shortcuts">
        ${Object.values(INTERVENTION_SHORTCUTS)
          .map(
            (shortcut) =>
              `<button class="secondary-button" type="button" data-intervention-shortcut="${shortcut.id}" ${disabled ? 'disabled' : ''}>${shortcut.label}</button>`,
          )
          .join('')}
      </div>
      ${state.message ? `<small>${state.message}</small>` : ''}
    `
  },

  setPhase(phase) {
    document.body.dataset.phase = phase
    if (elements.actionBar) {
      elements.actionBar.dataset.phase = phase
    }

    const isPlay = phase === 'play'
    if (elements.playButton) elements.playButton.disabled = !isPlay
    if (elements.skipButton) elements.skipButton.disabled = !isPlay
    if (phase !== 'execute') this.setInterventionState(null)
  },

  setExecutionMode(mode) {
    document.body.dataset.executionMode = mode
    if (elements.logPanel) {
      elements.logPanel.dataset.mode = mode
    }
  },

  onCardClick(callback) {
    cardClickCallback = callback
  },

  onPlayClick(callback) {
    playClickCallback = callback
  },

  onDecisionChange(callback) {
    decisionChangeCallback = callback
  },

  onInterventionRequest(callback) {
    interventionRequestCallback = callback
  },
}

function collectDecisionInput() {
  const gasAllocations = {}
  const contingencies = {}

  elements.handArea?.querySelectorAll('[data-gas-card-id]').forEach((input) => {
    gasAllocations[input.dataset.gasCardId] = Number(input.value)
  })

  elements.handArea?.querySelectorAll('[data-contingency-card-id]').forEach((input) => {
    contingencies[input.dataset.contingencyCardId] = input.value
  })

  return { gasAllocations, contingencies }
}

function renderDecisionControls(card, gasValue, contingencyValue) {
  return `
    <span class="decision-controls" data-decision-control>
      <label>
        <span>Gas</span>
        <input data-gas-card-id="${card.id}" type="number" min="0" step="1" value="${gasValue}">
      </label>
      <label>
        <span>Plan</span>
        <select data-contingency-card-id="${card.id}">
          ${contingencyOption('fight', 'Fight', contingencyValue)}
          ${contingencyOption('abandon', 'Abandon', contingencyValue)}
          ${contingencyOption('transfer', 'Transfer', contingencyValue)}
        </select>
      </label>
    </span>
  `
}

function contingencyOption(value, label, selectedValue) {
  return `<option value="${value}" ${value === selectedValue ? 'selected' : ''}>${label}</option>`
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

