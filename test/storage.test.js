import test from 'node:test'
import assert from 'node:assert/strict'

import { ROLE_IDS } from '../src/config/roles.js'
import { GameState } from '../src/core/GameState.js'
import { createMemoryStorage } from '../src/core/storage.js'

const LEGACY_UNLOCKED_KEY = `unlocked${'Agents'}`
const LEGACY_LEVELS_KEY = `agent${'Levels'}`

test('memory storage adapter implements the persistence interface', () => {
  const storage = createMemoryStorage()

  storage.setItem('key', 'value')
  assert.equal(storage.getItem('key'), 'value')

  storage.removeItem('key')
  assert.equal(storage.getItem('key'), null)
})

test('GameState resets old agent roster saves instead of migrating them', () => {
  const storage = createMemoryStorage({
    agent_rush_v1: JSON.stringify({
      schemaVersion: 1,
      [LEGACY_UNLOCKED_KEY]: ['searcher', 'executor'],
      [LEGACY_LEVELS_KEY]: { executor: 2 },
      tutorialSeen: true,
      seenBots: ['Phantom'],
    }),
  })

  GameState.init({ storage })

  assert.equal(GameState.role, null)
  assert.equal(GameState.roleLevel, 1)
  assert.equal(GameState.tutorialSeen, false)
  assert.equal('seenBots' in GameState, false)
  assert.equal('hasSeenBot' in GameState, false)
  assert.equal('markBotSeen' in GameState, false)
})

test('GameState starts a new run while preserving tutorial guide progress only', () => {
  const storage = createMemoryStorage()
  GameState.init({ storage })
  GameState.setRole(ROLE_IDS.RESIST)
  GameState.roleLevel = 2
  GameState.markTutorialSeen()
  GameState.saveProgress()

  GameState.init({ storage })

  assert.equal(GameState.role, null)
  assert.equal(GameState.roleLevel, 1)
  assert.equal(GameState.currentLayer, 1)
  assert.equal(GameState.cumulativeProfit, 0)
  assert.equal(GameState.tutorialSeen, true)
  assert.equal('seenBots' in GameState, false)
})

test('GameState persists sanitized terminal display id with guide progress', () => {
  const storage = createMemoryStorage()
  GameState.init({ storage })

  assert.equal(GameState.setDisplayId('  alpha<script>_unit-123456789  '), 'alphascript_unit')
  GameState.markTutorialSeen()

  GameState.init({ storage })

  assert.equal(GameState.displayId, 'alphascript_unit')
  assert.equal(GameState.tutorialSeen, true)
})

test('GameState role upgrades cap at configured max level', () => {
  const storage = createMemoryStorage()
  GameState.init({ storage })
  GameState.setRole(ROLE_IDS.SCOUT)

  GameState.upgradeRole()
  GameState.upgradeRole()
  GameState.upgradeRole()
  GameState.upgradeRole()

  assert.equal(GameState.roleLevel, 3)
})
