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
  models: Record<string, number>
  modelCosts?: Record<string, number>
  modelClients?: Record<string, string>
  modelInput?: Record<string, number>
  modelOutput?: Record<string, number>
  /** 各模型命中缓存 Token */
  modelCacheRead?: Record<string, number>
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

export const MONITOR_TOOL_IDS = ['claude', 'codex', 'kimi', 'cursor', 'opencode'] as const
