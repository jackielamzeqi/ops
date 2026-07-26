/**
 * 官方额度 / 余额查询（参考 CC Switch OpenRouter credits + Cursor Dashboard + ChatGPT wham）
 * 密钥仅在本机 agent 内读取，绝不写入快照返回体。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function readJsonSafe(file) {
  try {
    if (!fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

const HTTP_RETRY_DELAYS_MS = [500, 1500]

async function httpJson(url, { method = 'GET', headers = {}, body, timeoutMs = 15_000 } = {}) {
  let lastErr = null
  for (let attempt = 0; attempt <= HTTP_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, HTTP_RETRY_DELAYS_MS[attempt - 1]))
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        method,
        headers,
        body,
        signal: ctrl.signal,
      })
      const text = await res.text()
      let json = null
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        /* non-json */
      }
      // 5xx 可重试；4xx 直接返回
      if (res.status >= 500 && attempt < HTTP_RETRY_DELAYS_MS.length) {
        lastErr = new Error(`HTTP ${res.status}`)
        continue
      }
      return { ok: res.ok, status: res.status, json, text }
    } catch (e) {
      lastErr = e
      if (attempt >= HTTP_RETRY_DELAYS_MS.length) break
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastErr || new Error('fetch failed')
}

/** 各工具上次成功的官方额度，网络抖动时避免整卡掉进本地估算回退 */
const BILLING_CACHE_FILE = path.join(os.homedir(), '.cache', 'personal-ops', 'billing-last-good.json')
const lastGoodByTool = Object.create(null)

function loadLastGoodBilling() {
  const raw = readJsonSafe(BILLING_CACHE_FILE)
  if (!raw || typeof raw !== 'object') return
  for (const [id, row] of Object.entries(raw)) {
    if (row && typeof row === 'object' && row.ok && row.toolId) lastGoodByTool[id] = row
  }
}

function saveLastGoodBilling() {
  try {
    fs.mkdirSync(path.dirname(BILLING_CACHE_FILE), { recursive: true })
    fs.writeFileSync(BILLING_CACHE_FILE, JSON.stringify(lastGoodByTool, null, 2))
  } catch {
    /* ignore */
  }
}

loadLastGoodBilling()

