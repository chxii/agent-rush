import { SCENES } from '../config/scenes.js'
import { INTERVENTION_SHORTCUTS } from '../config/execution.js'
import { ROLE_CONFIG } from '../config/roles.js'
import { calculateBroadcastSuccessProbability } from '../core/ToolSimulator.js'
import { TOOL_SIMULATOR_CONFIG } from '../config/toolSimulator.js'
import { calculateWinLossProgress } from '../core/WinLoss.js'

const CARD_TYPE_META = {
  arbitrage: {
    label: '套利',
    className: 'type-arbitrage',
    tip: 'A 便宜 B 贵，低买高卖。稳，但抢的人多，利润薄。',
  },
  sandwich: {
    label: '夹击',
    className: 'type-sandwich',
    tip: '抢在大单前后买卖，最吃相邻排序，也最吃 Gas。',
  },
  front_run: {
    label: '抢跑',
    className: 'type-front-run',
    tip: '正面拼出价和排队位置，Gas 不够就容易被盖过。',
  },
  liquidation: {
    label: '清算',
    className: 'type-liquidation',
    tip: '帮系统平坏账领奖励，目标被先清就没了，堆 Gas 未必线性变强。',
  },
  nft_snipe: {
    label: 'NFT 抢购',
    className: 'type-nft-snipe',
    tip: '抢限量名额或错价单，回报飘，窗口短，也更容易扑空。',
  },
}

const TERMINAL_STATUSES = new Set(['success', 'failed', 'abandoned'])

