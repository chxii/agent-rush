import { EnemyBotAI } from '../core/EnemyBotAI.js'
import { getFallbackPlan } from '../ai/ExecutorMock.js'
import { SchemaValidator } from '../ai/SchemaValidator.js'
import { ThoughtChainPanel } from '../ui/ThoughtChainPanel.js'

const RIGID_STEP_DELAY_MS = 800
const ADAPTIVE_STEP_DELAY_MS = 400

export const ExecutionEngine = {
  async runRigidMode(cards, gasAllocations, gameState) {
    const executionStartMs = performance.now()
    const allocationMap = new Map(gasAllocations.map((item) => [item.cardId, item.gas]))
    const executedCards = []

    for (const card of cards) {
      const allocatedGas = allocationMap.get(card.id) ?? card.gasCost
      const elapsedSec = (performance.now() - executionStartMs) / 1000
      const workingCard = { ...card, allocatedGas, status: 'in_progress' }

      appendLog('executor', `[执行] 开始执行 ${card.id} (${card.type})，Gas ${allocatedGas} Gwei`)

      if (elapsedSec > card.timeWindowSec) {
        workingCard.status = 'failed'
        workingCard.actualProfit = 0
        appendResultLog(workingCard, '时间窗口过期')
        executedCards.push(workingCard)
        await delay(RIGID_STEP_DELAY_MS)
        continue
      }

      appendLog('tool', `broadcast_tx(${card.type}, gas=${allocatedGas})`)

      const competition = EnemyBotAI.compete(card, gameState)
      if (competition.stolen) {
        workingCard.status = 'failed'
        workingCard.actualProfit = -gasLossToEth(card.gasCost)
        appendResultLog(workingCard, `被 ${competition.botName} 抢占`)
        executedCards.push(workingCard)
        await delay(RIGID_STEP_DELAY_MS)
        continue
      }

      resolveCardSuccess(workingCard)
      appendResultLog(workingCard, workingCard.status === 'success' ? '确认成功' : '链上执行失败')

      executedCards.push(workingCard)
      await delay(RIGID_STEP_DELAY_MS)
    }

    return buildRoundResult(executedCards)
  },

  async runAdaptiveMode(cards, gameState, executorAI) {
    const executionLog = []
    const completedCards = []
    const initialGasPool = gameState.gasPool

    if (cards.length === 0) {
      return buildRoundResult([])
    }

    const initialPlan = await callExecutor(executorAI, 'InitialPlanning', {
      cards: cards.map((card) => toCardParam(card)),
      totalGasPool: initialGasPool,
      scene: toSceneInfo(gameState),
      remainingTimeWindowSec: Math.max(...cards.map((card) => card.timeWindowSec)),
    })

    const allocationMap = new Map(initialPlan.gasAllocations.map((item) => [item.cardId, item.gas]))
    const orderedCards = initialPlan.executionOrder
      .map((cardId) => cards.find((card) => card.id === cardId))
      .filter(Boolean)
    const cardsNotPlanned = cards.filter((card) => !orderedCards.some((planned) => planned.id === card.id))
    let remainingGasPool = initialGasPool

    for (const card of [...orderedCards, ...cardsNotPlanned]) {
      const allocatedGas = allocationMap.get(card.id) ?? card.gasCost
      const workingCard = { ...card, allocatedGas, status: 'in_progress' }
      let abandoned = false
      let repaired = false

      const singleCardPlan = await callExecutor(executorAI, 'SingleCardPlan', {
        card: toCardParam(card, allocatedGas),
        allocatedGas,
        remainingGasPool,
        completedCards: completedCards.map(toCompletedCard),
      })

      const competition = EnemyBotAI.compete(card, gameState)
      if (competition.stolen) {
        appendLog('system', `[竞争] ${competition.botName} 抢占 ${card.id}`)
        const incidentResponse = await callExecutor(executorAI, 'IncidentResponse', {
          event: 'target_stolen',
          affectedCardId: card.id,
          remainingGasPool,
          allCardStatuses: buildCardStatuses(cards, completedCards, card.id, allocatedGas),
          competitors: [
            {
              name: competition.botName,
              gasBid: Math.max(allocatedGas + 10, Math.ceil(allocatedGas * 1.15)),
              targetCardId: card.id,
            },
          ],
          card,
        })

        if (incidentResponse.selectedPlanId === 'abandon') {
          workingCard.status = 'abandoned'
          workingCard.actualProfit = -gasLossToEth(card.gasCost)
          abandoned = true
        } else {
          repaired = true
          appendLog('tool', `replace_tx(${card.id}, plan=${incidentResponse.selectedPlanId})`)
        }
      }

      for (const step of singleCardPlan.steps) {
        if (abandoned) break

        appendLog('tool', `${step.action}(${JSON.stringify(step.params ?? {})}) ...`)
        executionLog.push({
          timestampMs: Date.now(),
          action: step.action,
          input: step.params ?? {},
          output: {},
          success: true,
        })

        await delay(ADAPTIVE_STEP_DELAY_MS)
      }

      if (!abandoned) {
        resolveCardSuccess(workingCard)
      }

      remainingGasPool = Math.max(0, remainingGasPool - allocatedGas)
      completedCards.push(workingCard)
      appendResultLog(
        workingCard,
        repaired ? '迭代修复后完成' : workingCard.status === 'success' ? '确认成功' : '链上执行失败',
      )
    }

    const baseResult = buildRoundResult(completedCards)
    const settlementReport = await callExecutor(executorAI, 'SettlementReport', {
      completedCards: completedCards.map(toCompletedCard),
      executionLog,
      totalGasUsed: baseResult.gasUsed,
      initialGasPool,
    }, {
      streamField: 'summary',
    })

    return {
      ...baseResult,
      aiSummary: settlementReport.summary,
      decisionHighlights: settlementReport.decisionHighlights,
    }
  },
}

