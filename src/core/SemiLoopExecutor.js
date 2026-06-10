import { CARD_TOOL_SEQUENCES, SEMI_LOOP_CONFIG } from '../config/execution.js'
import { battlePlanToGasAllocationArray } from './BattlePlan.js'
import { createToolSimulator } from './ToolSimulator.js'
import { RuleDecider } from './RuleDecider.js'
import { consumePendingIntervention, isShortcutInstruction } from './PlayerIntervention.js'
import {
  DECIDER_ACTIONS,
  INCIDENT_TYPES,
  isValidIncidentDecision,
  normalizeIncidentDecision,
  normalizeInitialPlan,
} from './IDecider.js'

const TERMINAL_STATUSES = new Set(['success', 'failed', 'abandoned'])

export async function runSemiLoopExecution(battlePlan, context = {}, options = {}) {
  const cards = Array.isArray(battlePlan?.selectedCards) ? battlePlan.selectedCards : []
  if (cards.length === 0) return buildRoundResult([], [], [], { planInitial: 0, decideOnIncident: 0, summarize: 0 })

  const config = options.config ?? SEMI_LOOP_CONFIG
  const decider = options.decider ?? RuleDecider
  const fallbackDecider = options.fallbackDecider ?? RuleDecider
  const maxReplans = Math.min(cards.length, Math.max(0, Math.round(options.maxReplans ?? config.maxReplansPerRound)))
  const initialGasPool = Math.max(0, Math.round(Number(context.gasPool ?? context.gameState?.gasPool) || 0))
  const simulator = createSimulator(battlePlan, context, options, initialGasPool)
  const workingCards = new Map(cards.map((card) => [card.id, createWorkingCard(card, battlePlan.gasAllocations?.[card.id])]))
  const telemetry = {
    maxReplans,
    replans: 0,
    fallbackReplans: 0,
    fallbackReasons: [],
    incidents: [],
    incidentDecisions: [],
    deciderCalls: { planInitial: 0, decideOnIncident: 0, summarize: 0 },
    interventionUsed: Boolean(options.interventionState?.interventionUsed),
  }
  const executionLog = []
  const timestamp = createTimestampSource(options)

  const initialPlan = await planInitialSafely(decider, fallbackDecider, buildInitialInput(cards, battlePlan, context, initialGasPool), telemetry)
  let queue = orderCards(cards, initialPlan.executionOrder)
  let cursor = 0
  const completedCards = []

  while (cursor < queue.length) {
    const cardId = queue[cursor]
    cursor += 1

    const card = workingCards.get(cardId)
    if (!card || TERMINAL_STATUSES.has(card.status)) continue

    await emit(options, 'onCardStart', { card })
    recordEvent(card, 'plan', 'Executor 计划', initialPlan.reasoning)
    await executeCard(card, {
      simulator,
      battlePlan,
      workingCards,
      context,
      options,
      config,
      executionLog,
      telemetry,
      decider,
      fallbackDecider,
      timestamp,
      interventionState: options.interventionState ?? null,
      reorderPending(updatedOrder) {
        queue = reorderQueue(queue, cursor, updatedOrder, workingCards)
      },
      prioritizePending(cardToPrioritize) {
        queue = prioritizeQueueCard(queue, cursor, cardToPrioritize)
      },
    })

    if (!TERMINAL_STATUSES.has(card.status)) {
      const abandoned = await executeTool(card, 'abandon_card', { cardId: card.id }, {
        simulator,
        executionLog,
        options,
        config,
        timestamp,
      })
      syncWorkingCard(card, simulator)
      if (abandoned.invalid) {
        card.status = 'abandoned'
        card.resultReason = '半闭环执行结束后仍未解决，已安全放弃。'
      }
    }

    completedCards.push(card)
  }

  const finalState = simulator.snapshot()
  const baseResult = buildRoundResult(completedCards, executionLog, telemetry.incidents, telemetry.deciderCalls, {
    gasUsed: finalState.gasUsed,
  })
  await emit(options, 'onExecutionComplete', { result: baseResult, telemetry, finalState })
  const settlementReport = await summarizeSafely(decider, fallbackDecider, {
    completedCards: completedCards.map(toCompletedCard),
    executionLog,
    totalGasUsed: baseResult.gasUsed,
    initialGasPool,
  }, telemetry)

  return {
    ...baseResult,
    aiSummary: settlementReport.summary,
    decisionHighlights: settlementReport.decisionHighlights,
    telemetry,
    finalState,
  }
}