const elements = {
  header: null,
  roleStrip: null,
  handArea: null,
  thoughtArea: null,
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
    elements.thoughtArea = document.querySelector('#thought-area')
    elements.logPanel = document.querySelector('#log-panel')
    elements.playButton = document.querySelector('#play-button')
    elements.skipButton = document.querySelector('#skip-button')
    elements.timer = document.querySelector('#round-timer')
    elements.actionBar = document.querySelector('#action-bar')
    elements.selectionStatus = document.querySelector('#selection-status')

    if (!elements.selectionStatus && elements.handArea?.parentElement) {
      elements.selectionStatus = document.createElement('div')
      elements.selectionStatus.id = 'selection-status'
      elements.selectionStatus.className = 'selection-status'
      elements.handArea.insertAdjacentElement('afterend', elements.selectionStatus)
    } else if (elements.selectionStatus && elements.handArea?.parentElement && elements.selectionStatus.parentElement !== elements.handArea.parentElement) {
      elements.handArea.insertAdjacentElement('afterend', elements.selectionStatus)
    }

    if (!elements.interventionPanel && elements.actionBar) {
      elements.interventionPanel = document.createElement('div')
      elements.interventionPanel.id = 'intervention-panel'
      elements.interventionPanel.className = 'intervention-panel intervene'
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

    elements.handArea.hidden = false
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
            <span class="metric">Gas ${card.gasCost}</span>
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
      if (elements.thoughtArea) {
        elements.thoughtArea.hidden = true
        elements.thoughtArea.innerHTML = ''
      }
      elements.handArea.hidden = false
      return
    }

    const previousPositions = new Map(
      [...elements.handArea.querySelectorAll('[data-pipeline-card-id]')].map((chip) => [
        chip.dataset.pipelineCardId,
        chip.getBoundingClientRect(),
      ]),
    )

    elements.handArea.hidden = false
    elements.handArea.innerHTML = `
      <section class="execution-workbench" data-execution-workbench>
        <div class="pipeline-bar" aria-label="执行顺序">
          <span class="pipeline-label plabel">执行顺序</span>
          ${pipelineState.map((card, index) => renderPipelineItem(card, index, pipelineState.length)).join('')}
          <span class="pipeline-count pcount">${renderPipelineCount()}</span>
        </div>
        <div class="current-card-banner">
          ${renderCurrentBanner(currentPipelineCard())}
        </div>
      </section>
    `

    if (elements.thoughtArea) elements.thoughtArea.hidden = false

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

  setPlayButtonLabel(label) {
    if (elements.playButton) elements.playButton.textContent = label
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
      <strong>${status.selectedCount} / ${status.maxCards} 张 · ${status.selectedGas} / ${status.gasPool} Gas</strong>
      <small>剩余 ${status.remainingGas ?? Math.max(0, status.gasPool - status.selectedGas)} Gas</small>
      ${status.message ? `<span>${status.message}</span>` : ''}
      ${renderTutorialPanel(status.tutorial)}
    `
  },

  setInterventionState(state = null) {
    if (!elements.interventionPanel) return

    if (!state || state.phase !== 'execute') {
      elements.interventionPanel.hidden = true
      elements.interventionPanel.innerHTML = ''
      return
    }

    const formDisabled = (state.used || state.pending) && !state.allowCustomPrompt
    const shortcutsDisabled = state.used || state.pending
    elements.interventionPanel.hidden = false
    elements.interventionPanel.innerHTML = `
      <form class="intervention-form">
        <label>
          <span class="label">⚡ 干预</span>
          <textarea data-intervention-input maxlength="140" rows="2" placeholder="告诉 Executor 要调整什么，例如：保住套利，放弃高风险牌。" ${formDisabled ? 'disabled' : ''}></textarea>
        </label>
        <button class="secondary-button" type="submit" ${formDisabled ? 'disabled' : ''}>发送</button>
      </form>
      <div class="intervention-shortcuts">
        ${Object.values(INTERVENTION_SHORTCUTS)
          .map(
            (shortcut) =>
              `<button class="secondary-button" type="button" data-intervention-shortcut="${shortcut.id}" title="${shortcut.description ?? shortcut.label}" ${shortcutsDisabled ? 'disabled' : ''}>${shortcut.label}</button>`,
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
    this.setPlayButtonLabel('执行')
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

  buildTutorialFeedback(input) {
    return buildTutorialFeedback(input)
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

function renderTutorialPanel(tutorial) {
  if (!tutorial) return ''

  return `
    <section class="tutorial-panel">
      <div class="tutorial-steps">
        ${['选牌', '分 Gas', '设预案', '执行']
          .map((step, index) => `<span class="${index <= tutorial.stepIndex ? 'active' : ''}">${index + 1}. ${step}</span>`)
          .join('')}
      </div>
      <strong>${tutorial.title}</strong>
      <p>${tutorial.body}</p>
      ${tutorial.extraHtml ?? ''}
      ${tutorial.cards
        .map(
          (item) => `
            <article class="tutorial-card-note ${item.recommended ? 'recommended' : item.avoid ? 'avoid' : ''}">
              <div>
                <strong>${item.name}</strong>
                <span>${item.verdict}</span>
              </div>
              <small>成功率 ${formatPercent(item.successProbability)} · EV ${formatSignedEth(item.expectedValue)}</small>
              <p>${item.formula}</p>
            </article>
          `,
        )
        .join('')}
    </section>
  `
}

function renderPipelineItem(card, index, total) {
  return `${renderPipelineChip(card)}${index < total - 1 ? '<span class="pipeline-arrow parrow">→</span>' : ''}`
}

function renderPipelineChip(card) {
  const typeMeta = typeMetaFor(card.type)
  const status = normalizeStatus(card.status)
  const statusClass = status === 'queued' ? 'pending' : status === 'running' || status === 'incident' ? 'now' : status === 'success' ? 'done' : 'fail'
  return `
    <button class="pipeline-chip pchip ${typeMeta.className} ${statusClass} status-${status}" type="button" data-pipeline-card-id="${card.id}">
      <span class="dot"></span>
      <span class="pipeline-main">
        <strong>${typeMeta.label} ${shortId(card.id)}</strong>
        <small>${statusLabel(status)}</small>
      </span>
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
    <span class="current-card-meta">预期 ${formatEth(card.expectedProfit)} · 预案 ${contingencyLabel(card.contingency)} · Gas ${card.allocatedGas ?? card.gasCost}</span>
  `
}

export function buildTutorialFeedback({ layer, cards = [], selectedCards = [], gasAllocations = {}, role, roleLevel }) {
  if (layer < 1 || layer > 3) return null

  const selectedIds = new Set(selectedCards.map((card) => card.id))
  const notes = cards.map((card) => {
    const gas = gasAllocations[card.id] ?? card.gasCost
    const successProbability = estimateSuccessProbability(card, gas, { layer, role, roleLevel })
    const ev = expectedValue(card, gas)
    return {
      name: `${typeMetaFor(card.type).label} ${shortId(card.id)}`,
      successProbability,
      expectedValue: ev,
      recommended: recommendedTutorialCard(layer, card, ev),
      avoid: card.isScam || ev < 0,
      verdict: tutorialVerdict(layer, card, selectedIds.has(card.id), ev),
      formula: `${card.expectedProfit.toFixed(2)} × (1 - ${formatPercent(card.trueRisk)}) - ${gas}×0.001 = ${formatSignedEth(ev)}`,
    }
  })

  const selectedGasChanged = selectedCards.some((card) => (gasAllocations[card.id] ?? card.gasCost) !== card.gasCost)
  const stepIndex = selectedCards.length === 0 ? 0 : selectedGasChanged ? 2 : 1
  return {
    stepIndex,
    title: tutorialTitle(layer),
    body: tutorialBody(layer, notes),
    extraHtml: tutorialExtraHtml(layer, stepIndex),
    cards: notes,
  }
}

function renderPipelineCount() {
  const done = pipelineState.filter((card) => normalizeStatus(card.status) === 'success').length
  const failed = pipelineState.filter((card) => normalizeStatus(card.status) === 'failed').length
  const pending = pipelineState.filter((card) => normalizeStatus(card.status) === 'queued').length
  return `${done} 成 · ${failed} 跑 · ${pending} 待 / 共 ${pipelineState.length}`
}

function estimateSuccessProbability(card, gas, context = {}) {
  const state = {
    botName: context.layer >= 3 ? 'Bot-404' : null,
    botStrength: context.layer >= 3 ? 0.15 : 0,
    roleBuffs: {
      stealProbabilityMultiplier: 1,
      replaceRequiredBidMultiplier: 1,
      replaceSuppressProbabilityBonus: 0,
    },
  }
  return calculateBroadcastSuccessProbability(state, card, gas, { competitorDetected: false }, TOOL_SIMULATOR_CONFIG)
}

function expectedValue(card, gas) {
  return roundEth((card.expectedProfit ?? 0) * (1 - (card.trueRisk ?? card.displayedRisk ?? 0)) - gas * TOOL_SIMULATOR_CONFIG.gas.gasToEth)
}

function recommendedTutorialCard(layer, card, ev) {
  if (layer === 1) return !card.isScam && card.type === 'arbitrage'
  if (layer === 2) return card.type === 'sandwich'
  if (layer === 3) return ev > 0 && card.type === 'arbitrage'
  return ev > 0
}

function tutorialVerdict(layer, card, selected, ev) {
  if (card.isScam) return selected ? '别选：牌面风险低但真实风险极高。' : '排雷：这是骗局牌，别被高利润骗走 Gas。'
  if (layer === 1) return `${typeMetaFor(card.type).tip} ${selected ? '看清类型后再决定是否值得打。' : '点牌可观察 EV 和成功率。'}`
  if (layer === 2 && card.type === 'sandwich') return selected ? '正确：现在调高 Gas 看成功率变化。' : '推荐：夹击最吃 Gas，适合练习溢价。'
  if (ev < 0) return selected ? '不推荐：算上真实风险和 Gas 后 EV 为负。' : '观察即可：EV 为负，长期会亏。'
  return selected ? '可以打：风险、Gas 和收益能对上。' : '可选：EV 为正，适合按步骤执行。'
}

function tutorialTitle(layer) {
  const titles = {
    1: '第 1 关：先排雷，再选稳牌',
    2: '第 2 关：配 Gas，看 EV',
    3: '第 3 关：预案和干预',
  }
  return titles[layer] ?? ''
}

function tutorialBody(layer, notes) {
  if (layer === 1) return '先找骗局牌：显示风险很低、利润离谱，真实 EV 却很差。顺手把 5 种牌型认一遍，不同牌吃 Gas 的方式不一样。'
  if (layer === 2) return 'Gas 池是本层预算，不用花光，也不结转。调每张牌的 Gas，观察成功率和 EV；EV 为正，才值得长期打。'
  const best = [...notes].sort((a, b) => b.expectedValue - a.expectedValue)[0]
  return `每张牌都要设预案：被抢时硬刚、放弃，还是转移。Executor 会自己排执行顺序，通常优先打更有价值的牌；你通过预案和干预影响它。当前最稳的是 ${best?.name ?? 'EV 为正的牌'}。`
}

function tutorialExtraHtml(layer, stepIndex) {
  if (layer === 1) {
    return `
      <div class="tutorial-mini-grid">
        ${Object.values(CARD_TYPE_META)
          .map((type) => `<span class="${type.className}"><strong>${type.label}</strong>${type.tip}</span>`)
          .join('')}
      </div>
    `
  }

  if (layer === 2) {
    return `
      <div class="tutorial-tip">
        <strong>EV 公式</strong>
        <span>预期利润 × (1 - 真实风险) - 预计烧的 Gas。EV 为负代表长期亏，哪怕牌面利润看起来很香。</span>
      </div>
    `
  }

  if (layer === 3 && stepIndex >= 2) {
    return `
      <div class="contingency-guide">
        <span><strong>硬刚</strong>：被抢时加价 replace 抢回，可能成功，也会多烧 Gas。</span>
        <span><strong>放弃</strong>：立刻止损，只烧少量 Gas，保住池子给后面的牌。</span>
        <span><strong>转移</strong>：找一张没打过的正 EV 替补牌；找不到就等同放弃。</span>
      </div>
    `
  }

  return ''
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

function formatSignedEth(value) {
  const number = Number(value) || 0
  return `${number >= 0 ? '+' : ''}${number.toFixed(3)} ETH`
}

function formatPercent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`
}

function roundEth(value) {
  return Math.round(value * 1000) / 1000
}
