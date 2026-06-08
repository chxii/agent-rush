export const RARITY = {
  common: { weight: 55, profitRange: [0.05, 0.5], gasRange: [15, 40], riskRange: [0.05, 0.45] },
  rare: { weight: 30, profitRange: [0.3, 1.5], gasRange: [35, 70], riskRange: [0.2, 0.6] },
  epic: { weight: 12, profitRange: [1.0, 3.0], gasRange: [60, 120], riskRange: [0.4, 0.8] },
  legendary: { weight: 3, profitRange: [3.0, 8.0], gasRange: [80, 150], riskRange: [0.55, 0.9] },
}

export const CARD_TYPES = ['arbitrage', 'sandwich', 'nft_snipe', 'front_run', 'liquidation']

export const COMPETITION_BY_RARITY = {
  common: [0, 1],
  rare: [1, 2],
  epic: [2, 3],
  legendary: [3, 3],
}
