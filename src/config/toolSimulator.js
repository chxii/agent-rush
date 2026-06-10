export const TOOL_SIMULATOR_CONFIG = {
  gas: {
    gasToEth: 0.001,
    minBroadcastGas: 1,
    failedGasLossRate: 1,
    abandonGasLossRate: 0.15,
  },
  prices: {
    invalidationBase: 0.03,
    invalidationRiskWeight: 0.18,
    profitVariance: 0.12,
    slippageRange: [0.01, 0.08],
  },
  mempool: {
    detectionBase: 0.2,
    competitionWeight: 0.12,
    botStrengthWeight: 0.45,
    gasDefenseWeight: 0.003,
    competitorBidMinLift: 8,
    competitorBidMultiplier: 1.12,
  },
  broadcast: {
    baseSuccessProbability: 0.68,
    gasWeight: 0.22,
    riskPenalty: 0.55,
    botPressurePenalty: 0.18,
    minSuccessProbability: 0.05,
    maxSuccessProbability: 0.95,
    profitVariance: 0.15,
  },
  replace: {
    requiredBidMultiplier: 1.05,
    baseSuppressProbability: 0.35,
    bidAdvantageWeight: 1.5,
    maxSuppressProbability: 0.9,
  },
  replacement: {
    minExpectedValue: 0,
  },
}

export const BOT_STRENGTH_BY_NAME = {
  'Bot-404': 0.15,
  Shadow: 0.3,
  Phantom: 0.55,
  'Phantom+': 0.75,
  Genesis: 0.95,
}

export const CARD_TYPE_TOOL_SENSITIVITY = {
  arbitrage: { price: 1.25, mempool: 0.85, broadcast: 1 },
  sandwich: { price: 1, mempool: 1.25, broadcast: 0.95 },
  nft_snipe: { price: 1.15, mempool: 1.1, broadcast: 0.9 },
  front_run: { price: 0.9, mempool: 1.35, broadcast: 0.9 },
  liquidation: { price: 0.85, mempool: 1, broadcast: 1.05 },
}
