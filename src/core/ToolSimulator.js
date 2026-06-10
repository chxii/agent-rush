import { BOTS } from '../config/bots.js'
import { LAYER_CONFIG } from '../config/scenes.js'
import {
  BOT_STRENGTH_BY_NAME,
  CARD_TYPE_TOOL_SENSITIVITY,
  TOOL_SIMULATOR_CONFIG,
} from '../config/toolSimulator.js'
import { createRandomSource } from './rng.js'

const TERMINAL_STATUSES = new Set(['success', 'failed', 'abandoned'])

export function createToolSimulator(options = {}) {
  const rng = options.rng ?? createRandomSource(options.seed)
  const config = options.config ?? TOOL_SIMULATOR_CONFIG
  const state = createToolState(options, config)

  return {
    state,

    execute(toolName, params = {}) {
      switch (toolName) {
        case 'fetch_prices':
          return fetchPrices(state, params, rng, config)
        case 'monitor_mempool':
          return monitorMempool(state, params, rng, config)
        case 'broadcast_tx':
          return broadcastTx(state, params, rng, config)
        case 'replace_tx':
          return replaceTx(state, params, rng, config)
        case 'scan_replacement':
          return scanReplacement(state, params, config)
        case 'reallocate_gas':
          return reallocateGas(state, params)
        case 'abandon_card':
          return abandonCard(state, params, config)
        default:
          return invalidToolResult(toolName, `Unknown tool: ${toolName}`)
      }
    },

    snapshot() {
      return snapshotState(state)
    },
  }
}

export function createToolState(options = {}, config = TOOL_SIMULATOR_CONFIG) {
  const allocationMap = new Map((options.allocations ?? []).map((item) => [item.cardId, item.gas]))
  const layer = clampInt(options.layer ?? 1, 1, 20)
  const botName = options.botName === undefined ? activeBotForLayer(layer) : options.botName
  const botStrength = BOT_STRENGTH_BY_NAME[botName] ?? 0

  return {
    layer,
    scene: options.scene ?? LAYER_CONFIG[layer]?.scene ?? 'dex_arb',
    botName,
    botStrength,
    gasPool: clampNumber(options.gasPool ?? 0, 0, Number.MAX_SAFE_INTEGER),
    gasUsed: 0,
    config,
    competitors: {},
    cards: (options.cards ?? []).map((card) => ({
      ...card,
      allocatedGas: clampInt(allocationMap.get(card.id) ?? card.allocatedGas ?? card.gasCost ?? 0, 0),
      gasUsed: card.gasUsed ?? 0,
      actualProfit: card.actualProfit ?? 0,
      status: card.status && card.status !== 'pending' ? card.status : 'pending',
      resultReason: card.resultReason ?? '',
    })),
  }
}

function fetchPrices(state, params, rng, config) {
  const lookup = getMutableCard(state, params.cardId, 'fetch_prices')
  if (!lookup.ok) return lookup.result

  const { card } = lookup
  const sensitivity = sensitivityFor(card.type)
  const invalidationChance = clamp01(
    (config.prices.invalidationBase + card.trueRisk * config.prices.invalidationRiskWeight) * sensitivity.price,
  )
  const opportunityStillValid = rng() >= invalidationChance
  const drift = randomBetween(rng, -config.prices.profitVariance, config.prices.profitVariance)
  const priceGapEth = roundEth(Math.max(0, card.expectedProfit * (1 + drift)))
  const slippageEstimate = round(randomBetween(rng, ...config.prices.slippageRange) * sensitivity.price, 4)

  return {
    success: opportunityStillValid,
    tool: 'fetch_prices',
    cardId: card.id,
    message: opportunityStillValid ? 'Price gap is still tradable.' : 'Price gap closed before execution.',
    opportunityStillValid,
    priceGapEth,
    slippageEstimate,
    invalidationChance: round(invalidationChance, 4),
  }
}

