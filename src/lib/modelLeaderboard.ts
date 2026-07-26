/** 大模型榜单：Artificial Analysis + Arena（日更缓存） */

import { resolveBrandKey } from '../components/CreatorLogo'

export interface LeaderboardModel {
  rank: number
  name: string
  shortName: string
  slug: string
  creator: string
  /** ISO 国家码，如 us / cn */
  countryCode: string | null
  /** emoji 国旗 */
  countryFlag: string
  /** 是否开源权重；null 表示未知 */
  openWeights: boolean | null
  releaseDate: string | null
  /** 总参数量（十亿） */
  totalParams: number | null
  /** 激活参数量（十亿，MoE） */
  activeParams: number | null
  /** 参数量取自同族模型时的来源名（估算标记） */
  paramsRef?: string | null
  contextWindow: number | null
  /** 上下文取自同族模型时的来源名（估算标记） */
  contextRef?: string | null
  /** USD / 1M tokens，综合价（约 3:1 混合） */
  priceBlended: number | null
  /** 价格取自同族模型时的来源名（估算标记） */
  priceRef?: string | null
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

const CACHE_KEY = 'personal-ops-leaderboard-v6'
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
  creator?: { name?: string; country?: string; slug?: string }
  evaluations?: Record<string, number | boolean | null>
  pricing?: {
    price_1m_blended_3_to_1?: number | null
    price_1m_input_tokens?: number | null
    price_1m_output_tokens?: number | null
  }
  capabilities?: {
    context_window_tokens?: number | null
    total_parameters?: number | null
    active_parameters?: number | null
  }
  open_weights?: { is_open_weights?: boolean | null } | null
}

type IndexFile = {
  generated_at?: string
  models?: { rank: number; name: string; slug: string; creator?: string; score: number }[]
}

const BRAND_CREATOR_NAME: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  meta: 'Meta',
  xai: 'SpaceXAI',
  alibaba: 'Alibaba',
  deepseek: 'DeepSeek',
  moonshot: 'Kimi',
  minimax: 'MiniMax',
  zhipu: 'Z AI',
  mistral: 'Mistral',
}

const CREATOR_COUNTRY: Record<string, string> = {
  anthropic: 'us',
  openai: 'us',
  google: 'us',
  meta: 'us',
  spacexai: 'us',
  xai: 'us',
  amazon: 'us',
  microsoft: 'us',
  nvidia: 'us',
  perplexity: 'us',
  databricks: 'us',
  cohere: 'ca',
  mistral: 'fr',
  'ai21 labs': 'il',
  alibaba: 'cn',
  deepseek: 'cn',
  kimi: 'cn',
  moonshot: 'cn',
  minimax: 'cn',
  'z ai': 'cn',
  zhipu: 'cn',
  baidu: 'cn',
  tencent: 'cn',
  bytedance: 'cn',
  'bytedance seed': 'cn',
  stepfun: 'cn',
  xiaomi: 'cn',
  qwen: 'cn',
}

const COUNTRY_LABEL: Record<string, string> = {
  us: '美国',
  cn: '中国',
  fr: '法国',
  ca: '加拿大',
  il: '以色列',
  kr: '韩国',
  in: '印度',
  ae: '阿联酋',
  ch: '瑞士',
  es: '西班牙',
}

/**
 * AA 镜像滞后时的公开参数量（十亿）与开源标记补丁。
 * 来源：厂商官网 / 技术博客（如 Kimi K3 = 2.8T 开源权重）。
 */
type MetaOverride = {
  totalParams?: number
  activeParams?: number | null
  openWeights?: boolean
}

const MODEL_META_OVERRIDES: Record<string, MetaOverride> = {
  // https://www.kimi.com/blog/kimi-k3 — 2.8T，开源权重；激活参官方未给精确 B 数
  'kimi-k3': { totalParams: 2800, openWeights: true },
  // https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro
  'deepseek-v4-pro': { totalParams: 1600, activeParams: 49, openWeights: true },
  'deepseek-v4-flash': { totalParams: 284, activeParams: 13, openWeights: true },
}

/** 缺 AA 字段时按厂商默认开/闭源 */
const BRAND_OPEN_DEFAULT: Partial<Record<string, boolean>> = {
  anthropic: false,
  openai: false,
  google: false,
  xai: false,
  meta: true,
  deepseek: true,
  moonshot: true,
  alibaba: true,
  zhipu: true,
  minimax: true,
  mistral: true,
}

function lookupMetaOverride(slug: string, name?: string): MetaOverride | null {
  const keys = [normSlug(slug), normSlug(name || ''), stripModelVariant(slug)]
  for (const key of keys) {
    if (!key) continue
    if (MODEL_META_OVERRIDES[key]) return MODEL_META_OVERRIDES[key]
    for (const [k, v] of Object.entries(MODEL_META_OVERRIDES)) {
      if (key === k || key.startsWith(`${k}-`)) return v
    }
  }
  return null
}