async function executeCard(card, state) {
  const sequence = CARD_TOOL_SEQUENCES[card.type] ?? CARD_TOOL_SEQUENCES.default
  let competitorGasBid = 0

  for (const action of sequence) {
    if (TERMINAL_STATUSES.has(card.status)) break

    if (action === 'broadcast_tx') {
      const params = buildBroadcastParams(card, state, competitorGasBid)
      const result = await executeTool(card, action, params, state)
      syncWorkingCard(card, state.simulator)

      if (await maybeHandlePlayerIntervention(card, state)) continue

      if (result.invalid && isGasInsufficient(result)) {
        await handleIncident(card, INCIDENT_TYPES.GAS_INSUFFICIENT, result, state)
        continue
      }
      if (result.stolen) {
        await handleIncident(card, INCIDENT_TYPES.TARGET_STOLEN, result, state)
        continue
      }
      if (result.windowExpired || result.status === 'failed') {
        await handleIncident(card, INCIDENT_TYPES.TX_FAILED, result, state)
      }
      continue
    }

    const result = await executeTool(card, action, { cardId: card.id }, state)
    syncWorkingCard(card, state.simulator)

    if (await maybeHandlePlayerIntervention(card, state)) continue

    if (action === 'monitor_mempool') {
      competitorGasBid = result.competitorGasBid ?? 0
      await applyPlayerContingency(card, result, state)
    }
  }
}

async function applyPlayerContingency(card, mempoolResult, state) {
  if (!mempoolResult.competitorDetected || TERMINAL_STATUSES.has(card.status)) return

  const contingency = state.battlePlan.contingencies?.[card.id] ?? 'fight'
  if (contingency === 'abandon') {
    await executeTool(card, 'abandon_card', { cardId: card.id }, state)
    syncWorkingCard(card, state.simulator)
    return
  }

  if (contingency === 'transfer') {
    const scan = await executeTool(card, 'scan_replacement', { cardId: card.id }, state)
    if (scan.replacementCardId) state.prioritizePending(scan.replacementCardId)
    return
  }

  const currentGas = Math.max(0, Math.round(Number(card.allocatedGas ?? card.gasCost) || 0))
  const newGas = Math.max(currentGas + 1, Math.ceil((mempoolResult.competitorGasBid || currentGas) * 1.1))
  const result = await executeTool(card, 'replace_tx', { cardId: card.id, newGas }, state)
  syncWorkingCard(card, state.simulator)
  if (result.invalid && isGasInsufficient(result)) {
    await handleIncident(card, INCIDENT_TYPES.GAS_INSUFFICIENT, result, state)
  }
}

async function handleIncident(card, type, triggerResult, state) {
  const snapshot = buildIncidentSnapshot(card, type, triggerResult, state)
  state.telemetry.incidents.push(snapshot)
  state.executionLog.push({
    timestampMs: state.timestamp(),
    incident: true,
    cardId: card.id,
    event: type,
    snapshot,
  })
  recordEvent(card, 'incident', incidentTitle(type), triggerResult.message ?? type)
  await emit(state.options, 'onIncident', { card, snapshot })

  const decision = await decideOnIncidentSafely(snapshot, state)
  state.telemetry.incidentDecisions.push({ event: type, cardId: card.id, decision })
  recordEvent(card, decision.fallback ? 'fallback' : 'repair', 'Executor 重规划', decision.reasoning)
  await emit(state.options, 'onDecision', { card, snapshot, decision })

  await applyIncidentDecision(card, decision, state)
}

async function maybeHandlePlayerIntervention(card, state) {
  const instruction = consumePendingIntervention(state.interventionState)
  if (!instruction) return false

  state.telemetry.interventionUsed = true
  await handleIncident(
    card,
    INCIDENT_TYPES.PLAYER_INTERVENTION,
    {
      tool: 'player_intervention',
      message: '玩家干预已在上一次 Executor 动作后排队。',
      playerInstruction: instruction.text,
      instruction,
    },
    state,
  )
  return true
}

