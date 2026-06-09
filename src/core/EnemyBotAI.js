import { BOTS } from '../config/bots.js'
import { LAYER_CONFIG } from '../config/scenes.js'

let forceStealNextCompetition = false

export const EnemyBotAI = {
  getActiveBot(layer) {
    const configuredBot = LAYER_CONFIG[layer]?.bot
    if (configuredBot !== undefined) return configuredBot

    const entry = Object.entries(BOTS).find(([, bot]) => layer >= bot.layers[0] && layer <= bot.layers[1])
    return entry?.[0] ?? null
  },

  compete(card, gameState) {
    const botName = this.getActiveBot(gameState.currentLayer)
    if (!botName) return { stolen: false, botName: null }

    if (forceStealNextCompetition) {
      forceStealNextCompetition = false
      return { stolen: true, botName, winProb: 1 }
    }

    const bot = BOTS[botName]
    let winProb = bot.baseWinProb * (1 + card.competitionLevel * 0.1)

    if (botName === 'Genesis' && gameState.genesisHistory.boostedType === card.type) {
      winProb = Math.min(winProb + 0.2, 0.9)
    }

    return {
      stolen: Math.random() < winProb,
      botName,
      winProb,
    }
  },

  forceNextSteal() {
    forceStealNextCompetition = true
  },

  updateGenesisHistory(gameState, roundCards) {
    const record = {
      scene: gameState.currentScene,
      cardTypes: roundCards.map((card) => card.type),
    }

    gameState.genesisHistory.lastTwoRounds.push(record)
    while (gameState.genesisHistory.lastTwoRounds.length > 2) {
      gameState.genesisHistory.lastTwoRounds.shift()
    }

    if (gameState.genesisHistory.lastTwoRounds.length === 2) {
      const [firstRound, secondRound] = gameState.genesisHistory.lastTwoRounds
      const sameOpening =
        firstRound.scene === secondRound.scene && firstRound.cardTypes[0] === secondRound.cardTypes[0]
      gameState.genesisHistory.boostedType = sameOpening ? secondRound.cardTypes[0] : null
    }
  },
}
