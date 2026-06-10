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
  assert.equal(GameState.hasSeenBot('Phantom'), false)
})

test('GameState stores and loads role progress with schema 2', () => {
  const storage = createMemoryStorage()
  GameState.init({ storage })
  GameState.setRole(ROLE_IDS.RESIST)
  GameState.roleLevel = 2
  GameState.markBotSeen('Phantom')
  GameState.saveProgress()

  GameState.init({ storage })

  assert.equal(GameState.role, ROLE_IDS.RESIST)
  assert.equal(GameState.roleLevel, 2)
  assert.equal(GameState.hasSeenBot('Phantom'), true)
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
