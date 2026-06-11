#!/usr/bin/env node

import { fileURLToPath } from 'node:url'

import { CARD_TYPES } from '../src/config/cards.js'
import { LAYER_CONFIG } from '../src/config/scenes.js'
import { ROLE_IDS } from '../src/config/roles.js'
import { WIN_LOSS_CONFIG } from '../src/config/winloss.js'
import { createBattlePlan, validateBattlePlan } from '../src/core/BattlePlan.js'
import { generateHand } from '../src/core/CardGenerator.js'
import { RuleDecider } from '../src/core/RuleDecider.js'
import { getBaseGasPoolForLayer, getRoleBuffs, nextRoleLevel } from '../src/core/RoleBuffs.js'
import { createRandomSource } from '../src/core/rng.js'
import { runSemiLoopExecution } from '../src/core/SemiLoopExecutor.js'

export const STRATEGY_NAMES = ['random', 'greedy', 'balanced', 'expert']
const DEFAULT_ROLE = ROLE_IDS.SCOUT
const ALL_ROLES = Object.values(ROLE_IDS)

export async function runBatchSimulation(options = {}) {
  if (options.fullRun || options.runs !== undefined) return runBatchGames(options)
  return runLayerSimulation(options)
}

export async function runLayerSimulation(options = {}) {
  const seed = options.seed ?? 42
  const rng = createRandomSource(seed)
  const layer = clampInt(options.layer ?? 8, 1, 20)
  const role = options.role ?? DEFAULT_ROLE
  const roleLevel = clampInt(options.roleLevel ?? 1, 1, 3)
  const scene = options.scene ?? chooseScene(layer, rng)
  const cards = options.cards ?? generateHand(scene, role, roleLevel, { rng })
  const gasPool = options.gasPool ?? gasPoolFor(layer, role, roleLevel)
  const strategy = normalizeStrategy(options.strategy ?? 'balanced')
  const strategyDecider = createStrategyDecider(strategy, { rng })
  const decision = strategyDecider.createBattlePlan(cards, {
    gasPool,
    maxCards: options.maxCards ?? maxCardsForLayer(layer, cards.length),
  })
  const result = await runSemiLoopExecution(
    decision.battlePlan,
    {
      gasPool,
      layer,
      scene,
      role,
      roleLevel,
    },
    {
      decider: options.decider ?? strategyDecider,
      fallbackDecider: options.fallbackDecider ?? RuleDecider,
      seed,
      maxReplans: options.maxReplans,
      botName: options.botName,
      simulatorFactory: options.simulatorFactory,
      config: options.config,
      toolConfig: options.toolConfig,
      forceSteal: options.forceSteal,
    },
  )

  return buildLayerReport({
    seed,
    strategy,
    role,
    roleLevel,
    layer,
    scene,
    gasPool,
    decision,
    result,
  })
}

export async function runFullGameSimulation(options = {}) {
  const seed = options.seed ?? 42
  const rng = createRandomSource(seed)
  const strategy = normalizeStrategy(options.strategy ?? 'balanced')
  let role = options.role ?? pickRole(rng)
  let roleLevel = clampInt(options.roleLevel ?? 1, 1, 3)
  let cumulativeProfit = 0
  let consecutiveLoss = 0
  const fromLayer = clampInt(options.fromLayer ?? 1, 1, 20)
  const toLayer = clampInt(options.toLayer ?? WIN_LOSS_CONFIG.victory.targetLayer, fromLayer, 20)
  const layers = []
  let outcome = 'in_progress'

  for (let layer = fromLayer; layer <= toLayer; layer += 1) {
    const layerSeed = `${seed}:layer:${layer}`
    const scene = options.scene ?? chooseScene(layer, rng)
    const layerResult = await runLayerSimulation({
      ...options,
      seed: layerSeed,
      layer,
      scene,
      role,
      roleLevel,
      strategy,
      gasPool: options.gasPool ?? gasPoolFor(layer, role, roleLevel),
    })
    layers.push(layerResult)

    cumulativeProfit = roundEth(cumulativeProfit + layerResult.summary.netProfit)
    if (layerResult.summary.netProfit < 0) {
      consecutiveLoss += 1
    } else if (layerResult.summary.netProfit > 0) {
      consecutiveLoss = 0
    }

    if (
      consecutiveLoss >= WIN_LOSS_CONFIG.failure.consecutiveLossThreshold &&
      cumulativeProfit < WIN_LOSS_CONFIG.failure.cumulativeProfitBelow
    ) {
      outcome = 'failed'
      break
    }

    if (layer === WIN_LOSS_CONFIG.victory.targetLayer && cumulativeProfit > WIN_LOSS_CONFIG.victory.cumulativeProfitGreaterThan) {
      outcome = 'victory'
      break
    }

    if (isBossLayer(layer)) roleLevel = nextRoleLevel(roleLevel)
  }

  if (outcome === 'in_progress') {
    outcome = toLayer >= WIN_LOSS_CONFIG.victory.targetLayer ? 'completed_no_victory' : 'completed_range'
  }

  return {
    status: 'ok',
    seed,
    strategy,
    role,
    roleLevel,
    outcome,
    layersCompleted: layers.length,
    finalLayer: layers.at(-1)?.layer ?? fromLayer,
    cumulativeProfit: roundEth(cumulativeProfit),
    consecutiveLoss,
    layers,
  }
}

