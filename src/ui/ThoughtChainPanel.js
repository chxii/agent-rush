const cardSections = new Map()
const cardMeta = new Map()
const loadingRows = new Map()

const BOT_EMOJI = {
  'Bot-404': '🐣',
  Shadow: '👻',
  Phantom: '😈',
  'Phantom+': '💢',
  Genesis: '👑',
}

export const ThoughtChainPanel = {
  displayId: 'operator',

  setDisplayId(displayId) {
    this.displayId = sanitizeDisplayId(displayId)
  },

  appendLog(entry) {
    if (entry?.cardId) {
      this.appendCardEvent(entry.cardId, {
        kind: entry.kind ?? entry.source ?? 'system',
        title: entry.title ?? sourceTitle(entry.source),
        detail: entry.text,
      })
      return
    }

    const panel = getLogPanel()
    if (!panel) return

    const line = document.createElement('div')
    line.className = `log-line ${sourceClass(entry?.source)}`
    line.innerHTML = `<span class="terminal-prefix">${this.displayId}@executor-pc &gt;&gt;</span> ${formatEntry(entry)}`
    panel.append(line)
    scrollToBottom(panel)
  },

  appendStreaming(prefix = '', onStart, options = {}) {
    const panel = options.cardId ? getThoughtPanel() : getLogPanel()
    const line = document.createElement('div')
    const span = document.createElement('span')
    let done = false
    let attached = false

    line.className = 'log-line log-executor streaming'
    if (options.cardId) {
      span.textContent = prefix
    } else {
      line.innerHTML = `<span class="terminal-prefix">${this.displayId}@executor-pc &gt;&gt;</span> `
    }
    line.append(span)

    const parent = options.cardId ? getCardBody(options.cardId, options.cardTitle) : panel
    const attachLine = () => {
      if (!parent || attached) return
      parent.append(line)
      attached = true
      scrollToBottom(panel)
    }
    if (options.cardId) attachLine()

    if (onStart) onStart(span)

    return {
      write(chunk) {
        if (done) return
        if (!attached && chunk) attachLine()
        span.textContent += chunk
        scrollToBottom(panel)
      },

      end() {
        done = true
        if (!attached && span.textContent) attachLine()
        line.classList.remove('streaming')
        scrollToBottom(panel)
      },
    }
  },

  showLoading(key, message, options = {}) {
    if (!key || loadingRows.has(key)) return

    const panel = options.cardId ? getThoughtPanel() : getLogPanel()
    const parent = options.cardId ? getCardBody(options.cardId, options.cardTitle) : panel
    if (!parent) return

    const row = document.createElement('div')
    row.className = options.cardId
      ? 'thought-event event-loading is-loading'
      : 'log-line log-executor loading-line is-loading'

    if (options.cardId) {
      row.innerHTML = `
        <span class="event-icon">AI</span>
        <div>
          <strong>Executor thinking</strong>
          <p>${escapeHtml(message)}</p>
          <span class="thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span>
        </div>
      `
    } else {
      row.innerHTML = `<span class="terminal-prefix">${this.displayId}@executor-pc &gt;&gt;</span> ${escapeHtml(message)} <span class="thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span>`
    }

    parent.append(row)
    loadingRows.set(key, row)
    scrollToBottom(panel)
  },

  clearLoading(key) {
    if (!key) return
    loadingRows.get(key)?.remove()
    loadingRows.delete(key)
  },

  clearAllLoading() {
    loadingRows.forEach((row) => row.remove())
    loadingRows.clear()
  },

  startCard(card) {
    cardMeta.set(card.id, card)
    getCardBody(card.id, cardLabel(card))
  },

  appendCardEvent(cardId, event) {
    const panel = getThoughtPanel()
    const body = getCardBody(cardId, event.cardTitle)
    if (!body) return

    const row = document.createElement('div')
    row.className = `thought-event event-${event.kind ?? 'system'}`
    if (event.kind === 'bot' || event.kind === 'incident') row.classList.add('is-steal', 'steal')
    if (event.kind === 'repair') row.classList.add('is-replan', 'replan')

    row.innerHTML = `
      <span class="event-icon">${iconForKind(event.kind)}</span>
      <div>
        <strong>${decorateText(event.title ?? '事件')}</strong>
        <p>${decorateText(event.detail ?? '')}</p>
        ${event.meta ? `<small>${decorateText(event.meta)}</small>` : ''}
      </div>
    `
    body.append(row)
    scrollToBottom(panel)
  },

  appendDiagnostic(diagnostic) {
    this.appendLog({
      source: diagnostic.level ?? 'system',
      text: `[LLM] ${diagnostic.text}`,
    })
  },

  clear() {
    const logPanel = getLogPanel()
    const thoughtPanel = getThoughtPanel()
    if (logPanel) logPanel.innerHTML = ''
    if (thoughtPanel) thoughtPanel.innerHTML = ''
    cardSections.clear()
    cardMeta.clear()
    loadingRows.clear()
  },
}

