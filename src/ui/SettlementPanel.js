import { calculateWinLossProgress } from '../core/WinLoss.js'

let continueCallback = null
let rowTimerIds = []

export const SettlementPanel = {
  show(roundResult, gameStateOrCallback, maybeOnContinue) {
    const gameState = typeof gameStateOrCallback === 'function' ? null : gameStateOrCallback
    continueCallback = typeof gameStateOrCallback === 'function' ? gameStateOrCallback : maybeOnContinue

    const panel = getPanel()
    clearRowTimers()
    panel.innerHTML = `
      <div class="settlement-dialog">
        <h2>回合结算</h2>
        ${formatSummary(roundResult)}
        <div class="settlement-rows"></div>
        ${formatHighlights(roundResult.decisionHighlights)}
        ${formatProgress(roundResult, gameState)}
        <button id="settlement-continue" class="primary-button" type="button">继续</button>
      </div>
    `
    panel.classList.add('visible')
    panel.querySelector('#settlement-continue').addEventListener('click', () => {
      this.hide()
      if (continueCallback) continueCallback()
    })

    const rowContainer = panel.querySelector('.settlement-rows')
    ;(roundResult.cards ?? []).forEach((card, index) => {
      const timerId = window.setTimeout(() => {
        rowContainer.insertAdjacentHTML('beforeend', this.formatLine(card))
      }, index * 450)
      rowTimerIds.push(timerId)
    })
  },

  hide() {
    clearRowTimers()
    const panel = document.querySelector('#settlement-panel')
    if (panel) panel.classList.remove('visible')
  },

  formatLine(card) {
    const isSuccess = card.status === 'success'
    const reason = card.resultReason || reasonFromEvents(card) || statusLabel(card.status)
    return `
      <div class="settlement-line ${isSuccess ? 'success' : 'failure'}">
        <span>
          <strong>${typeLabel(card.type)} · ${card.id}</strong>
          <small>${reason}</small>
        </span>
        <span>${statusLabel(card.status)}</span>
        <strong>${formatSignedEth(card.actualProfit)}</strong>
      </div>
    `
  },
}

function getPanel() {
  let panel = document.querySelector('#settlement-panel')
  if (!panel) {
    panel = document.createElement('section')
    panel.id = 'settlement-panel'
    panel.className = 'modal-layer'
    document.body.append(panel)
  }
  return panel
}

function clearRowTimers() {
  rowTimerIds.forEach((timerId) => window.clearTimeout(timerId))
  rowTimerIds = []
}

function formatSummary(roundResult) {
  return `
    <div class="settlement-summary">
      <p>${roundResult.aiSummary ?? humanRoundSummary(roundResult)}</p>
      <div class="settlement-total">
        <span>本轮净收益 ${formatSignedEth(roundResult.netProfit)}</span>
        <span>Gas 使用 ${roundResult.gasUsed} Gwei</span>
      </div>
    </div>
  `
}

function humanRoundSummary(roundResult) {
  const net = Number(roundResult.netProfit) || 0
  if (net > 0) return `本轮赚钱 ${formatSignedEth(net)}，收益会加入累计利润。`
  if (net < 0) return `本轮亏损 ${formatSignedEth(net)}，会推进连亏计数。`
  return '本轮盈亏持平，没有扩大风险。'
}

function formatProgress(roundResult, gameState) {
  if (!gameState) return ''

  const projectedProfit = roundEth((gameState.cumulativeProfit ?? 0) + (roundResult.netProfit ?? 0))
  const projectedLossStreak = (roundResult.netProfit ?? 0) < 0 ? (gameState.consecutiveLoss ?? 0) + 1 : 0
  const progress = calculateWinLossProgress({
    cumulativeProfit: projectedProfit,
    consecutiveLoss: projectedLossStreak,
    currentLayer: gameState.currentLayer,
  })

  return `
    <section class="win-loss-progress">
      <h3>胜负条件</h3>
      <div class="progress-grid">
        <div>
          <strong>当前处境</strong>
          <span>预计累计收益 ${formatSignedEth(projectedProfit)} · 连亏 ${progress.failure.consecutiveLoss} / ${progress.failure.consecutiveLossThreshold}</span>
        </div>
        <div>
          <strong>胜利</strong>
          <span>到第 ${progress.victory.targetLayer} 层且累计收益 > ${formatSignedEth(progress.victory.profitLine)}；还差 ${progress.victory.profitRemaining.toFixed(3)} ETH / ${progress.victory.layersRemaining} 层。</span>
        </div>
        <div>
          <strong>失败</strong>
          <span>连亏达到 ${progress.failure.consecutiveLossThreshold} 且累计收益 < ${formatSignedEth(progress.failure.profitLine)}；还可亏 ${progress.failure.lossesRemaining} 次，收益缓冲 ${progress.failure.profitBuffer.toFixed(3)} ETH。</span>
        </div>
      </div>
    </section>
  `
}

function formatHighlights(highlights = []) {
  if (!highlights.length) return ''

  return `
    <div class="decision-highlights">
      ${highlights
        .map(
          (highlight) => `
            <div class="decision-highlight">
              <span>${highlightLabel(highlight.momentLabel)}</span>
              <p>${highlight.description}</p>
            </div>
          `,
        )
        .join('')}
    </div>
  `
}

function reasonFromEvents(card) {
  const result = [...(card.events ?? [])].reverse().find((event) =>
    ['success', 'failure', 'bot', 'repair'].includes(event.kind),
  )
  return result?.detail ?? ''
}

function statusLabel(status) {
  const labels = {
    success: '成功',
    failed: '失败',
    abandoned: '放弃',
  }
  return labels[status] ?? status
}

function typeLabel(type) {
  const labels = {
    arbitrage: '套利',
    sandwich: '夹子',
    nft_snipe: 'NFT 抢购',
    front_run: '抢跑',
    liquidation: '清算',
  }

  return labels[type] ?? type
}

function highlightLabel(label) {
  const labels = {
    task_decomposition: '任务拆解',
    multi_step_planning: '多步规划',
    tool_call: '链上动作',
    iterative_repair: '迭代修复',
    workflow_closure: '闭环总结',
  }
  return labels[label] ?? label
}

function formatSignedEth(value) {
  const number = Number(value) || 0
  return `${number >= 0 ? '+' : ''}${number.toFixed(3)} ETH`
}

function roundEth(value) {
  return Math.round(value * 1000) / 1000
}
