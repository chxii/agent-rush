import { ExecutorMock, getFallbackPlan } from './ExecutorMock.js'
import { SchemaValidator } from './SchemaValidator.js'
import { ThoughtChainPanel } from '../ui/ThoughtChainPanel.js'
import { LLM_CONFIG } from '../config/llm.js'

const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'
const DEFAULT_MODEL = 'glm-4-flash'
const CACHE_LIMIT = 50
const STREAM_DELAY_MIN_MS = 20
const STREAM_DELAY_MAX_MS = 30

const SYSTEM_PROMPT = [
  'You are the Executor AI in the Agent Rush game.',
  'Return one strict JSON object that matches the requested schema.',
  'Do not wrap the JSON in Markdown or add extra prose.',
  'Use concise Chinese in display fields such as reasoning and summary.',
  'Keep these terms in English, never translate them: Gas, Gwei, ETH, MEV, mempool, searcher, Executor. For example write "消耗 25 Gas" or "投入 150 Gas", never "耗气25".',
  'Each decision should show task decomposition, multi-step planning, or iterative repair.',
  'Gas is allocated by the player. Never invent or return gas allocations unless the call type explicitly asks for a reallocation after an incident.',
].join('\n')

const OUTPUT_CONTRACTS = {
  InitialPlanning: [
    'Output schema:',
    '{ "reasoning": string, "executionOrder": string[] }',
    'executionOrder must contain every selected card id from input.cards exactly once.',
    'Planning may only reorder cards; do not omit, discard, skip, or abandon any selected card during initial planning.',
    'Do not include gasAllocations.',
  ].join('\n'),
  SingleCardPlan: [
    'Output schema:',
    '{ "reasoning": string, "action": "fetch_prices"|"broadcast_tx"|"replace_tx"|"monitor_mempool"|"scan_replacement"|"abandon_card"|"reallocate_gas", "params"?: object }',
    'Return exactly one next action, not a steps array.',
  ].join('\n'),
  IncidentResponse: [
    'Output schema:',
    '{ "reasoning": string, "action": "continue"|"retry_broadcast"|"replace_tx"|"abandon_card"|"reallocate_gas"|"skip_card", "targetCardId"?: string, "gas"?: integer, "gasAllocations"?: [{ "cardId": string, "gas": integer }], "updatedExecutionOrder"?: string[] }',
    'Return one narrow recovery action or remaining-plan adjustment. Use input.playerContingency as the affected card owner intent.',
  ].join('\n'),
  PlayerIntervention: [
    'Output schema:',
    '{ "reasoning": string, "interpretedIntent": string, "updatedGasAllocations": [{ "cardId": string, "gas": integer }], "updatedExecutionOrder": string[] }',
  ].join('\n'),
  SettlementReport: [
    'Output schema:',
    '{ "reasoning": string, "summary": string, "netProfit": number, "decisionHighlights": [{ "momentLabel": "task_decomposition"|"multi_step_planning"|"tool_call"|"iterative_repair"|"workflow_closure", "description": string }] }',
  ].join('\n'),
}

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
    if (cached) {
      appendSystemLog(`[LLM] ${callType} 使用缓存结果。`)
      return cached
    }

    return this.requestWithFallback(callType, input, { stream: false })
  },

  async callStreaming(callType, input = {}, onChunk = () => {}, streamField = 'reasoning') {
    await this.ensureReady()

    if (this._useMock) {
      return ExecutorMock.callStreaming(callType, input, onChunk, streamField)
    }

    const cached = getCachedResponse(callType, input)
    if (cached) {
      appendSystemLog(`[LLM] ${callType} 使用缓存结果。`)
      await streamText(cached[streamField] ?? cached.reasoning ?? '', onChunk)
      return cached
    }

    let emittedFieldDelta = false
    let emittedFieldText = ''
    const emitFieldDelta = (chunk) => {
      if (!chunk) return
      emittedFieldDelta = true
      emittedFieldText += chunk
      onChunk(chunk)
    }

    return this.requestWithFallback(callType, input, {
      stream: true,
      streamField,
      onFieldDelta: emitFieldDelta,
      hasEmittedFieldDelta: () => emittedFieldDelta,
      getEmittedFieldText: () => emittedFieldText,
    })
  },

  async ensureReady() {
    if (!this._ready) this.init()
    await this._ready
  },

  async requestWithFallback(callType, input, options) {
    const startedAt = performance.now()

    try {
      appendSystemLog(`[LLM] ${callType} 发起真实调用（${options.stream ? '流式' : '非流式'}）：${callTypeActivity(callType)}`)
      const result = options.stream
        ? await requestStreamingJson(callType, input, options.onFieldDelta, options.streamField)
        : await requestJson(callType, input)
      const response = result.data
      const validation = SchemaValidator.validate(callType, response)
      const elapsedMs = Math.round(performance.now() - startedAt)

      if (!validation.valid) {
        console.warn(`[ExecutorAI] ${callType} schema validation failed`, validation.errors)
        appendSystemLog(`[LLM] ${callType} schema 校验失败，用时 ${elapsedMs}ms：${formatValidationErrors(validation.errors)}`)
        appendSystemLog(`[LLM] ${callType} 原始返回摘要：${summarizeText(result.rawContent)}`)
        appendSystemLog('[自动降级] AI 响应格式不符合 schema，使用保底策略')
        return replayFallbackIfNeeded(callType, input, options)
      }

      if (result.repaired) {
        appendSystemLog(`[LLM] ${callType} AI 响应被截断，已修复可用 JSON 并继续。`)
      }

      appendSystemLog(`[LLM] ${callType} 完成，用时 ${elapsedMs}ms`)
      setCachedResponse(callType, input, response)
      return response
    } catch (error) {
      const elapsedMs = Math.round(performance.now() - startedAt)
      console.warn(`[ExecutorAI] ${callType} request failed`, error)
      if (error.isTruncatedResponse) {
        appendSystemLog(`[LLM] ${callType} AI 响应被截断，用时 ${elapsedMs}ms：${error.message}`)
      } else {
        appendSystemLog(`[LLM] ${callType} 调用失败，用时 ${elapsedMs}ms：${error.message}`)
      }
      if (error.rawContent) {
        appendSystemLog(`[LLM] ${callType} 失败前已收到：${summarizeText(error.rawContent)}`)
      }
      const fallbackMessage = error.name === 'AbortError'
        ? '[自动降级] AI 响应超时，使用保底策略'
        : '[自动降级] AI 响应不可用，使用保底策略'
      appendSystemLog(
        error.isTruncatedResponse
          ? '[自动降级] AI 响应被截断，已保留已生成内容并启用保底策略'
          : fallbackMessage,
      )
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
  const parsed = parseJsonContent(content)
  return {
    data: parsed.data,
    rawContent: content ?? '',
    repaired: parsed.repaired,
  }
}

async function requestStreamingJson(callType, input, onFieldDelta = () => {}, streamField = 'reasoning') {
  const response = await fetchWithTimeout(true, callType, input)
  if (!response.body) throw new Error('ReadableStream body is not available')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const extractor = createFieldValueExtractor(streamField)
  let buffer = ''
  let content = ''

  try {
    while (true) {
      const { done, value } = await readStreamChunk(reader)
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
  } catch (error) {
    const parsed = tryParseLenientJson(content)
    if (parsed.ok) {
      return {
        data: parsed.value,
        rawContent: content,
        repaired: true,
      }
    }

    error.rawContent = content
    error.isTruncatedResponse = true
    throw error
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

  const parsed = parseJsonContent(content)
  return {
    data: parsed.data,
    rawContent: content,
    repaired: parsed.repaired,
  }
}

async function readStreamChunk(reader) {
  let timeoutId = null
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error('SSE 流读取超时')), LLM_CONFIG.streamReadTimeoutMs)
      }),
    ])
  } catch (error) {
    try {
      await reader.cancel()
    } catch (cancelError) {
      console.warn('[ExecutorAI] Failed to cancel stalled SSE reader', cancelError)
    }
    throw error
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId)
  }
}

