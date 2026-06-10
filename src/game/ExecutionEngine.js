import { EnemyBotAI } from '../core/EnemyBotAI.js'
import { createToolSimulator } from '../core/ToolSimulator.js'
import { createRandomSource } from '../core/rng.js'
import { getFallbackPlan } from '../ai/ExecutorMock.js'
import { SchemaValidator } from '../ai/SchemaValidator.js'
import { ThoughtChainPanel } from '../ui/ThoughtChainPanel.js'

const RIGID_STEP_DELAY_MS = 900
const ADAPTIVE_STEP_DELAY_MS = 650

export const ExecutionEngine = {
  async runRigidMode(cards, gasAllocations, gameState) {
    const executionStartMs = performance.now()
    const allocationMap = new Map(gasAllocations.map((item) => [item.cardId, item.gas]))
    const simulator = createToolSimulator({
      cards,
      allocations: gasAllocations,
      gasPool: gameState.gasPool,
      layer: gameState.currentLayer,
      scene: gameState.currentScene,
      rng: createRandomSource(),
    })
    const executedCards = []

    for (const card of cards) {
      const allocatedGas = allocationMap.get(card.id) ?? card.gasCost
      const workingCard = createWorkingCard(card, allocatedGas)
      ThoughtChainPanel.startCard(workingCard)

      try {
        recordEvent(workingCard, 'plan', '开始执行', `按固定脚本执行 ${typeLabel(card.type)}，分配 Gas ${allocatedGas} Gwei。`)

        const elapsedSec = (performance.now() - executionStartMs) / 1000
        if (elapsedSec > card.timeWindowSec) {
          failCard(workingCard, '时间窗口过期', 0)
          executedCards.push(workingCard)
          await delay(RIGID_STEP_DELAY_MS)
          continue
        }

        const competition = EnemyBotAI.compete(card, gameState, { rng: () => 1 })
        if (competition.stolen) {
          workingCard.botName = competition.botName
          failCard(workingCard, `被 ${competition.botName} 抢占`, -gasLossToEth(card.gasCost), 'bot')
          executedCards.push(workingCard)
          await delay(RIGID_STEP_DELAY_MS)
          continue
        }

        const toolResult = simulator.execute('broadcast_tx', {
          cardId: card.id,
          gas: allocatedGas,
        })
        recordToolEvent(workingCard, 'broadcast_tx', { type: card.type, gas: allocatedGas }, toolResult.message)
        syncWorkingCardFromSimulator(workingCard, simulator, card.id)
        recordResultEvent(workingCard)
        executedCards.push(workingCard)
        await delay(RIGID_STEP_DELAY_MS)
      } catch (error) {
        failCard(workingCard, `执行异常：${error.message}`, 0)
        executedCards.push(workingCard)
      }
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
    const simulator = createToolSimulator({
      cards,
      allocations: initialPlan.gasAllocations,
      gasPool: initialGasPool,
      layer: gameState.currentLayer,
      scene: gameState.currentScene,
      rng: createRandomSource(),
    })
    const orderedCards = initialPlan.executionOrder
      .map((cardId) => cards.find((card) => card.id === cardId))
      .filter(Boolean)
    const cardsNotPlanned = cards.filter((card) => !orderedCards.some((planned) => planned.id === card.id))
    let remainingGasPool = initialGasPool

    for (const card of [...orderedCards, ...cardsNotPlanned]) {
      const allocatedGas = allocationMap.get(card.id) ?? card.gasCost
      const workingCard = createWorkingCard(card, allocatedGas)
      let abandoned = false
      let repaired = false

      ThoughtChainPanel.startCard(workingCard)

      try {
        const singleCardPlan = await callExecutor(
          executorAI,
          'SingleCardPlan',
          {
            card: toCardParam(card, allocatedGas),
            allocatedGas,
            remainingGasPool,
            completedCards: completedCards.map(toCompletedCard),
          },
          { cardId: card.id },
        )

        recordEvent(workingCard, 'plan', 'Executor 拆解步骤', singleCardPlan.reasoning)

        const competition = EnemyBotAI.compete(card, gameState, { rng: () => 1 })
        if (competition.stolen) {
          workingCard.botName = competition.botName
          recordEvent(workingCard, 'bot', '对手 Bot 抢占', `${competition.botName} 提高出价，正在争夺这张牌。`)

          const incidentResponse = await callExecutor(
            executorAI,
            'IncidentResponse',
            {
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
            },
            { cardId: card.id },
          )

          const selectedPlan = incidentResponse.candidatePlans?.find(
            (plan) => plan.planId === incidentResponse.selectedPlanId,
          )
          const selectedPlanText = selectedPlan?.description ?? incidentResponse.selectedPlanId ?? '保底方案'

          if (incidentResponse.selectedPlanId === 'abandon') {
            failCard(workingCard, `放弃执行：${selectedPlanText}`, -gasLossToEth(card.gasCost), 'failure')
            abandoned = true
          } else {
            repaired = true
            recordEvent(
              workingCard,
              'repair',
              '迭代修复',
              `${selectedPlanText}。${selectedPlan?.expectedOutcome ?? '继续尝试挽回收益。'}`,
            )
            recordToolEvent(workingCard, 'replace_tx', { cardId: card.id, plan: selectedPlanText })
          }
        }

        for (const step of singleCardPlan.steps) {
          if (abandoned) break

          const toolParams = {
            ...(step.params ?? {}),
            cardId: step.params?.cardId ?? card.id,
            gas: step.params?.gas ?? allocatedGas,
          }
          const toolResult = simulator.execute(step.action, toolParams)
          recordToolEvent(workingCard, step.action, toolParams, toolResult.message ?? step.description)
          executionLog.push({
            timestampMs: Date.now(),
            cardId: card.id,
            action: step.action,
            input: toolParams,
            output: toolResult,
            success: toolResult.success === true,
          })

          if (isTerminalToolAction(step.action) && !toolResult.invalid) {
            syncWorkingCardFromSimulator(workingCard, simulator, card.id)
            abandoned = workingCard.status === 'abandoned'
            break
          }

          await delay(ADAPTIVE_STEP_DELAY_MS)
        }

        if (!abandoned) {
          if (!isTerminalStatus(workingCard.status)) {
            const fallbackResult = simulator.execute('broadcast_tx', {
              cardId: card.id,
              gas: allocatedGas,
            })
            recordToolEvent(workingCard, 'broadcast_tx', { cardId: card.id, gas: allocatedGas }, fallbackResult.message)
            syncWorkingCardFromSimulator(workingCard, simulator, card.id)
          }
          if (repaired && workingCard.status === 'success') {
            workingCard.resultReason = '迭代修复后完成'
          }
          recordResultEvent(workingCard)
        }
      } catch (error) {
        failCard(workingCard, `执行异常：${error.message}`, 0)
      }

      remainingGasPool = Math.max(0, remainingGasPool - allocatedGas)
      completedCards.push(workingCard)
    }

    const baseResult = buildRoundResult(completedCards)
    const settlementReport = await callExecutor(
      executorAI,
      'SettlementReport',
      {
        completedCards: completedCards.map(toCompletedCard),
        executionLog,
        totalGasUsed: baseResult.gasUsed,
        initialGasPool,
      },
      {
        streamField: 'summary',
      },
    )

    return {
      ...baseResult,
      aiSummary: settlementReport.summary,
      decisionHighlights: settlementReport.decisionHighlights,
    }
  },
}

async function callExecutor(executorAI, callType, input, options = {}) {
  const writer = ThoughtChainPanel.appendStreaming(`[${callType}] `, null, {
    cardId: options.cardId,
    cardTitle: options.cardId,
  })
  let response

  try {
    response = await executorAI.callStreaming(callType, input, (chunk) => writer.write(chunk), options.streamField)
  } catch (error) {
    writer.write('AI 调用失败，使用保底策略。')
    appendLog('system', `[fallback] ${callType} 调用异常：${error.message}`)
    response = getFallbackPlan(callType, input)
  } finally {
    writer.end()
  }

  const validation = SchemaValidator.validate(callType, response)
  if (validation.valid) return response

  appendLog('system', `[fallback] ${callType} schema 校验失败，使用保底策略。`)
  console.warn(`[SchemaValidator] ${callType} output invalid`, validation.errors)
  return getFallbackPlan(callType, input)
}

function createWorkingCard(card, allocatedGas) {
  return {
    ...card,
    allocatedGas,
    status: 'in_progress',
    actualProfit: 0,
    events: [],
    resultReason: '',
  }
}

function syncWorkingCardFromSimulator(workingCard, simulator, cardId) {
  const simulatedCard = simulator.snapshot().cards.find((card) => card.id === cardId)
  if (!simulatedCard) return

  workingCard.status = simulatedCard.status
  workingCard.actualProfit = simulatedCard.actualProfit
  workingCard.allocatedGas = simulatedCard.allocatedGas
  workingCard.gasUsed = simulatedCard.gasUsed
  workingCard.resultReason = simulatedCard.resultReason
}

function isTerminalToolAction(action) {
  return action === 'broadcast_tx' || action === 'abandon_card'
}

function isTerminalStatus(status) {
  return status === 'success' || status === 'failed' || status === 'abandoned'
}

function failCard(card, reason, profit, kind = 'failure') {
  card.status = reason.startsWith('放弃') ? 'abandoned' : 'failed'
  card.actualProfit = roundEth(profit)
  card.resultReason = reason
  recordEvent(card, kind, resultTitle(card), `${reason}，本牌结果 ${formatSignedEth(card.actualProfit)}。`)
}

function recordResultEvent(card) {
  recordEvent(
    card,
    card.status === 'success' ? 'success' : 'failure',
    resultTitle(card),
    `${card.resultReason || statusLabel(card.status)}，本牌结果 ${formatSignedEth(card.actualProfit)}。`,
  )
}

function recordToolEvent(card, action, params = {}, description = '') {
  const explanation = actionExplanation(action)
  const detail = description ? `${description}。${explanation}` : explanation
  recordEvent(card, 'tool', action, detail, formatParams(params))
}

function recordEvent(card, kind, title, detail, meta = '') {
  const event = { kind, title, detail, meta }
  card.events.push(event)
  ThoughtChainPanel.appendCardEvent(card.id, event)
}

function buildRoundResult(executedCards) {
  return {
    cards: executedCards,
    netProfit: roundEth(executedCards.reduce((sum, card) => sum + (card.actualProfit ?? 0), 0)),
    gasUsed: executedCards.reduce((sum, card) => sum + (card.gasUsed ?? card.allocatedGas ?? card.gasCost ?? 0), 0),
  }
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
    gasUsed: card.allocatedGas ?? card.gasCost,
    reason: card.resultReason,
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

function actionExplanation(action) {
  const explanations = {
    fetch_prices: '读取链上和市场价格，用来判断机会是否仍然存在。',
    broadcast_tx: '提交交易到链上，开始争夺这笔收益。',
    replace_tx: '用更高 Gas 或新方案替换交易，尝试抢回执行优先级。',
    monitor_mempool: '观察交易池变化，确认是否有对手正在抢同一个目标。',
  }
  return explanations[action] ?? '执行一个链上辅助动作。'
}

function formatParams(params) {
  const entries = Object.entries(params ?? {})
  if (!entries.length) return ''
  return entries.map(([key, value]) => `${key}=${value}`).join(' · ')
}

function resultTitle(card) {
  if (card.status === 'success') return '执行成功'
  if (card.status === 'abandoned') return '放弃执行'
  return '执行失败'
}

function statusLabel(status) {
  const labels = {
    success: '执行成功',
    failed: '执行失败',
    abandoned: '已放弃',
  }
  return labels[status] ?? status
}

function typeLabel(type) {
  const labels = {
    arbitrage: '套利',
    sandwich: '夹子',
    nft_snipe: 'NFT 抢购',
    front_run: '抢跑',
    liquidation: '清算',
  }

  return labels[type] ?? type
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
