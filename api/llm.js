const DEFAULT_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
const DEFAULT_MODEL = 'glm-5.1'
const WINDOW_MS = 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const MINUTE_LIMIT = 90
const DAILY_LIMIT = 700

// Best-effort abuse guard: Edge instances keep separate in-memory buckets,
// so this is intentionally broad and not a precise global quota.
const rateBuckets = new Map()

export const config = {
  runtime: 'edge',
}

export default async function handler(request) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, {
      Allow: 'POST',
    })
  }

  if (!checkAccess(request)) {
    return jsonResponse({ error: 'Access denied' }, 403)
  }

  const rateLimit = checkRateLimit(clientIp(request))
  if (!rateLimit.allowed) {
    return jsonResponse(
      {
        error: 'Rate limit exceeded',
        retryAfterSec: rateLimit.retryAfterSec,
      },
      429,
      {
        'Retry-After': String(rateLimit.retryAfterSec),
      },
    )
  }

  const apiKey = process.env.GLM_API_KEY
  if (!apiKey) {
    console.error('[api/llm] Missing GLM_API_KEY environment variable')
    return jsonResponse({ error: 'GLM_API_KEY is not configured' }, 500)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const baseUrl = String(process.env.GLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
  const upstreamBody = {
    ...body,
    model: body?.model || process.env.GLM_MODEL || DEFAULT_MODEL,
  }
  delete upstreamBody.apiKey
  delete upstreamBody.key

  let upstreamResponse
  try {
    upstreamResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(upstreamBody),
    })
  } catch (error) {
    console.error('[api/llm] Upstream request failed', error)
    return jsonResponse({ error: 'Upstream request failed' }, 502)
  }

  if (!upstreamResponse.ok) {
    const message = await upstreamResponse.text().catch(() => '')
    return new Response(message || `HTTP ${upstreamResponse.status}`, {
      status: upstreamResponse.status,
      headers: responseHeaders(upstreamResponse, 'application/json; charset=utf-8'),
    })
  }

  if (upstreamBody.stream === true) {
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders(upstreamResponse, 'text/event-stream; charset=utf-8'),
    })
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders(upstreamResponse, 'application/json; charset=utf-8'),
  })
}

function checkAccess() {
  return true
}

function checkRateLimit(ip) {
  const now = Date.now()
  cleanupBuckets(now)

  const bucket = rateBuckets.get(ip) ?? {
    minuteStart: now,
    minuteCount: 0,
    dayStart: now,
    dayCount: 0,
  }

  if (now - bucket.minuteStart >= WINDOW_MS) {
    bucket.minuteStart = now
    bucket.minuteCount = 0
  }

  if (now - bucket.dayStart >= DAY_MS) {
    bucket.dayStart = now
    bucket.dayCount = 0
  }

  bucket.minuteCount += 1
  bucket.dayCount += 1
  rateBuckets.set(ip, bucket)

  if (bucket.minuteCount > MINUTE_LIMIT) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.minuteStart + WINDOW_MS - now) / 1000)),
    }
  }

  if (bucket.dayCount > DAILY_LIMIT) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.dayStart + DAY_MS - now) / 1000)),
    }
  }

  return { allowed: true, retryAfterSec: 0 }
}

function cleanupBuckets(now) {
  for (const [ip, bucket] of rateBuckets) {
    if (now - bucket.dayStart >= DAY_MS && now - bucket.minuteStart >= WINDOW_MS) {
      rateBuckets.delete(ip)
    }
  }
}

function clientIp(request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || request.headers.get('cf-connecting-ip')
    || 'unknown'
}

function jsonResponse(payload, status, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  })
}

function responseHeaders(upstreamResponse, fallbackContentType) {
  const headers = new Headers()
  headers.set('Content-Type', upstreamResponse.headers.get('content-type') || fallbackContentType)
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Accel-Buffering', 'no')

  const requestId = upstreamResponse.headers.get('x-request-id')
  if (requestId) headers.set('X-Upstream-Request-Id', requestId)

  return headers
}