function monitorMempool(state, params, rng, config) {
  const lookup = getMutableCard(state, params.cardId, 'monitor_mempool')
  if (!lookup.ok) return lookup.result

  const { card } = lookup
  const result = calculateCompetition(state, card, rng, config, true)
  state.competitors[card.id] = result

  return {
    success: true,
    tool: 'monitor_mempool',
    cardId: card.id,
    message: result.competitorDetected
      ? `${state.botName} detected with a competing bid.`
      : 'No active competitor detected.',
    competitorDetected: result.competitorDetected,
    competitorName: result.competitorDetected ? state.botName : null,
    competitorGasBid: result.competitorDetected ? result.competitorGasBid : 0,
    stealProbability: result.stealProbability,
  }
}

function broadcastTx(state, params, rng, config) {
  const lookup = getMutableCard(state, params.cardId, 'broadcast_tx')
  if (!lookup.ok) return lookup.result

  const { card } = lookup
  const gas = clampInt(params.gas ?? card.allocatedGas ?? card.gasCost ?? 0, 0)
  if (gas < config.gas.minBroadcastGas) {
    return invalidToolResult('broadcast_tx', 'Gas bid is below the minimum broadcast threshold.', { cardId: card.id })
  }
  if (gas > state.gasPool) {
    return invalidToolResult('broadcast_tx', 'Insufficient gas pool for broadcast.', {
      cardId: card.id,
      requestedGas: gas,
      remainingGasPool: state.gasPool,
    })
  }

  card.status = 'in_progress'
  card.allocatedGas = gas

  const competition = state.competitors[card.id] ?? calculateCompetition(state, card, rng, config, false)
  state.competitors[card.id] = competition
  const stolen = competition.competitorDetected && rng() < competition.stealProbability

  spendGas(state, card, gas)

  if (stolen) {
    const loss = roundEth(-gas * config.gas.gasToEth * config.gas.failedGasLossRate)
    settleCard(card, 'failed', loss, `Target stolen by ${state.botName}.`)
    return {
      success: false,
      tool: 'broadcast_tx',
      cardId: card.id,
      message: card.resultReason,
      status: card.status,
      stolen: true,
      actualProfit: card.actualProfit,
      actualGasConsumed: gas,
      remainingGasPool: state.gasPool,
      successProbability: 0,
      stealProbability: competition.stealProbability,
    }
  }

  const successProbability = calculateBroadcastSuccessProbability(state, card, gas, config)
  const txSucceeded = rng() < successProbability

  if (txSucceeded) {
    const multiplier = 1 + randomBetween(rng, -config.broadcast.profitVariance, config.broadcast.profitVariance)
    settleCard(card, 'success', roundEth(card.expectedProfit * multiplier), 'Transaction confirmed on chain.')
  } else {
    const loss = roundEth(-gas * config.gas.gasToEth * config.gas.failedGasLossRate)
    settleCard(card, 'failed', loss, 'Transaction reverted or missed the block slot.')
  }

  return {
    success: txSucceeded,
    tool: 'broadcast_tx',
    cardId: card.id,
    message: card.resultReason,
    status: card.status,
    stolen: false,
    actualProfit: card.actualProfit,
    actualGasConsumed: gas,
    remainingGasPool: state.gasPool,
    successProbability,
    stealProbability: competition.stealProbability,
  }
}

function replaceTx(state, params, rng, config) {
  const lookup = getMutableCard(state, params.cardId, 'replace_tx')
  if (!lookup.ok) return lookup.result

  const { card } = lookup
  const oldGas = card.allocatedGas ?? card.gasCost ?? 0
  const newGas = clampInt(params.newGas ?? params.gas ?? Math.ceil(oldGas * 1.2), 0)
  if (newGas <= oldGas) {
    return invalidToolResult('replace_tx', 'Replacement gas must be higher than the current bid.', {
      cardId: card.id,
      currentGas: oldGas,
      requestedGas: newGas,
    })
  }

  const gasDelta = newGas - oldGas
  if (gasDelta > state.gasPool) {
    return invalidToolResult('replace_tx', 'Insufficient gas pool for replacement delta.', {
      cardId: card.id,
      requestedGas: newGas,
      gasDelta,
      remainingGasPool: state.gasPool,
    })
  }

  const competitor = state.competitors[card.id] ?? calculateCompetition(state, card, rng, config, false)
  const requiredBid = Math.ceil((competitor.competitorGasBid || oldGas) * config.replace.requiredBidMultiplier)
  const bidAdvantage = Math.max(0, newGas - requiredBid) / Math.max(requiredBid, 1)
  const suppressProbability = clamp(
    config.replace.baseSuppressProbability + bidAdvantage * config.replace.bidAdvantageWeight,
    0,
    config.replace.maxSuppressProbability,
  )
  const suppressSucceeded = newGas >= requiredBid && rng() < suppressProbability

  card.allocatedGas = newGas
  state.gasPool = clampNumber(state.gasPool - gasDelta, 0, Number.MAX_SAFE_INTEGER)
  state.gasUsed += gasDelta
  state.competitors[card.id] = {
    ...competitor,
    suppressed: suppressSucceeded,
    stealProbability: suppressSucceeded ? 0 : competitor.stealProbability,
  }

  return {
    success: suppressSucceeded,
    tool: 'replace_tx',
    cardId: card.id,
    message: suppressSucceeded ? 'Replacement bid suppressed the competitor.' : 'Replacement bid did not fully suppress the competitor.',
    suppressSucceeded,
    newGasConsumed: gasDelta,
    newAllocatedGas: newGas,
    requiredBid,
    remainingGasPool: state.gasPool,
    suppressProbability: round(suppressProbability, 4),
  }
}

