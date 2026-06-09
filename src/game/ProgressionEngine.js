import { EnemyBotAI } from '../core/EnemyBotAI.js'
import { LAYER_CONFIG } from '../config/scenes.js'
import { OverlayManager } from '../ui/OverlayManager.js'

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
    const unlockAgentId = getLayerConfig(completedLayer).unlocks

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
    const layerConfig = getLayerConfig(gameState.currentLayer)
    const availableScenes = layerConfig.scenes ?? [layerConfig.scene]
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
    const slots = getLayerConfig(gameState.currentLayer).slots
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
      slots: getLayerConfig(gameState.currentLayer).slots,
      bot: EnemyBotAI.getActiveBot(gameState.currentLayer),
      isBoss: isBossLayer(gameState.currentLayer),
    }
  },
}

function getLayerConfig(layer) {
  return LAYER_CONFIG[layer] ?? LAYER_CONFIG[20]
}

function isBossLayer(layer) {
  return getLayerConfig(layer).isBoss
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
