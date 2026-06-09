import { ExecutorMock, getFallbackPlan } from './ExecutorMock.js'
import { SchemaValidator } from './SchemaValidator.js'
import { ThoughtChainPanel } from '../ui/ThoughtChainPanel.js'

const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'
const DEFAULT_MODEL = 'glm-4-flash'
const TIMEOUT_MS = 5000
const CACHE_LIMIT = 50
const STREAM_DELAY_MIN_MS = 20
const STREAM_DELAY_MAX_MS = 30

const SYSTEM_PROMPT = [
  'You are the Executor AI in the Agent Rush game.',
  'Return one strict JSON object that matches the requested schema.',
  'Do not wrap the JSON in Markdown or add extra prose.',
  'Use concise Chinese in display fields such as reasoning and summary.',
  'Each decision should show task decomposition, multi-step planning, or iterative repair.',
].join('\n')

const _cache = new Map()

export const ExecutorAI = {
  _ready: null,
  _useMock: true,

  init() {
    this._useMock = !window.GLM_API_KEY

    if (this._useMock) {
      console.warn('[ExecutorAI] GLM_API_KEY not found. Switching to Mock mode.')
    }

    this._ready = SchemaValidator.init()
    return this._ready
  },

  async call(callType, input = {}) {
    await this.ensureReady()

    if (this._useMock) return ExecutorMock.call(callType, input)

    const cached = getCachedResponse(callType, input)
    if (cached) return cached

    return this.requestWithFallback(callType, input, { stream: false })
  },

  async callStreaming(callType, input = {}, onChunk = () => {}, streamField = 'reasoning') {
    await this.ensureReady()

    if (this._useMock) {
      return ExecutorMock.callStreaming(callType, input, onChunk, streamField)
    }

    const cached = getCachedResponse(callType, input)
    if (cached) {
      await streamText(cached[streamField] ?? cached.reasoning ?? '', onChunk)
      return cached
    }

    let emittedFieldDelta = false
    const emitFieldDelta = (chunk) => {
      if (!chunk) return
      emittedFieldDelta = true
      onChunk(chunk)
    }

    return this.requestWithFallback(callType, input, {
      stream: true,
      streamField,
      onFieldDelta: emitFieldDelta,
      hasEmittedFieldDelta: () => emittedFieldDelta,
    })
  },

  async ensureReady() {
    if (!this._ready) this.init()
    await this._ready
  },

  async requestWithFallback(callType, input, options) {
    try {
      const response = options.stream
        ? await requestStreamingJson(callType, input, options.onFieldDelta, options.streamField)
        : await requestJson(callType, input)
      const validation = SchemaValidator.validate(callType, response)

      if (!validation.valid) {
        console.warn(`[ExecutorAI] ${callType} schema validation failed`, validation.errors)
        appendSystemLog('[自动降级] AI 响应格式不符合 schema，使用保底策略')
        return replayFallbackIfNeeded(callType, input, options)
      }

      setCachedResponse(callType, input, response)
      return response
    } catch (error) {
      console.warn(`[ExecutorAI] ${callType} request failed`, error)
      appendSystemLog('[自动降级] AI 响应超时，使用保底策略')
      return replayFallbackIfNeeded(callType, input, options)
    }
  },
}

export function preWarmCache(scenarios) {
  scenarios.forEach((scenario) => {
    if (scenario.key) setCacheEntry(scenario.key, scenario.response)
    if (scenario.input) setCachedResponse(scenario.callType, scenario.input, scenario.response)
  })
}

export function getCacheKey(callType, input = {}) {
  const cardIds = extractCards(input)
    .map((card) => card.id)
    .filter(Boolean)
    .join(',')
  const completedIds = (input.completedCards ?? [])
    .map((card) => card.id)
    .filter(Boolean)
    .join(',')
  const event = input.event ?? ''
  const affected = input.affectedCardId ?? ''
  const layer = input.scene?.layer ?? input.layer ?? ''

  return [callType, layer, cardIds, completedIds, event, affected].join('|')
}

