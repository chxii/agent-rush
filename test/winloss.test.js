import test from 'node:test'
import assert from 'node:assert/strict'

import { GameState } from '../src/core/GameState.js'
import { calculateWinLossProgress } from '../src/core/WinLoss.js'
import { ProgressionEngine } from '../src/game/ProgressionEngine.js'
import { OverlayManager } from '../src/ui/OverlayManager.js'

const TEST_CONFIG = {
  victory: {
    targetLayer: 3,
    cumulativeProfitGreaterThan: 5,
  },
  failure: {
    consecutiveLossThreshold: 3,
    cumulativeProfitBelow: -2,
  },
}

test('victory uses configured layer and strict profit boundary', () => {
  assert.equal(state({ currentLayer: 3, cumulativeProfit: 5 }).checkVictory(TEST_CONFIG), false)
  assert.equal(state({ currentLayer: 2, cumulativeProfit: 5.1 }).checkVictory(TEST_CONFIG), false)
  assert.equal(state({ currentLayer: 3, cumulativeProfit: 5.1 }).checkVictory(TEST_CONFIG), true)
})

test('failure uses configured loss streak and strict profit boundary', () => {
  assert.equal(state({ consecutiveLoss: 3, cumulativeProfit: -2 }).checkFailure(TEST_CONFIG), false)
  assert.equal(state({ consecutiveLoss: 2, cumulativeProfit: -2.1 }).checkFailure(TEST_CONFIG), false)
  assert.equal(state({ consecutiveLoss: 3, cumulativeProfit: -2.1 }).checkFailure(TEST_CONFIG), true)
})

test('applyRoundResult only clears loss streak on positive profit', () => {
  const gameState = state({ cumulativeProfit: -1, consecutiveLoss: 2 })

  gameState.applyRoundResult(0)
  assert.equal(gameState.cumulativeProfit, -1)
  assert.equal(gameState.consecutiveLoss, 2)

  gameState.applyRoundResult(0.25)
  assert.equal(gameState.cumulativeProfit, -0.75)
  assert.equal(gameState.consecutiveLoss, 0)

  gameState.applyRoundResult(-0.1)
  assert.equal(gameState.cumulativeProfit, -0.85)
  assert.equal(gameState.consecutiveLoss, 1)
})

test('calculateWinLossProgress returns victory and failure distances from config', () => {
  const progress = calculateWinLossProgress(
    {
      currentLayer: 2,
      cumulativeProfit: 1.25,
      consecutiveLoss: 1,
    },
    TEST_CONFIG,
  )

  assert.equal(progress.cumulativeProfit, 1.25)
  assert.equal(progress.victory.targetLayer, 3)
  assert.equal(progress.victory.profitLine, 5)
  assert.equal(progress.victory.profitRemaining, 3.75)
  assert.equal(progress.victory.layersRemaining, 1)
  assert.equal(progress.failure.consecutiveLoss, 1)
  assert.equal(progress.failure.consecutiveLossThreshold, 3)
  assert.equal(progress.failure.lossesRemaining, 2)
  assert.equal(progress.failure.profitLine, -2)
  assert.equal(progress.failure.profitBuffer, 3.25)
})

test('ProgressionEngine checks victory after applying round profit', () => {
  const originalVictory = OverlayManager.showVictory
  const originalGameOver = OverlayManager.showGameOver
  let finalStats = null

  OverlayManager.showVictory = (stats) => {
    finalStats = stats
  }
  OverlayManager.showGameOver = () => {
    throw new Error('failure should not trigger')
  }

  try {
    const gameState = state({ currentLayer: 20, cumulativeProfit: 9.9, consecutiveLoss: 0 })
    ProgressionEngine.afterRound({ netProfit: 0.2, cards: [] }, gameState)

    assert.equal(finalStats.cumulativeProfit, 10.1)
    assert.equal(finalStats.currentLayer, 20)
  } finally {
    OverlayManager.showVictory = originalVictory
    OverlayManager.showGameOver = originalGameOver
  }
})

test('ProgressionEngine checks failure after applying round loss', () => {
  const originalVictory = OverlayManager.showVictory
  const originalGameOver = OverlayManager.showGameOver
  let finalStats = null

  OverlayManager.showVictory = () => {
    throw new Error('victory should not trigger')
  }
  OverlayManager.showGameOver = (stats) => {
    finalStats = stats
  }

  try {
    const gameState = state({ currentLayer: 5, cumulativeProfit: -0.4, consecutiveLoss: 1 })
    ProgressionEngine.afterRound({ netProfit: -0.2, cards: [] }, gameState)

    assert.equal(finalStats.cumulativeProfit, -0.6)
    assert.equal(finalStats.consecutiveLoss, 2)
  } finally {
    OverlayManager.showVictory = originalVictory
    OverlayManager.showGameOver = originalGameOver
  }
})

function state(overrides = {}) {
  return Object.assign(Object.create(GameState), {
    currentLayer: 1,
    cumulativeProfit: 0,
    consecutiveLoss: 0,
    ...overrides,
  })
}
