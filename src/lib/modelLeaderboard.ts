/** 大模型榜单：Artificial Analysis + Arena（日更缓存） */

export interface LeaderboardModel {
  rank: number
  name: string
  shortName: string
  slug: string
  creator: string
  releaseDate: string | null
  contextWindow: number | null
  /** USD / 1M tokens，综合价（约 3:1 混合） */
  priceBlended: number | null
  priceInput: number | null
  priceOutput: number | null
  /** Artificial Analysis Intelligence Index */
  intelligence: number | null
  /** SciCode 科学推理 0–100 */
  science: number | null
  /** GPQA Diamond 0–100（客观智力参考） */
  gpqa: number | null
  /** Coding Index */
  coding: number | null
  arenaTextRank: number | null
  arenaTextElo: number | null
  arenaCodeRank: number | null
  arenaCodeElo: number | null
}

export interface LeaderboardSnapshot {
  ok: boolean
  updatedAt: string
  cacheDate: string
  sources: { id: string; label: string; url: string; fetchedAt?: string }[]
  models: LeaderboardModel[]
  warnings: string[]
  fromCache?: boolean
}

const CACHE_KEY = 'personal-ops-leaderboard-v1'
const DAY_MS = 24 * 60 * 60 * 1000
const TOP_N = 30

const AA_MIRROR =
  'https://raw.githubusercontent.com/oolong-tea-2026/artificial-analysis-leaderboards/main'
const AA_INDEX =
  'https://raw.githubusercontent.com/EvanZhouDev/ai-model-index/main/data'
const ARENA_API = 'https://api.wulong.dev/arena-ai-leaderboards/v1'

type AaModel = {
  name?: string
  short_name?: string
  slug?: string
  release_date?: string
  deprecated?: boolean
  creator?: { name?: string }
  evaluations?: Record<string, number | boolean | null>
  pricing?: {
    price_1m_blended_3_to_1?: number | null
    price_1m_input_tokens?: number | null
    price_1m_output_tokens?: number | null
  }
  capabilities?: { context_window_tokens?: number | null }
}

type IndexFile = {
  generated_at?: string
  models?: { rank: number; name: string; slug: string; creator?: string; score: number }[]
}

type ArenaBoard = {
  meta?: { fetched_at?: string; last_updated?: string }
  models?: { rank: number; model: string; vendor?: string; score?: number }[]
}

function todayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10)
}

function normSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function toPct(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  // AA 部分评测为 0–1，部分为 0–100
  const n = v <= 1.5 ? v * 100 : v
  return Math.round(n * 10) / 10
}

function blendedPrice(p?: AaModel['pricing']): number | null {
  if (!p) return null
  if (typeof p.price_1m_blended_3_to_1 === 'number') {
    return Math.round(p.price_1m_blended_3_to_1 * 100) / 100
  }
  const inn = p.price_1m_input_tokens
  const out = p.price_1m_output_tokens
  if (typeof inn === 'number' && typeof out === 'number') {
    return Math.round(((inn * 3 + out) / 4) * 100) / 100
  }
  return null
}

