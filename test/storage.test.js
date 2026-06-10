import test from 'node:test'
import assert from 'node:assert/strict'

import { GameState } from '../src/core/GameState.js'
import { createMemoryStorage } from '../src/core/storage.js'

test('memory storage adapter implements the persistence interface', () => {
  const storage = createMemoryStorage()

  storage.setItem('key', 'value')
  assert.equal(storage.getItem('key'), 'value')

  storage.removeItem('key')
  assert.equal(storage.getItem('key'), null)
})

test('GameState can initialize with injected memory storage in Node', () => {
  const storage = createMemoryStorage({
    agent_rush_v1: JSON.stringify({
      schemaVersion: 1,
      unlockedAgents: ['searcher', 'executor'],
      agentLevels: { executor: 2 },
      tutorialSeen: true,
      seenBots: ['Phantom'],
    }),
  })

  GameState.init({ storage })

  assert.equal(GameState.tutorialSeen, true)
  assert.equal(GameState.agentLevels.executor, 2)
  assert.equal(GameState.unlockedAgents.includes('executor'), true)
  assert.equal(GameState.hasSeenBot('Phantom'), true)
})
