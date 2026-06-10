export const SEMI_LOOP_CONFIG = {
  maxReplansPerRound: 4,
  toolDelayMs: 3500,
  simulatedToolElapsedSec: 1,
}

export const INTERVENTION_SHORTCUTS = {
  FIGHT_ALL: {
    id: 'fight_all',
    label: '全部硬刚',
    instruction: 'shortcut:fight_all',
  },
  ABANDON_HIGHEST_RISK: {
    id: 'abandon_highest_risk',
    label: '放弃最高风险',
    instruction: 'shortcut:abandon_highest_risk',
  },
  FOCUS_BEST_GAS: {
    id: 'focus_best_gas',
    label: 'Gas 集中最优',
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