export async function runBatchGames(options = {}) {
  const runs = clampInt(options.runs ?? 1, 1, 100000)
  const strategyList = normalizeStrategyList(options.strategies ?? options.strategy ?? 'balanced')
  const roleList = normalizeRoleList(options.roles ?? options.role ?? DEFAULT_ROLE)
  const games = []

  for (const strategy of strategyList) {
    for (const role of roleList) {
      for (let index = 0; index < runs; index += 1) {
        games.push(
          await runFullGameSimulation({
            ...options,
            fullRun: true,
            strategy,
            role,
            seed: `${options.seed ?? 42}:${strategy}:${role}:${index}`,
          }),
        )
      }
    }
  }

  const metrics = aggregateGames(games)
  return {
    status: 'ok',
    seed: options.seed ?? 42,
    runs,
    strategies: strategyList,
    roles: roleList,
    metrics,
    summaryText: formatSummary(metrics),
    games: options.summaryOnly ? undefined : games,
  }
}

export function createStrategyDecider(strategy = 'balanced', options = {}) {
  const normalizedStrategy = normalizeStrategy(strategy)
  const rng = options.rng ?? createRandomSource(options.seed ?? normalizedStrategy)

  return {
    strategy: normalizedStrategy,

    createBattlePlan(cards, context = {}) {
      const cardList = Array.isArray(cards) ? cards : []
      const gasPool = Math.max(0, Math.round(Number(context.gasPool) || 0))
      const maxCards = Math.max(0, Math.round(Number(context.maxCards ?? cardList.length) || 0))
      const selectedCards = selectCardsForStrategy(normalizedStrategy, cardList, gasPool, maxCards, rng)
      const gasAllocations = allocateGasForStrategy(normalizedStrategy, selectedCards, gasPool)
      const contingencies = Object.fromEntries(selectedCards.map((card) => [card.id, contingencyForStrategy(normalizedStrategy, card)]))
      const battlePlan = createBattlePlan({ selectedCards, gasAllocations, contingencies })
      return {
        battlePlan,
        validation: validateBattlePlan(battlePlan, { gasPool, maxCards }),
        reasoning: `${normalizedStrategy} strategy selected ${selectedCards.length} cards.`,
      }
    },

    async planInitial(input = {}) {
      const cards = input.cards ?? []
      return {
        reasoning: `${normalizedStrategy} strategy orders cards headlessly.`,
        executionOrder: orderForStrategy(normalizedStrategy, cards, rng).map((card) => card.id),
      }
    },

    decideOnIncident: RuleDecider.decideOnIncident,
    summarize: RuleDecider.summarize,
  }
}

