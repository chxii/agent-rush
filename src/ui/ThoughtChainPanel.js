export const ThoughtChainPanel = {
  appendLog(entry) {
    const panel = document.querySelector('#log-panel')
    if (!panel) return

    const line = document.createElement('div')
    line.className = `log-line ${sourceClass(entry.source)}`
    line.textContent = formatEntry(entry)
    panel.append(line)
    panel.scrollTop = panel.scrollHeight
  },

  appendStreaming(prefix = '', onStart) {
    const panel = document.querySelector('#log-panel')
    const line = document.createElement('div')
    const span = document.createElement('span')
    let done = false

    line.className = 'log-line log-executor streaming'
    span.textContent = prefix
    line.append(span)

    if (panel) {
      panel.append(line)
      panel.scrollTop = panel.scrollHeight
    }

    if (onStart) onStart(span)

    return {
      write(chunk) {
        if (done) return
        span.textContent += chunk
        if (panel) panel.scrollTop = panel.scrollHeight
      },

      end() {
        done = true
        line.classList.remove('streaming')
        if (panel) panel.scrollTop = panel.scrollHeight
      },
    }
  },

  clear() {
    const panel = document.querySelector('#log-panel')
    if (panel) panel.innerHTML = ''
  },
}

function sourceClass(source) {
  return `log-${source ?? 'system'}`
}

function formatEntry(entry) {
  if (typeof entry === 'string') return entry
  const prefix = entry.source === 'tool' ? '-> ' : ''
  return `${prefix}${entry.text}`
}
