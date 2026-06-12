export const ROLE_IDS = {
  SCOUT: 'scout',
  RESIST: 'resist',
  EFFICIENCY: 'efficiency',
}

export const ROLE_CONFIG = {
  maxRoleLevel: 3,
  base: {
    scanCardCount: 3,
    maxScanCardCount: 6,
    gasPoolByStage: [
      { maxLayer: 3, gasPool: 150 },
      { maxLayer: 7, gasPool: 200 },
      { maxLayer: 12, gasPool: 250 },
      { maxLayer: 17, gasPool: 300 },
      { maxLayer: 20, gasPool: 350 },
    ],
    scoutExtraCardGasPenalty: 25,
    gasPoolMultiplier: 1,
    stealProbabilityMultiplier: 1,
    replaceRequiredBidMultiplier: 1,
    replaceSuppressProbabilityBonus: 0,
  },
  roles: {
    [ROLE_IDS.SCOUT]: {
      id: ROLE_IDS.SCOUT,
      name: '侦察型',
      tagline: '信息优势',
      description: '每回合扫描更多机会牌，适合先看清局面再做选择。',
      buffSummary: '随档位每轮额外发 1/2/3 张机会牌。',
      levels: {
        1: { scanCardBonus: 1 },
        2: { scanCardBonus: 2 },
        3: { scanCardBonus: 3 },
      },
    },
    [ROLE_IDS.RESIST]: {
      id: ROLE_IDS.RESIST,
      name: '抗压型',
      tagline: '对抗韧性',
      description: '降低被抢概率，并让反抢时的 replace_tx 成本更低。',
      buffSummary: '降低被抢概率，反抢更便宜。',
      levels: {
        1: { stealProbabilityMultiplier: 0.7, replaceRequiredBidMultiplier: 0.84, replaceSuppressProbabilityBonus: 0.08 },
        2: { stealProbabilityMultiplier: 0.55, replaceRequiredBidMultiplier: 0.76, replaceSuppressProbabilityBonus: 0.13 },
        3: { stealProbabilityMultiplier: 0.45, replaceRequiredBidMultiplier: 0.68, replaceSuppressProbabilityBonus: 0.18 },
      },
    },
    [ROLE_IDS.EFFICIENCY]: {
      id: ROLE_IDS.EFFICIENCY,
      name: '效率型',
      tagline: '资源优势',
      description: '提高每层 Gas Pool 上限，适合同时推进更多机会。',
      buffSummary: '随档位提高 20%/35%/50% Gas Pool 上限。',
      levels: {
        1: { gasPoolMultiplier: 1.2 },
        2: { gasPoolMultiplier: 1.35 },
        3: { gasPoolMultiplier: 1.5 },
      },
    },
  },
}
