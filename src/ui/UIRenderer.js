import { SCENES } from '../config/scenes.js'
import { INTERVENTION_SHORTCUTS } from '../config/execution.js'
import { ROLE_CONFIG } from '../config/roles.js'
import { calculateWinLossProgress } from '../core/WinLoss.js'

const CARD_TYPE_META = {
  arbitrage: { label: '套利', className: 'type-arbitrage' },
  sandwich: { label: '夹击', className: 'type-sandwich' },
  front_run: { label: '抢跑', className: 'type-front-run' },
  liquidation: { label: '清算', className: 'type-liquidation' },
  nft_snipe: { label: 'NFT 抢购', className: 'type-nft-snipe' },
}

const TERMINAL_STATUSES = new Set(['success', 'failed', 'abandoned'])

const elements = {
  header: null,
  roleStrip: null,
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
let pipelineState = []

export const UIRenderer = {
  init() {
    elements.header = document.querySelector('#header')
    elements.roleStrip = document.querySelector('#rolestrip')
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
      const pipelineChip = event.target.closest('[data-pipeline-card-id]')
      if (pipelineChip) {
        this.focusPipelineCard(pipelineChip.dataset.pipelineCardId)
        return
      }

      if (event.target.closest('[data-decision-control]')) return
      const cardButton = event.target.closest('[data-card-id]')
      if (cardButton && cardClickCallback) cardClickCallback(cardButton.dataset.cardId)
    })

    elements.handArea?.addEventListener('keydown', (event) => {
      const pipelineChip = event.target.closest('[data-pipeline-card-id]')
      if (pipelineChip && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault()
        this.focusPipelineCard(pipelineChip.dataset.pipelineCardId)
        return
      }

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
    if (!elements.roleStrip) return

    const role = ROLE_CONFIG.roles[gameState.role]
    elements.roleStrip.innerHTML = `
      <div class="rolestrip-main">
        <span class="label">指挥官角色</span>
        <strong>${role?.name ?? '未选择角色'}</strong>
        <span class="role-level">Lv.${gameState.roleLevel ?? 1}</span>
      </div>
      <div class="rolestrip-buff">
        <span>${role?.tagline ?? '开局选择一个打法。'}</span>
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
        const typeMeta = typeMetaFor(card.type)
        const riskPercent = Math.round(card.displayedRisk * 100)
        const disabledReason = constraints?.disabledReasons?.[card.id] ?? ''
        const isSelected = selectedSet.has(card.id)
        const isDisabled = !isPlayable || Boolean(disabledReason)
        const tagName = isSelected && isPlayable ? 'article' : 'button'
        const gasValue = constraints?.gasAllocations?.[card.id] ?? card.gasCost
        const contingencyValue = constraints?.contingencies?.[card.id] ?? 'fight'
        return `
          <${tagName} class="card ${typeMeta.className} ${isSelected ? 'selected' : ''} ${disabledReason ? 'blocked' : ''} ${card.id === enteringId ? 'entering' : ''} ${card.rarity}" data-card-id="${card.id}" ${tagName === 'button' ? `type="button" ${isDisabled ? 'disabled' : ''}` : 'role="button" tabindex="0"'}>
            <span class="card-meta">
              <span class="card-type">${typeMeta.label}</span>
              <span class="rarity">${card.rarity}</span>
            </span>
            <strong class="profit-value">${formatEth(card.expectedProfit)}</strong>
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

  initPipeline(cards, battlePlan = {}) {
    pipelineState = cards.map((card) => ({
      ...card,
      status: 'queued',
      allocatedGas: battlePlan.gasAllocations?.[card.id] ?? card.gasCost,
      contingency: battlePlan.contingencies?.[card.id] ?? 'fight',
    }))
    this.renderPipeline()
  },

  updatePipelineCard(cardId, updates = {}) {
    pipelineState = pipelineState.map((card) => {
      if (card.id !== cardId) {
        if (card.status === 'running') return { ...card, status: 'queued' }
        return card
      }
      return { ...card, ...updates }
    })
    this.renderPipeline()
  },

  reorderPipeline(updatedOrder = []) {
    if (!Array.isArray(updatedOrder) || updatedOrder.length === 0) return

    const cardsById = new Map(pipelineState.map((card) => [card.id, card]))
    const completed = pipelineState.filter((card) => TERMINAL_STATUSES.has(card.status))
    const movable = pipelineState.filter((card) => !TERMINAL_STATUSES.has(card.status))
    const movableIds = new Set(movable.map((card) => card.id))
    const ordered = updatedOrder
      .filter((cardId) => movableIds.has(cardId))
      .map((cardId) => cardsById.get(cardId))
    const orderedIds = new Set(ordered.map((card) => card.id))
    const rest = movable.filter((card) => !orderedIds.has(card.id))

    pipelineState = [...completed, ...ordered, ...rest]
    this.renderPipeline()
  },

  completePipeline(cards = []) {
    const resultById = new Map(cards.map((card) => [card.id, card]))
    pipelineState = pipelineState.map((card) => ({
      ...card,
      ...(resultById.get(card.id) ?? {}),
      status: resultById.get(card.id)?.status ?? card.status,
    }))
    this.renderPipeline()
  },

  renderPipeline(nextState = pipelineState) {
    pipelineState = nextState
    if (!elements.handArea) return

    if (!pipelineState.length) {
      const existing = elements.handArea.querySelector('[data-execution-workbench]')
      if (existing) existing.remove()
      return
    }

    const previousPositions = new Map(
      [...elements.handArea.querySelectorAll('[data-pipeline-card-id]')].map((chip) => [
        chip.dataset.pipelineCardId,
        chip.getBoundingClientRect(),
      ]),
    )

    elements.handArea.innerHTML = `
      <section class="execution-workbench" data-execution-workbench>
        <div class="pipeline-bar" aria-label="执行顺序">
          ${pipelineState.map((card, index) => renderPipelineChip(card, index, pipelineState.length)).join('')}
        </div>
        <div class="current-card-banner">
          ${renderCurrentBanner(currentPipelineCard())}
        </div>
      </section>
    `

    animatePipelineMove(previousPositions)
  },

  focusPipelineCard(cardId) {
    const card = pipelineState.find((item) => item.id === cardId)
    if (!card) return
    this.updatePipelineCard(cardId, { status: TERMINAL_STATUSES.has(card.status) ? card.status : 'running' })
    document.querySelector(`.thought-card[data-card-id="${CSS.escape(cardId)}"]`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  },

  setPlayEnabled(enabled) {
    if (elements.playButton) elements.playButton.disabled = !enabled
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
          <span class="label">⚡ 干预</span>
          <textarea data-intervention-input maxlength="140" rows="2" placeholder="告诉 Executor 要调整什么，例如：保住套利，放弃高风险牌。" ${disabled ? 'disabled' : ''}></textarea>
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
      ${state.message ? `<small>${state.message} · 最多 140 字。</small>` : '<small>最多 140 字。</small>'}
    `
  },

  setPhase(phase) {
    document.body.dataset.phase = phase
    if (elements.actionBar) elements.actionBar.dataset.phase = phase

    const isPlay = phase === 'play'
    if (elements.playButton) elements.playButton.disabled = !isPlay
    if (elements.skipButton) elements.skipButton.disabled = !isPlay
    if (phase !== 'execute') this.setInterventionState(null)
  },

  setExecutionMode(mode) {
    document.body.dataset.executionMode = mode
    if (elements.logPanel) elements.logPanel.dataset.mode = mode
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

function renderPipelineChip(card, index, total) {
  const typeMeta = typeMetaFor(card.type)
  const status = normalizeStatus(card.status)
  return `
    <button class="pipeline-chip ${typeMeta.className} status-${status}" type="button" data-pipeline-card-id="${card.id}">
      <span class="pipeline-index">${index + 1}</span>
      <span class="pipeline-main">
        <strong>${typeMeta.label}</strong>
        <small>${shortId(card.id)}</small>
      </span>
      <span class="pipeline-status">${statusLabel(status)}</span>
      ${index < total - 1 ? '<span class="pipeline-arrow">→</span>' : ''}
    </button>
  `
}

function animatePipelineMove(previousPositions) {
  if (!previousPositions.size) return

  elements.handArea?.querySelectorAll('[data-pipeline-card-id]').forEach((chip) => {
    const previous = previousPositions.get(chip.dataset.pipelineCardId)
    if (!previous) return

    const current = chip.getBoundingClientRect()
    const deltaX = previous.left - current.left
    const deltaY = previous.top - current.top
    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return

    chip.animate(
      [
        { transform: `translate(${deltaX}px, ${deltaY}px)` },
        { transform: 'translate(0, 0)' },
      ],
      { duration: 240, easing: 'ease-out' },
    )
  })
}

function renderCurrentBanner(card) {
  if (!card) {
    return '<span class="label">Pipeline</span><strong>等待执行队列</strong>'
  }

  const typeMeta = typeMetaFor(card.type)
  return `
    <span class="now-badge">NOW</span>
    <strong class="${typeMeta.className}">${typeMeta.label} · ${shortId(card.id)}</strong>
    <span>预案 ${contingencyLabel(card.contingency)} · Gas ${card.allocatedGas ?? card.gasCost} Gwei</span>
  `
}

function currentPipelineCard() {
  return pipelineState.find((card) => card.status === 'running' || card.status === 'incident')
    ?? pipelineState.find((card) => !TERMINAL_STATUSES.has(card.status))
    ?? pipelineState[pipelineState.length - 1]
}

function contingencyOption(value, label, selectedValue) {
  return `<option value="${value}" ${value === selectedValue ? 'selected' : ''}>${label}</option>`
}

function typeMetaFor(type) {
  return CARD_TYPE_META[type] ?? { label: type, className: 'type-unknown' }
}

function riskBucket(risk) {
  if (risk >= 0.65) return 'high'
  if (risk >= 0.35) return 'mid'
  return 'low'
}

function normalizeStatus(status) {
  if (status === 'in_progress') return 'running'
  if (status === 'abandoned') return 'failed'
  if (status === 'incident') return 'incident'
  if (status === 'success' || status === 'failed') return status
  return 'queued'
}

function statusLabel(status) {
  const labels = {
    queued: '排队',
    running: '在跑',
    incident: '重想',
    success: '成',
    failed: '败',
  }
  return labels[status] ?? status
}

function contingencyLabel(value) {
  const labels = {
    fight: '硬刚',
    abandon: '放弃',
    transfer: '转移',
  }
  return labels[value] ?? value
}

function shortId(id) {
  const text = String(id ?? '')
  if (text.length <= 8) return text
  return `${text.slice(0, 4)}…${text.slice(-3)}`
}

function formatEth(value) {
  const number = Number(value) || 0
  return `${number >= 0 ? '+' : ''}${number.toFixed(2)} ETH`
}

function formatUnsignedEth(value) {
  return `${Math.max(0, Number(value) || 0).toFixed(2)} ETH`
}
