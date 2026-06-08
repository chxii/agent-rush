export const ThoughtChainPanel = {
  appendLog(message) {
    const panel = document.querySelector('#log-panel')
    if (!panel) return

    const line = document.createElement('div')
    line.className = 'log-line'
    line.textContent = message
    panel.append(line)
    panel.scrollTop = panel.scrollHeight
  },
}