function buildLayerReport({ seed, strategy, role, roleLevel, layer, scene, gasPool, decision, result }) {
  const finalState = result.finalState ?? {
    layer,
    scene,
    role,
    roleLevel,
    gasPool,
    gasUsed: result.gasUsed ?? 0,
    cards: [],
    competitors: {},
  }
  const telemetry = result.telemetry ?? {
    replans: 0,
    fallbackReplans: 0,
    deciderCalls: { planInitial: 0, decideOnIncident: 0, summarize: 0 },
  }
  const cardTypeStats = collectCardTypeStats(result.cards, result.executionLog)
  const terminalFailureReasons = collectTerminalFailureReasons(result.executionLog)
  return {
    status: 'ok',
    seed,
    strategy,
    role,
    roleLevel,
    layer,
    scene,
    battlePlan: {
      selectedCardIds: decision.battlePlan.selectedCards.map((card) => card.id),
      gasAllocations: decision.battlePlan.gasAllocations,
      contingencies: decision.battlePlan.contingencies,
      valid: decision.validation.valid,
    },
    summary: {
      cards: result.cards.length,
      successes: result.cards.filter((card) => card.status === 'success').length,
      failures: result.cards.filter((card) => card.status === 'failed').length,
      abandoned: result.cards.filter((card) => card.status === 'abandoned').length,
      gasUsed: result.gasUsed,
      remainingGasPool: finalState.gasPool,
      initialGasPool: gasPool,
      netProfit: result.netProfit,
      incidents: result.incidents.length,
      replans: telemetry.replans,
      fallbackReplans: telemetry.fallbackReplans,
      halfLoopTriggered: result.incidents.length > 0,
      cardTypeStats,
      terminalFailureReasons,
    },
    incidents: result.incidents,
    telemetry,
    executionLog: result.executionLog,
    finalState,
  }
}

function aggregateGames(games) {
  const byStrategy = Object.fromEntries(STRATEGY_NAMES.map((name) => [name, emptyAggregate()]))
  const byRole = Object.fromEntries(ALL_ROLES.map((name) => [name, emptyAggregate()]))
  const layerCheckpoints = {}
  const failureReasons = {}
  const terminalFailureReasons = {}
  const cardTypes = Object.fromEntries(CARD_TYPES.map((type) => [type, emptyCardAggregate()]))
  const profitCurve = Array.from({ length: 20 }, (_, index) => ({ layer: index + 1, samples: 0, cumulativeProfit: 0 }))
  let totalLayerRuns = 0
  let halfLoopTriggers = 0
  let incidents = 0
  let gasUsed = 0
  let gasPool = 0

  for (const game of games) {
    updateAggregate(byStrategy[game.strategy], game)
    updateAggregate(byRole[game.role], game)

    for (const layer of game.layers) {
      totalLayerRuns += 1
      halfLoopTriggers += layer.summary.halfLoopTriggered ? 1 : 0
      incidents += layer.summary.incidents
      gasUsed += layer.summary.gasUsed
      gasPool += layer.summary.initialGasPool
      layerCheckpoints[layer.layer] = layerCheckpoints[layer.layer] ?? { reached: 0, failed: 0, samples: 0 }
      layerCheckpoints[layer.layer].samples += 1
      layerCheckpoints[layer.layer].reached += 1
      if (layer.summary.netProfit < 0) layerCheckpoints[layer.layer].failed += 1
      profitCurve[layer.layer - 1].samples += 1
      profitCurve[layer.layer - 1].cumulativeProfit += game.layers
        .filter((item) => item.layer <= layer.layer)
        .reduce((sum, item) => sum + item.summary.netProfit, 0)

      for (const [type, stats] of Object.entries(layer.summary.cardTypeStats)) {
        const target = cardTypes[type] ?? (cardTypes[type] = emptyCardAggregate())
        target.used += stats.used
        target.successes += stats.successes
        target.stolen += stats.stolen
        target.netProfit += stats.netProfit
      }

      for (const incident of layer.incidents) {
        const reason = incident.event ?? incident.trigger?.type ?? 'unknown'
        failureReasons[reason] = (failureReasons[reason] ?? 0) + 1
      }
      for (const [reason, count] of Object.entries(layer.summary.terminalFailureReasons)) {
        terminalFailureReasons[reason] = (terminalFailureReasons[reason] ?? 0) + count
      }
    }
  }

  return {
    totalGames: games.length,
    passRate: ratio(games.filter(isPassingOutcome).length, games.length),
    byStrategy: finalizeAggregateMap(byStrategy),
    byRole: finalizeAggregateMap(byRole),
    roleWinRateSpread: spread(Object.values(finalizeAggregateMap(byRole)).map((item) => item.passRate)),
    layerCheckpointRates: Object.fromEntries(
      Object.entries(layerCheckpoints).map(([layer, item]) => [
        layer,
        {
          reachedRate: ratio(item.reached, games.length),
          negativeProfitRate: ratio(item.failed, item.samples),
        },
      ]),
    ),
    failureReasons,
    terminalFailureReasons,
    cardTypes: finalizeCardTypes(cardTypes),
    gasHealth: {
      averageGasUsedRate: ratio(gasUsed, gasPool),
    },
    halfLoopTriggerRate: ratio(halfLoopTriggers, totalLayerRuns),
    averageHalfLoopTriggersPerGame: ratio(incidents, games.length),
    cumulativeProfitCurve: profitCurve.map((item) => ({
      layer: item.layer,
      averageCumulativeProfit: roundEth(ratio(item.cumulativeProfit, item.samples, 0)),
    })),
  }
}

