let continueCallback = null
let rowTimerIds = []

export const SettlementPanel = {
  show(roundResult, onContinue) {
    continueCallback = onContinue
    const panel = getPanel()
    clearRowTimers()
    panel.innerHTML = `
      <div class="settlement-dialog">
        <h2>Round Settlement</h2>
        <div class="settlement-rows"></div>
        <div class="settlement-total">
          <span>Net ${formatSignedEth(roundResult.netProfit)}</span>
          <span>Gas ${roundResult.gasUsed} Gwei</span>
        </div>
        <button id="settlement-continue" class="primary-button" type="button">Continue</button>
      </div>
    `
    panel.classList.add('visible')
    panel.querySelector('#settlement-continue').addEventListener('click', () => {
      this.hide()
      if (continueCallback) continueCallback()
    })

    const rowContainer = panel.querySelector('.settlement-rows')
    roundResult.cards.forEach((card, index) => {
      const timerId = window.setTimeout(() => {
        rowContainer.insertAdjacentHTML('beforeend', this.formatLine(card))
      }, index * 500)
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
    return `
      <div class="settlement-line ${isSuccess ? 'success' : 'failure'}">
        <span>${card.id}</span>
        <span>${card.status}</span>
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

function formatSignedEth(value) {
  return `${value >= 0 ? '+' : ''}${Number(value).toFixed(3)} ETH`
}