export function countryFlagEmoji(code?: string | null): string {
  const c = (code || '').trim().toLowerCase()
  if (!/^[a-z]{2}$/.test(c)) return '🏳️'
  const A = 0x1f1e6
  return String.fromCodePoint(A + c.charCodeAt(0) - 97, A + c.charCodeAt(1) - 97)
}

export function countryLabel(code?: string | null): string {
  const c = (code || '').trim().toLowerCase()
  return COUNTRY_LABEL[c] || c.toUpperCase() || '未知'
}

function inferCreatorName(slug: string, name: string, hint?: string | null): string {
  const fromHint = (hint || '').trim()
  if (fromHint && fromHint !== '—') return fromHint
  const brand = resolveBrandKey({ creator: hint, slug, name })
  if (brand && BRAND_CREATOR_NAME[brand]) return BRAND_CREATOR_NAME[brand]
  return '—'
}

function inferCountryCode(
  aaCountry?: string | null,
  creator?: string | null,
  slug?: string,
  name?: string
): string | null {
  const fromAa = (aaCountry || '').trim().toLowerCase()
  if (/^[a-z]{2}$/.test(fromAa)) return fromAa
  const c = (creator || '').trim().toLowerCase()
  if (CREATOR_COUNTRY[c]) return CREATOR_COUNTRY[c]
  for (const [key, code] of Object.entries(CREATOR_COUNTRY)) {
    if (c.includes(key)) return code
  }
  const brand = resolveBrandKey({ creator, slug, name })
  if (brand === 'alibaba' || brand === 'deepseek' || brand === 'moonshot' || brand === 'minimax' || brand === 'zhipu') {
    return 'cn'
  }
  if (brand === 'mistral') return 'fr'
  if (brand) return 'us'
  return null
}

