#!/usr/bin/env node

import { fileURLToPath } from 'node:url'

import { RuleDecider } from '../src/core/RuleDecider.js'
import { createToolSimulator } from '../src/core/ToolSimulator.js'

export function runBatchSimulation(options = {}) {
  const seed = options.seed ?? 42
  const cards = options.cards ?? createSampleCards()
  const decision = RuleDecider.createBattlePlan(cards, {
    gasPool: options.gasPool ?? 180,
    maxCards: options.maxCards ?? cards.length,
  })
  const selectedCards = decision.battlePlan.selectedCards
  const simulator = createToolSimulator({
    seed,
    cards: selectedCards,
    gasPool: options.gasPool ?? 180,
    layer: options.layer ?? 8,
    allocations: Object.entries(decision.battlePlan.gasAllocations).map(([cardId, gas]) => ({ cardId, gas })),
  })

  const toolResults = []
  for (const card of selectedCards) {
    toolResults.push(simulator.execute('fetch_prices', { cardId: card.id }))
    toolResults.push(simulator.execute('monitor_mempool', { cardId: card.id }))
    toolResults.push(simulator.execute('broadcast_tx', { cardId: card.id, gas: decision.battlePlan.gasAllocations[card.id] }))
  }

  const snapshot = simulator.snapshot()
  return {
    status: 'ok',
    seed,
    battlePlan: {
      selectedCardIds: selectedCards.map((card) => card.id),
      gasAllocations: decision.battlePlan.gasAllocations,
      contingencies: decision.battlePlan.contingencies,
      valid: decision.validation.valid,
    },
    summary: {
      cards: snapshot.cards.length,
      successes: snapshot.cards.filter((card) => card.status === 'success').length,
      failures: snapshot.cards.filter((card) => card.status === 'failed').length,
      abandoned: snapshot.cards.filter((card) => card.status === 'abandoned').length,
      gasUsed: snapshot.gasUsed,
      remainingGasPool: snapshot.gasPool,
      netProfit: round(snapshot.cards.reduce((sum, card) => sum + (card.actualProfit ?? 0), 0)),
    },
    toolResults,
    finalState: snapshot,
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = runBatchSimulation({ seed: parseSeedArg(process.argv) })
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

function round(value) {
  return Math.round(value * 1000) / 1000
}