function num(v, fallback = 0) {
  const n = typeof v === 'string' ? Number(v) : Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** Claude / OpenRouter：从 settings 读 key（不外泄） */
function readClaudeEnv() {
  const files = [
    path.join(os.homedir(), '.claude', 'settings.json'),
    path.join(os.homedir(), '.claude', 'settings.local.json'),
  ]
  let env = {}
  for (const file of files) {
    const raw = readJsonSafe(file)
    if (raw?.env && typeof raw.env === 'object') env = { ...env, ...raw.env }
  }
  return env
}

/**
 * OpenRouter：GET /api/v1/credits
 * remaining = total_credits - total_usage（与 CC Switch 一致）
 */
export async function fetchOpenRouterCredits() {
  const env = readClaudeEnv()
  const baseUrl = String(env.ANTHROPIC_BASE_URL || '').trim()
  if (baseUrl && !/openrouter/i.test(baseUrl)) {
    return { ok: false, toolId: 'claude', error: '当前 Claude 未配置 OpenRouter' }
  }
  const key = String(
    env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || process.env.OPENROUTER_API_KEY || ''
  ).trim()
  if (!key) return { ok: false, toolId: 'claude', error: '未找到 OpenRouter API Key' }

  const res = await httpJson('https://openrouter.ai/api/v1/credits', {
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
  })
  if (!res.ok || !res.json) {
    return { ok: false, toolId: 'claude', error: `OpenRouter credits HTTP ${res.status}` }
  }
  const data = res.json.data || res.json
  const total = num(data.total_credits)
  const used = num(data.total_usage)
  const remaining = total - used
  return {
    ok: true,
    toolId: 'claude',
    kind: 'credits',
    provider: 'OpenRouter',
    billingMode: 'prepaid',
    unit: 'USD',
    total,
    used,
    remaining,
    source: 'openrouter:/api/v1/credits',
  }
}

function readCursorAccessToken() {
  const db = path.join(
    os.homedir(),
    'Library/Application Support/Cursor/User/globalStorage/state.vscdb'
  )
  if (fs.existsSync(db)) {
    try {
      const out = execFileSync(
        'sqlite3',
        [`file:${db}?mode=ro`, "SELECT value FROM ItemTable WHERE key='cursorAuth/accessToken';"],
        { encoding: 'utf8', timeout: 5000 }
      ).trim()
      if (out) return out
    } catch {
      /* fall through */
    }
  }
  // tokscale 凭证里的 sessionToken（Workos 格式）作备用
  const cred = readJsonSafe(path.join(os.homedir(), '.config/tokscale/cursor-credentials.json'))
  const active = cred?.activeAccountId
  const acct = active && cred?.accounts?.[active]
  if (acct?.sessionToken) {
    const raw = decodeURIComponent(String(acct.sessionToken))
    const parts = raw.split('::')
    return parts[1] || raw
  }
  return null
}

/** Cursor：Dashboard GetCurrentPeriodUsage（与设置页 Plan & Usage 一致） */
export async function fetchCursorPlanUsage() {
  const token = readCursorAccessToken()
  if (!token) return { ok: false, toolId: 'cursor', error: '未找到 Cursor 登录凭证' }

  const res = await httpJson(
    'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'User-Agent': 'PersonalOps-TokenAgent/1.0',
      },
      body: '{}',
    }
  )
  if (!res.ok || !res.json) {
    return { ok: false, toolId: 'cursor', error: `Cursor usage HTTP ${res.status}` }
  }

  let planName = 'Pro'
  let priceLabel = null
  try {
    const planRes = await httpJson(
      'https://api2.cursor.sh/aiserver.v1.DashboardService/GetPlanInfo',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1',
          'User-Agent': 'PersonalOps-TokenAgent/1.0',
        },
        body: '{}',
      }
    )
    if (planRes.ok && planRes.json?.planInfo) {
      planName = planRes.json.planInfo.planName || planName
      priceLabel = planRes.json.planInfo.price || null
    }
  } catch {
    /* optional */
  }

  const plan = res.json.planUsage || {}
  const totalPercentUsed = num(plan.totalPercentUsed)
  const autoPercentUsed = num(plan.autoPercentUsed)
  const apiPercentUsed = num(plan.apiPercentUsed)
  const limitCents = num(plan.limit)
  const includedSpendCents = num(plan.includedSpend)
  const remainingCents = Math.max(limitCents - includedSpendCents, 0)

  return {
    ok: true,
    toolId: 'cursor',
    kind: 'plan_percent',
    provider: 'Cursor',
    billingMode: 'subscription',
    planName,
    priceLabel,
    unit: 'percent',
    usedPercent: totalPercentUsed,
    remainingPercent: Math.max(100 - totalPercentUsed, 0),
    autoPercentUsed,
    apiPercentUsed,
    totalPercentUsed,
    limitCents,
    includedSpendCents,
    remainingCents,
    billingCycleStart: res.json.billingCycleStart || null,
    billingCycleEnd: res.json.billingCycleEnd || null,
    displayMessage: res.json.displayMessage || null,
    source: 'cursor:GetCurrentPeriodUsage',
  }
}

function readCodexAuth() {
  const auth = readJsonSafe(path.join(os.homedir(), '.codex', 'auth.json'))
  if (!auth) return null
  let tokens = auth.tokens || {}
  if (typeof tokens === 'string') {
    try {
      tokens = JSON.parse(tokens)
    } catch {
      tokens = {}
    }
  }
  const access = tokens.access_token || tokens.accessToken || null
  const accountId = tokens.account_id || tokens.accountId || null
  let identity = {}
  try {
    const idToken = tokens.id_token || tokens.idToken
    const payload = idToken ? JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8')) : {}
    identity = { email: payload.email || null, name: payload.name || null }
  } catch {
    identity = {}
  }
  return access ? { access, accountId, authMode: auth.auth_mode, ...identity } : null
}

function readChatGPTAccountCatalog() {
  const configured = readJsonSafe(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'chatgpt-accounts.json'))
  return Array.isArray(configured?.accounts) ? configured.accounts : []
}