async function decideOnIncidentSafely(snapshot, state) {
  const useFallbackForLimit = state.telemetry.replans >= state.telemetry.maxReplans
  const useRuleForShortcut = isPlayerInterventionShortcut(snapshot)
  const primary = useRuleForShortcut ? RuleDecider : useFallbackForLimit ? state.fallbackDecider : state.decider

  if (useFallbackForLimit) {
    state.telemetry.fallbackReasons.push({ reason: 'replan_limit', event: snapshot.trigger.type, cardId: snapshot.affectedCardId })
    await emit(state.options, 'onFallback', { reason: 'replan_limit', snapshot })
  } else {
    state.telemetry.replans += 1
    state.telemetry.deciderCalls.decideOnIncident += 1
  }

  try {
    const rawDecision = await primary.decideOnIncident(snapshot)
    if (!isValidIncidentDecision(rawDecision)) throw new Error('Invalid incident decision shape')
    return {
      ...normalizeIncidentDecision(rawDecision, { targetCardId: snapshot.affectedCardId }),
      fallback: useFallbackForLimit,
    }
  } catch (error) {
    state.telemetry.fallbackReplans += 1
    state.telemetry.fallbackReasons.push({
      reason: 'decider_error',
      event: snapshot.trigger.type,
      cardId: snapshot.affectedCardId,
      message: error.message,
    })
    await emit(state.options, 'onFallback', { reason: 'decider_error', snapshot, error })
    const fallbackDecision = await state.fallbackDecider.decideOnIncident(snapshot)
    return {
      ...normalizeIncidentDecision(fallbackDecision, { targetCardId: snapshot.affectedCardId }),
      fallback: true,
    }
  }
}

function isPlayerInterventionShortcut(snapshot) {
  return snapshot.event === INCIDENT_TYPES.PLAYER_INTERVENTION && isShortcutInstruction(snapshot.playerInstruction)
}

async function applyIncidentDecision(card, decision, state) {
  const targetCard = state.workingCards.get(decision.targetCardId) ?? card

  if (decision.updatedExecutionOrder.length > 0) state.reorderPending(decision.updatedExecutionOrder)

  if (decision.action === DECIDER_ACTIONS.CONTINUE) return

  if (decision.action === DECIDER_ACTIONS.REALLOCATE_GAS) {
    await executeTool(card, 'reallocate_gas', { allocations: decision.gasAllocations }, state)
    syncWorkingCard(card, state.simulator)
    return
  }

  if (TERMINAL_STATUSES.has(targetCard.status)) return

  if (decision.action === DECIDER_ACTIONS.ABANDON_CARD || decision.action === DECIDER_ACTIONS.SKIP_CARD) {
    await executeTool(targetCard, 'abandon_card', { cardId: targetCard.id }, state)
    syncWorkingCard(targetCard, state.simulator)
    return
  }

  if (decision.action === DECIDER_ACTIONS.REPLACE_TX) {
    await executeTool(targetCard, 'replace_tx', { cardId: targetCard.id, newGas: decision.gas }, state)
    syncWorkingCard(targetCard, state.simulator)
    return
  }

  if (decision.action === DECIDER_ACTIONS.RETRY_BROADCAST) {
    await executeTool(targetCard, 'broadcast_tx', buildBroadcastParams(targetCard, state, 0, decision.gas), state)
    syncWorkingCard(targetCard, state.simulator)
  }
}

async function executeTool(card, action, params, state) {
  const result = state.simulator.execute(action, params)
  state.executionLog.push({
    timestampMs: state.timestamp(),
    cardId: card?.id ?? params.cardId,
    action,
    input: params,
    output: result,
    success: result.success === true,
  })

  if (card) recordEvent(card, 'tool', action, result.message ?? action, formatParams(params))
  await emit(state.options, 'onToolResult', { card, action, params, result })
  if (state.options.delay && state.config.toolDelayMs > 0) await state.options.delay(state.config.toolDelayMs)
  return result
}

async function planInitialSafely(decider, fallbackDecider, input, telemetry) {
  telemetry.deciderCalls.planInitial += 1
  try {
    return normalizeInitialPlan(await decider.planInitial(input), input.cards)
  } catch {
    return normalizeInitialPlan(await fallbackDecider.planInitial(input), input.cards)
  }
}

