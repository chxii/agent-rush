const CALL_DELAY_MIN_MS = 300
const CALL_DELAY_MAX_MS = 800
const STREAM_DELAY_MIN_MS = 20
const STREAM_DELAY_MAX_MS = 30

export const ExecutorMock = {
  async call(callType, input = {}) {
    await delay(randomInt(CALL_DELAY_MIN_MS, CALL_DELAY_MAX_MS))
    return getFallbackPlan(callType, input)
  },

  async callStreaming(callType, input = {}, onChunk = () => {}, streamField = 'reasoning') {
    const response = await this.call(callType, input)
    await streamText(response[streamField] ?? response.reasoning ?? '', onChunk)
    return response
  },
}

export function getFallbackPlan(callType, input = {}) {
  if (callType === 'InitialPlanning') return buildInitialPlanning(input)
  if (callType === 'SingleCardPlan') return buildSingleCardPlan(input)
  if (callType === 'IncidentResponse') return buildIncidentResponse(input)
  if (callType === 'SettlementReport') return buildSettlementReport(input)
  if (callType === 'PlayerIntervention') return buildPlayerIntervention(input)

  return { reasoning: 'Unknown executor request; using safe fallback.' }
}

function buildInitialPlanning(input) {
  const cards = [...(input.cards ?? [])]
  const executionOrder = cards.sort((a, b) => expectedValue(b) - expectedValue(a)).map((card) => card.id)

  return {
    reasoning: 'Direct ExecutorAI mock only: order selected cards by EV. Runtime no-key execution uses RuleDecider.',
    executionOrder,
  }
}

function buildSingleCardPlan(input) {
  const card = input.card ?? {}

  return {
    reasoning: `Choose one next action for ${card.type ?? 'target'} from the current observed state.`,
    action: 'broadcast_tx',
    params: { cardId: card.id, gas: input.allocatedGas ?? card.gasBudget ?? 0 },
  }
}

function buildIncidentResponse(input) {
  const cardId = input.affectedCardId ?? input.trigger?.cardId ?? 'unknown'
  const remainingGasPool = Math.max(0, Math.round(Number(input.remainingGasPool) || 0))
  const playerContingency = input.playerContingency ?? 'fight'

  if (playerContingency === 'abandon' || remainingGasPool <= 0) {
    return {
      reasoning: 'Follow the player contingency and preserve the remaining plan.',
      action: 'abandon_card',
      targetCardId: cardId,
    }
  }

  if (input.event === 'gas_insufficient') {
    return {
      reasoning: 'Gas is short; reallocate to pending cards that still fit the remaining pool.',
      action: 'reallocate_gas',
      targetCardId: cardId,
      gasAllocations: (input.allCardStatuses ?? [])
        .filter((card) => card.status === 'pending' && card.allocatedGas <= remainingGasPool)
        .map((card) => ({ cardId: card.id, gas: card.allocatedGas })),
    }
  }

  return {
    reasoning: 'Return one narrow recovery action for this incident.',
    action: playerContingency === 'transfer' ? 'continue' : 'replace_tx',
    targetCardId: cardId,
    gas: Math.max(1, Math.floor(remainingGasPool * 0.35)),
  }
}

function buildSettlementReport(input) {
  const completedCards = input.completedCards ?? []
  const netProfit = roundEth(completedCards.reduce((sum, card) => sum + (Number(card.actualProfit) || 0), 0))

  return {
    reasoning: 'Summarize semi-loop execution after all cards settle.',
    summary: `Round complete. Net ${formatSignedEth(netProfit)} across ${completedCards.length} cards.`,
    netProfit,
    decisionHighlights: [
      {
        momentLabel: 'workflow_closure',
        description: 'Executor followed the semi-loop plan and only replanned after simulator incidents.',
      },
    ],
  }
}

function buildPlayerIntervention(input) {
  const state = input.currentExecutionState ?? { allCardStatuses: [] }

  return {
    reasoning: 'Direct ExecutorAI mock only: echo current allocations and order for a safe intervention fallback.',
    interpretedIntent: input.playerInstruction ?? 'continue',
    updatedGasAllocations: state.allCardStatuses.map((card) => ({
      cardId: card.id,
      gas: card.allocatedGas,
    })),
    updatedExecutionOrder: state.allCardStatuses.map((card) => card.id),
  }
}

function expectedValue(card) {
  const gas = card.gasBudget ?? card.allocatedGas ?? card.gasCost ?? 0
  return (card.expectedProfit ?? 0) * (1 - (card.trueRisk ?? card.displayedRisk ?? 0)) - gas * 0.001
}

async function streamText(text, onChunk) {
  for (const char of text) {
    onChunk(char)
    await delay(randomInt(STREAM_DELAY_MIN_MS, STREAM_DELAY_MAX_MS))
  }
}

function randomInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1))
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function formatSignedEth(value) {
  return `${value >= 0 ? '+' : ''}${Number(value).toFixed(3)} ETH`
}

function roundEth(value) {
  return Math.round(value * 1000) / 1000
}
