export const CONTINGENCY_ACTIONS = ['fight', 'abandon', 'transfer']
export const DEFAULT_CONTINGENCY = 'fight'

export const DECISION_LIMITS = {
  minGasPerSelectedCard: 0,
  maxSelectedCardsByLayer: [
    { maxLayer: 2, maxCards: 1 },
    { maxLayer: 7, maxCards: 2 },
    { maxLayer: 20, maxCards: 3 },
  ],
}

export function maxSelectedCardsForLayer(layer, limits = DECISION_LIMITS) {
  const normalizedLayer = Math.max(1, Math.round(Number(layer) || 1))
  const stage = limits.maxSelectedCardsByLayer.find((item) => normalizedLayer <= item.maxLayer)
  return stage?.maxCards ?? limits.maxSelectedCardsByLayer.at(-1)?.maxCards ?? 1
}