function updateAggregate(target, game) {
  target.games += 1
  target.passes += isPassingOutcome(game) ? 1 : 0
  target.layers += game.layersCompleted
  target.netProfit += game.cumulativeProfit
}

function isPassingOutcome(game) {
  return game.outcome === 'victory' || game.outcome === 'completed_range'
}

function finalizeAggregateMap(map) {
  return Object.fromEntries(Object.entries(map).map(([key, value]) => [key, finalizeAggregate(value)]))
}

function finalizeAggregate(value) {
  return {
    games: value.games,
    passRate: ratio(value.passes, value.games),
    averageLayersCompleted: ratio(value.layers, value.games, 0),
    averageNetProfit: roundEth(ratio(value.netProfit, value.games, 0)),
  }
}

function finalizeCardTypes(map) {
  return Object.fromEntries(
    Object.entries(map).map(([type, value]) => [
      type,
      {
        used: value.used,
        successes: value.successes,
        stolen: value.stolen,
        netProfit: roundEth(value.netProfit),
        useRate: ratio(value.used, Object.values(map).reduce((sum, item) => sum + item.used, 0)),
        winRate: ratio(value.successes, value.used),
        stolenRate: ratio(value.stolen, value.used),
        averageNetProfit: roundEth(ratio(value.netProfit, value.used, 0)),
      },
    ]),
  )
}

function collectCardTypeStats(cards, executionLog = []) {
  const stats = Object.fromEntries(CARD_TYPES.map((type) => [type, emptyCardAggregate()]))
  const cardTypeById = new Map(cards.map((card) => [card.id, card.type]))
  for (const card of cards) {
    const item = stats[card.type] ?? (stats[card.type] = emptyCardAggregate())
    item.used += 1
    item.successes += card.status === 'success' ? 1 : 0
    item.netProfit += card.actualProfit ?? 0
  }
  for (const entry of executionLog) {
    if (entry.output?.stolen !== true) continue
    const type = cardTypeById.get(entry.cardId)
    if (!type) continue
    const item = stats[type] ?? (stats[type] = emptyCardAggregate())
    item.stolen += 1
  }
  return finalizeCardTypes(stats)
}

function collectTerminalFailureReasons(executionLog = []) {
  const reasons = {}
  for (const entry of executionLog) {
    if (entry.action !== 'broadcast_tx' || entry.output?.success !== false) continue
    const reason = terminalFailureReason(entry.output)
    reasons[reason] = (reasons[reason] ?? 0) + 1
  }
  return reasons
}

function terminalFailureReason(output = {}) {
  if (output.stolen === true) return 'target_stolen'
  if (output.invalidOpportunity === true) return 'invalid_opportunity'
  if (output.windowExpired === true) return 'window_expired'
  return 'tx_failed'
}

function emptyAggregate() {
  return { games: 0, passes: 0, layers: 0, netProfit: 0 }
}

function emptyCardAggregate() {
  return { used: 0, successes: 0, stolen: 0, netProfit: 0 }
}

