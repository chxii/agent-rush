import { WIN_LOSS_CONFIG } from '../config/winloss.js'

export function calculateWinLossProgress(state = {}, config = WIN_LOSS_CONFIG) {
  const cumulativeProfit = roundEth(Number(state.cumulativeProfit) || 0)
  const consecutiveLoss = Math.max(0, Math.round(Number(state.consecutiveLoss) || 0))
  const currentLayer = Math.max(1, Math.round(Number(state.currentLayer) || 1))
  const targetLayer = Math.max(1, Math.round(Number(config.victory.targetLayer) || 1))
  const victoryProfitLine = Number(config.victory.cumulativeProfitGreaterThan) || 0
  const failureLossThreshold = Math.max(0, Math.round(Number(config.failure.consecutiveLossThreshold) || 0))
  const failureProfitLine = Number(config.failure.cumulativeProfitBelow) || 0

  return {
    cumulativeProfit,
    currentLayer,
    victory: {
      targetLayer,
      profitLine: victoryProfitLine,
      profitRemaining: Math.max(0, roundEth(victoryProfitLine - cumulativeProfit)),
      layersRemaining: Math.max(0, targetLayer - currentLayer),
    },
    failure: {
      consecutiveLoss,
      consecutiveLossThreshold: failureLossThreshold,
      lossesRemaining: Math.max(0, failureLossThreshold - consecutiveLoss),
      profitLine: failureProfitLine,
      profitBuffer: Math.max(0, roundEth(cumulativeProfit - failureProfitLine)),
    },
  }
}

function roundEth(value) {
  return Math.round(value * 1000) / 1000
}
