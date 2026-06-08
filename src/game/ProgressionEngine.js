export const ProgressionEngine = {
  getCurrentLayerConfig(gameState) {
    return {
      layer: gameState.currentLayer,
      scene: gameState.currentScene,
      slots: gameState.activeAgents.length,
    }
  },
}
