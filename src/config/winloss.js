export const WIN_LOSS_CONFIG = {
  victory: {
    targetLayer: 20,
    cumulativeProfitGreaterThan: 10,
  },
  failure: {
    consecutiveLossThreshold: 2,
    cumulativeProfitBelow: -0.5,
  },
}
