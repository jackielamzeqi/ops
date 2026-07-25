/** 拉取最新 USD→CNY 汇率（无 key） */

const CACHE_KEY = 'personal-ops-usd-cny'
const FALLBACK_RATE = 7.2
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 小时

export interface ExchangeRateInfo {
  rate: number
  updatedAt: string
  source: string
  fromCache: boolean
}

interface CachedRate {
  rate: number
  updatedAt: string
  source: string
  fetchedAt: number
}

function readCache(): CachedRate | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedRate
    if (!parsed?.rate || parsed.rate <= 0) return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(info: Omit<CachedRate, 'fetchedAt'>) {
  const payload: CachedRate = { ...info, fetchedAt: Date.now() }
  localStorage.setItem(CACHE_KEY, JSON.stringify(payload))
}

function abortAfter(ms: number): AbortSignal {
  const c = new AbortController()
  setTimeout(() => c.abort(), ms)
  return c.signal
}

async function fetchFromErApi(): Promise<ExchangeRateInfo> {
  const res = await fetch('https://open.er-api.com/v6/latest/USD', {
    signal: abortAfter(8000),
  })
  if (!res.ok) throw new Error(`er-api ${res.status}`)
  const data = await res.json()
  const rate = Number(data?.rates?.CNY)
  if (!rate || rate <= 0) throw new Error('invalid CNY rate')
  const updatedAt = String(data.time_last_update_utc || new Date().toISOString())
  const info = { rate, updatedAt, source: 'open.er-api.com', fromCache: false }
  writeCache(info)
  return info
}

async function fetchFromFrankfurter(): Promise<ExchangeRateInfo> {
  const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=CNY', {
    signal: abortAfter(8000),
  })
  if (!res.ok) throw new Error(`frankfurter ${res.status}`)
  const data = await res.json()
  const rate = Number(data?.rates?.CNY)
  if (!rate || rate <= 0) throw new Error('invalid CNY rate')
  const updatedAt = String(data.date || new Date().toISOString().slice(0, 10))
  const info = { rate, updatedAt, source: 'frankfurter.app', fromCache: false }
  writeCache(info)
  return info
}

/** 获取最新汇率；失败时回退缓存或默认值 */
export async function fetchUsdCnyRate(force = false): Promise<ExchangeRateInfo> {
  const cached = readCache()
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return {
      rate: cached.rate,
      updatedAt: cached.updatedAt,
      source: cached.source,
      fromCache: true,
    }
  }

  try {
    return await fetchFromErApi()
  } catch {
    try {
      return await fetchFromFrankfurter()
    } catch {
      if (cached) {
        return {
          rate: cached.rate,
          updatedAt: cached.updatedAt,
          source: cached.source,
          fromCache: true,
        }
      }
      return {
        rate: FALLBACK_RATE,
        updatedAt: new Date().toISOString(),
        source: 'fallback',
        fromCache: false,
      }
    }
  }
}

export function usdToCnyWithRate(usd: number, rate: number): number {
  return Math.round(usd * rate * 100) / 100
}