function scanReplacement(state, params, config) {
  const sourceId = params.cardId
  const candidates = state.cards
    .filter((card) => card.id !== sourceId && !TERMINAL_STATUSES.has(card.status))
    .map((card) => ({
      card,
      expectedValue: card.expectedProfit * (1 - card.trueRisk) - card.allocatedGas * config.gas.gasToEth,
    }))
    .filter((item) => item.expectedValue >= config.replacement.minExpectedValue)
    .sort((a, b) => b.expectedValue - a.expectedValue)

  const replacement = candidates[0]

  return {
    success: Boolean(replacement),
    tool: 'scan_replacement',
    cardId: sourceId,
    message: replacement ? 'Replacement opportunity found.' : 'No viable replacement opportunity found.',
    foundReplacement: Boolean(replacement),
    replacementCardId: replacement?.card.id ?? null,
    replacementSummary: replacement
      ? {
          type: replacement.card.type,
          expectedProfit: replacement.card.expectedProfit,
          risk: replacement.card.trueRisk,
          expectedValue: roundEth(replacement.expectedValue),
        }
      : null,
  }
}

function reallocateGas(state, params) {
  const allocations = Array.isArray(params.allocations) ? params.allocations : []
  const totalGas = allocations.reduce((sum, item) => sum + clampInt(item.gas ?? 0, 0), 0)
  if (totalGas > state.gasPool) {
    return invalidToolResult('reallocate_gas', 'Reallocation exceeds remaining gas pool.', {
      requestedGas: totalGas,
      remainingGasPool: state.gasPool,
    })
  }

  const updatedAllocations = []
  for (const allocation of allocations) {
    const card = state.cards.find((item) => item.id === allocation.cardId)
    if (!card || TERMINAL_STATUSES.has(card.status)) continue
    card.allocatedGas = clampInt(allocation.gas, 0)
    updatedAllocations.push({ cardId: card.id, gas: card.allocatedGas })
  }

  return {
    success: true,
    tool: 'reallocate_gas',
    message: 'Gas allocations updated.',
    updatedAllocations,
    remainingPool: state.gasPool - updatedAllocations.reduce((sum, item) => sum + item.gas, 0),
  }
}

function abandonCard(state, params, config) {
  const lookup = getMutableCard(state, params.cardId, 'abandon_card')
  if (!lookup.ok) return lookup.result

  const { card } = lookup
  const allocatedGas = clampInt(card.allocatedGas ?? card.gasCost ?? 0, 0)
  const gasLost = Math.min(state.gasPool, Math.ceil(allocatedGas * config.gas.abandonGasLossRate))
  state.gasPool -= gasLost
  state.gasUsed += gasLost
  card.gasUsed += gasLost
  settleCard(card, 'abandoned', roundEth(-gasLost * config.gas.gasToEth), 'Card abandoned before broadcast.')

  return {
    success: true,
    tool: 'abandon_card',
    cardId: card.id,
    message: card.resultReason,
    abandoned: true,
    gasLost,
    gasRefunded: Math.max(0, allocatedGas - gasLost),
    remainingGasPool: state.gasPool,
    actualProfit: card.actualProfit,
  }
}

