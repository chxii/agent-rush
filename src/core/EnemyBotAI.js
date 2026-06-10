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

  forceNextSteal() {
    forceStealNextCompetition = true
  },

  consumeForcedSteal() {
    if (!forceStealNextCompetition) return false
    forceStealNextCompetition = false
    return true
  },
}