function selectCardsForStrategy(strategy, cards, gasPool, maxCards, rng) {
  const candidates = orderForStrategy(strategy, cards, rng)
  const selected = []
  let reservedGas = 0
  const strategyMaxCards =
    strategy === 'random'
      ? Math.min(maxCards, 1 + Math.floor(rng() * 2))
      : strategy === 'greedy'
        ? Math.min(maxCards, rng() < 0.25 ? 2 : 1)
        : maxCards

  for (const card of candidates) {
    if (selected.length >= strategyMaxCards) break
    const minimumGas = Math.max(0, Math.round(card.gasCost ?? 0))
    if (reservedGas + minimumGas > gasPool) continue
    if (strategy === 'random' && rng() < 0.25) continue
    selected.push(card)
    reservedGas += minimumGas
  }

  return selected
}

function allocateGasForStrategy(strategy, cards, gasPool) {
  if (cards.length === 0) return {}
  const allocations = Object.fromEntries(cards.map((card) => [card.id, Math.max(0, Math.round(card.gasCost ?? 0))]))
  const spendableGasPool = Math.max(0, Math.floor(gasPool * gasBudgetMultiplierForStrategy(strategy)))
  let remainingGas = spendableGasPool - Object.values(allocations).reduce((sum, gas) => sum + gas, 0)
  if (remainingGas <= 0) return allocations

  const weights = Object.fromEntries(cards.map((card) => [card.id, allocationWeight(strategy, card)]))
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0)
  for (const card of cards) {
    const share = card === cards.at(-1) ? remainingGas : Math.floor((remainingGas * weights[card.id]) / Math.max(totalWeight, 1))
    allocations[card.id] += Math.max(0, share)
    remainingGas -= Math.max(0, share)
  }
  return allocations
}

function allocationWeight(strategy, card) {
  if (strategy === 'random') return 1
  if (strategy === 'greedy') return Math.max(1, card.expectedProfit ?? 1)
  if (strategy === 'expert') return Math.max(1, expectedValue(card) * 2 + safetyScore(card))
  return Math.max(1, expectedValue(card) + safetyScore(card))
}

function gasBudgetMultiplierForStrategy(strategy) {
  if (strategy === 'random') return 0.45
  if (strategy === 'greedy') return 0.45
  if (strategy === 'balanced') return 0.55
  return 1
}

function contingencyForStrategy(strategy, card) {
  if (strategy === 'random') return ['fight', 'transfer', 'abandon'][Math.abs(hashCode(card.id)) % 3]
  if (strategy === 'greedy') return 'fight'
  if (strategy === 'expert') {
    if ((card.trueRisk ?? card.displayedRisk ?? 0) > 0.72) return 'abandon'
    if ((card.trueRisk ?? card.displayedRisk ?? 0) <= 0.55) return 'fight'
    if (card.type === 'front_run' || card.type === 'sandwich') return 'fight'
    return 'transfer'
  }
  if ((card.displayedRisk ?? card.trueRisk ?? 0) > 0.65) return 'transfer'
  return card.type === 'front_run' || card.type === 'sandwich' ? 'fight' : 'transfer'
}

function orderForStrategy(strategy, cards, rng) {
  const copy = [...cards]
  if (strategy === 'random') return shuffle(copy, rng)
  if (strategy === 'greedy') return copy.sort((a, b) => (b.expectedProfit ?? 0) - (a.expectedProfit ?? 0))
  if (strategy === 'expert') return copy.sort((a, b) => expertValue(b) - expertValue(a))
  return copy.sort((a, b) => expectedValue(b) - expectedValue(a))
}

function expectedValue(card) {
  return (card.expectedProfit ?? 0) * (1 - (card.displayedRisk ?? card.trueRisk ?? 0)) - (card.gasCost ?? 0) * 0.001
}

function expertValue(card) {
  return (card.expectedProfit ?? 0) * (1 - (card.trueRisk ?? card.displayedRisk ?? 0)) - (card.gasCost ?? 0) * 0.001
}

function safetyScore(card) {
  return Math.max(0, 1 - (card.trueRisk ?? card.displayedRisk ?? 0))
}

function chooseScene(layer, rng) {
  const layerConfig = LAYER_CONFIG[layer] ?? LAYER_CONFIG[20]
  const scenes = layerConfig.scenes ?? [layerConfig.scene]
  return scenes[Math.floor(rng() * scenes.length)] ?? 'dex_arb'
}

