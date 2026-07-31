/** 连接本机 token-agent（参考 Javis603/token-monitor） */

export interface DetectedTool {
  id: string
  name: string
  installed: boolean
  status: 'active' | 'waiting' | 'detected' | 'missing'
  binaries: { name: string; path: string }[]
  dataDirs: string[]
  apps?: string[]
  monthTokens?: number
  monthCostUsd?: number
  /** Claude：实际供应商（如 OpenRouter） */
  provider?: string
  /** Claude：配置的模型短名（如 HY3(free)） */
  configuredModel?: string
  /** 列表优先展示名（如供应商） */
  displayName?: string
}

export interface UsagePeriod {
  totalTokens: number
  totalCostUsd: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  clients: Record<string, number>
  clientCosts: Record<string, number>
  /** 各工具运行时长（毫秒） */
  clientActiveMs?: Record<string, number>
  /** 各工具命中缓存 Token */
  clientCacheRead?: Record<string, number>
  /** 各工具唯一 sessionId 数量 */
  clientSessions?: Record<string, number>
  /** 各工具提问次数（role=user / messageCount） */
  clientMessages?: Record<string, number>
  models: Record<string, number>
  modelCosts?: Record<string, number>
  modelClients?: Record<string, string>
  modelInput?: Record<string, number>
  modelOutput?: Record<string, number>
  /** 各模型命中缓存 Token */
  modelCacheRead?: Record<string, number>
  modelSessions?: Record<string, number>
  modelMessages?: Record<string, number>
}

export interface HistoryDay {
  date: string
  totalTokens: number
  totalCostUsd: number
  messages: number
  activeTimeMs?: number
  clients: Record<string, number>
  clientCosts: Record<string, number>
  /** 按日模型用量（graph 行内 modelId） */
  models?: Record<string, number>
  modelCosts?: Record<string, number>
  modelClients?: Record<string, string>
}

/** 官方额度（OpenRouter 充值 / Cursor·ChatGPT 套餐百分比） */
export interface OfficialBilling {
  ok: boolean
  toolId: string
  kind: 'credits' | 'plan_percent'
  provider?: string
  billingMode?: 'prepaid' | 'subscription'
  planName?: string
  priceLabel?: string
  unit?: string
  /** credits (USD) */
  total?: number
  used?: number
  remaining?: number
  /** plan percent 0–100 */
  usedPercent?: number
  remainingPercent?: number
  totalPercentUsed?: number
  autoPercentUsed?: number
  apiPercentUsed?: number
  limitCents?: number
  includedSpendCents?: number
  remainingCents?: number
  windowSeconds?: number | null
  resetAt?: number | string | null
  /** Cursor 账单周期（毫秒时间戳字符串或数字） */
  billingCycleStart?: number | string | null
  billingCycleEnd?: number | string | null
  creditsBalanceUsd?: number
  hasCredits?: boolean
  displayMessage?: string | null
  accountEmail?: string | null
  accounts?: Array<{
    email: string
    name?: string | null
    planName?: string
    status: 'logged_in' | 'not_logged_in'
    usedPercent?: number
    remainingPercent?: number
    windowSeconds?: number | null
    resetAt?: number | string | null
  }>
  /** Kimi Code */
  weeklyUsed?: number
  weeklyLimit?: number
  weeklyRemaining?: number
  weeklyResetAt?: string | null
  fiveHour?: {
    used: number
    limit: number
    remaining: number
    usedPercent: number
    resetAt?: string | null
  } | null
  balanceCny?: number
  monthlyUsedCny?: number
  currency?: string
  source?: string
  error?: string
}

export interface TokenSnapshot {
  ok: boolean
  source: string
  reference?: string
  engine?: string
  updatedAt: string
  hostname?: string
  tools: DetectedTool[]
  trackedClients: string[]
  today: UsagePeriod
  week?: UsagePeriod
  month: UsagePeriod
  durations?: {
    today: Record<string, number>
    week: Record<string, number>
    month: Record<string, number>
  }
  history: HistoryDay[]
  billing?: {
    byTool: Record<string, OfficialBilling>
    errors?: string[]
    updatedAt?: string | null
  }
  warnings: string[]
  cached?: boolean
  error?: string
}

