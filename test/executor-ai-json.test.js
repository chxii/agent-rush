import test from 'node:test'
import assert from 'node:assert/strict'

import { tryParseLenientJson } from '../src/ai/ExecutorAI.js'

test('tryParseLenientJson parses complete JSON without repair', () => {
  const result = tryParseLenientJson('{"reasoning":"ok","executionOrder":["a","b"]}')

  assert.equal(result.ok, true)
  assert.equal(result.repaired, false)
  assert.deepEqual(result.value, {
    reasoning: 'ok',
    executionOrder: ['a', 'b'],
  })
})

test('tryParseLenientJson repairs common truncated streaming JSON', () => {
  const result = tryParseLenientJson('{"reasoning":"keep streamed text","executionOrder":["a"')

  assert.equal(result.ok, true)
  assert.equal(result.repaired, true)
  assert.deepEqual(result.value, {
    reasoning: 'keep streamed text',
    executionOrder: ['a'],
  })
})

test('tryParseLenientJson safely fails unrecoverable truncated JSON', () => {
  const result = tryParseLenientJson('{"reasoning": @')

  assert.equal(result.ok, false)
  assert.equal(result.repaired, false)
  assert.equal(result.truncated, true)
  assert.ok(result.error instanceof Error)
})

test('tryParseLenientJson safely fails invalid non-JSON input', () => {
  const result = tryParseLenientJson('not json at all')

  assert.equal(result.ok, false)
  assert.equal(result.repaired, false)
  assert.equal(result.truncated, false)
  assert.ok(result.error instanceof Error)
})
