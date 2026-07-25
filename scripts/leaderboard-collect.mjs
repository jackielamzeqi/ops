/**
 * 大模型榜单采集（AA 镜像 + Arena），本地日缓存
 * 供 token-agent /api/leaderboard 使用
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TOP_N = 30
const DAY_MS = 24 * 60 * 60 * 1000
const CACHE_DIR = path.join(os.homedir(), '.cache', 'personal-ops')
const CACHE_FILE = path.join(CACHE_DIR, 'leaderboard.json')

const AA_MIRROR =
  'https://raw.githubusercontent.com/oolong-tea-2026/artificial-analysis-leaderboards/main'
const AA_INDEX =
  'https://raw.githubusercontent.com/EvanZhouDev/ai-model-index/main/data'
const ARENA_API = 'https://api.wulong.dev/arena-ai-leaderboards/v1'

function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10)
}

function normSlug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function toPct(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  const n = v <= 1.5 ? v * 100 : v
  return Math.round(n * 10) / 10
}

function blendedPrice(p) {
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

async function fetchJson(url, timeoutMs = 90_000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`${res.status} ${url}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

function readCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
  } catch {
    return null
  }
}

function writeCache(snap) {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  fs.writeFileSync(CACHE_FILE, JSON.stringify(snap))
}

function isFresh(snap) {
  if (!snap?.ok || !snap.updatedAt) return false
  if (snap.cacheDate === todayKey()) return true
  return Date.now() - new Date(snap.updatedAt).getTime() < DAY_MS
}

function buildArenaMap(board) {
  const map = new Map()
  for (const m of board?.models || []) {
    const key = normSlug(m.model)
    if (!key) continue
    map.set(key, { rank: m.rank, elo: m.score ?? 0 })
    const base = key.replace(/-thinking.*$/, '').replace(/-xhigh.*$/, '').replace(/-max.*$/, '')
    if (!map.has(base)) map.set(base, { rank: m.rank, elo: m.score ?? 0 })
  }
  return map
}

function findArena(slug, name, map) {
  const keys = [normSlug(slug), normSlug(name), normSlug(slug).replace(/-with-fallback$/, '')]
  for (const k of keys) {
    if (map.has(k)) return map.get(k)
    for (const [mk, v] of map) {
      if (mk.includes(k) || k.includes(mk)) return v
    }
  }
  return null
}

const BRAND_CREATOR_NAME = {
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

const CREATOR_COUNTRY = {
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
  'bytedance seed': 'cn',
  stepfun: 'cn',
  xiaomi: 'cn',
}

function countryFlagEmoji(code) {
  const c = String(code || '')
    .trim()
    .toLowerCase()
  if (!/^[a-z]{2}$/.test(c)) return '🏳️'
  const A = 0x1f1e6
  return String.fromCodePoint(A + c.charCodeAt(0) - 97, A + c.charCodeAt(1) - 97)
}

function inferBrand(slug, name, creator) {
  const blob = `${slug || ''} ${name || ''} ${creator || ''}`.toLowerCase()
  if (/claude|anthropic/.test(blob) || (/(^|[-_\s])(sonnet|opus|haiku|fable)([-_\s]|$)/.test(blob) && !/qwen|alibaba|gemini|gpt|grok|llama|glm/.test(blob))) {
    return 'anthropic'
  }
  if (/qwen|alibaba|tongyi|通义|阿里/.test(blob)) return 'alibaba'
  if (/\bgpt|openai|chatgpt|(^|[-_\s])o[1-9]([-_\s.]|$)/.test(blob)) return 'openai'
  if (/gemini|google|deepmind/.test(blob)) return 'google'
  if (/llama|meta\b|muse-spark/.test(blob)) return 'meta'
  if (/grok|xai|spacexai/.test(blob)) return 'xai'
  if (/deepseek/.test(blob)) return 'deepseek'
  if (/kimi|moonshot|月之暗面/.test(blob)) return 'moonshot'
  if (/minimax/.test(blob)) return 'minimax'
  if (/\bglm|zhipu|智谱|\bz ai\b/.test(blob)) return 'zhipu'
  if (/mistral|mixtral/.test(blob)) return 'mistral'
  return null
}

function inferCreatorName(slug, name, hint) {
  const fromHint = String(hint || '').trim()
  if (fromHint && fromHint !== '—') return fromHint
  const brand = inferBrand(slug, name, hint)
  return (brand && BRAND_CREATOR_NAME[brand]) || '—'
}

function inferCountryCode(aaCountry, creator, slug, name) {
  const fromAa = String(aaCountry || '')
    .trim()
    .toLowerCase()
  if (/^[a-z]{2}$/.test(fromAa)) return fromAa
  const c = String(creator || '')
    .trim()
    .toLowerCase()
  if (CREATOR_COUNTRY[c]) return CREATOR_COUNTRY[c]
  for (const [key, code] of Object.entries(CREATOR_COUNTRY)) {
    if (c.includes(key)) return code
  }
  const brand = inferBrand(slug, name, creator)
  if (['alibaba', 'deepseek', 'moonshot', 'minimax', 'zhipu'].includes(brand)) return 'cn'
  if (brand === 'mistral') return 'fr'
  if (brand) return 'us'
  return null
}

function stripModelVariant(slug) {
  return normSlug(slug)
    .replace(
      /-(adaptive|xhigh|high|medium|low|max|max-effort|non-reasoning|with-fallback|thinking|preview|exp|experimental|chat|instruct)(-|$)/g,
      '-'
    )
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function findRelatedAa(slug, name, bySlug, all) {
  const direct = bySlug.get(slug)
  if (direct) return direct
  const base = stripModelVariant(slug)
  if (base && bySlug.has(base)) return bySlug.get(base)
  const keys = [base, normSlug(name), stripModelVariant(name)].filter(Boolean)
  let best = null
  let bestScore = 0
  for (const m of all) {
    const ms = m.slug || ''
    if (!ms) continue
    const mb = stripModelVariant(ms)
    for (const k of keys) {
      if (!k) continue
      if (ms === k || mb === k) return m
      if (ms.startsWith(`${k}-`) || k.startsWith(`${ms}-`) || mb.startsWith(k) || k.startsWith(mb)) {
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

function findFamilyReleaseDate(slug, all) {
  const parts = stripModelVariant(slug).split('-').filter(Boolean)
  const minLen = parts[0] && parts[0].length >= 4 ? 1 : 2
  for (let len = Math.min(parts.length, 4); len >= minLen; len--) {
    const prefix = parts.slice(0, len).join('-')
    if (prefix.length < 4) continue
    const dates = all
      .map((m) => {
        const ms = m.slug || ''
        return ms === prefix || ms.startsWith(`${prefix}-`) ? m.release_date || null : null
      })
      .filter(Boolean)
      .sort()
    if (dates.length) return dates[dates.length - 1]
  }
  return null
}

export async function collectLeaderboard(force = false) {
  const cached = readCache()
  if (!force && isFresh(cached)) {
    return { ...cached, fromCache: true }
  }

  const warnings = []
  const sources = []
  let aaModels = []

  try {
    const latest = await fetchJson(`${AA_MIRROR}/data/latest.json`)
    const pathRel = latest.path?.startsWith('data/') ? latest.path : `data/${latest.date}`
    const llms = await fetchJson(`${AA_MIRROR}/${pathRel}/llms.json`)
    aaModels = (llms.models || []).filter((m) => !m.deprecated)
    sources.push({
      id: 'aa',
      label: 'Artificial Analysis',
      url: 'https://artificialanalysis.ai/leaderboards/models',
      fetchedAt: llms.meta?.fetched_at || latest.date,
    })
  } catch (e) {
    warnings.push(`Artificial Analysis 镜像拉取失败：${e.message || e}`)
  }

  const overlays = {}
  const overlayFiles = [
    { file: 'aa-intelligence.json', key: 'intelligence', label: 'AA Intelligence' },
    { file: 'aa-coding.json', key: 'coding', label: 'AA Coding' },
    { file: 'scicode.json', key: 'science', label: 'SciCode' },
    { file: 'gpqa.json', key: 'gpqa', label: 'GPQA' },
  ]
  for (const f of overlayFiles) {
    try {
      const data = await fetchJson(`${AA_INDEX}/llm/${f.file}`)
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
      warnings.push(`${f.label} 拉取失败：${e.message || e}`)
    }
  }

  let arenaText = null
  let arenaCode = null
  try {
    ;[arenaText, arenaCode] = await Promise.all([
      fetchJson(`${ARENA_API}/leaderboard?name=text`),
      fetchJson(`${ARENA_API}/leaderboard?name=code`),
    ])
    sources.push({
      id: 'arena',
      label: 'Arena AI',
      url: 'https://arena.ai/leaderboard/text',
      fetchedAt: arenaText.meta?.fetched_at || arenaText.meta?.last_updated,
    })
  } catch (e) {
    warnings.push(`Arena 拉取失败：${e.message || e}`)
  }

  const textMap = buildArenaMap(arenaText)
  const codeMap = buildArenaMap(arenaCode)
  const bySlug = new Map()
  for (const m of aaModels) {
    if (m.slug) bySlug.set(m.slug, m)
  }

  const seeds = []
  for (const [slug, o] of Object.entries(overlays)) {
    if (o.intelligence == null) continue
    seeds.push({ slug, aa: bySlug.get(slug), intelligence: o.intelligence })
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

  const models = seeds.slice(0, TOP_N).map((s, i) => {
    const o = overlays[s.slug] || {}
    const related = findRelatedAa(s.slug, o.name || s.slug, bySlug, aaModels)
    const aa = s.aa || bySlug.get(s.slug) || related || undefined
    const ev = aa?.evaluations || {}
    const name = aa?.name || o.name || s.slug
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
      aa?.release_date || related?.release_date || findFamilyReleaseDate(s.slug, aaModels) || null
    const arenaT = findArena(s.slug, name, textMap)
    const arenaC = findArena(s.slug, name, codeMap)
    return {
      rank: i + 1,
      name,
      shortName: aa?.short_name || name,
      slug: s.slug,
      creator,
      countryCode,
      countryFlag: countryFlagEmoji(countryCode),
      releaseDate,
      contextWindow: aa?.capabilities?.context_window_tokens ?? null,
      priceBlended: blendedPrice(aa?.pricing),
      priceInput: aa?.pricing?.price_1m_input_tokens ?? null,
      priceOutput: aa?.pricing?.price_1m_output_tokens ?? null,
      intelligence:
        o.intelligence ??
        (typeof ev.artificial_analysis_intelligence_index === 'number'
          ? Math.round(ev.artificial_analysis_intelligence_index * 10) / 10
          : s.intelligence),
      science: o.science ?? toPct(ev.scicode),
      gpqa: o.gpqa ?? toPct(ev.gpqa),
      coding:
        o.coding ??
        (typeof ev.artificial_analysis_coding_index === 'number'
          ? Math.round(ev.artificial_analysis_coding_index * 10) / 10
          : null),
      arenaTextRank: arenaT?.rank ?? null,
      arenaTextElo: arenaT?.elo ?? null,
      arenaCodeRank: arenaC?.rank ?? null,
      arenaCodeElo: arenaC?.elo ?? null,
    }
  })

  const snap = {
    ok: models.length > 0,
    updatedAt: new Date().toISOString(),
    cacheDate: todayKey(),
    sources,
    models,
    warnings,
    fromCache: false,
  }

  if (snap.ok) writeCache(snap)
  else if (cached?.ok) return { ...cached, fromCache: true, warnings: [...warnings, '使用昨日缓存'] }
  return snap
}

const once = process.argv.includes('--once')
if (once) {
  const snap = await collectLeaderboard(true)
  console.log(JSON.stringify(snap, null, 2))
}
