import test from 'node:test'
import assert from 'node:assert/strict'

import { CARD_TYPES, COMPETITION_BY_RARITY, RARITY } from '../src/config/cards.js'

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