async function summarizeSafely(decider, fallbackDecider, input, telemetry) {
  telemetry.deciderCalls.summarize += 1
  try {
    return await decider.summarize(input)
  } catch {
    return fallbackDecider.summarize(input)
  }
}

function createSimulator(battlePlan, context, options, initialGasPool) {
  const factory = options.simulatorFactory ?? createToolSimulator
  return factory({
    cards: battlePlan.selectedCards,
    allocations: battlePlanToGasAllocationArray(battlePlan),
    gasPool: initialGasPool,
    layer: context.layer ?? context.gameState?.currentLayer ?? 1,
    scene: context.scene ?? context.gameState?.currentScene,
    rng: options.rng,
    seed: options.seed,
    botName: options.botName,
    forceSteal: options.forceSteal,
    config: options.toolConfig,
    role: context.role ?? context.gameState?.role,
    roleLevel: context.roleLevel ?? context.gameState?.roleLevel,
  })
}

function buildInitialInput(cards, battlePlan, context, initialGasPool) {
  return {
    cards: cards.map((card) => toDeciderCard(card, battlePlan.gasAllocations?.[card.id] ?? card.gasCost)),
    battlePlan: {
      selectedCardIds: cards.map((card) => card.id),
      gasAllocations: { ...(battlePlan.gasAllocations ?? {}) },
      contingencies: { ...(battlePlan.contingencies ?? {}) },
    },
    totalGasPool: initialGasPool,
    scene: {
      sceneType: context.scene ?? context.gameState?.currentScene ?? 'dex_arb',
      layer: context.layer ?? context.gameState?.currentLayer ?? 1,
      enemyBotActivity: botActivityForLayer(context.layer ?? context.gameState?.currentLayer ?? 1),
    },
    remainingTimeWindowSec: Math.max(...cards.map((card) => card.timeWindowSec ?? 1)),
  }
}

function buildIncidentSnapshot(card, type, triggerResult, state) {
  const snapshot = state.simulator.snapshot()
  return {
    event: type,
    affectedCardId: card.id,
    remainingGasPool: snapshot.gasPool,
    allCardStatuses: snapshot.cards.map((item) => ({
      id: item.id,
      type: item.type,
      status: item.status,
      allocatedGas: item.allocatedGas,
      gasUsed: item.gasUsed ?? 0,
      actualProfit: item.actualProfit ?? 0,
      expectedProfit: item.expectedProfit,
      gasCost: item.gasCost,
      displayedRisk: item.displayedRisk,
      trueRisk: item.trueRisk,
      timeWindowSec: item.timeWindowSec,
    })),
    trigger: {
      type,
      cardId: card.id,
      tool: triggerResult.tool,
      message: triggerResult.message,
      stolen: triggerResult.stolen === true,
      invalid: triggerResult.invalid === true,
      competitorGasBid: triggerResult.competitorGasBid ?? snapshot.competitors?.[card.id]?.competitorGasBid ?? 0,
      remainingTimeWindowSec: triggerResult.remainingTimeWindowSec,
      rawResult: triggerResult,
    },
    playerContingency: state.battlePlan.contingencies?.[card.id] ?? 'fight',
    competitors: snapshot.competitors,
    playerInstruction: triggerResult.playerInstruction ?? state.options.playerInstruction ?? null,
  }
}

function buildBroadcastParams(card, state, competitorGasBid = 0, gasOverride) {
  const elapsedSec = elapsedSeconds(card, state)
  return {
    cardId: card.id,
    gas: Math.max(0, Math.round(Number(gasOverride ?? card.allocatedGas ?? card.gasCost) || 0)),
    elapsedSec,
    remainingTimeWindowSec: Math.max(0, (card.timeWindowSec ?? 0) - elapsedSec),
    competitorGasBid,
  }
}

function elapsedSeconds(card, state) {
  if (typeof state.options.elapsedSec === 'function') return Math.max(0, Number(state.options.elapsedSec(card)) || 0)
  if (Number.isFinite(Number(state.options.elapsedSec))) return Math.max(0, Number(state.options.elapsedSec))
  return (state.executionLog.filter((entry) => entry.cardId === card.id && !entry.incident).length + 1) * state.config.simulatedToolElapsedSec
}

