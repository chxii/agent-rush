import { generateHand } from '../core/CardGenerator.js'
import { ExecutionEngine } from './ExecutionEngine.js'
import { UIRenderer } from '../ui/UIRenderer.js'

export const RoundEngine = {
  gameState: null,
  currentHand: [],
  selectedIds: new Set(),

  startRound(gameState) {
    this.gameState = gameState
    this.selectedIds.clear()
    gameState.setPhase('play')

    this.currentHand = generateHand(gameState.currentScene, gameState.activeAgents, gameState.agentLevels, {
      gasPool: gameState.gasPool,
      activeBotType: null,
    })

    UIRenderer.renderHeader(gameState)
    UIRenderer.renderHand(this.currentHand, [...this.selectedIds])
    UIRenderer.setTimerText('Ready')
    UIRenderer.appendLog('Searcher scanned the mempool and found new opportunities.')
  },

  toggleCard(cardId) {
    if (this.selectedIds.has(cardId)) {
      this.selectedIds.delete(cardId)
    } else {
      this.selectedIds.add(cardId)
    }

    UIRenderer.renderHand(this.currentHand, [...this.selectedIds])
  },

  confirmPlay(options = {}) {
    if (!this.gameState) return

    const selectedCards = options.skip
      ? []
      : this.currentHand.filter((card) => this.selectedIds.has(card.id))

    if (!options.skip && selectedCards.length === 0) return

    this.gameState.setPhase('settle')
    const executedCards = ExecutionEngine.executeSelectedCards(selectedCards)
    const gasUsed = executedCards.reduce((sum, card) => sum + card.gasCost, 0)
    const netProfit = roundEth(executedCards.reduce((sum, card) => sum + card.actualProfit, 0))

    this.gameState.gasPool = Math.max(0, this.gameState.gasPool - gasUsed)
    this.gameState.applyRoundResult(netProfit)

    const roundResult = {
      gasUsed,
      netProfit,
      results: executedCards.map((card) => ({
        cardId: card.id,
        success: true,
        actualProfit: card.actualProfit,
      })),
    }

    UIRenderer.renderSettlement(roundResult)
    UIRenderer.renderHeader(this.gameState)
    UIRenderer.setPlayEnabled(false)
    UIRenderer.setTimerText('Settled')
  },
}

function roundEth(value) {
  return Math.round(value * 100) / 100
}