export function uniformRandom(min, max) {
  return min + Math.random() * (max - min)
}

async function callExecutor(executorAI, callType, input, options = {}) {
  const writer = ThoughtChainPanel.appendStreaming(`[${callType}] `)
  let response

  try {
    response = await executorAI.callStreaming(callType, input, (chunk) => writer.write(chunk), options.streamField)
  } catch (error) {
    writer.write('AI调用失败，使用保底策略。')
    appendLog('system', `[fallback] ${callType} 调用异常：${error.message}`)
    response = getFallbackPlan(callType, input)
  } finally {
    writer.end()
  }

  const validation = SchemaValidator.validate(callType, response)
  if (validation.valid) return response

  appendLog('system', `[fallback] ${callType} schema校验失败，使用保底策略。`)
  console.warn(`[SchemaValidator] ${callType} output invalid`, validation.errors)
  return getFallbackPlan(callType, input)
}

function resolveCardSuccess(card) {
  const success = Math.random() < 1 - card.trueRisk
  if (success) {
    card.status = 'success'
    card.actualProfit = roundEth(card.expectedProfit * uniformRandom(0.85, 1.15))
  } else {
    card.status = 'failed'
    card.actualProfit = -gasLossToEth(card.gasCost)
  }
}

function buildRoundResult(executedCards) {
  return {
    cards: executedCards,
    netProfit: roundEth(executedCards.reduce((sum, card) => sum + (card.actualProfit ?? 0), 0)),
    gasUsed: executedCards.reduce((sum, card) => sum + card.gasCost, 0),
  }
}

function appendResultLog(card, reason) {
  appendLog('system', `[结果] ${card.id}: ${card.status} (${formatSignedEth(card.actualProfit)}) - ${reason}`)
}

function appendLog(source, text) {
  ThoughtChainPanel.appendLog({
    timestampMs: Date.now(),
    source,
    text,
    isStreaming: false,
  })
}

function toCardParam(card, gasBudget = card.gasCost) {
  return {
    id: card.id,
    type: card.type,
    expectedProfit: card.expectedProfit,
    gasBudget,
    riskRating: card.displayedRisk,
    timeWindowSec: card.timeWindowSec,
  }
}

function toCompletedCard(card) {
  return {
    id: card.id,
    status: card.status,
    actualProfit: card.actualProfit,
    gasUsed: card.gasCost,
  }
}

function toSceneInfo(gameState) {
  return {
    sceneType: gameState.currentScene,
    layer: gameState.currentLayer,
    enemyBotActivity: botActivityForLayer(gameState.currentLayer),
  }
}

function botActivityForLayer(layer) {
  if (layer <= 2) return 'none'
  if (layer <= 7) return 'low'
  if (layer <= 12) return 'medium'
  return 'high'
}

function buildCardStatuses(cards, completedCards, activeCardId, allocatedGas) {
  const completedMap = new Map(completedCards.map((card) => [card.id, card]))

  return cards.map((card) => {
    const completed = completedMap.get(card.id)
    return {
      id: card.id,
      status: completed?.status ?? (card.id === activeCardId ? 'in_progress' : 'pending'),
      allocatedGas: card.id === activeCardId ? allocatedGas : card.gasCost,
    }
  })
}

function gasLossToEth(gasCost) {
  return roundEth(gasCost / 1000)
}

function roundEth(value) {
  return Math.round(value * 1000) / 1000
}

function formatSignedEth(value) {
  return `${value >= 0 ? '+' : ''}${Number(value ?? 0).toFixed(3)} ETH`
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
