export const SCENES = {
  dex_arb: {
    name: 'DEX 套利',
    rarityWeights: { common: 65, rare: 25, epic: 8, legendary: 2 },
    scamRate: 0.05,
    botPreference: null,
  },
  new_token: {
    name: '新币发射台',
    rarityWeights: { common: 50, rare: 35, epic: 10, legendary: 5 },
    scamRate: 0.3,
    botPreference: 'Shadow',
  },
  nft_market: {
    name: 'NFT 市场',
    rarityWeights: { common: 50, rare: 35, epic: 13, legendary: 2 },
    scamRate: 0.15,
    botPreference: 'Phantom',
  },
  lending: {
    name: '借贷清算',
    rarityWeights: { common: 55, rare: 25, epic: 15, legendary: 5 },
    scamRate: 0.08,
    botPreference: null,
  },
}

export const LAYER_CONFIG = {
  1: { scene: 'dex_arb', bot: null, slots: 1, isTutorial: true, isBoss: false, fixedCards: 1 },
  2: { scene: 'dex_arb', bot: null, slots: 1, isTutorial: true, isBoss: false, fixedCards: 2 },
  3: { scene: 'dex_arb', bot: 'Bot-404', slots: 1, isTutorial: true, isBoss: false },
  4: { scene: 'dex_arb', bot: 'Bot-404', slots: 2, isTutorial: false, isBoss: true, unlocks: 'riskAnalyzer' },
  5: { scenes: ['dex_arb', 'new_token'], bot: 'Shadow', slots: 2, isBoss: false },
  6: { scenes: ['dex_arb', 'new_token'], bot: 'Shadow', slots: 2, isBoss: false },
  7: { scenes: ['dex_arb', 'new_token'], bot: 'Shadow', slots: 2, isBoss: false },
  8: { scene: 'nft_market', bot: 'Phantom', slots: 3, isBoss: true, unlocks: 'executor' },
  9: { scenes: ['nft_market', 'lending'], bot: 'Phantom', slots: 3, isBoss: false },
  10: { scenes: ['nft_market', 'lending'], bot: 'Phantom', slots: 3, isBoss: false },
  11: { scenes: ['nft_market', 'lending'], bot: 'Phantom', slots: 3, isBoss: false },
  12: { scenes: ['nft_market', 'lending'], bot: 'Phantom', slots: 3, isBoss: false },
  13: { scene: 'lending', bot: 'Phantom+', slots: 3, isBoss: true, unlocks: 'strategist' },
  14: { scenes: ['nft_market', 'lending', 'new_token'], bot: 'Phantom+', slots: 3, isBoss: false },
  15: { scenes: ['nft_market', 'lending', 'new_token'], bot: 'Phantom+', slots: 3, isBoss: false },
  16: { scenes: ['nft_market', 'lending', 'new_token'], bot: 'Phantom+', slots: 3, isBoss: true },
  17: { scenes: ['nft_market', 'lending', 'new_token'], bot: 'Phantom+', slots: 3, isBoss: false },
  18: { scenes: ['dex_arb', 'nft_market', 'lending', 'new_token'], bot: 'Genesis', slots: 3, isBoss: false },
  19: { scenes: ['dex_arb', 'nft_market', 'lending', 'new_token'], bot: 'Genesis', slots: 3, isBoss: false },
  20: { scenes: ['dex_arb', 'nft_market', 'lending', 'new_token'], bot: 'Genesis', slots: 3, isBoss: true },
}