export function createFieldValueExtractor(fieldName) {
  const keyPattern = new RegExp(`"${escapeRegExp(fieldName)}"\\s*:\\s*"`)
  const extractor = {
    done: false,
    _buffer: '',
    _state: 'SEEKING_KEY',
    _escaped: false,
    _unicodeBuffer: null,

    push(chunk) {
      if (this.done || !chunk) return ''

      this._buffer += chunk
      let output = ''

      if (this._state === 'SEEKING_KEY') {
        const match = this._buffer.match(keyPattern)
        if (!match || match.index === undefined) {
          return ''
        }

        const valueStart = match.index + match[0].length
        this._buffer = this._buffer.slice(valueStart)
        this._state = 'IN_VALUE'
      }

      if (this._state === 'IN_VALUE') {
        output += this._consumeValueBuffer()
      }

      return output
    },

    _consumeValueBuffer() {
      let output = ''
      let consumed = 0

      for (let index = 0; index < this._buffer.length; index += 1) {
        const char = this._buffer[index]
        consumed = index + 1

        if (this._unicodeBuffer !== null) {
          if (/[0-9a-fA-F]/.test(char)) {
            this._unicodeBuffer += char
            if (this._unicodeBuffer.length === 4) {
              output += String.fromCharCode(parseInt(this._unicodeBuffer, 16))
              this._unicodeBuffer = null
              this._escaped = false
            }
            continue
          }

          this._unicodeBuffer = null
          this._escaped = false
          output += char
          continue
        }

        if (this._escaped) {
          if (char === 'u') {
            this._unicodeBuffer = ''
            continue
          }

          output += decodeEscapedChar(char)
          this._escaped = false
          continue
        }

        if (char === '\\') {
          this._escaped = true
          continue
        }

        if (char === '"') {
          this.done = true
          this._state = 'DONE'
          this._buffer = ''
          return output
        }

        output += char
      }

      this._buffer = this._buffer.slice(consumed)
      return output
    },
  }

  return extractor
}

async function requestJson(callType, input) {
  const apiResponse = await fetchWithTimeout(false, callType, input)
  const content = apiResponse.choices?.[0]?.message?.content
  return parseJsonContent(content)
}

async function requestStreamingJson(callType, input, onFieldDelta = () => {}, streamField = 'reasoning') {
  const response = await fetchWithTimeout(true, callType, input)
  if (!response.body) throw new Error('ReadableStream body is not available')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const extractor = createFieldValueExtractor(streamField)
  let buffer = ''
  let content = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''

    lines.forEach((line) => {
      const chunk = parseSseLine(line)
      if (!chunk) return

      content += chunk
      const delta = extractor.push(chunk)
      if (delta) onFieldDelta(delta)
    })
  }

  buffer += decoder.decode()
  buffer
    .split(/\r?\n/)
    .map(parseSseLine)
    .filter(Boolean)
    .forEach((chunk) => {
      content += chunk
      const delta = extractor.push(chunk)
      if (delta) onFieldDelta(delta)
    })

  return parseJsonContent(content)
}

async function fetchWithTimeout(stream, callType, input) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(`${getBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${window.GLM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: getModel(),
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(callType, input) },
        ],
        temperature: 0.2,
        stream,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    return stream ? response : response.json()
  } finally {
    window.clearTimeout(timeoutId)
  }
}

function replayFallbackIfNeeded(callType, input, options) {
  const fallback = getFallbackPlan(callType, input)
  const shouldReplay =
    options.stream && options.onFieldDelta && !(options.hasEmittedFieldDelta && options.hasEmittedFieldDelta())

  if (shouldReplay) {
    return streamText(fallback[options.streamField] ?? fallback.reasoning ?? '', options.onFieldDelta).then(
      () => fallback,
    )
  }

  return fallback
}

function parseSseLine(line) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return ''

  const data = trimmed.slice(5).trim()
  if (!data || data === '[DONE]') return ''

  try {
    const parsed = JSON.parse(data)
    return parsed.choices?.[0]?.delta?.content ?? ''
  } catch (error) {
    console.warn('[ExecutorAI] Failed to parse SSE line', error)
    return ''
  }
}

function parseJsonContent(content) {
  if (!content) throw new Error('empty AI content')

  const normalized = content
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim()

  return JSON.parse(normalized)
}

function buildUserPrompt(callType, input) {
  return [
    `callType: ${callType}`,
    'Return only the output JSON object for this call type.',
    'Input:',
    JSON.stringify(input),
  ].join('\n')
}

function getCachedResponse(callType, input) {
  return _cache.get(getCacheKey(callType, input)) ?? null
}

function setCachedResponse(callType, input, response) {
  setCacheEntry(getCacheKey(callType, input), response)
}

function setCacheEntry(key, response) {
  if (!key || !response) return

  if (_cache.has(key)) _cache.delete(key)
  _cache.set(key, response)

  while (_cache.size > CACHE_LIMIT) {
    const oldestKey = _cache.keys().next().value
    _cache.delete(oldestKey)
  }
}

function extractCards(input) {
  if (Array.isArray(input.cards)) return input.cards
  if (input.card) return [input.card]
  return []
}

async function streamText(text, onChunk) {
  for (const char of text) {
    onChunk(char)
    await delay(randomInt(STREAM_DELAY_MIN_MS, STREAM_DELAY_MAX_MS))
  }
}

function getBaseUrl() {
  return (window.GLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
}

function getModel() {
  return window.GLM_MODEL || DEFAULT_MODEL
}

function appendSystemLog(text) {
  ThoughtChainPanel.appendLog({
    timestampMs: Date.now(),
    source: 'system',
    text,
    isStreaming: false,
  })
}

function decodeEscapedChar(char) {
  const escapes = {
    '"': '"',
    '\\': '\\',
    '/': '/',
    b: '\b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t',
  }

  return escapes[char] ?? char
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function randomInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1))
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
