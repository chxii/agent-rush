import { EnemyBotAI } from '../core/EnemyBotAI.js'
import { OverlayManager } from '../ui/OverlayManager.js'

const UNLOCK_BY_LAYER = {
  4: 'riskAnalyzer',
  8: 'executor',
  13: 'strategist',
}

let roundStarter = null

export const ProgressionEngine = {
  setRoundStarter(callback) {
    roundStarter = callback
  },

  afterRound(roundResult, gameState) {
    gameState.applyRoundResult(roundResult.netProfit)
    EnemyBotAI.updateGenesisHistory(gameState, roundResult.cards)

    if (gameState.checkFailure()) {
      OverlayManager.showGameOver(() => restartGame(gameState))
      return
    }

    if (gameState.checkVictory()) {
      OverlayManager.showVictory({ cumulativeProfit: gameState.cumulativeProfit }, () => restartGame(gameState))
      return
    }

    const completedLayer = gameState.currentLayer
    if (isBossLayer(completedLayer)) {
      OverlayManager.showBossReward(gameState.unlockedAgents, gameState.agentLevels, (agentId) => {
        gameState.upgradeAgent(agentId)
        this.unlockThenAdvance(gameState, completedLayer)
      })
      return
    }

    this.unlockThenAdvance(gameState, completedLayer)
  },

  unlockThenAdvance(gameState, completedLayer) {
    const unlockAgentId = UNLOCK_BY_LAYER[completedLayer]

    if (unlockAgentId && !gameState.unlockedAgents.includes(unlockAgentId)) {
      gameState.unlockAgent(unlockAgentId)
      OverlayManager.showAgentUnlock(unlockAgentId, () => this.advanceAfterReward(gameState, completedLayer))
      return
    }

    this.advanceAfterReward(gameState, completedLayer)
  },

  advanceAfterReward(gameState, completedLayer) {
    gameState.currentLayer = Math.min(completedLayer + 1, 20)
    gameState.gasPoolMax = gameState.gasPoolMaxForStage(gameState.currentLayer)
    gameState.gasPool = gameState.gasPoolMax

    if (gameState.currentLayer <= 3) {
      if (roundStarter) roundStarter(gameState)
      return
    }

    this.showSceneSelection(gameState)
  },

  showSceneSelection(gameState) {
    const availableScenes = sceneChoicesForLayer(gameState.currentLayer)
    if (availableScenes.length <= 1) {
      gameState.currentScene = availableScenes[0]
      this.showAgentRoster(gameState)
      return
    }

    OverlayManager.showSceneSelect(availableScenes, (sceneId) => {
      gameState.currentScene = sceneId
      this.showAgentRoster(gameState)
    })
  },

  showAgentRoster(gameState) {
    const slots = slotsForLayer(gameState.currentLayer)
    OverlayManager.showAgentRoster(gameState.unlockedAgents, gameState.agentLevels, slots, (activeAgents) => {
      gameState.activeAgents = activeAgents.slice(0, slots)
      gameState.saveProgress()
      if (roundStarter) roundStarter(gameState)
    })
  },

  getCurrentLayerConfig(gameState) {
    return {
      layer: gameState.currentLayer,
      scene: gameState.currentScene,
      slots: slotsForLayer(gameState.currentLayer),
      bot: EnemyBotAI.getActiveBot(gameState.currentLayer),
      isBoss: isBossLayer(gameState.currentLayer),
    }
  },
}

function sceneChoicesForLayer(layer) {
  if (layer <= 4) return ['dex_arb']
  if (layer <= 7) return ['dex_arb', 'new_token']
  if (layer <= 12) return ['nft_market', 'lending']
  if (layer <= 17) return ['nft_market', 'lending', 'new_token']
  return ['dex_arb', 'nft_market', 'lending', 'new_token']
}

function slotsForLayer(layer) {
  if (layer <= 3) return 1
  if (layer <= 7) return 2
  return 3
}

function isBossLayer(layer) {
  return layer === 4 || layer === 8 || layer === 13 || layer === 16 || layer === 20
}

function restartGame(gameState) {
  gameState.currentLayer = 1
  gameState.currentScene = 'dex_arb'
  gameState.activeAgents = ['searcher']
  gameState.gasPoolMax = gameState.gasPoolMaxForStage(1)
  gameState.gasPool = gameState.gasPoolMax
  gameState.cumulativeProfit = 0
  gameState.consecutiveLoss = 0
  OverlayManager.hideAll()
  if (roundStarter) roundStarter(gameState)
}
