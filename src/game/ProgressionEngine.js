import { EnemyBotAI } from '../core/EnemyBotAI.js'
import { LAYER_CONFIG } from '../config/scenes.js'
import { WIN_LOSS_CONFIG } from '../config/winloss.js'
import { ROLE_CONFIG } from '../config/roles.js'
import { OverlayManager } from '../ui/OverlayManager.js'

let roundStarter = null

export const ProgressionEngine = {
  setRoundStarter(callback) {
    roundStarter = callback
  },

  startRun(gameState) {
    gameState.gasPoolMax = gameState.gasPoolMaxForStage(gameState.currentLayer)
    gameState.gasPool = Math.min(gameState.gasPool || gameState.gasPoolMax, gameState.gasPoolMax)

    if (!gameState.role) {
      OverlayManager.showRoleSelect(ROLE_CONFIG.roles, (roleId) => {
        gameState.setRole(roleId)
        this.showSceneSelection(gameState)
      })
      return
    }

    this.showSceneSelection(gameState)
  },

  afterRound(roundResult, gameState) {
    gameState.applyRoundResult(roundResult.netProfit)
    EnemyBotAI.updateGenesisHistory(gameState, roundResult.cards)

    if (gameState.checkFailure()) {
      OverlayManager.showGameOver(buildFinalStats(gameState), () => restartGame(gameState))
      return
    }

    if (gameState.checkVictory()) {
      OverlayManager.showVictory(buildFinalStats(gameState), () => restartGame(gameState))
      return
    }

    const completedLayer = gameState.currentLayer
    if (isBossLayer(completedLayer)) {
      const nextLevel = gameState.upgradeRole()
      OverlayManager.showBossReward(gameState.role, nextLevel, () => {
        this.advanceAfterReward(gameState, completedLayer)
      })
      return
    }

    this.advanceAfterReward(gameState, completedLayer)
  },

  advanceAfterReward(gameState, completedLayer) {
    gameState.currentLayer = Math.min(completedLayer + 1, WIN_LOSS_CONFIG.victory.targetLayer)
    gameState.gasPoolMax = gameState.gasPoolMaxForStage(gameState.currentLayer)
    gameState.gasPool = gameState.gasPoolMax
    this.showSceneSelection(gameState)
  },

  showSceneSelection(gameState) {
    const layerConfig = getLayerConfig(gameState.currentLayer)
    const availableScenes = layerConfig.scenes ?? [layerConfig.scene]
    if (availableScenes.length <= 1) {
      gameState.currentScene = availableScenes[0]
      this.beginLayer(gameState)
      return
    }

    OverlayManager.showSceneSelect(availableScenes, (sceneId) => {
      gameState.currentScene = sceneId
      this.beginLayer(gameState)
    })
  },

  beginLayer(gameState) {
    gameState.saveProgress()
    if (roundStarter) roundStarter(gameState)
  },

  getCurrentLayerConfig(gameState) {
    return {
      layer: gameState.currentLayer,
      scene: gameState.currentScene,
      bot: EnemyBotAI.getActiveBot(gameState.currentLayer),
      isBoss: isBossLayer(gameState.currentLayer),
    }
  },
}

function buildFinalStats(gameState) {
  return {
    currentLayer: gameState.currentLayer,
    cumulativeProfit: gameState.cumulativeProfit,
    consecutiveLoss: gameState.consecutiveLoss,
  }
}

function getLayerConfig(layer) {
  return LAYER_CONFIG[layer] ?? LAYER_CONFIG[20]
}

function isBossLayer(layer) {
  return getLayerConfig(layer).isBoss
}

function restartGame(gameState) {
  gameState.role = null
  gameState.roleLevel = 1
  gameState.currentLayer = 1
  gameState.currentScene = 'dex_arb'
  gameState.gasPoolMax = gameState.gasPoolMaxForStage(1)
  gameState.gasPool = gameState.gasPoolMax
  gameState.cumulativeProfit = 0
  gameState.consecutiveLoss = 0
  gameState.genesisHistory = { lastTwoRounds: [], boostedType: null }
  gameState.saveProgress()
  OverlayManager.hideAll()
  ProgressionEngine.startRun(gameState)
}
