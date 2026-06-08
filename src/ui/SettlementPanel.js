export const SettlementPanel = {
  formatLine(result) {
    return `${result.cardId}: ${result.success ? `+${result.actualProfit.toFixed(2)} ETH` : '失败'}`
  },
}
