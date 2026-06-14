import { BOTS } from '../config/bots.js'
import { LAYER_CONFIG } from '../config/scenes.js'
import { getRoleBuffs } from './RoleBuffs.js'
import {
  BOT_STRENGTH_BY_NAME,
  CARD_TYPE_MECHANICS,
  CARD_TYPE_TOOL_SENSITIVITY,
  DEFAULT_CARD_TYPE_MECHANICS,
  TOOL_SIMULATOR_CONFIG,
} from '../config/toolSimulator.js'
import { createRandomSource } from './rng.js'

const TERMINAL_STATUSES = new Set(['success', 'failed', 'abandoned'])

export function createToolSimulator(options = {}) {
  const rng = options.rng ?? createRandomSource(options.seed)
  const config = options.config ?? TOOL_SIMULATOR_CONFIG
  const state = createToolState(options, config)
  const consumeForceSteal = createForceStealConsumer(options.forceSteal)

  return {
    state,

    execute(toolName, params = {}) {
      switch (toolName) {
        case 'fetch_prices':
          return fetchPrices(state, params, rng, config)
        case 'monitor_mempool':
          return monitorMempool(state, params, rng, config, consumeForceSteal)
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
  const isBoss = options.isBoss ?? LAYER_CONFIG[layer]?.isBoss === true
  const baseBotStrength = BOT_STRENGTH_BY_NAME[botName] ?? 0
  const botStrength = clamp01(baseBotStrength + (isBoss && botName ? config.boss?.botStrengthBonus ?? 0 : 0))
  const role = options.role ?? null
  const roleLevel = options.roleLevel ?? 1
  const roleBuffs = getRoleBuffs(role, roleLevel)

  return {
    layer,
    scene: options.scene ?? LAYER_CONFIG[layer]?.scene ?? 'dex_arb',
    role,
    roleLevel,
    roleBuffs,
    botName,
    isBoss,
    baseBotStrength,
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
      opportunityStillValid: card.opportunityStillValid !== false,
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
  card.opportunityStillValid = opportunityStillValid
  const drift = randomBetween(rng, -config.prices.profitVariance, config.prices.profitVariance)
  const priceGapEth = roundEth(Math.max(0, card.expectedProfit * (1 + drift)))
  const slippageEstimate = round(randomBetween(rng, ...config.prices.slippageRange) * sensitivity.price, 4)

  return {
    success: opportunityStillValid,
    tool: 'fetch_prices',
    cardId: card.id,
    message: opportunityStillValid ? '价差仍可交易。' : '执行前价差已经消失。',
    opportunityStillValid,
    priceGapEth,
    slippageEstimate,
    invalidationChance: round(invalidationChance, 4),
  }
}

function monitorMempool(state, params, rng, config, consumeForceSteal) {
  const lookup = getMutableCard(state, params.cardId, 'monitor_mempool')
  if (!lookup.ok) return lookup.result

  const { card } = lookup
  const result = calculateCompetition(state, card, rng, config, true, consumeForceSteal)
  state.competitors[card.id] = result

  return {
    success: true,
    tool: 'monitor_mempool',
    cardId: card.id,
    message: result.competitorDetected
      ? `检测到 ${state.botName} 提交竞争出价。`
      : '未检测到活跃竞争者。',
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
    return invalidToolResult('broadcast_tx', 'Gas 出价低于最低广播门槛。', { cardId: card.id })
  }
  if (gas > state.gasPool) {
    return invalidToolResult('broadcast_tx', 'Gas 池不足，无法广播交易。', {
      cardId: card.id,
      requestedGas: gas,
      remainingGasPool: state.gasPool,
    })
  }

  const mechanics = mechanicsFor(card.type)
  card.status = 'in_progress'
  card.allocatedGas = gas

  if (card.opportunityStillValid === false || params.opportunityStillValid === false) {
    const gasLost = spendFailureGas(state, card, gas, 'invalidOpportunity', config)
    settleCard(card, 'failed', roundEth(-gasLost * config.gas.gasToEth), '广播前机会已经失效，价差窗口没了。')
    return {
      success: false,
      tool: 'broadcast_tx',
      cardId: card.id,
      message: card.resultReason,
      status: card.status,
      invalidOpportunity: true,
      stolen: false,
      windowExpired: false,
      actualProfit: card.actualProfit,
      actualGasConsumed: gasLost,
      remainingGasPool: state.gasPool,
      successProbability: 0,
      stealProbability: 0,
    }
  }

  if (isHardTimeWindowExpired(card, params, mechanics)) {
    const gasLost = spendFailureGas(state, card, gas, 'windowExpired', config)
    const loss = roundEth(-gasLost * config.gas.gasToEth)
    settleCard(card, 'failed', loss, '清算窗口在广播前已经过期。')
    return {
      success: false,
      tool: 'broadcast_tx',
      cardId: card.id,
      message: card.resultReason,
      status: card.status,
      stolen: false,
      windowExpired: true,
      actualProfit: card.actualProfit,
      actualGasConsumed: gasLost,
      remainingGasPool: state.gasPool,
      successProbability: 0,
      stealProbability: 0,
    }
  }

  const competition = resolveCompetition(state, card, params, rng, config)
  state.competitors[card.id] = competition
  const stolen = competition.competitorDetected && rng() < competition.stealProbability

  if (stolen) {
    const gasLost = spendFailureGas(state, card, gas, 'stolen', config)
    const loss = roundEth(-gasLost * config.gas.gasToEth)
    settleCard(card, 'failed', loss, `目标被 ${state.botName} 抢走。`)
    return {
      success: false,
      tool: 'broadcast_tx',
      cardId: card.id,
      message: card.resultReason,
      status: card.status,
      stolen: true,
      actualProfit: card.actualProfit,
      actualGasConsumed: gasLost,
      remainingGasPool: state.gasPool,
      successProbability: 0,
      stealProbability: competition.stealProbability,
    }
  }

  const successProbability = calculateBroadcastSuccessProbability(state, card, gas, competition, config)
  const txSucceeded = rng() < successProbability
  let actualGasConsumed = gas

  if (txSucceeded) {
    spendGas(state, card, gas)
    const profitVariance = mechanics.profitVariance ?? config.broadcast.profitVariance
    const multiplier = 1 + randomBetween(rng, -profitVariance, profitVariance)
    settleCard(card, 'success', roundEth(card.expectedProfit * multiplier), '交易已在链上确认。')
  } else {
    const gasLost = spendFailureGas(state, card, gas, 'txFailed', config)
    actualGasConsumed = gasLost
    const loss = roundEth(-gasLost * config.gas.gasToEth)
    settleCard(card, 'failed', loss, '没抢到这个区块，交易没打包成功。')
  }

  return {
    success: txSucceeded,
    tool: 'broadcast_tx',
    cardId: card.id,
    message: card.resultReason,
    status: card.status,
    stolen: false,
    actualProfit: card.actualProfit,
    actualGasConsumed,
    remainingGasPool: state.gasPool,
    successProbability,
    stealProbability: competition.stealProbability,
    bidPosition: competition.bidPosition ?? 'not_compared',
    windowExpired: false,
  }
}

function replaceTx(state, params, rng, config) {
  const lookup = getMutableCard(state, params.cardId, 'replace_tx')
  if (!lookup.ok) return lookup.result

  const { card } = lookup
  const oldGas = card.allocatedGas ?? card.gasCost ?? 0
  const newGas = clampInt(params.newGas ?? params.gas ?? Math.ceil(oldGas * 1.2), 0)
  if (newGas <= oldGas) {
    return invalidToolResult('replace_tx', '替换交易的 Gas 必须高于当前出价。', {
      cardId: card.id,
      currentGas: oldGas,
      requestedGas: newGas,
    })
  }

  const gasDelta = newGas - oldGas
  if (gasDelta > state.gasPool) {
    return invalidToolResult('replace_tx', 'Gas 池不足，无法补足替换交易差额。', {
      cardId: card.id,
      requestedGas: newGas,
      gasDelta,
      remainingGasPool: state.gasPool,
    })
  }

  const competitor = state.competitors[card.id] ?? calculateCompetition(state, card, rng, config, false)
  const mechanics = mechanicsFor(card.type)
  const requiredBidMultiplier =
    (mechanics.replaceRequiredBidMultiplier ?? config.replace.requiredBidMultiplier) *
    state.roleBuffs.replaceRequiredBidMultiplier
  const requiredBid = Math.ceil((competitor.competitorGasBid || oldGas) * requiredBidMultiplier)
  const bidAdvantage = Math.max(0, newGas - requiredBid) / Math.max(requiredBid, 1)
  const maxSuppressProbability = botMechanicValue(
    config,
    state.botName,
    'maxSuppressProbability',
    config.replace.maxSuppressProbability,
  )
  const suppressProbability = clamp(
    config.replace.baseSuppressProbability +
      bidAdvantage * config.replace.bidAdvantageWeight +
      state.roleBuffs.replaceSuppressProbabilityBonus,
    0,
    maxSuppressProbability,
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
    message: suppressSucceeded ? '替换出价压制了竞争者。' : '替换出价未能完全压制竞争者。',
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
    message: replacement ? '找到可转移的替代机会。' : '没有找到可用的替代机会。',
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

  // 玩家/LLM 干预常按「原分配 + 追加」给出超过剩余池的数字（原分配是计划值，从未真正进池）。
  // 不再整体拒绝（那会让干预看似生效实则改不动结局），而是按请求顺序在剩余池内尽量满足，
  // 单牌请求超池则给到池上限。totalGas ≤ pool 时行为与旧版完全一致（向后兼容）。
  let budget = state.gasPool
  const updatedAllocations = []
  for (const allocation of allocations) {
    const card = state.cards.find((item) => item.id === allocation.cardId)
    if (!card || TERMINAL_STATUSES.has(card.status)) continue
    const granted = Math.min(clampInt(allocation.gas, 0), budget)
    card.allocatedGas = granted
    budget -= granted
    updatedAllocations.push({ cardId: card.id, gas: granted })
  }

  return {
    success: true,
    tool: 'reallocate_gas',
    message: 'Gas 分配已更新。',
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
  settleCard(card, 'abandoned', roundEth(-gasLost * config.gas.gasToEth), '机会牌在广播前被放弃。')

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

function calculateCompetition(state, card, rng, config, sampled, consumeForceSteal = () => false) {
  if (!state.botName) {
    return {
      competitorDetected: false,
      competitorGasBid: 0,
      stealProbability: 0,
    }
  }

  if (consumeForceSteal()) {
    const baseGas = card.allocatedGas ?? card.gasCost ?? 0
    return {
      competitorDetected: true,
      competitorName: state.botName,
      competitorGasBid: competitorGasBidFor(state, baseGas, config),
      stealProbability: 1,
      forced: true,
    }
  }

  const sensitivity = sensitivityFor(card.type)
  const mechanics = mechanicsFor(card.type)
  const gasDefense = (card.allocatedGas ?? card.gasCost ?? 0) * config.mempool.gasDefenseWeight
  const stealProbability = clamp01(
    (state.botStrength * config.mempool.botStrengthWeight +
      (card.competitionLevel ?? 0) * config.mempool.competitionWeight -
      gasDefense) *
      sensitivity.mempool *
      mechanics.stealProbabilityMultiplier *
      state.roleBuffs.stealProbabilityMultiplier,
  )
  const detectionChance = clamp01(config.mempool.detectionBase + stealProbability)
  const competitorDetected = sampled ? rng() < detectionChance : stealProbability > 0
  const baseGas = card.allocatedGas ?? card.gasCost ?? 0

  return {
    competitorDetected,
    competitorGasBid: competitorDetected ? competitorGasBidFor(state, baseGas, config) : 0,
    stealProbability: round(stealProbability, 4),
  }
}

function resolveCompetition(state, card, params, rng, config) {
  const calculated = state.competitors[card.id] ?? calculateCompetition(state, card, rng, config, false)
  if (params.competitorGasBid === undefined && params.competitorGasBidGwei === undefined) return calculated

  const competitorGasBid = clampInt(params.competitorGasBid ?? params.competitorGasBidGwei, 0)
  return {
    ...calculated,
    competitorDetected: competitorGasBid > 0,
    competitorGasBid,
    stealProbability: clamp01(params.stealProbability ?? calculated.stealProbability),
  }
}

export function calculateBroadcastSuccessProbability(state, card, gas, competition = {}, config = TOOL_SIMULATOR_CONFIG) {
  const sensitivity = sensitivityFor(card.type)
  const mechanics = mechanicsFor(card.type)
  const gasRatio = gas / Math.max(card.gasCost ?? gas, 1)
  let probability =
    config.broadcast.baseSuccessProbability +
    Math.min(gasRatio, 2) * config.broadcast.gasWeight * mechanics.gasSuccessWeight -
    (card.trueRisk ?? card.displayedRisk ?? 0) * config.broadcast.riskPenalty -
    state.botStrength * config.broadcast.botPressurePenalty

  if (mechanics.frontRunBidCheck && competition.competitorDetected) {
    const outbidCompetitor = gas >= competition.competitorGasBid
    competition.bidPosition = outbidCompetitor ? 'overbid' : 'underbid'
    probability += outbidCompetitor ? mechanics.frontRunOverbidBonus : -mechanics.frontRunUnderbidPenalty
  }

  return round(
    clamp(
      probability * sensitivity.broadcast,
      config.broadcast.minSuccessProbability,
      config.broadcast.maxSuccessProbability,
    ),
    4,
  )
}

function isHardTimeWindowExpired(card, params, mechanics) {
  if (!mechanics.hardTimeWindow) return false
  if (params.windowExpired === true) return true
  if (Number.isFinite(params.elapsedSec) && params.elapsedSec > (card.timeWindowSec ?? 0)) return true
  if (Number.isFinite(params.remainingTimeWindowSec) && params.remainingTimeWindowSec <= 0) return true
  return false
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

function spendFailureGas(state, card, gas, reason, config) {
  const gasLost = Math.min(state.gasPool, Math.ceil(gas * failureGasLossRate(config, card, reason)))
  state.gasPool = clampNumber(state.gasPool - gasLost, 0, Number.MAX_SAFE_INTEGER)
  state.gasUsed += gasLost
  card.gasUsed = (card.gasUsed ?? 0) + gasLost
  return gasLost
}

function failureGasLossRate(config, card, reason) {
  const mechanics = mechanicsFor(card.type)
  const baseRate = config.gas.failedGasLossRateByReason?.[reason] ?? config.gas.failedGasLossRate
  return clamp01(baseRate * (mechanics.failedGasLossMultiplier ?? 1))
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

function mechanicsFor(type) {
  return {
    ...DEFAULT_CARD_TYPE_MECHANICS,
    ...(CARD_TYPE_MECHANICS[type] ?? {}),
  }
}

function competitorGasBidFor(state, baseGas, config) {
  const multiplier = botMechanicValue(
    config,
    state.botName,
    'competitorBidMultiplier',
    config.mempool.competitorBidMultiplier,
  )
  const minLift = botMechanicValue(
    config,
    state.botName,
    'competitorBidMinLift',
    config.mempool.competitorBidMinLift,
  )
  return Math.ceil(baseGas * multiplier + minLift)
}

function botMechanicValue(config, botName, key, fallback) {
  return config.botMechanicOverrides?.[botName]?.[key] ?? fallback
}

function createForceStealConsumer(forceSteal) {
  if (typeof forceSteal === 'function') return () => forceSteal() === true

  let pending = forceSteal === true
  return () => {
    if (!pending) return false
    pending = false
    return true
  }
}

function snapshotState(state) {
  return {
    layer: state.layer,
    scene: state.scene,
    role: state.role,
    roleLevel: state.roleLevel,
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
