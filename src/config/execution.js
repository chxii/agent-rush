export const SEMI_LOOP_CONFIG = {
  maxReplansPerRound: 4,
  toolDelayMs: 1400,
  simulatedToolElapsedSec: 1,
}

export const INTERVENTION_SHORTCUTS = {
  FIGHT_ALL: {
    id: 'fight_all',
    label: 'All fight',
    instruction: 'shortcut:fight_all',
  },
  ABANDON_HIGHEST_RISK: {
    id: 'abandon_highest_risk',
    label: 'Drop riskiest',
    instruction: 'shortcut:abandon_highest_risk',
  },
  FOCUS_BEST_GAS: {
    id: 'focus_best_gas',
    label: 'Focus best',
    instruction: 'shortcut:focus_best_gas',
  },
}

export const CARD_TOOL_SEQUENCES = {
  arbitrage: ['fetch_prices', 'monitor_mempool', 'broadcast_tx'],
  sandwich: ['monitor_mempool', 'broadcast_tx'],
  nft_snipe: ['fetch_prices', 'monitor_mempool', 'broadcast_tx'],
  front_run: ['monitor_mempool', 'broadcast_tx'],
  liquidation: ['fetch_prices', 'monitor_mempool', 'broadcast_tx'],
  default: ['monitor_mempool', 'broadcast_tx'],
}
