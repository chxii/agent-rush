export const TOOL_SIMULATOR_CONFIG = {
  gas: {
    gasToEth: 0.001,
    minBroadcastGas: 1,
    failedGasLossRate: 0.4,
    failedGasLossRateByReason: {
      stolen: 0.35,
      windowExpired: 0.12,
      txFailed: 0.4,
      invalidOpportunity: 0.08,
    },
    abandonGasLossRate: 0.15,
  },
  prices: {
    invalidationBase: 0.03,
    invalidationRiskWeight: 0.18,
    profitVariance: 0.12,
    slippageRange: [0.01, 0.08],
  },
  mempool: {
    detectionBase: 0.145,
    competitionWeight: 0.12,
    botStrengthWeight: 0.45,
    gasDefenseWeight: 0.003,
    competitorBidMinLift: 8,
    competitorBidMultiplier: 1.12,
  },
  broadcast: {
    baseSuccessProbability: 0.58,
    gasWeight: 0.18,
    riskPenalty: 0.85,
    botPressurePenalty: 0.24,
    minSuccessProbability: 0.05,
    maxSuccessProbability: 0.9,
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
  botMechanicOverrides: {
    Genesis: {
      maxSuppressProbability: 0.6,
      competitorBidMultiplier: 1.3,
    },
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

export const DEFAULT_CARD_TYPE_MECHANICS = {
  gasSuccessWeight: 1,
  stealProbabilityMultiplier: 1,
  profitVariance: null,
  hardTimeWindow: false,
  frontRunBidCheck: false,
  frontRunOverbidBonus: 0,
  frontRunUnderbidPenalty: 0,
  replaceRequiredBidMultiplier: null,
  failedGasLossMultiplier: 1,
}

export const CARD_TYPE_MECHANICS = {
  arbitrage: {
    gasSuccessWeight: 0.75,
    stealProbabilityMultiplier: 1.1,
    failedGasLossMultiplier: 0.5,
    profitVariance: 0.1,
  },
  sandwich: {
    gasSuccessWeight: 1.75,
    stealProbabilityMultiplier: 1.25,
    profitVariance: 0.3,
  },
  nft_snipe: {
    gasSuccessWeight: 0.9,
    stealProbabilityMultiplier: 1.65,
    profitVariance: 0.45,
  },
  front_run: {
    gasSuccessWeight: 1.15,
    stealProbabilityMultiplier: 1.2,
    profitVariance: 0.18,
    frontRunBidCheck: true,
    frontRunOverbidBonus: 0.28,
    frontRunUnderbidPenalty: 0.34,
    replaceRequiredBidMultiplier: 1.1,
  },
  liquidation: {
    gasSuccessWeight: 0.85,
    stealProbabilityMultiplier: 0.9,
    profitVariance: 0.05,
    hardTimeWindow: true,
  },
}
