import { EnemyBotAI } from '../core/EnemyBotAI.js'
import { ThoughtChainPanel } from '../ui/ThoughtChainPanel.js'

const STEP_DELAY_MS = 800

export const ExecutionEngine = {
  async runRigidMode(cards, gasAllocations, gameState) {
    const executionStartMs = performance.now()
    const allocationMap = new Map(gasAllocations.map((item) => [item.cardId, item.gas]))
    const executedCards = []

    for (const card of cards) {
      const allocatedGas = allocationMap.get(card.id) ?? card.gasCost
      const elapsedSec = (performance.now() - executionStartMs) / 1000
      const workingCard = { ...card, allocatedGas, status: 'in_progress' }

      ThoughtChainPanel.appendLog({
        timestampMs: Date.now(),
        source: 'executor',
        text: `[执行] 开始执行 ${card.id} (${card.type})，Gas ${allocatedGas} Gwei`,
        isStreaming: false,
      })

      if (elapsedSec > card.timeWindowSec) {
        workingCard.status = 'expired'
        workingCard.actualProfit = 0
        appendResultLog(workingCard, '时间窗口过期')
        executedCards.push(workingCard)
        await delay(STEP_DELAY_MS)
        continue
      }

      ThoughtChainPanel.appendLog({
        timestampMs: Date.now(),
        source: 'tool',
        text: `broadcast_tx(${card.type}, gas=${allocatedGas})`,
        isStreaming: false,
      })

      const competition = EnemyBotAI.compete(card, gameState)
      if (competition.stolen) {
        workingCard.status = 'failed'
        workingCard.actualProfit = -gasLossToEth(card.gasCost)
        appendResultLog(workingCard, `被 ${competition.botName} 抢占`)
        executedCards.push(workingCard)
        await delay(STEP_DELAY_MS)
        continue
      }

      const success = Math.random() < 1 - card.trueRisk
      if (success) {
        workingCard.status = 'success'
        workingCard.actualProfit = roundEth(card.expectedProfit * uniformRandom(0.85, 1.15))
        appendResultLog(workingCard, '确认成功')
      } else {
        workingCard.status = 'failed'
        workingCard.actualProfit = -gasLossToEth(card.gasCost)
        appendResultLog(workingCard, '链上执行失败')
      }

      executedCards.push(workingCard)
      await delay(STEP_DELAY_MS)
    }

    return {
      cards: executedCards,
      netProfit: roundEth(executedCards.reduce((sum, card) => sum + card.actualProfit, 0)),
      gasUsed: executedCards.reduce((sum, card) => sum + card.gasCost, 0),
    }
  },
}

export function uniformRandom(min, max) {
  return min + Math.random() * (max - min)
}

function appendResultLog(card, reason) {
  ThoughtChainPanel.appendLog({
    timestampMs: Date.now(),
    source: 'system',
    text: `[结果] ${card.id}: ${card.status} (${formatSignedEth(card.actualProfit)}) - ${reason}`,
    isStreaming: false,
  })
}

function gasLossToEth(gasCost) {
  return roundEth(gasCost / 1000)
}

function roundEth(value) {
  return Math.round(value * 1000) / 1000
}

function formatSignedEth(value) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(3)} ETH`
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