async function fetchWithTimeout(stream, callType, input) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), LLM_CONFIG.requestTimeoutMs)

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
  const emittedFieldText =
    options.stream && options.getEmittedFieldText ? String(options.getEmittedFieldText() ?? '') : ''

  if (emittedFieldText && options.streamField) {
    fallback[options.streamField] = emittedFieldText
  }

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

export function tryParseLenientJson(content) {
  const normalized = normalizeJsonContent(content)
  if (!normalized) {
    return { ok: false, value: null, repaired: false, error: new Error('empty AI content') }
  }

  const parsed = parseJsonCandidate(normalized)
  if (parsed.ok) return { ...parsed, repaired: false }

  for (const candidate of buildRepairCandidates(normalized)) {
    const repaired = parseJsonCandidate(candidate)
    if (repaired.ok) return { ...repaired, repaired: true, repairedContent: candidate }
  }

  return {
    ok: false,
    value: null,
    repaired: false,
    error: parsed.error,
    rawContent: normalized,
    truncated: looksLikeJsonFragment(normalized),
  }
}

function parseJsonContent(content) {
  const result = tryParseLenientJson(content)
  if (result.ok) {
    return {
      data: result.value,
      repaired: result.repaired,
    }
  }

  const error = new Error(result.truncated ? 'AI response was truncated or invalid JSON' : result.error.message)
  error.rawContent = result.rawContent ?? content ?? ''
  error.isTruncatedResponse = result.truncated === true
  throw error
}