const LOCAL_AGENT = 'http://127.0.0.1:3847'
const DEV_PROXY = '/token-agent'

function agentBase(): string {
  if (import.meta.env.DEV) return DEV_PROXY
  return (import.meta.env.VITE_TOKEN_AGENT_URL as string | undefined)?.trim() || LOCAL_AGENT
}

function withTimeout(ms: number): AbortSignal {
  const c = new AbortController()
  setTimeout(() => c.abort(), ms)
  return c.signal
}

export async function fetchAgentHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${agentBase()}/api/health`, { signal: withTimeout(2000) })
    if (!res.ok) return false
    const data = await res.json()
    return Boolean(data?.ok)
  } catch {
    return false
  }
}

export async function fetchTokenSnapshot(refresh = false): Promise<TokenSnapshot> {
  const q = refresh ? '?refresh=1' : ''
  const res = await fetch(`${agentBase()}/api/stats${q}`, {
    signal: withTimeout(180_000),
  })
  if (!res.ok) {
    throw new Error(`token-agent HTTP ${res.status}`)
  }
  return (await res.json()) as TokenSnapshot
}

/** 通过本机 agent 调起 CLI（终端）或 GUI 应用 */
export async function launchLocalTool(toolId: string): Promise<{ ok: boolean; error?: string; via?: string }> {
  const res = await fetch(`${agentBase()}/api/launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolId }),
    signal: withTimeout(10_000),
  })
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    error?: string
    via?: string
  }
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `启动失败（HTTP ${res.status}）`)
  }
  return { ok: true, via: data.via }
}

export const MONITOR_TOOL_IDS = ['claude', 'codex', 'kimi', 'cursor', 'opencode', 'qoder'] as const

/** Cursor Pro 等订阅月费上限（美元） */
export function cursorPlanUsd(bill?: OfficialBilling | null): number | null {
  if (!bill?.ok) return null
  if (bill.billingMode !== 'subscription' && bill.kind !== 'plan_percent') return null
  if (typeof bill.limitCents === 'number' && bill.limitCents > 0) return bill.limitCents / 100
  const m = String(bill.priceLabel || '').match(/\$?\s*([\d.]+)/)
  if (m) return Number(m[1])
  if (String(bill.planName || '').toLowerCase().includes('pro')) return 20
  return 20
}

function rescaleClientCostInPlace(
  period: {
    totalCostUsd?: number
    clientCosts?: Record<string, number>
    modelCosts?: Record<string, number>
    modelClients?: Record<string, string>
  },
  client: string,
  nextCost: number
) {
  if (!period.clientCosts) period.clientCosts = {}
  const old = Number(period.clientCosts[client] || 0)
  const next = Math.round(Math.max(0, nextCost) * 1e6) / 1e6
  if (!(old > 0) || Math.abs(old - next) < 1e-9) {
    period.clientCosts[client] = next
    return
  }
  const ratio = next / old
  period.clientCosts[client] = next
  period.totalCostUsd = Math.round((Number(period.totalCostUsd || 0) - old + next) * 1e6) / 1e6
  for (const [mid, tool] of Object.entries(period.modelClients || {})) {
    if (tool !== client || !period.modelCosts?.[mid]) continue
    period.modelCosts[mid] = Math.round(period.modelCosts[mid] * ratio * 1e6) / 1e6
  }
}

/** ChatGPT 订阅月费合计（美元）：按已登记账号的套餐累加（如 2 × Plus $20 = $40） */
export function chatgptPlanUsd(bill?: OfficialBilling | null): number | null {
  if (!bill?.ok || bill.billingMode !== 'subscription') return null
  const priceOf = (name?: string | null) => {
    const n = String(name || 'plus').toLowerCase()
    if (n.includes('pro')) return 200
    if (n.includes('team')) return 30
    if (n.includes('free')) return 0
    return 20
  }
  const accounts = bill.accounts || []
  if (accounts.length) return accounts.reduce((s, a) => s + priceOf(a.planName), 0)
  return priceOf(bill.planName)
}

