export const ExecutionEngine = {
  executeSelectedCards(cards) {
    return cards.map((card) => ({
      ...card,
      status: 'success',
      // scam 牌即使判定成功也几乎不兑现利润（虚高的 expectedProfit 是诱饵）
      actualProfit: card.isScam ? 0 : Math.round(card.expectedProfit * 0.9 * 100) / 100,
    }))
  },
}