function calculateCompetition(state, card, rng, config, sampled) {
  if (!state.botName) {
    return {
      competitorDetected: false,
      competitorGasBid: 0,
      stealProbability: 0,
    }
  }

  const sensitivity = sensitivityFor(card.type)
  const gasDefense = (card.allocatedGas ?? card.gasCost ?? 0) * config.mempool.gasDefenseWeight
  const stealProbability = clamp01(
    (state.botStrength * config.mempool.botStrengthWeight +
      (card.competitionLevel ?? 0) * config.mempool.competitionWeight -
      gasDefense) *
      sensitivity.mempool,
  )
  const detectionChance = clamp01(config.mempool.detectionBase + stealProbability)
  const competitorDetected = sampled ? rng() < detectionChance : stealProbability > 0
  const baseGas = card.allocatedGas ?? card.gasCost ?? 0

  return {
    competitorDetected,
    competitorGasBid: competitorDetected
      ? Math.ceil(baseGas * config.mempool.competitorBidMultiplier + config.mempool.competitorBidMinLift)
      : 0,
    stealProbability: round(stealProbability, 4),
  }
}

function calculateBroadcastSuccessProbability(state, card, gas, config) {
  const sensitivity = sensitivityFor(card.type)
  const gasRatio = gas / Math.max(card.gasCost ?? gas, 1)
  const probability =
    config.broadcast.baseSuccessProbability +
    Math.min(gasRatio, 2) * config.broadcast.gasWeight -
    (card.trueRisk ?? card.displayedRisk ?? 0) * config.broadcast.riskPenalty -
    state.botStrength * config.broadcast.botPressurePenalty

  return round(
    clamp(
      probability * sensitivity.broadcast,
      config.broadcast.minSuccessProbability,
      config.broadcast.maxSuccessProbability,
    ),
    4,
  )
}

function getMutableCard(state, cardId, tool) {
  const card = state.cards.find((item) => item.id === cardId)
  if (!card) {
    return {
      ok: false,
      result: invalidToolResult(tool, `Card not found: ${cardId}`, { cardId }),
    }
  }
  if (TERMINAL_STATUSES.has(card.status)) {
    return {
      ok: false,
      result: invalidToolResult(tool, `Card is already ${card.status}.`, { cardId }),
    }
  }
  return { ok: true, card }
}

function spendGas(state, card, gas) {
  state.gasPool = clampNumber(state.gasPool - gas, 0, Number.MAX_SAFE_INTEGER)
  state.gasUsed += gas
  card.gasUsed = (card.gasUsed ?? 0) + gas
}

function settleCard(card, status, actualProfit, reason) {
  card.status = status
  card.actualProfit = roundEth(actualProfit)
  card.resultReason = reason
}

function invalidToolResult(tool, message, extra = {}) {
  return {
    success: false,
    tool,
    message,
    invalid: true,
    ...extra,
  }
}

function activeBotForLayer(layer) {
  const configuredBot = LAYER_CONFIG[layer]?.bot
  if (configuredBot !== undefined) return configuredBot

  const entry = Object.entries(BOTS).find(([, bot]) => layer >= bot.layers[0] && layer <= bot.layers[1])
  return entry?.[0] ?? null
}

function sensitivityFor(type) {
  return CARD_TYPE_TOOL_SENSITIVITY[type] ?? { price: 1, mempool: 1, broadcast: 1 }
}

function snapshotState(state) {
  return {
    layer: state.layer,
    scene: state.scene,
    botName: state.botName,
    gasPool: state.gasPool,
    gasUsed: state.gasUsed,
    cards: state.cards.map((card) => ({ ...card })),
    competitors: structuredCloneSafe(state.competitors),
  }
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value))
}

function randomBetween(rng, min, max) {
  return min + rng() * (max - min)
}

function clampInt(value, min, max = Number.MAX_SAFE_INTEGER) {
  return clamp(Math.round(Number(value) || 0), min, max)
}

function clampNumber(value, min, max) {
  return clamp(Number(value) || 0, min, max)
}

function clamp01(value) {
  return clamp(value, 0, 1)
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function roundEth(value) {
  return round(value, 3)
}

function round(value, places = 3) {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}
