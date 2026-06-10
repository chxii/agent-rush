export const SEMI_LOOP_CONFIG = {
  maxReplansPerRound: 4,
  toolDelayMs: 650,
  simulatedToolElapsedSec: 1,
}

export const CARD_TOOL_SEQUENCES = {
  arbitrage: ['fetch_prices', 'monitor_mempool', 'broadcast_tx'],
  sandwich: ['monitor_mempool', 'broadcast_tx'],
  nft_snipe: ['fetch_prices', 'monitor_mempool', 'broadcast_tx'],
  front_run: ['monitor_mempool', 'broadcast_tx'],
  liquidation: ['fetch_prices', 'monitor_mempool', 'broadcast_tx'],
  default: ['monitor_mempool', 'broadcast_tx'],
}