/** 将某工具的费用封顶到订阅月费：月 ≤ 套餐价，周/日按日历天数折算 */
function capSubscriptionCostInPlace(
  next: TokenSnapshot,
  toolId: string,
  planUsd: number,
  monthTarget: number
) {
  const weekCap = (planUsd * 7) / 31
  const dayCap = planUsd / 31
  if (next.month) {
    rescaleClientCostInPlace(
      next.month,
      toolId,
      Math.min(Number(next.month.clientCosts?.[toolId] || 0), monthTarget, planUsd)
    )
  }
  if (next.week) {
    rescaleClientCostInPlace(
      next.week,
      toolId,
      Math.min(Number(next.week.clientCosts?.[toolId] || 0), weekCap)
    )
  }
  if (next.today) {
    rescaleClientCostInPlace(
      next.today,
      toolId,
      Math.min(Number(next.today.clientCosts?.[toolId] || 0), dayCap)
    )
  }
  for (const d of next.history || []) {
    rescaleClientCostInPlace(d, toolId, Math.min(Number(d.clientCosts?.[toolId] || 0), dayCap))
  }
  for (const t of next.tools || []) {
    if (t.id === toolId) t.monthCostUsd = next.month?.clientCosts?.[toolId] || 0
  }
}

/**
 * 纠正订阅制工具的预估费用：tokscale 按 API 标价会估出上千美元，
 * 但 Cursor Pro / ChatGPT Plus 为包月订阅，实际支出不超过订阅月费。
 * 对已缓存的旧快照同样生效。
 */
export function normalizeSubscriptionCosts(snapshot: TokenSnapshot): TokenSnapshot {
  const cursorBill = snapshot.billing?.byTool?.cursor
  const cursorPlan = cursorPlanUsd(cursorBill)
  const codexBill = snapshot.billing?.byTool?.codex
  const codexPlan = chatgptPlanUsd(codexBill)
  const hasCursor = cursorPlan != null && cursorPlan > 0
  const hasCodex = codexPlan != null && codexPlan > 0
  if (!hasCursor && !hasCodex) return snapshot

  const next: TokenSnapshot = {
    ...snapshot,
    today: snapshot.today ? { ...snapshot.today, clientCosts: { ...snapshot.today.clientCosts }, modelCosts: { ...(snapshot.today.modelCosts || {}) } } : snapshot.today,
    week: snapshot.week
      ? { ...snapshot.week, clientCosts: { ...snapshot.week.clientCosts }, modelCosts: { ...(snapshot.week.modelCosts || {}) } }
      : snapshot.week,
    month: snapshot.month
      ? { ...snapshot.month, clientCosts: { ...snapshot.month.clientCosts }, modelCosts: { ...(snapshot.month.modelCosts || {}) } }
      : snapshot.month,
    history: (snapshot.history || []).map((d) => ({
      ...d,
      clientCosts: { ...d.clientCosts },
      modelCosts: { ...(d.modelCosts || {}) },
    })),
    tools: (snapshot.tools || []).map((t) => ({ ...t })),
  }

  if (hasCursor) {
    // Cursor Dashboard 提供本账期用量占比，按占比 × 月费估算
    const monthTarget =
      typeof cursorBill?.usedPercent === 'number'
        ? Math.min(cursorPlan, (Math.max(0, cursorBill.usedPercent) / 100) * cursorPlan)
        : Math.min(Number(next.month?.clientCosts?.cursor || 0), cursorPlan)
    capSubscriptionCostInPlace(next, 'cursor', cursorPlan, monthTarget)
  }
  if (hasCodex) {
    // ChatGPT 的 usedPercent 是限流窗口占比而非账期进度，直接以订阅月费封顶
    capSubscriptionCostInPlace(next, 'codex', codexPlan, codexPlan)
  }
  return next
}

/** 缓存命中率：cache / (input + cache) */
export function cacheHitPct(cacheT: number, inputT: number): number {
  const den = cacheT + inputT
  if (!(den > 0)) return 0
  return (cacheT / den) * 100
}