function getCardBody(cardId, title = cardId) {
  const panel = getThoughtPanel()
  if (!panel || !cardId) return null

  panel.querySelectorAll('.thought-card.is-active').forEach((item) => item.classList.remove('is-active'))

  if (cardSections.has(cardId)) {
    const existingBody = cardSections.get(cardId)
    existingBody.closest('.thought-card')?.classList.add('is-active')
    return existingBody
  }

  const meta = cardMeta.get(cardId)
  panel.querySelector('.thought-placeholder')?.remove()
  const section = document.createElement('section')
  section.className = `thought-card is-active ${meta ? `type-${meta.type.replaceAll('_', '-')}` : ''}`
  section.dataset.cardId = cardId
  section.innerHTML = `
    <div class="thought-card-header">
      <div>
        <span class="trace-badge">TRACE</span>
        <strong>${title}</strong>
      </div>
      <span>${cardId}</span>
    </div>
    <div class="thought-card-body"></div>
  `

  panel.append(section)
  const body = section.querySelector('.thought-card-body')
  cardSections.set(cardId, body)
  scrollToBottom(panel)
  return body
}

function getLogPanel() {
  return document.querySelector('#log-panel')
}

function getThoughtPanel() {
  return document.querySelector('#thought-area')
}

function sourceClass(source) {
  return `log-${source ?? 'system'}`
}

function sourceTitle(source) {
  const titles = {
    executor: 'Executor',
    tool: '链上动作',
    system: '系统',
  }
  return titles[source] ?? '事件'
}

function formatEntry(entry) {
  if (typeof entry === 'string') return decorateText(entry)
  const prefix = entry.source === 'tool' ? '⚙️ ' : ''
  return decorateText(`${prefix}${entry.text ?? ''}`)
}

function decorateText(text) {
  const escaped = escapeHtml(text)
  return Object.entries(BOT_EMOJI).reduce((result, [bot, emoji]) => {
    const pattern = new RegExp(`(?<![\\w-])${escapeRegExp(bot)}(?![\\w-])`, 'g')
    return result.replace(pattern, `${emoji} <strong>${bot}</strong>`)
  }, escaped)
}

function cardLabel(card) {
  return `${typeLabel(card.type)} · ${formatEth(card.expectedProfit)} · Gas ${card.allocatedGas ?? card.gasCost}`
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

function iconForKind(kind) {
  const icons = {
    plan: '🧭',
    tool: '⚙️',
    bot: '🔥',
    incident: '🔥',
    repair: '🧠',
    fallback: 'R',
    success: '✅',
    failure: '⚠️',
    system: 'i',
    executor: 'AI',
  }
  return icons[kind] ?? 'i'
}

function sanitizeDisplayId(value) {
  const cleaned = String(value ?? 'operator')
    .trim()
    .replace(/[^\w-]/g, '')
    .slice(0, 16)
  return cleaned || 'operator'
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatEth(value) {
  return `${Number(value ?? 0).toFixed(2)} ETH`
}

function scrollToBottom(panel) {
  if (panel) panel.scrollTop = panel.scrollHeight
}