function normalizeJsonContent(content) {
  return String(content ?? '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim()
}

function parseJsonCandidate(candidate) {
  try {
    const value = JSON.parse(candidate)
    if (!isObjectLike(value)) {
      return { ok: false, value: null, error: new Error('AI JSON root must be an object or array') }
    }
    return { ok: true, value }
  } catch (error) {
    return { ok: false, value: null, error }
  }
}

function isObjectLike(value) {
  return value !== null && typeof value === 'object'
}

function buildRepairCandidates(content) {
  const candidates = []
  addCandidate(candidates, repairJsonFragment(content))

  const trimPoints = findTrimPoints(content)
  for (const index of trimPoints) {
    addCandidate(candidates, repairJsonFragment(content.slice(0, index)))
  }

  return candidates
}

function repairJsonFragment(content) {
  const scan = scanJsonFragment(content)
  let candidate = content

  if (scan.inString) {
    if (scan.escaped && candidate.endsWith('\\')) candidate = candidate.slice(0, -1)
    candidate += '"'
  }

  candidate = removeTrailingCommas(candidate)
  for (let index = scan.stack.length - 1; index >= 0; index -= 1) {
    candidate += scan.stack[index]
  }

  return removeTrailingCommas(candidate)
}

function scanJsonFragment(content) {
  const stack = []
  let inString = false
  let escaped = false

  for (const char of content) {
    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === '"') inString = false
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') stack.push('}')
    if (char === '[') stack.push(']')
    if ((char === '}' || char === ']') && stack[stack.length - 1] === char) stack.pop()
  }

  return { stack, inString, escaped }
}

function findTrimPoints(content) {
  const points = []
  let inString = false
  let escaped = false

  for (let index = content.length - 1; index >= 0; index -= 1) {
    const char = content[index]

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === '"') inString = false
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === ',') points.push(index)
    if (points.length >= 8) break
  }

  return points
}

function removeTrailingCommas(content) {
  return content.replace(/,\s*([}\]])/g, '$1').replace(/,\s*$/g, '')
}

function addCandidate(candidates, candidate) {
  if (!candidate || candidates.includes(candidate)) return
  candidates.push(candidate)
}

function looksLikeJsonFragment(content) {
  const trimmed = content.trim()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

function buildUserPrompt(callType, input) {
  return [
    `callType: ${callType}`,
    'Return only the output JSON object for this call type.',
    OUTPUT_CONTRACTS[callType] ?? '',
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

function summarizeText(text) {
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!normalized) return '空响应'
  return normalized.length > 220 ? `${normalized.slice(0, 220)}...` : normalized
}

function callTypeActivity(callType) {
  const activities = {
    InitialPlanning: '正在拆解任务、规划执行顺序。',
    IncidentResponse: '出事了，正在评估现场、决定应对。',
    PlayerIntervention: '正在理解你的指令、调整计划。',
    SettlementReport: '正在复盘这一回合、生成总结。',
    SingleCardPlan: '正在为当前这张牌规划下一步。',
  }
  return activities[callType] ?? '正在处理当前请求。'
}

function formatValidationErrors(errors = []) {
  if (!errors.length) return '未知字段错误'
  return errors
    .slice(0, 4)
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .join('；')
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