/** ChatGPT / Codex：chatgpt.com/backend-api/wham/usage */
export async function fetchChatGPTUsage() {
  const auth = readCodexAuth()
  if (!auth?.access) return { ok: false, toolId: 'codex', error: '未找到 Codex/ChatGPT 登录凭证' }

  const headers = {
    Authorization: `Bearer ${auth.access}`,
    Accept: 'application/json',
    'User-Agent': 'PersonalOps-TokenAgent/1.0',
  }
  if (auth.accountId) headers['ChatGPT-Account-ID'] = auth.accountId

  const res = await httpJson('https://chatgpt.com/backend-api/wham/usage', { headers })
  if (!res.ok || !res.json) {
    return { ok: false, toolId: 'codex', error: `ChatGPT usage HTTP ${res.status}` }
  }

  const d = res.json
  const rl = d.rate_limit || {}
  const primary = rl.primary_window || {}
  const secondary = rl.secondary_window || null
  const usedPercent = num(primary.used_percent)
  const credits = d.credits || {}
  const creditBalance = num(credits.balance)
  const catalog = readChatGPTAccountCatalog()
  const accounts = catalog.map((account) => {
    const loggedIn = Boolean(auth.email && account.email.toLowerCase() === auth.email.toLowerCase())
    return {
      email: account.email,
      name: loggedIn ? auth.name || null : null,
      planName: account.planName || (loggedIn ? d.plan_type : 'plus'),
      status: loggedIn ? 'logged_in' : 'not_logged_in',
      ...(loggedIn ? {
        usedPercent,
        remainingPercent: Math.max(100 - usedPercent, 0),
        windowSeconds: num(primary.limit_window_seconds, null) || null,
        resetAt: primary.reset_at || null,
      } : {}),
    }
  })
  if (auth.email && !accounts.some((account) => account.email.toLowerCase() === auth.email.toLowerCase())) {
    accounts.unshift({
      email: auth.email,
      name: auth.name || null,
      planName: d.plan_type || 'plus',
      status: 'logged_in',
      usedPercent,
      remainingPercent: Math.max(100 - usedPercent, 0),
      windowSeconds: num(primary.limit_window_seconds, null) || null,
      resetAt: primary.reset_at || null,
    })
  }

  return {
    ok: true,
    toolId: 'codex',
    kind: 'plan_percent',
    provider: 'ChatGPT',
    billingMode: 'subscription',
    planName: d.plan_type || 'plus',
    unit: 'percent',
    usedPercent,
    remainingPercent: Math.max(100 - usedPercent, 0),
    windowSeconds: num(primary.limit_window_seconds, null) || null,
    resetAt: primary.reset_at || null,
    resetAfterSeconds: num(primary.reset_after_seconds, null) || null,
    secondaryUsedPercent: secondary ? num(secondary.used_percent) : null,
    creditsBalanceUsd: creditBalance,
    hasCredits: Boolean(credits.has_credits),
    allowed: rl.allowed !== false,
    limitReached: Boolean(rl.limit_reached),
    accountEmail: auth.email || null,
    accounts,
    source: 'chatgpt:wham/usage',
  }
}

const KIMI_FIXED_POINT_CENTS = 1e6
const KIMI_CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098'
const KIMI_CRED_PATH = path.join(os.homedir(), '.kimi-code', 'credentials', 'kimi-code.json')

