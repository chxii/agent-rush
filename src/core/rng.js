export function createSeededRng(seed = 1) {
  let state = normalizeSeed(seed)

  return function rng() {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function createRandomSource(seed) {
  if (seed !== undefined && seed !== null) return createSeededRng(seed)
  return () => Math.random()
}

export function createSequenceRng(values) {
  const sequence = Array.isArray(values) && values.length ? values : [0]
  let index = 0

  return function rng() {
    const value = sequence[index % sequence.length]
    index += 1
    return Math.max(0, Math.min(0.999999, Number(value) || 0))
  }
}

function normalizeSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed | 0

  const text = String(seed)
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash | 0
}
