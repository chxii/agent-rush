import test from 'node:test'
import assert from 'node:assert/strict'

import { generateHand } from '../src/core/CardGenerator.js'
import { ROLE_IDS } from '../src/config/roles.js'
import { EnemyBotAI } from '../src/core/EnemyBotAI.js'
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

test('enemy bot competition uses injected RNG', () => {
  const card = { type: 'front_run', competitionLevel: 3 }
  const gameState = {
    currentLayer: 8,
    genesisHistory: { boostedType: null },
  }

  const stolen = EnemyBotAI.compete(card, gameState, { rng: createSequenceRng([0]) })
  const escaped = EnemyBotAI.compete(card, gameState, { rng: createSequenceRng([0.999]) })

  assert.equal(stolen.stolen, true)
  assert.equal(escaped.stolen, false)
})