async function ensureKimiAccessToken() {
  const cred = readJsonSafe(KIMI_CRED_PATH)
  if (!cred?.access_token) return null
  const expiresAt = Number(cred.expires_at || 0)
  const stillFresh = expiresAt > Math.floor(Date.now() / 1000) + 60
  if (stillFresh) return cred.access_token
  if (!cred.refresh_token) return cred.access_token

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: String(cred.refresh_token),
    client_id: KIMI_CLIENT_ID,
  })
  const res = await httpJson('https://auth.kimi.com/api/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  })
  if (!res.ok || !res.json?.access_token) {
    return cred.access_token // 尽量用旧 token
  }
  const expiresIn = Number(res.json.expires_in || 900)
  const next = {
    ...cred,
    access_token: res.json.access_token,
    refresh_token: res.json.refresh_token || cred.refresh_token,
    token_type: res.json.token_type || cred.token_type || 'Bearer',
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    scope: res.json.scope || cred.scope,
  }
  try {
    const tmp = `${KIMI_CRED_PATH}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2))
    fs.renameSync(tmp, KIMI_CRED_PATH)
  } catch {
    /* 写回失败不影响本次查询 */
  }
  return next.access_token
}

/**
 * Kimi Code：GET /coding/v1/usages
 * 周额度 + 5h 窗口 + Extra Usage 余额（人民币）
 */
export async function fetchKimiUsage() {
  const token = await ensureKimiAccessToken()
  if (!token) return { ok: false, toolId: 'kimi', error: '未找到 Kimi Code 登录凭证' }

  const base = (process.env.KIMI_CODE_BASE_URL || 'https://api.kimi.com/coding/v1').replace(
    /\/+$/,
    ''
  )
  const res = await httpJson(`${base}/usages`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'User-Agent': 'PersonalOps-TokenAgent/1.0',
    },
  })
  if (!res.ok || !res.json) {
    return { ok: false, toolId: 'kimi', error: `Kimi usages HTTP ${res.status}` }
  }

  const d = res.json
  const weekly = d.usage || {}
  const weeklyLimit = num(weekly.limit)
  const weeklyUsed = num(weekly.used)
  const weeklyRemaining =
    weekly.remaining != null ? num(weekly.remaining) : Math.max(weeklyLimit - weeklyUsed, 0)
  const weeklyPct =
    weeklyLimit > 0 ? Math.min((weeklyUsed / weeklyLimit) * 100, 100) : weeklyUsed > 0 ? 100 : 0

  // 5h 窗口（duration 300 分钟）
  let fiveH = null
  for (const item of d.limits || []) {
    const win = item?.window || {}
    const detail = item?.detail || item || {}
    const duration = num(win.duration)
    const unit = String(win.timeUnit || '')
    const isFiveH =
      (unit.includes('MINUTE') && duration === 300) ||
      (unit.includes('HOUR') && duration === 5) ||
      duration === 300
    if (!isFiveH) continue
    const limit = num(detail.limit)
    const remaining = detail.remaining != null ? num(detail.remaining) : null
    const used =
      detail.used != null
        ? num(detail.used)
        : remaining != null && limit > 0
          ? Math.max(limit - remaining, 0)
          : 0
    fiveH = {
      used,
      limit,
      remaining: remaining ?? Math.max(limit - used, 0),
      usedPercent: limit > 0 ? Math.min((used / limit) * 100, 100) : 0,
      resetAt: detail.resetTime || null,
    }
    break
  }

  const wallet = d.boosterWallet || {}
  const bal = wallet.balance || {}
  // boosterWallet.balance.amount 是钱包「充值总额」（定点数，1e6 = 1 分），
  // 并非可用余额；实际可用余额 = 充值总额 − 本月已用。
  // 新版字段 amount；保留 amountLeft 兼容旧版响应。
  const rawAmount = num(bal.amount || bal.amountLeft)
  const walletTotalCents = rawAmount > 0 ? Math.round(rawAmount / KIMI_FIXED_POINT_CENTS) : 0
  const walletTotalCny = walletTotalCents / 100
  const monthlyUsedCents = num(wallet.monthlyUsed?.priceInCents)
  const monthlyUsedCny = monthlyUsedCents / 100
  // 可用余额扣除本月已用；若无法计量则为 0（避免把充值总额误报成余额）
  const balanceCny = Math.max(walletTotalCny - monthlyUsedCny, 0)
  const membership = d.user?.membership?.level || ''

  return {
    ok: true,
    toolId: 'kimi',
    kind: 'plan_percent',
    provider: 'Kimi Code',
    billingMode: 'subscription',
    planName: membership.replace(/^LEVEL_/, '') || 'BASIC',
    unit: 'percent',
    usedPercent: weeklyPct,
    remainingPercent: Math.max(100 - weeklyPct, 0),
    weeklyUsed,
    weeklyLimit,
    weeklyRemaining,
    weeklyResetAt: weekly.resetTime || null,
    fiveHour: fiveH,
    balanceCny,
    monthlyUsedCny,
    currency: wallet.monthlyUsed?.currency || wallet.topupLimit?.currency || 'CNY',
    source: 'kimi:/coding/v1/usages',
  }
}

/** 并行拉取官方额度（失败不阻断；单工具失败时回退上次成功结果） */
export async function fetchOfficialBilling() {
  const [openrouter, cursor, chatgpt, kimi] = await Promise.all([
    fetchOpenRouterCredits().catch((e) => ({ ok: false, toolId: 'claude', error: String(e.message || e) })),
    fetchCursorPlanUsage().catch((e) => ({ ok: false, toolId: 'cursor', error: String(e.message || e) })),
    fetchChatGPTUsage().catch((e) => ({ ok: false, toolId: 'codex', error: String(e.message || e) })),
    fetchKimiUsage().catch((e) => ({ ok: false, toolId: 'kimi', error: String(e.message || e) })),
  ])

  const byTool = {}
  const errors = []
  for (const r of [openrouter, cursor, chatgpt, kimi]) {
    if (r?.ok && r.toolId) {
      byTool[r.toolId] = r
      lastGoodByTool[r.toolId] = r
      continue
    }
    const toolId = r?.toolId
    if (toolId && lastGoodByTool[toolId]) {
      byTool[toolId] = { ...lastGoodByTool[toolId], stale: true }
      if (r?.error) errors.push(`${r.error}（已显示上次成功结果）`)
      continue
    }
    if (r && !r.ok && r.error) errors.push(r.error)
  }
  saveLastGoodBilling()
  return { byTool, errors, updatedAt: new Date().toISOString() }
}