function syncWorkingCard(card, simulator) {
  const simulated = simulator.snapshot().cards.find((item) => item.id === card.id)
  if (!simulated) return

  card.status = simulated.status === 'pending' ? 'in_progress' : simulated.status
  card.actualProfit = simulated.actualProfit
  card.allocatedGas = simulated.allocatedGas
  card.gasUsed = simulated.gasUsed
  card.resultReason = simulated.resultReason
}

function createWorkingCard(card, allocatedGas) {
  return {
    ...card,
    allocatedGas: Math.max(0, Math.round(Number(allocatedGas ?? card.gasCost) || 0)),
    gasUsed: card.gasUsed ?? 0,
    status: 'in_progress',
    actualProfit: 0,
    resultReason: '',
    events: [],
  }
}

function orderCards(cards, executionOrder) {
  const cardMap = new Map(cards.map((card) => [card.id, card]))
  return executionOrder.filter((cardId) => cardMap.has(cardId))
}

function reorderQueue(queue, cursor, updatedOrder, workingCards) {
  const completed = queue.slice(0, cursor)
  const pending = queue.slice(cursor)
  const pendingSet = new Set(pending)
  const ordered = updatedOrder.filter((cardId) => pendingSet.has(cardId) && !TERMINAL_STATUSES.has(workingCards.get(cardId)?.status))
  const rest = pending.filter((cardId) => !ordered.includes(cardId) && !TERMINAL_STATUSES.has(workingCards.get(cardId)?.status))
  return [...completed, ...ordered, ...rest]
}

function prioritizeQueueCard(queue, cursor, cardId) {
  const index = queue.indexOf(cardId)
  if (index < cursor) return queue

  const nextQueue = [...queue]
  nextQueue.splice(index, 1)
  nextQueue.splice(cursor, 0, cardId)
  return nextQueue
}

function buildRoundResult(cards, executionLog = [], incidents = [], deciderCalls = {}, overrides = {}) {
  return {
    cards,
    netProfit: roundEth(cards.reduce((sum, card) => sum + (card.actualProfit ?? 0), 0)),
    gasUsed: overrides.gasUsed ?? cards.reduce((sum, card) => sum + (card.gasUsed ?? 0), 0),
    executionLog,
    incidents,
    deciderCalls,
  }
}

function recordEvent(card, kind, title, detail, meta = '') {
  card.events.push({ kind, title, detail, meta })
}

function incidentTitle(type) {
  const titles = {
    [INCIDENT_TYPES.TARGET_STOLEN]: '目标被抢',
    [INCIDENT_TYPES.TX_FAILED]: '交易失败',
    [INCIDENT_TYPES.GAS_INSUFFICIENT]: 'Gas 不足',
    [INCIDENT_TYPES.PLAYER_INTERVENTION]: '玩家干预',
    [INCIDENT_TYPES.TARGET_INVALID]: '目标失效',
  }
  return titles[type] ?? type
}

function isGasInsufficient(result) {
  return /insufficient gas/i.test(result.message ?? '') || result.requestedGas > result.remainingGasPool
}

function toDeciderCard(card, gasBudget = card.gasCost) {
  return {
    ...card,
    gasBudget,
  }
}

function toCompletedCard(card) {
  return {
    id: card.id,
    status: card.status,
    actualProfit: card.actualProfit,
    gasUsed: card.gasUsed ?? card.allocatedGas ?? 0,
  }
}

function botActivityForLayer(layer) {
  if (layer <= 2) return 'none'
  if (layer <= 7) return 'low'
  if (layer <= 12) return 'medium'
  return 'high'
}

function formatParams(params) {
  const entries = Object.entries(params ?? {})
  if (!entries.length) return ''
  return entries.map(([key, value]) => `${key}=${value}`).join(' · ')
}

async function emit(options, name, payload) {
  const handler = options.hooks?.[name]
  if (!handler) return
  await handler(payload)
}

function roundEth(value) {
  return Math.round(value * 1000) / 1000
}

function createTimestampSource(options) {
  if (typeof options.now === 'function') return () => Math.round(Number(options.now()) || 0)
  if (Number.isFinite(Number(options.now))) return () => Math.round(Number(options.now))

  let timestamp = Math.round(Number(options.startTimestampMs) || 0)
  return () => {
    timestamp += 1
    return timestamp
  }
}