async function fetchJson<T>(url: string, timeoutMs = 45_000): Promise<T> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`${res.status} ${url}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(t)
  }
}

function loadCache(): LeaderboardSnapshot | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as LeaderboardSnapshot
  } catch {
    return null
  }
}

function saveCache(snap: LeaderboardSnapshot) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(snap))
  } catch {
    /* quota */
  }
}

export function isLeaderboardFresh(snap: LeaderboardSnapshot | null): boolean {
  if (!snap?.ok || !snap.updatedAt) return false
  if (snap.cacheDate === todayKey()) return true
  const age = Date.now() - new Date(snap.updatedAt).getTime()
  return age < DAY_MS
}

function buildArenaMap(board: ArenaBoard | null): Map<string, { rank: number; elo: number }> {
  const map = new Map<string, { rank: number; elo: number }>()
  for (const m of board?.models || []) {
    const key = normSlug(m.model)
    if (!key) continue
    map.set(key, { rank: m.rank, elo: m.score ?? 0 })
    // 去掉后缀便于模糊匹配
    const base = key.replace(/-thinking.*$/, '').replace(/-xhigh.*$/, '').replace(/-max.*$/, '')
    if (!map.has(base)) map.set(base, { rank: m.rank, elo: m.score ?? 0 })
  }
  return map
}

function findArena(
  slug: string,
  name: string,
  map: Map<string, { rank: number; elo: number }>
) {
  const keys = [normSlug(slug), normSlug(name), normSlug(slug).replace(/-with-fallback$/, '')]
  for (const k of keys) {
    if (map.has(k)) return map.get(k)!
    for (const [mk, v] of map) {
      if (mk.includes(k) || k.includes(mk)) return v
    }
  }
  return null
}

export async function fetchModelLeaderboard(force = false): Promise<LeaderboardSnapshot> {
  const cached = loadCache()
  if (!force && isLeaderboardFresh(cached) && cached) {
    return { ...cached, fromCache: true }
  }

  const warnings: string[] = []
  const sources: LeaderboardSnapshot['sources'] = []

  let aaModels: AaModel[] = []
  let aaFetchedAt = ''
  try {
    const latest = await fetchJson<{ date: string; path: string }>(`${AA_MIRROR}/data/latest.json`)
    const path = latest.path?.startsWith('data/') ? latest.path : `data/${latest.date}`
    const llms = await fetchJson<{ meta?: { fetched_at?: string }; models?: AaModel[] }>(
      `${AA_MIRROR}/${path}/llms.json`,
      90_000
    )
    aaModels = (llms.models || []).filter((m) => !m.deprecated)
    aaFetchedAt = llms.meta?.fetched_at || latest.date
    sources.push({
      id: 'aa',
      label: 'Artificial Analysis',
      url: 'https://artificialanalysis.ai/leaderboards/models',
      fetchedAt: aaFetchedAt,
    })
  } catch (e) {
    warnings.push(`Artificial Analysis 镜像拉取失败：${(e as Error).message || e}`)
  }

  // 日更指数（更新鲜）覆盖 AA 镜像分数
  const overlays: Record<string, Partial<Record<'intelligence' | 'coding' | 'science' | 'gpqa', number>>> =
    {}
  const overlayFiles: { file: string; key: 'intelligence' | 'coding' | 'science' | 'gpqa'; label: string }[] =
    [
      { file: 'aa-intelligence.json', key: 'intelligence', label: 'AA Intelligence' },
      { file: 'aa-coding.json', key: 'coding', label: 'AA Coding' },
      { file: 'scicode.json', key: 'science', label: 'SciCode' },
      { file: 'gpqa.json', key: 'gpqa', label: 'GPQA' },
    ]
  for (const f of overlayFiles) {
    try {
      const data = await fetchJson<IndexFile>(`${AA_INDEX}/llm/${f.file}`)
      for (const m of data.models || []) {
        const slug = m.slug || normSlug(m.name)
        overlays[slug] = overlays[slug] || {}
        const score =
          f.key === 'science' || f.key === 'gpqa' ? toPct(m.score) : Math.round(m.score * 10) / 10
        if (score != null) overlays[slug][f.key] = score
      }
      if (!sources.find((s) => s.id === 'aa-index')) {
        sources.push({
          id: 'aa-index',
          label: 'AA Index（日更）',
          url: 'https://artificialanalysis.ai/',
          fetchedAt: data.generated_at,
        })
      }
    } catch (e) {
      warnings.push(`${f.label} 拉取失败：${(e as Error).message || e}`)
    }
  }

  let arenaText: ArenaBoard | null = null
  let arenaCode: ArenaBoard | null = null
  try {
    ;[arenaText, arenaCode] = await Promise.all([
      fetchJson<ArenaBoard>(`${ARENA_API}/leaderboard?name=text`),
      fetchJson<ArenaBoard>(`${ARENA_API}/leaderboard?name=code`),
    ])
    sources.push({
      id: 'arena',
      label: 'Arena AI',
      url: 'https://arena.ai/leaderboard/text',
      fetchedAt: arenaText.meta?.fetched_at || arenaText.meta?.last_updated,
    })
  } catch (e) {
    warnings.push(`Arena 拉取失败：${(e as Error).message || e}`)
  }

  const textMap = buildArenaMap(arenaText)
  const codeMap = buildArenaMap(arenaCode)

  const bySlug = new Map<string, AaModel>()
  for (const m of aaModels) {
    if (m.slug) bySlug.set(m.slug, m)
  }

  // 以智力指数排序：优先用日更 overlay，否则用镜像 evaluations
  type RowSeed = {
    slug: string
    aa?: AaModel
    intelligence: number
  }
  const seeds: RowSeed[] = []

  if (Object.keys(overlays).length) {
    for (const [slug, o] of Object.entries(overlays)) {
      if (o.intelligence == null) continue
      seeds.push({ slug, aa: bySlug.get(slug), intelligence: o.intelligence })
    }
  }
  if (seeds.length < 10) {
    for (const m of aaModels) {
      const intel = m.evaluations?.artificial_analysis_intelligence_index
      if (typeof intel !== 'number' || !m.slug) continue
      if (seeds.some((s) => s.slug === m.slug)) continue
      seeds.push({ slug: m.slug, aa: m, intelligence: intel })
    }
  }

  seeds.sort((a, b) => b.intelligence - a.intelligence)
  const top = seeds.slice(0, TOP_N)

  const models: LeaderboardModel[] = top.map((s, i) => {
    const aa = s.aa || bySlug.get(s.slug)
    const o = overlays[s.slug] || {}
    const ev = aa?.evaluations || {}
    const name = aa?.name || s.slug
    const shortName = aa?.short_name || name
    const arenaT = findArena(s.slug, name, textMap)
    const arenaC = findArena(s.slug, name, codeMap)
    const science =
      o.science ??
      toPct(ev.scicode) ??
      null
    const gpqa = o.gpqa ?? toPct(ev.gpqa) ?? null
    const coding =
      o.coding ??
      (typeof ev.artificial_analysis_coding_index === 'number'
        ? Math.round(ev.artificial_analysis_coding_index * 10) / 10
        : null)
    const intelligence =
      o.intelligence ??
      (typeof ev.artificial_analysis_intelligence_index === 'number'
        ? Math.round(ev.artificial_analysis_intelligence_index * 10) / 10
        : s.intelligence)

    return {
      rank: i + 1,
      name,
      shortName,
      slug: s.slug,
      creator: aa?.creator?.name || '—',
      releaseDate: aa?.release_date || null,
      contextWindow: aa?.capabilities?.context_window_tokens ?? null,
      priceBlended: blendedPrice(aa?.pricing),
      priceInput: aa?.pricing?.price_1m_input_tokens ?? null,
      priceOutput: aa?.pricing?.price_1m_output_tokens ?? null,
      intelligence,
      science,
      gpqa,
      coding,
      arenaTextRank: arenaT?.rank ?? null,
      arenaTextElo: arenaT?.elo ?? null,
      arenaCodeRank: arenaC?.rank ?? null,
      arenaCodeElo: arenaC?.elo ?? null,
    }
  })

  const snap: LeaderboardSnapshot = {
    ok: models.length > 0,
    updatedAt: new Date().toISOString(),
    cacheDate: todayKey(),
    sources,
    models,
    warnings,
    fromCache: false,
  }

  if (snap.ok) saveCache(snap)
  else if (cached?.ok) return { ...cached, fromCache: true, warnings: [...warnings, '使用昨日缓存'] }

  return snap
}

export function formatContext(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 2)}M`
  if (n >= 1_000) return `${Math.round(n / 1000)}k`
  return String(n)
}

export function formatPriceUsd(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n < 0.01) return `$${n.toFixed(3)}`
  return `$${n.toFixed(2)}`
}

export function formatScore(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toFixed(1)
}
