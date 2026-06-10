#!/usr/bin/env node

import { fileURLToPath } from 'node:url'

import { RuleDecider } from '../src/core/RuleDecider.js'
import { runSemiLoopExecution } from '../src/core/SemiLoopExecutor.js'

export async function runBatchSimulation(options = {}) {
  const seed = options.seed ?? 42
  const cards = options.cards ?? createSampleCards()
  const gasPool = options.gasPool ?? 180
  const role = options.role ?? null
  const roleLevel = options.roleLevel ?? 1
  const decision = RuleDecider.createBattlePlan(cards, {
    gasPool,
    maxCards: options.maxCards ?? cards.length,
  })
  const result = await runSemiLoopExecution(
    decision.battlePlan,
    {
      gasPool,
      layer: options.layer ?? 8,
      scene: options.scene ?? 'nft_market',
      role,
      roleLevel,
    },
    {
      decider: options.decider ?? RuleDecider,
      fallbackDecider: options.fallbackDecider ?? RuleDecider,
      seed,
      maxReplans: options.maxReplans,
      botName: options.botName,
      simulatorFactory: options.simulatorFactory,
      config: options.config,
    },
  )

  return {
    status: 'ok',
    seed,
    role,
    roleLevel,
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
      remainingGasPool: result.finalState.gasPool,
      netProfit: result.netProfit,
      incidents: result.incidents.length,
      replans: result.telemetry.replans,
      fallbackReplans: result.telemetry.fallbackReplans,
    },
    incidents: result.incidents,
    telemetry: result.telemetry,
    executionLog: result.executionLog,
    finalState: result.finalState,
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await runBatchSimulation({ seed: parseSeedArg(process.argv) })
  console.log(JSON.stringify(result, null, 2))
}

function createSampleCards() {
  return [
    {
      id: 'arbitrage_A',
      type: 'arbitrage',
      rarity: 'rare',
      expectedProfit: 1.2,
      displayedRisk: 0.28,
      trueRisk: 0.32,
      gasCost: 45,
      timeWindowSec: 30,
      competitionLevel: 2,
      status: 'pending',
      actualProfit: 0,
    },
    {
      id: 'front_run_B',
      type: 'front_run',
      rarity: 'epic',
      expectedProfit: 2.1,
      displayedRisk: 0.45,
      trueRisk: 0.5,
      gasCost: 70,
      timeWindowSec: 22,
      competitionLevel: 3,
      status: 'pending',
      actualProfit: 0,
    },
  ]
}

function parseSeedArg(argv) {
  const seedFlagIndex = argv.findIndex((item) => item === '--seed')
  if (seedFlagIndex >= 0 && argv[seedFlagIndex + 1]) return argv[seedFlagIndex + 1]

  const inlineSeed = argv.find((item) => item.startsWith('--seed='))
  if (inlineSeed) return inlineSeed.slice('--seed='.length)

  return 42
}
