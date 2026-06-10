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
      { maxLayer: 4, gasPool: 150 },
      { maxLayer: 7, gasPool: 200 },
      { maxLayer: 12, gasPool: 250 },
      { maxLayer: 17, gasPool: 300 },
      { maxLayer: 20, gasPool: 350 },
    ],
    gasPoolMultiplier: 1,
    stealProbabilityMultiplier: 1,
    replaceRequiredBidMultiplier: 1,
    replaceSuppressProbabilityBonus: 0,
  },
  roles: {
    [ROLE_IDS.SCOUT]: {
      id: ROLE_IDS.SCOUT,
      name: 'Scout',
      tagline: 'Information edge',
      description: 'Scans more opportunity cards each round.',
      buffSummary: '+1/+2/+3 scan cards by role level.',
      levels: {
        1: { scanCardBonus: 1 },
        2: { scanCardBonus: 2 },
        3: { scanCardBonus: 3 },
      },
    },
    [ROLE_IDS.RESIST]: {
      id: ROLE_IDS.RESIST,
      name: 'Resist',
      tagline: 'Mempool pressure control',
      description: 'Reduces steal probability and makes replacement bids cheaper.',
      buffSummary: 'Lower steal chance, cheaper replace_tx.',
      levels: {
        1: { stealProbabilityMultiplier: 0.85, replaceRequiredBidMultiplier: 0.92, replaceSuppressProbabilityBonus: 0.04 },
        2: { stealProbabilityMultiplier: 0.75, replaceRequiredBidMultiplier: 0.86, replaceSuppressProbabilityBonus: 0.08 },
        3: { stealProbabilityMultiplier: 0.65, replaceRequiredBidMultiplier: 0.8, replaceSuppressProbabilityBonus: 0.12 },
      },
    },
    [ROLE_IDS.EFFICIENCY]: {
      id: ROLE_IDS.EFFICIENCY,
      name: 'Efficiency',
      tagline: 'Gas reserve edge',
      description: 'Raises the Gas Pool cap for each layer.',
      buffSummary: '+15%/+25%/+35% Gas Pool cap by role level.',
      levels: {
        1: { gasPoolMultiplier: 1.15 },
        2: { gasPoolMultiplier: 1.25 },
        3: { gasPoolMultiplier: 1.35 },
      },
    },
  },
}