function stripModelVariant(slug: string): string {
  return normSlug(slug)
    .replace(
      /-(adaptive|xhigh|high|medium|low|max|max-effort|non-reasoning|with-fallback|thinking|preview|exp|experimental|chat|instruct)(-|$)/g,
      '-'
    )
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/** AA 镜像滞后时，用同族模型补发布日期 / 公司 / 国家 */
function findRelatedAa(slug: string, name: string, bySlug: Map<string, AaModel>, all: AaModel[]): AaModel | null {
  const direct = bySlug.get(slug)
  if (direct) return direct
  const base = stripModelVariant(slug)
  if (base && bySlug.has(base)) return bySlug.get(base)!
  const keys = [base, normSlug(name), stripModelVariant(name)].filter(Boolean)
  let best: AaModel | null = null
  let bestScore = 0
  for (const m of all) {
    const ms = m.slug || ''
    if (!ms) continue
    const mb = stripModelVariant(ms)
    for (const k of keys) {
      if (!k) continue
      if (ms === k || mb === k) return m
      if (ms.startsWith(k + '-') || k.startsWith(ms + '-') || mb.startsWith(k) || k.startsWith(mb)) {
        const score = Math.min(k.length, mb.length)
        if (score > bestScore) {
          best = m
          bestScore = score
        }
      }
    }
  }
  return bestScore >= 8 ? best : null
}

/**
 * 取同族最新且带所需字段的模型（如 claude-opus-5 → 最近的 claude-opus-*）。
 * AA 镜像更新慢于日更指数时，新模型没有自身条目，用同族数据兜底。
 */
function findFamilyAa(
  slug: string,
  all: AaModel[],
  has: (m: AaModel) => boolean
): AaModel | null {
  const parts = stripModelVariant(slug).split('-').filter(Boolean)
  const minLen = parts[0] && parts[0].length >= 4 ? 1 : 2
  for (let len = Math.min(parts.length, 4); len >= minLen; len--) {
    const prefix = parts.slice(0, len).join('-')
    if (prefix.length < 4) continue
    const candidates = all.filter((m) => {
      const ms = m.slug || ''
      return (ms === prefix || ms.startsWith(`${prefix}-`)) && has(m)
    })
    if (!candidates.length) continue
    candidates.sort((a, b) => (b.release_date || '').localeCompare(a.release_date || ''))
    return candidates[0]
  }
  return null
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

function resolveOpenWeights(
  aa: AaModel | null | undefined,
  related: AaModel | null | undefined,
  slug: string,
  name: string,
  creator: string
): boolean | null {
  const direct = aa?.open_weights?.is_open_weights
  if (typeof direct === 'boolean') return direct
  const fromRelated = related?.open_weights?.is_open_weights
  if (typeof fromRelated === 'boolean') return fromRelated
  const override = lookupMetaOverride(slug, name)
  if (typeof override?.openWeights === 'boolean') return override.openWeights
  const brand = resolveBrandKey({ creator, slug, name })
  if (brand && brand in BRAND_OPEN_DEFAULT) return BRAND_OPEN_DEFAULT[brand]!
  return null
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

  // 日更指数（更新鲜）覆盖 AA 镜像分数；并带回 creator 供 AA 缺字段时回退
  type Overlay = Partial<Record<'intelligence' | 'coding' | 'science' | 'gpqa', number>> & {
    creator?: string
    name?: string
  }
  const overlays: Record<string, Overlay> = {}
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
        if (m.creator && !overlays[slug].creator) overlays[slug].creator = m.creator
        if (m.name && !overlays[slug].name) overlays[slug].name = m.name
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
    const o = overlays[s.slug] || {}
    const related = findRelatedAa(s.slug, o.name || s.slug, bySlug, aaModels)
    const aa = s.aa || bySlug.get(s.slug) || related || undefined
    const ev = aa?.evaluations || {}
    const name = aa?.name || o.name || s.slug
    const shortName = aa?.short_name || name
    const creator = inferCreatorName(
      s.slug,
      name,
      aa?.creator?.name || related?.creator?.name || o.creator
    )
    const countryCode = inferCountryCode(
      aa?.creator?.country || related?.creator?.country,
      creator,
      s.slug,
      name
    )
    const releaseDate =
      aa?.release_date ||
      related?.release_date ||
      findFamilyAa(s.slug, aaModels, (m) => !!m.release_date)?.release_date ||
      null

    // 上下文 / 价格：自身缺失时回退同族最新模型，并标记为估算
    // 参数量只回退紧密相关变体（见下方），避免跨代误用
    const ctxDirect = aa?.capabilities?.context_window_tokens ?? null
    const ctxRef =
      ctxDirect == null
        ? findFamilyAa(s.slug, aaModels, (m) => m.capabilities?.context_window_tokens != null)
        : null
    const contextWindow = ctxDirect ?? ctxRef?.capabilities?.context_window_tokens ?? null

    // 参数量：AA → 紧密相关变体 → 公开披露补丁（避免 K3 误用 K2）
    const metaOverride = lookupMetaOverride(s.slug, name)
    const paramsDirect = aa?.capabilities?.total_parameters ?? null
    const paramsFromRelated =
      paramsDirect == null && related?.capabilities?.total_parameters != null ? related : null
    const totalParams =
      paramsDirect ??
      paramsFromRelated?.capabilities?.total_parameters ??
      metaOverride?.totalParams ??
      null
    const activeParams =
      aa?.capabilities?.active_parameters ??
      paramsFromRelated?.capabilities?.active_parameters ??
      (metaOverride?.activeParams !== undefined ? metaOverride.activeParams : null) ??
      null
    const paramsRef =
      paramsDirect == null && paramsFromRelated
        ? paramsFromRelated.short_name || paramsFromRelated.name || null
        : paramsDirect == null && metaOverride?.totalParams != null
          ? '公开披露'
          : null

    const priceDirect = blendedPrice(aa?.pricing)
    const priceRef =
      priceDirect == null
        ? findFamilyAa(s.slug, aaModels, (m) => blendedPrice(m.pricing) != null)
        : null
    const priceBlended = priceDirect ?? blendedPrice(priceRef?.pricing)
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
      creator,
      countryCode,
      countryFlag: countryFlagEmoji(countryCode),
      openWeights: resolveOpenWeights(aa, related, s.slug, name, creator),
      releaseDate,
      totalParams,
      activeParams,
      paramsRef,
      contextWindow,
      contextRef: ctxRef?.short_name || ctxRef?.name || null,
      priceBlended,
      priceRef: priceRef?.short_name || priceRef?.name || null,
      priceInput: aa?.pricing?.price_1m_input_tokens ?? priceRef?.pricing?.price_1m_input_tokens ?? null,
      priceOutput: aa?.pricing?.price_1m_output_tokens ?? priceRef?.pricing?.price_1m_output_tokens ?? null,
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

/** 参数量（十亿）→ 108B / 1T/42B */
export function formatParams(total: number | null, active?: number | null): string {
  if (total == null || !Number.isFinite(total)) return '—'
  const fmt = (n: number) => {
    if (n >= 1000) {
      const t = n / 1000
      return `${Number.isInteger(t) ? t : Math.round(t * 10) / 10}T`
    }
    if (n >= 10) return `${Math.round(n)}B`
    if (n >= 1) return `${Math.round(n * 10) / 10}B`
    return `${Math.round(n * 100) / 100}B`
  }
  if (active != null && Number.isFinite(active) && Math.abs(active - total) > 0.05) {
    return `${fmt(total)}/${fmt(active)}`
  }
  return fmt(total)
}

/** 缩短模型括号变体：Adaptive Reasoning, Max Effort → AR·Max */
export function compactModelLabel(raw: string): string {
  if (!raw) return '—'
  let s = raw
  s = s.replace(/Adaptive Reasoning,\s*/gi, 'AR·')
  s = s.replace(/\s*Effort/gi, '')
  s = s.replace(/\bMedium\b/gi, 'Med')
  s = s.replace(/,\s*Opus\s*([\d.]+)\s*Fallback/gi, ' · Opus$1 fb')
  s = s.replace(/\bwith fallback\b/gi, 'fb')
  s = s.replace(/\bNon-reasoning\b/gi, 'NR')
  s = s.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')
  s = s.replace(/,\s*,/g, ',').replace(/\s{2,}/g, ' ').trim()
  return s
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
