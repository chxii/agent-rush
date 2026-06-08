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