function maxCardsForLayer(layer, fallback) {
  if (layer <= 2) return Math.min(fallback, layer)
  if (layer <= 8) return Math.min(fallback, 3)
  if (layer <= 16) return Math.min(fallback, 4)
  return Math.min(fallback, 5)
}

function gasPoolFor(layer, role, roleLevel) {
  const buffs = getRoleBuffs(role, roleLevel)
  return Math.round(getBaseGasPoolForLayer(layer) * buffs.gasPoolMultiplier)
}

function isBossLayer(layer) {
  return Boolean((LAYER_CONFIG[layer] ?? LAYER_CONFIG[20]).isBoss)
}

function pickRole(rng) {
  return ALL_ROLES[Math.floor(rng() * ALL_ROLES.length)] ?? DEFAULT_ROLE
}

function normalizeStrategy(strategy) {
  return STRATEGY_NAMES.includes(strategy) ? strategy : 'balanced'
}

function normalizeStrategyList(value) {
  const list = value === 'all' ? STRATEGY_NAMES : Array.isArray(value) ? value : String(value).split(',')
  return [...new Set(list.map((item) => normalizeStrategy(item.trim?.() ?? item)))]
}

function normalizeRoleList(value) {
  if (value === 'all') return ALL_ROLES
  const list = Array.isArray(value) ? value : String(value).split(',')
  return [...new Set(list.map((item) => (ALL_ROLES.includes(item.trim?.() ?? item) ? item.trim?.() ?? item : DEFAULT_ROLE)))]
}

function parseArgs(argv) {
  const options = {}
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index]
    const [rawKey, inlineValue] = item.startsWith('--') ? item.slice(2).split('=') : [null, null]
    if (!rawKey) continue
    const value = inlineValue ?? (argv[index + 1]?.startsWith('--') ? true : argv[++index])
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    options[key] = value
  }
  if (options.runs !== undefined) options.runs = Number(options.runs)
  if (options.layer !== undefined) options.layer = Number(options.layer)
  if (options.roleLevel !== undefined) options.roleLevel = Number(options.roleLevel)
  if (options.fromLayer !== undefined) options.fromLayer = Number(options.fromLayer)
  if (options.toLayer !== undefined) options.toLayer = Number(options.toLayer)
  if (options.fullRun === 'true' || options.fullRun === true) options.fullRun = true
  if (options.summaryOnly === 'true' || options.summaryOnly === true) options.summaryOnly = true
  if (options.strategies) options.strategies = options.strategies
  if (options.roles) options.roles = options.roles
  return options
}

function formatSummary(metrics) {
  return [
    `games=${metrics.totalGames}`,
    `passRate=${formatPercent(metrics.passRate)}`,
    `roleWinRateSpread=${formatPercent(metrics.roleWinRateSpread)}`,
    `halfLoopTriggerRate=${formatPercent(metrics.halfLoopTriggerRate)}`,
    `halfLoopTriggersPerGame=${metrics.averageHalfLoopTriggersPerGame}`,
    `averageGasUsedRate=${formatPercent(metrics.gasHealth.averageGasUsedRate)}`,
  ].join(' | ')
}

function formatPercent(value) {
  return `${Math.round((value ?? 0) * 1000) / 10}%`
}

function shuffle(cards, rng) {
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1))
    ;[cards[index], cards[swapIndex]] = [cards[swapIndex], cards[index]]
  }
  return cards
}

function spread(values) {
  const finite = values.filter((value) => Number.isFinite(value))
  if (finite.length === 0) return 0
  return Math.max(...finite) - Math.min(...finite)
}

function ratio(numerator, denominator, fallback = 0) {
  return denominator > 0 ? round(numerator / denominator, 4) : fallback
}

function round(value, places = 4) {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function roundEth(value) {
  return Math.round(value * 1000) / 1000
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(Number(value) || 0)))
}

function hashCode(value) {
  return [...String(value)].reduce((hash, char) => Math.imul(31, hash) + char.charCodeAt(0), 0)
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const options = parseArgs(process.argv)
  const result = await runBatchSimulation({
    fullRun: options.fullRun ?? options.runs !== undefined,
    ...options,
  })
  console.log(JSON.stringify(result, null, 2))
}
