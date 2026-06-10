import { SCENES } from '../config/scenes.js'
import { INTERVENTION_SHORTCUTS } from '../config/execution.js'
import { ROLE_CONFIG } from '../config/roles.js'
import { calculateWinLossProgress } from '../core/WinLoss.js'

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
    const progress = calculateWinLossProgress(gameState)
    elements.header.innerHTML = `
      <div>
        <p class="label">层数</p>
        <strong>${gameState.currentLayer}</strong>
      </div>
      <div>
        <p class="label">场景</p>
        <strong>${sceneName}</strong>
      </div>
      <div>
        <p class="label">Gas 池</p>
        <strong>${gameState.gasPool} / ${gameState.gasPoolMax}</strong>
      </div>
      <div>
        <p class="label">收益</p>
        <strong>${formatEth(gameState.cumulativeProfit)}</strong>
      </div>
      <div>
        <p class="label">胜利线</p>
        <strong>还差 ${formatUnsignedEth(progress.victory.profitRemaining)}</strong>
        <small>距离第 ${progress.victory.targetLayer} 层还差 ${progress.victory.layersRemaining} 层</small>
      </div>
      <div>
        <p class="label">失败线</p>
        <strong>${progress.failure.consecutiveLoss} / ${progress.failure.consecutiveLossThreshold} 连亏</strong>
        <small>还能再亏 ${progress.failure.lossesRemaining} 次</small>
      </div>
    `

    this.renderRole(gameState)
  },

  renderRole(gameState) {
    const role = ROLE_CONFIG.roles[gameState.role]
    elements.agentPanel.innerHTML = `
      <div class="agent active">
        <span>${role?.name ?? '未选择角色'}</span>
        <b>Lv.${gameState.roleLevel ?? 1}</b>
      </div>
      <div class="agent">
        <span>${role?.tagline ?? '请选择起始角色'}</span>
        <b>${role?.buffSummary ?? ''}</b>
      </div>
    `
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
            <span class="card-meta">
              <span>${typeLabel(card.type)}</span>
              <span class="rarity">${card.rarity}</span>
            </span>
            <strong>${formatEth(card.expectedProfit)}</strong>
            <span class="metric">Gas ${card.gasCost} Gwei</span>
            <span class="metric risk-${riskBucket(card.displayedRisk)}">风险 ${riskPercent}%</span>
            <span class="metric">窗口 ${card.timeWindowSec}s</span>
            <span class="reason">${card.riskReason}</span>
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
      <small>剩余 ${status.remainingGas ?? Math.max(0, status.gasPool - status.selectedGas)} Gwei</small>
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
          <span class="label">干预</span>
          <input data-intervention-input type="text" placeholder="告诉 Executor 要调整什么" ${disabled ? 'disabled' : ''}>
        </label>
        <button class="secondary-button" type="submit" ${disabled ? 'disabled' : ''}>发送</button>
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
        <span>预案</span>
        <select data-contingency-card-id="${card.id}">
          ${contingencyOption('fight', '硬刚', contingencyValue)}
          ${contingencyOption('abandon', '放弃', contingencyValue)}
          ${contingencyOption('transfer', '转移', contingencyValue)}
        </select>
      </label>
    </span>
  `
}

function contingencyOption(value, label, selectedValue) {
  return `<option value="${value}" ${value === selectedValue ? 'selected' : ''}>${label}</option>`
}

function typeLabel(type) {
  const labels = {
    arbitrage: '套利',
    sandwich: '夹击',
    nft_snipe: 'NFT 抢购',
    front_run: '抢跑',
    liquidation: '清算',
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

function formatUnsignedEth(value) {
  return `${Math.max(0, Number(value) || 0).toFixed(2)} ETH`
}

