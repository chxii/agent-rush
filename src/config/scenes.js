export const SCENES = {
  dex_arb: {
    name: 'DEX 套利池',
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
