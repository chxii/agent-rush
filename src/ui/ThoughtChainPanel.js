const cardSections = new Map()

export const ThoughtChainPanel = {
  appendLog(entry) {
    const panel = document.querySelector('#log-panel')
    if (!panel) return

    if (entry?.cardId) {
      this.appendCardEvent(entry.cardId, {
        kind: entry.kind ?? entry.source ?? 'system',
        title: entry.title ?? sourceTitle(entry.source),
        detail: entry.text,
      })
      return
    }

    const line = document.createElement('div')
    line.className = `log-line ${sourceClass(entry?.source)}`
    line.textContent = formatEntry(entry)
    panel.append(line)
    scrollToBottom(panel)
  },

  appendStreaming(prefix = '', onStart, options = {}) {
    const panel = document.querySelector('#log-panel')
    const line = document.createElement('div')
    const span = document.createElement('span')
    let done = false

    line.className = 'log-line log-executor streaming'
    span.textContent = prefix
    line.append(span)

    const parent = options.cardId ? getCardBody(options.cardId, options.cardTitle) : panel
    if (parent) {
      parent.append(line)
      scrollToBottom(panel)
    }

    if (onStart) onStart(span)

    return {
      write(chunk) {
        if (done) return
        span.textContent += chunk
        scrollToBottom(panel)
      },

      end() {
        done = true
        line.classList.remove('streaming')
        scrollToBottom(panel)
      },
    }
  },

  startCard(card) {
    getCardBody(card.id, cardLabel(card))
  },

  appendCardEvent(cardId, event) {
    const panel = document.querySelector('#log-panel')
    const body = getCardBody(cardId, event.cardTitle)
    if (!body) return

    const row = document.createElement('div')
    row.className = `thought-event event-${event.kind ?? 'system'}`
    row.innerHTML = `
      <span class="event-icon">${iconForKind(event.kind)}</span>
      <div>
        <strong>${event.title ?? '事件'}</strong>
        <p>${event.detail ?? ''}</p>
        ${event.meta ? `<small>${event.meta}</small>` : ''}
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
    const panel = document.querySelector('#log-panel')
    if (panel) panel.innerHTML = ''
    cardSections.clear()
  },
}

function getCardBody(cardId, title = cardId) {
  const panel = document.querySelector('#log-panel')
  if (!panel || !cardId) return null

  panel.querySelectorAll('.thought-card.is-active').forEach((item) => item.classList.remove('is-active'))

  if (cardSections.has(cardId)) {
    const existingBody = cardSections.get(cardId)
    existingBody.closest('.thought-card')?.classList.add('is-active')
    return existingBody
  }

  const section = document.createElement('section')
  section.className = 'thought-card is-active'
  section.dataset.cardId = cardId
  section.innerHTML = `
    <div class="thought-card-header">
      <strong>${title}</strong>
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

function sourceClass(source) {
  return `log-${source ?? 'system'}`
}

function sourceTitle(source) {
  const titles = {
    executor: '执行器',
    tool: '链上动作',
    system: '系统',
  }
  return titles[source] ?? '事件'
}

function formatEntry(entry) {
  if (typeof entry === 'string') return entry
  const prefix = entry.source === 'tool' ? '-> ' : ''
  return `${prefix}${entry.text}`
}

function cardLabel(card) {
  return `${typeLabel(card.type)} · ${formatEth(card.expectedProfit)}`
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

function iconForKind(kind) {
  const icons = {
    plan: '1',
    tool: '2',
    bot: '!',
    repair: '+',
    success: 'OK',
    failure: 'X',
    system: 'i',
    executor: 'AI',
  }
  return icons[kind] ?? 'i'
}

function formatEth(value) {
  return `${Number(value ?? 0).toFixed(2)} ETH`
}

function scrollToBottom(panel) {
  if (panel) panel.scrollTop = panel.scrollHeight
}
