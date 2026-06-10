import test from 'node:test'
import assert from 'node:assert/strict'

import { generateHand } from '../src/core/CardGenerator.js'
import { ROLE_IDS } from '../src/config/roles.js'
import { createToolSimulator } from '../src/core/ToolSimulator.js'
import { createSeededRng, createSequenceRng } from '../src/core/rng.js'

test('card generation is reproducible with an injected seed', () => {
  const first = generateHand('dex_arb', ROLE_IDS.SCOUT, 2, {
    rng: createSeededRng('hand-seed'),
  })
  const second = generateHand('dex_arb', ROLE_IDS.SCOUT, 2, {
    rng: createSeededRng('hand-seed'),
  })

  assert.deepEqual(first, second)
})

test('tool simulator mempool competition uses injected RNG', () => {
  const detected = createCompetitionSimulator(createSequenceRng([0])).execute('monitor_mempool', {
    cardId: 'front_run_card',
  })
  const missed = createCompetitionSimulator(createSequenceRng([0.999])).execute('monitor_mempool', {
    cardId: 'front_run_card',
  })

  assert.equal(detected.competitorDetected, true)
  assert.equal(missed.competitorDetected, false)
})

function createCompetitionSimulator(rng) {
  return createToolSimulator({
    cards: [
      {
        id: 'front_run_card',
        type: 'front_run',
        rarity: 'rare',
        expectedProfit: 1,
        displayedRisk: 0.2,
        trueRisk: 0.2,
        gasCost: 40,
        allocatedGas: 40,
        timeWindowSec: 30,
        competitionLevel: 3,
        status: 'pending',
        actualProfit: 0,
      },
    ],
    gasPool: 120,
    botName: 'Phantom',
    rng,
  })
}
