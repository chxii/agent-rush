import test from 'node:test'
import assert from 'node:assert/strict'

import { CARD_TYPES, COMPETITION_BY_RARITY, RARITY } from '../src/config/cards.js'
import { LAYER_CONFIG } from '../src/config/scenes.js'
import { __testUpdatePipelineStateForCard, buildTutorialFeedback } from '../src/ui/UIRenderer.js'

test('card config can be imported in Node and has the expected shape', () => {
  assert.ok(Array.isArray(CARD_TYPES))
  assert.ok(CARD_TYPES.length > 0)
  assert.ok(CARD_TYPES.every((type) => typeof type === 'string' && type.length > 0))

  for (const [rarity, config] of Object.entries(RARITY)) {
    assert.equal(typeof config.weight, 'number', `${rarity}.weight`)
    assert.ok(Array.isArray(config.profitRange), `${rarity}.profitRange`)
    assert.ok(Array.isArray(config.gasRange), `${rarity}.gasRange`)
    assert.ok(Array.isArray(config.riskRange), `${rarity}.riskRange`)
    assert.equal(config.profitRange.length, 2, `${rarity}.profitRange length`)
    assert.equal(config.gasRange.length, 2, `${rarity}.gasRange length`)
    assert.equal(config.riskRange.length, 2, `${rarity}.riskRange length`)
  }

  assert.deepEqual(Object.keys(COMPETITION_BY_RARITY).sort(), Object.keys(RARITY).sort())
})

test('tutorial layers use fixed cards that cover all card types plus a scam example', () => {
  const tutorialCards = [1, 2, 3].flatMap((layer) => LAYER_CONFIG[layer].tutorialCards ?? [])
  const types = new Set(tutorialCards.map((card) => card.type))

  for (const type of CARD_TYPES) assert.equal(types.has(type), true, `${type} tutorial coverage`)
  assert.equal(tutorialCards.some((card) => card.isScam && card.trueRisk > card.displayedRisk), true)
  assert.equal(LAYER_CONFIG[4].isTutorial, false)
})

test('tutorial feedback computes card metrics without shadowing the EV helper', () => {
  const cards = LAYER_CONFIG[1].tutorialCards
  assert.doesNotThrow(() => {
    const feedback = buildTutorialFeedback({
      layer: 1,
      cards,
      selectedCards: [cards[0]],
      gasAllocations: { [cards[0].id]: cards[0].gasCost + 5 },
    })

    assert.equal(feedback.cards.length, cards.length)
    assert.equal(feedback.stepIndex, undefined)
    assert.equal(typeof feedback.cards[0].successProbability, 'number')
    assert.equal(typeof feedback.cards[0].expectedValue, 'number')
    assert.equal(feedback.cards[0].cardId, cards[0].id)
  })
})

test('tutorial layer 2 shows all five card types while keeping sandwich recommended', () => {
  const cards = LAYER_CONFIG[2].tutorialCards
  const types = new Set(cards.map((card) => card.type))

  for (const type of CARD_TYPES) assert.equal(types.has(type), true, `${type} tutorial layer 2 coverage`)

  const feedback = buildTutorialFeedback({
    layer: 2,
    cards,
    selectedCards: cards,
    gasAllocations: Object.fromEntries(cards.map((card) => [card.id, card.gasCost])),
  })

  assert.equal(feedback.cards.length, 5)
  assert.equal(feedback.cards.find((item) => item.cardId === 'tutorial_2_sandwich').recommended, true)
  assert.equal(feedback.evExplanation.includes('成功率'), true)
  assert.equal(feedback.evExplanation.includes('游戏'), true)
})

test('pipeline state keeps terminal cards terminal during later updates', () => {
  const state = [
    { id: 'done', status: 'success', actualProfit: 1.2 },
    { id: 'current', status: 'running' },
    { id: 'next', status: 'queued' },
  ]

  const afterDecision = __testUpdatePipelineStateForCard(state, 'done', { status: 'running' })
  assert.equal(afterDecision.find((card) => card.id === 'done').status, 'success')

  const afterNextStart = __testUpdatePipelineStateForCard(afterDecision, 'next', { status: 'running' })
  assert.equal(afterNextStart.find((card) => card.id === 'done').status, 'success')
  assert.equal(afterNextStart.find((card) => card.id === 'current').status, 'queued')
  assert.equal(afterNextStart.find((card) => card.id === 'next').status, 'running')
})
