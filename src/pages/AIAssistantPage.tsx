import { useAIAssistantStore, useAuthStore, useSubscriptionStore } from '../store'
import { aiTools } from '../store/data'
import {
  formatNumber,
  formatCost,
  formatPct,
  calcChange,
  getToolColor,
  getToolName,
  getToolIcon,
  usdToCny,
  cnyToUsd,
  formatUsd,
  formatDuration,
} from '../utils/helpers'
import { WORK_ENVS } from '../lib/workEnv'
import { useTokenMonitor } from '../hooks/useTokenMonitor'
import { useExchangeRate } from '../hooks/useExchangeRate'
import { useModelLeaderboard } from '../hooks/useModelLeaderboard'
import { formatContext, formatScore } from '../lib/modelLeaderboard'
import { launchLocalTool, type OfficialBilling, type TokenSnapshot } from '../lib/tokenMonitor'
import { ToolLogo } from '../components/ToolLogo'
import { CreatorLogo } from '../components/CreatorLogo'
import { formatModelLabel } from '../utils/modelLabels'
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

const MODEL_BAR_COLORS = [
  '#0a84ff',
  '#30d158',
  '#ff9f0a',
  '#ff453a',
  '#bf5af2',
  '#64d2ff',
  '#ff375f',
  '#ac8e68',
]

type QuotaDot = 'ok' | 'low' | 'bad'

function remainingFromBill(bill?: OfficialBilling | null): number | null {
  if (!bill?.ok) return null
  if (bill.kind === 'credits') {
    const total = Math.max(bill.total || 0, 0)
    const remaining = bill.remaining ?? total - Math.max(bill.used || 0, 0)
    if (total <= 0) return remaining > 0 ? 100 : 0
    return Math.max(0, Math.min(100, (remaining / total) * 100))
  }
  if (bill.kind === 'plan_percent') {
    if (bill.accounts?.length) {
      const logged = bill.accounts.find((a) => a.status === 'logged_in')
      if (!logged) return 0
      return Math.max(
        0,
        Math.min(100, logged.remainingPercent ?? 100 - (logged.usedPercent || 0))
      )
    }
    return Math.max(
      0,
      Math.min(100, bill.remainingPercent ?? 100 - (bill.usedPercent ?? bill.totalPercentUsed ?? 0))
    )
  }
  return null
}

/** 消耗额度百分比（越高越靠前）；无法计量时为 0，未登录账号为 -1 */
function billUsedPercent(bill?: OfficialBilling | null, fallbackTokenPct = 0): number {
  if (!bill?.ok) return fallbackTokenPct
  if (bill.kind === 'credits') {
    const total = Math.max(bill.total || 0, 0)
    const used = Math.max(bill.used || 0, 0)
    if (total > 0) return Math.min((used / total) * 100, 100)
    return used > 0 ? 100 : 0
  }
  if (bill.kind === 'plan_percent') {
    return Math.min(bill.usedPercent ?? bill.totalPercentUsed ?? 0, 100)
  }
  return fallbackTokenPct
}

/** 绿=额度充足；黄=剩余 <20%；红=离线或无额度 */
function toolQuotaDot(
  toolId: string,
  opts: {
    monitorOnline: boolean
    installed: boolean
    snapshot: TokenSnapshot | null
    usedTokens: number
    tokenQuota: number
  }
): QuotaDot {
  if (!opts.monitorOnline || !opts.installed) return 'bad'
  const bill = opts.snapshot?.billing?.byTool?.[toolId]
  const fromBill = remainingFromBill(bill)
  const remaining =
    fromBill != null
      ? fromBill
      : opts.tokenQuota > 0
        ? Math.max(0, Math.min(100, ((opts.tokenQuota - opts.usedTokens) / opts.tokenQuota) * 100))
        : 100
  if (remaining <= 0) return 'bad'
  if (remaining < 20) return 'low'
  return 'ok'
}

function LaunchArrow() {
  return (
    <svg className="detect-launch-arrow" viewBox="0 0 12 12" aria-hidden>
      <path
        d="M4.2 2.2 8.3 6 4.2 9.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 图表 Y 轴：200K / 1.2M */
function formatAxisToken(n: number): string {
  if (n <= 0) return '0'
  if (n >= 1_000_000) {
    const v = n / 1_000_000
    return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)}M`
  }
  if (n >= 1000) {
    const v = n / 1000
    return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(0)}K`
  }
  return String(Math.round(n))
}

/** 额度栏展示名：Claude → 实际订阅渠道；Kimi 简称 */
function quotaToolName(
  toolId: string,
  fallback: string,
  detected?: { provider?: string } | null
): string {
  if (toolId === 'claude') return detected?.provider || 'OpenRouter'
  if (toolId === 'kimi') return 'Kimi Code'
  return fallback
}

function formatPlanLabel(name?: string | null): string {
  if (!name) return ''
  const key = name.toLowerCase()
  const map: Record<string, string> = {
    plus: 'Plus',
    pro: 'Pro',
    free: 'Free',
    pro_plus: 'Pro+',
    team: 'Team',
    ultra: 'Ultra',
  }
  return map[key] || name
}

function formatMoneyCny(usd: number, rate: number): string {
  return formatCost(usdToCny(Math.max(usd, 0), rate))
}

function MiniSpark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const w = 64
  const h = 28
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = h - ((v - min) / span) * (h - 4) - 2
      return `${x},${y}`
    })
    .join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="sparkline">
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts} strokeLinejoin="round" />
    </svg>
  )
}

export default function AIAssistantPage() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const account = useAuthStore((s) => s.user?.username || null)
  const {
    period,
    trendGrain,
    selectedTools,
    workEnv,
    setPeriod,
    setTrendGrain,
    setSelectedTools,
    getDateRangeLabel,
  } = useAIAssistantStore()

  const { status, snapshot, error, refresh } = useTokenMonitor(workEnv, account, accessToken)
  const fx = useExchangeRate()
  const {
    data: leaderboard,
    loading: lbLoading,
    error: lbError,
    refresh: refreshLeaderboard,
  } = useModelLeaderboard()
  const { pricesCny, getPriceCny, setPriceCny, getQuota } = useSubscriptionStore()
  const [detailView, setDetailView] = useState<'tool' | 'model'>('tool')
  const [launchingId, setLaunchingId] = useState<string | null>(null)
  const [launchMsg, setLaunchMsg] = useState<string | null>(null)

  const handleLaunch = async (toolId: string) => {
    if (status !== 'online') {
      setLaunchMsg('本机监测未连接，无法调起本地应用')
      return
    }
    setLaunchingId(toolId)
    setLaunchMsg(null)
    try {
      const r = await launchLocalTool(toolId)
      const cmdHint =
        toolId === 'claude'
          ? 'claude'
          : toolId === 'codex'
            ? 'codex'
            : toolId === 'kimi'
              ? 'kimi'
              : 'Cursor'
      setLaunchMsg(
        toolId === 'cursor'
          ? `已打开 Cursor${r.via ? `（${r.via}）` : ''}`
          : `已在终端执行 ${cmdHint}${r.via ? `（${r.via}）` : ''}`
      )
    } catch (e) {
      setLaunchMsg(e instanceof Error ? e.message : '启动失败')
    } finally {
      setLaunchingId(null)
    }
  }

  const [priceEdit, setPriceEdit] = useState<{
    toolId: string
    name: string
    unit: 'USD' | 'CNY'
    value: string
  } | null>(null)

  const savePriceEdit = () => {
    if (!priceEdit) return
    const n = parseFloat(priceEdit.value)
    const amount = Number.isFinite(n) && n >= 0 ? n : 0
    const cny = priceEdit.unit === 'CNY' ? amount : usdToCny(amount, fx.rate)
    setPriceCny(priceEdit.toolId, cny)
    setPriceEdit(null)
  }

  /** 国外订阅没有手动价格时统一以 $20/月作为编辑默认值。 */
  const foreignPriceForEdit = (priceKey: string): string => {
    const saved = pricesCny[priceKey]
    return typeof saved === 'number' ? cnyToUsd(saved, fx.rate).toFixed(2) : '20.00'
  }

  /** 外国工具（Claude / ChatGPT / Cursor）：无本机数据或未手动改价时，默认 $20 按实时汇率换算人民币 */
  const foreignPlanCny = (priceKey: string): number => {
    const saved = pricesCny[priceKey]
    if (typeof saved === 'number') return saved
    const base = priceKey.split(':')[0]
    if (base === 'kimi') return getPriceCny(priceKey)
    return usdToCny(20, fx.rate)
  }

  const isForeignTool = (toolId: string): boolean => {
    const base = toolId.split(':')[0]
    return base === 'claude' || base === 'codex' || base === 'cursor'
  }

  const detectedIds = useMemo(() => {
    const tools = snapshot?.tools?.filter((t) => t.installed) || []
    return tools.map((t) => t.id)
  }, [snapshot])

  /** 本机可用工具列表（已安装）；监测未连时回退目录 */
  const availableTools = useMemo(() => {
    if (detectedIds.length > 0) {
      return detectedIds
        .map((id) => aiTools.find((t) => t.id === id) || {
          id,
          name: getToolName(id),
          vendor: '',
          models: ['—'],
          subscriptionPrice: getPriceCny(id),
          apiInputPrice: 0,
          apiOutputPrice: 0,
          color: getToolColor(id),
          icon: getToolIcon(id),
        })
    }
    return aiTools
  }, [detectedIds, getPriceCny])

  const usage =
    (period === '7d' ? snapshot?.week || snapshot?.today : snapshot?.month) || snapshot?.month

  /** 消耗额度列表：按已用比例从高到低（ChatGPT 多账号拆成独立行） */
  const quotaRows = useMemo(() => {
    type Row = {
      key: string
      tool: (typeof availableTools)[number]
      account?: NonNullable<OfficialBilling['accounts']>[number]
      usedPct: number
    }
    const rows: Row[] = []
    for (const t of availableTools) {
      const bill = snapshot?.billing?.byTool?.[t.id]
      const usedTokens = usage?.clients[t.id] || 0
      const tokenQuota = getQuota(t.id)
      const tokenPct = Math.min((usedTokens / Math.max(tokenQuota, 1)) * 100, 100)

      if (t.id === 'codex' && bill?.accounts?.length) {
        for (const account of bill.accounts) {
          rows.push({
            key: `codex:${account.email}`,
            tool: t,
            account,
            usedPct: account.status === 'logged_in' ? account.usedPercent || 0 : -1,
          })
        }
        continue
      }

      rows.push({
        key: t.id,
        tool: t,
        usedPct: billUsedPercent(bill, tokenPct),
      })
    }
    return rows.sort((a, b) => b.usedPct - a.usedPct)
  }, [availableTools, snapshot, usage, getQuota])

  // 按本机已检测工具自动收窄筛选
  useEffect(() => {
    if (detectedIds.length === 0) return
    setSelectedTools(new Set(detectedIds))
  }, [detectedIds.join(','), setSelectedTools])

  const activeToolIds = useMemo(() => {
    if (detectedIds.length > 0) return detectedIds
    return aiTools.map((t) => t.id).filter((id) => selectedTools.has(id))
  }, [detectedIds, selectedTools])

  // 近 7 天用 history 切片；近 30 天/全部用 month + history
  const history = useMemo(() => {
    const rows = snapshot?.history || []
    if (period === '7d') {
      return rows.slice(-7)
    }
    return rows
  }, [snapshot, period])

  /** 按日 / 按周 / 按月聚合后的趋势数据（工具 + 模型） */
  const trendHistory = useMemo(() => {
    type Bucket = {
      label: string
      clients: Record<string, number>
      clientCosts: Record<string, number>
      models: Record<string, number>
      modelCosts: Record<string, number>
      modelClients: Record<string, string>
    }
    if (!history.length) return [] as Bucket[]
    if (trendGrain === 'day') {
      return history.map((d) => ({
        label: d.date.slice(5),
        clients: { ...d.clients },
        clientCosts: { ...d.clientCosts },
        models: { ...(d.models || {}) },
        modelCosts: { ...(d.modelCosts || {}) },
        modelClients: { ...(d.modelClients || {}) },
      }))
    }

    const buckets = new Map<string, Bucket>()
    const order: string[] = []
    for (const d of history) {
      const dt = new Date(d.date + 'T00:00:00')
      let key = d.date.slice(0, 7)
      let label = key
      if (trendGrain === 'week') {
        const day = dt.getDay() || 7
        const monday = new Date(dt)
        monday.setDate(dt.getDate() - day + 1)
        key = monday.toISOString().slice(0, 10)
        label = `${key.slice(5)}周`
      }
      let b = buckets.get(key)
      if (!b) {
        b = {
          label,
          clients: {},
          clientCosts: {},
          models: {},
          modelCosts: {},
          modelClients: {},
        }
        buckets.set(key, b)
        order.push(key)
      }
      for (const [id, v] of Object.entries(d.clients || {})) {
        b.clients[id] = (b.clients[id] || 0) + v
      }
      for (const [id, v] of Object.entries(d.clientCosts || {})) {
        b.clientCosts[id] = (b.clientCosts[id] || 0) + v
      }
      for (const [id, v] of Object.entries(d.models || {})) {
        b.models[id] = (b.models[id] || 0) + v
      }
      for (const [id, v] of Object.entries(d.modelCosts || {})) {
        b.modelCosts[id] = (b.modelCosts[id] || 0) + v
      }
      for (const [id, client] of Object.entries(d.modelClients || {})) {
        b.modelClients[id] = client
      }
    }
    return order.map((k) => buckets.get(k)!)
  }, [history, trendGrain])

  const summary = useMemo(() => {
    if (!usage) {
      return {
        totalTokens: 0,
        totalCost: 0,
        dailyAvgTokens: 0,
        dailyAvgCost: 0,
        toolCount: activeToolIds.length,
        prevTotalTokens: 0,
        prevTotalCost: 0,
        inputTokens: 0,
        outputTokens: 0,
      }
    }
    // 按选中工具过滤
    let totalTokens = 0
    let totalCostUsd = 0
    let inputTokens = usage.inputTokens
    let outputTokens = usage.outputTokens
    if (activeToolIds.length && Object.keys(usage.clients).length) {
      totalTokens = activeToolIds.reduce((s, id) => s + (usage.clients[id] || 0), 0)
      totalCostUsd = activeToolIds.reduce((s, id) => s + (usage.clientCosts[id] || 0), 0)
    } else {
      totalTokens = usage.totalTokens
      totalCostUsd = usage.totalCostUsd
    }
    const days = Math.max(history.length, 1)
    // 上期：history 前半段估算
    const half = Math.floor(history.length / 2)
    const prevRows = history.slice(0, half)
    const prevTotalTokens = prevRows.reduce((s, d) => {
      return s + activeToolIds.reduce((ss, id) => ss + (d.clients[id] || 0), 0)
    }, 0)
    const prevTotalCost = prevRows.reduce((s, d) => {
      return s + activeToolIds.reduce((ss, id) => ss + (d.clientCosts[id] || 0), 0)
    }, 0)

    return {
      totalTokens,
      totalCost: usdToCny(totalCostUsd, fx.rate),
      dailyAvgTokens: Math.round(totalTokens / days),
      dailyAvgCost: usdToCny(totalCostUsd / days, fx.rate),
      toolCount: activeToolIds.filter((id) => (usage.clients[id] || 0) > 0 || detectedIds.includes(id)).length,
      prevTotalTokens,
      prevTotalCost: usdToCny(prevTotalCost, fx.rate),
      inputTokens,
      outputTokens,
    }
  }, [usage, activeToolIds, history, detectedIds, fx.rate])

  const tokenChange = calcChange(summary.totalTokens, summary.prevTotalTokens)
  const costChange = calcChange(summary.totalCost, summary.prevTotalCost)

  const metricSparks = useMemo(() => {
    const tokens = history.map((d) =>
      activeToolIds.reduce((s, id) => s + (d.clients[id] || 0), 0)
    )
    const cost = history.map((d) =>
      activeToolIds.reduce((s, id) => s + (d.clientCosts[id] || 0), 0)
    )
    return { tokens, cost }
  }, [history, activeToolIds])

  const toolTrendSeries = useMemo(() => {
    const ids = activeToolIds.length ? activeToolIds : detectedIds
    return ids.map((id) => ({
      id,
      label: getToolName(id),
      color: getToolColor(id),
      toolId: id,
    }))
  }, [activeToolIds, detectedIds])

  /** 按模型：取时间窗口内用量 Top N 画折线 */
  const modelTrendSeries = useMemo(() => {
    const totals = new Map<string, number>()
    const clientOf = new Map<string, string>()
    for (const d of trendHistory) {
      for (const [id, v] of Object.entries(d.models || {})) {
        if (id === '<synthetic>' || !v) continue
        const toolId = d.modelClients[id] || usage?.modelClients?.[id] || ''
        if (activeToolIds.length && toolId && !activeToolIds.includes(toolId)) continue
        totals.set(id, (totals.get(id) || 0) + v)
        if (toolId) clientOf.set(id, toolId)
      }
    }
    // history 尚无 models 时回退到当前窗口合计（刷新 agent 后即有按日曲线）
    if (totals.size === 0 && usage?.models) {
      for (const [id, v] of Object.entries(usage.models)) {
        if (id === '<synthetic>' || !v) continue
        const toolId = usage.modelClients?.[id] || ''
        if (activeToolIds.length && toolId && !activeToolIds.includes(toolId)) continue
        totals.set(id, v)
        if (toolId) clientOf.set(id, toolId)
      }
    }
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id], i) => ({
        id,
        label: formatModelLabel(id),
        color: MODEL_BAR_COLORS[i % MODEL_BAR_COLORS.length],
        toolId: clientOf.get(id) || usage?.modelClients?.[id] || '',
      }))
  }, [trendHistory, usage, activeToolIds])

  const trendSeries = detailView === 'model' ? modelTrendSeries : toolTrendSeries

  const chartPaths = useMemo(() => {
    if (trendHistory.length === 0 || trendSeries.length === 0) return null
    const valueAt = (d: (typeof trendHistory)[0], id: string) =>
      detailView === 'model' ? d.models[id] || 0 : d.clients[id] || 0
    const costAt = (d: (typeof trendHistory)[0], id: string) =>
      detailView === 'model' ? d.modelCosts[id] || 0 : d.clientCosts[id] || 0
    const rawMax = Math.max(
      1,
      ...trendHistory.flatMap((d) => trendSeries.map((s) => valueAt(d, s.id)))
    )
    // 向上取整到好看的刻度（对齐参考图 200K 步进感）
    const niceMax = (() => {
      const step = rawMax <= 1000 ? 200 : rawMax <= 1e6 ? 2e5 : 2e5
      return Math.max(step, Math.ceil(rawMax / step) * step)
    })()
    const W = 400
    const H = 248
    const padL = 32
    const padR = 6
    const padT = 6
    const padB = 18
    const plotW = W - padL - padR
    const plotH = H - padT - padB
    const n = trendHistory.length
    const xAt = (i: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)
    const yAt = (v: number) => padT + plotH - (v / niceMax) * plotH

    const yTicks = 6
    const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => {
      const val = (niceMax / yTicks) * (yTicks - i)
      return { val, y: yAt(val), label: formatAxisToken(val) }
    })

    // 横坐标约 6–8 个刻度
    const xTickCount = Math.min(n, 7)
    const xIdx =
      n <= xTickCount
        ? Array.from({ length: n }, (_, i) => i)
        : Array.from({ length: xTickCount }, (_, i) =>
            Math.round((i * (n - 1)) / (xTickCount - 1))
          )

    const series = trendSeries.map((s) => {
      const pts = trendHistory.map((d, i) => {
        const v = valueAt(d, s.id)
        return { x: xAt(i), y: yAt(v), v, costUsd: costAt(d, s.id) }
      })
      const d =
        pts.length === 0
          ? ''
          : `M ${pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' L ')}`
      // 点密度过高时抽稀显示，避免糊成一团
      const markEvery = n > 40 ? Math.ceil(n / 24) : n > 20 ? 2 : 1
      const marks = pts.filter((_, i) => i % markEvery === 0 || i === pts.length - 1)
      return { ...s, d, pts, marks }
    })

    return {
      W,
      H,
      padL,
      padT,
      padB,
      plotW,
      plotH,
      labels: trendHistory.map((d) => d.label),
      yLabels,
      xTicks: xIdx.map((i) => ({
        x: xAt(i),
        label: trendHistory[i]?.label || '',
      })),
      series,
      pointCount: n,
    }
  }, [trendHistory, trendSeries, detailView])

  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const chartRef = useRef<HTMLDivElement>(null)

  const hoverTip = useMemo(() => {
    if (hoverIdx == null || !chartPaths) return null
    const label = chartPaths.labels[hoverIdx]
    const x = chartPaths.series[0]?.pts[hoverIdx]?.x
    if (x == null || !label) return null
    const rows = chartPaths.series
      .map((s) => {
        const p = s.pts[hoverIdx]
        return {
          id: s.id,
          label: s.label,
          color: s.color,
          tokens: p?.v || 0,
          cost: usdToCny(p?.costUsd || 0, fx.rate),
          y: p?.y ?? 0,
        }
      })
      .filter((r) => r.tokens > 0 || chartPaths.series.length <= 6)
      .sort((a, b) => b.tokens - a.tokens)
    const totalTokens = rows.reduce((s, r) => s + r.tokens, 0)
    const totalCost = rows.reduce((s, r) => s + r.cost, 0)
    return { label, x, rows, totalTokens, totalCost }
  }, [hoverIdx, chartPaths, fx.rate])

  const handleChartPointer = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!chartPaths || !chartRef.current) return
    const rect = chartRef.current.getBoundingClientRect()
    if (rect.width <= 0) return
    const svgX = ((e.clientX - rect.left) / rect.width) * chartPaths.W
    if (svgX < chartPaths.padL || svgX > chartPaths.padL + chartPaths.plotW) {
      setHoverIdx(null)
      return
    }
    const n = chartPaths.pointCount
    if (n <= 1) {
      setHoverIdx(0)
      return
    }
    const t = (svgX - chartPaths.padL) / chartPaths.plotW
    const idx = Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))))
    setHoverIdx(idx)
  }

  useEffect(() => {
    setHoverIdx(null)
  }, [detailView, trendGrain, period])

  const breakdown = useMemo(() => {
    if (!usage) return []
    const total = activeToolIds.reduce((s, id) => s + (usage.clients[id] || 0), 0) || 1
    return activeToolIds
      .map((id) => ({
        toolId: id,
        tokens: usage.clients[id] || 0,
        cost: usdToCny(usage.clientCosts[id] || 0, fx.rate),
        tokenPct: ((usage.clients[id] || 0) / total) * 100,
      }))
      .filter((b) => b.tokens > 0 || detectedIds.includes(b.toolId))
      .sort((a, b) => b.tokens - a.tokens)
  }, [usage, activeToolIds, detectedIds, fx.rate])

  const donutSegments = useMemo(() => {
    let offset = 0
    const total = breakdown.reduce((s, b) => s + b.tokenPct, 0) || 1
    return breakdown.map((b) => {
      const dash = (b.tokenPct / total) * 251.2
      const seg = {
        color: getToolColor(b.toolId),
        dasharray: `${dash} ${251.2 - dash}`,
        dashoffset: -offset,
        pct: b.tokenPct,
        toolId: b.toolId,
      }
      offset += dash
      return seg
    })
  }, [breakdown])

  const tableRows = useMemo(() => {
    const durBag =
      (period === '7d'
        ? snapshot?.durations?.week || usage?.clientActiveMs
        : snapshot?.durations?.month || usage?.clientActiveMs) || {}
    return breakdown.map((b) => {
      const tool = aiTools.find((t) => t.id === b.toolId)
      const detected = snapshot?.tools.find((t) => t.id === b.toolId)
      const spark = history.map((d) => d.clients[b.toolId] || 0)
      const days = spark.filter((v) => v > 0).length
      // 使用明细：Claude Code CLI (配置模型)；Cursor 不带括号备注
      const name =
        b.toolId === 'claude'
          ? 'Claude Code CLI'
          : tool?.name || getToolName(b.toolId)
      const model =
        b.toolId === 'cursor'
          ? ''
          : b.toolId === 'claude'
            ? detected?.configuredModel || ''
            : tool?.models[0] || ''
      return {
        toolId: b.toolId,
        name,
        model,
        tokens: b.tokens,
        // 输入/输出粗分：用全局比例估算
        inputT: summary.totalTokens
          ? Math.round(b.tokens * (summary.inputTokens / Math.max(summary.totalTokens, 1)))
          : 0,
        outputT: summary.totalTokens
          ? Math.round(b.tokens * (summary.outputTokens / Math.max(summary.totalTokens, 1)))
          : 0,
        cacheT:
          typeof (usage?.clientCacheRead || {})[b.toolId] === 'number'
            ? (usage?.clientCacheRead || {})[b.toolId]
            : summary.totalTokens && usage?.cacheReadTokens
              ? Math.round(b.tokens * (usage.cacheReadTokens / Math.max(summary.totalTokens, 1)))
              : 0,
        cost: b.cost,
        activeMs: durBag[b.toolId] || 0,
        avgDaily: days ? Math.round(b.tokens / days) : 0,
        spark,
        status: detected?.status,
      }
    }).sort((a, b) => b.tokens - a.tokens)
  }, [breakdown, history, summary, snapshot, period, usage])

  /** 按模型拆分的实际用量（如 Kimi：K2.7 / K3） */
  const modelRows = useMemo(() => {
    if (!usage?.models) return []
    const costs = usage.modelCosts || {}
    const clients = usage.modelClients || {}
    const inputs = usage.modelInput || {}
    const outputs = usage.modelOutput || {}
    const caches = usage.modelCacheRead || {}
    const days = Math.max(history.filter((d) => d.totalTokens > 0).length, 1)
    return Object.entries(usage.models)
      .filter(([id, tokens]) => id !== '<synthetic>' && tokens > 0)
      .map(([id, tokens]) => {
        const toolId = clients[id] || ''
        return {
          modelId: id,
          label: formatModelLabel(id),
          toolId,
          toolName: toolId ? getToolName(toolId) : '—',
          tokens,
          inputT: inputs[id] || 0,
          outputT: outputs[id] || 0,
          cacheT: caches[id] || 0,
          cost: usdToCny(costs[id] || 0, fx.rate),
          avgDaily: Math.round(tokens / days),
        }
      })
      .sort((a, b) => b.tokens - a.tokens)
  }, [usage, history, fx.rate])

  const totals = useMemo(
    () => ({
      tokens: tableRows.reduce((s, r) => s + r.tokens, 0),
      inputT: tableRows.reduce((s, r) => s + r.inputT, 0),
      outputT: tableRows.reduce((s, r) => s + r.outputT, 0),
      cacheT: tableRows.reduce((s, r) => s + r.cacheT, 0),
      cost: tableRows.reduce((s, r) => s + r.cost, 0),
      activeMs: tableRows.reduce((s, r) => s + (r.activeMs || 0), 0),
      avgDaily: summary.dailyAvgTokens,
    }),
    [tableRows, summary]
  )

  const catalog = useMemo(() => {
    if (snapshot?.tools?.length) {
      return snapshot.tools.filter((t) => t.installed)
    }
    return aiTools.map((t) => ({
      id: t.id,
      name: t.name,
      installed: true,
      status: 'waiting' as const,
    }))
  }, [snapshot])

  const envMeta = WORK_ENVS.find((e) => e.id === workEnv)
  const monitorLabel =
    status === 'online'
      ? `本机监测已连接 · ${snapshot?.engine || 'tokscale'}`
      : status === 'loading' || status === 'checking'
        ? '正在连接本机监测…'
        : snapshot
          ? `数据库缓存 · ${snapshot.updatedAt ? new Date(snapshot.updatedAt).toLocaleString('zh-CN') : '时间未知'}`
          : '本机监测未连接'

  return (
    <div className="fade-in dashboard">
      {/* 监测状态 */}
      <div className={`monitor-banner ${status}`}>
        <div>
          <strong>{monitorLabel}</strong>
          <span className="monitor-banner-sub">
            {envMeta ? `${envMeta.icon} ${envMeta.label}` : workEnv}
            {account ? ` · @${account}` : ''}
            {' · '}
            {status === 'online'
              ? `已检测 ${detectedIds.length} 个 AI 工具 · 数据已写入账号绑定库`
              : snapshot
                ? `非实时数据 · 已缓存 ${detectedIds.length} 个 AI 工具（其他端可查看）`
                : '请在本机项目目录运行 npm run agent，以自动检测 CLI 并采集 Token'}
          </span>
          {error && <div className="monitor-banner-error">{error}</div>}
          {snapshot?.warnings?.length ? (
            <div className="monitor-banner-warn">{snapshot.warnings[0]}</div>
          ) : null}
        </div>
        <button className="btn btn-secondary" onClick={() => refresh(true)} disabled={status === 'loading'}>
          {status === 'loading' ? '读取中…' : status === 'online' ? '刷新监测' : '刷新缓存'}
        </button>
      </div>

      {/* 已检测工具：点击调起本机 CLI / 应用 */}
      <div className="detect-strip">
        {(snapshot?.tools.filter((tool) => tool.installed) || []).map((t) => {
          const id = t.id
          const installed = Boolean(t?.installed)
          const usedTokens = usage?.clients[id] || 0
          const dot = toolQuotaDot(id, {
            monitorOnline: status === 'online',
            installed,
            snapshot,
            usedTokens,
            tokenQuota: getQuota(id),
          })
          const dotLabel =
            dot === 'ok' ? '额度充足' : dot === 'low' ? '可用额度低于 20%' : '离线或无可用额度'
          const launchHint =
            id === 'cursor'
              ? '打开 Cursor 应用'
              : id === 'claude'
                ? '打开终端并执行 claude'
                : id === 'codex'
                  ? '打开终端并执行 codex'
                  : id === 'kimi'
                    ? '打开终端并执行 kimi'
                    : `调起 ${getToolName(id)}`
          return (
            <button
              key={id}
              type="button"
              className={`detect-chip ${installed ? 'installed' : 'missing'} ${launchingId === id ? 'launching' : ''}`}
              disabled={!installed || launchingId === id}
              onClick={() => installed && void handleLaunch(id)}
              title={`${launchHint}\n${dotLabel}${t?.binaries?.[0]?.path ? `\n${t.binaries[0].path}` : ''}`}
            >
              <ToolLogo toolId={id} provider={t?.provider} size={18} />
              {getToolName(id)}
              <span className={`detect-status-dot ${dot}`} title={dotLabel} />
              <LaunchArrow />
            </button>
          )
        })}
        {launchMsg && <span className="detect-strip-msg">{launchMsg}</span>}
      </div>

      {/* Header */}
      <div className="dashboard-header">
        <div>
          <div className="dashboard-title">总览</div>
        </div>
        <div className="dashboard-filters">
          <div className="filter-select">
            <span className="filter-select-icon">📅</span>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as '7d' | '30d' | 'all')}
            >
              <option value="7d">近 7 天（今日窗口）</option>
              <option value="30d">{getDateRangeLabel()}</option>
              <option value="all">历史可用区间</option>
            </select>
          </div>
        </div>
      </div>

      {/* Metrics：已移除「使用天数」 */}
      <div className="metrics-grid five">
        <div className="metric-card accent-purple">
          <div className="metric-card-top">
            <div>
              <div className="metric-label">总 Token 消耗</div>
              <div className="metric-value">{formatNumber(summary.totalTokens)}</div>
              <div className={`metric-delta ${tokenChange >= 0 ? 'up' : 'down'}`}>
                {tokenChange >= 0 ? '↑' : '↓'} {Math.abs(tokenChange).toFixed(1)}%
              </div>
            </div>
            <MiniSpark values={metricSparks.tokens} color="#a78bfa" />
          </div>
        </div>
        <div className="metric-card accent-blue">
          <div className="metric-card-top">
            <div>
              <div className="metric-label">总费用（估算）</div>
              <div className="metric-value">{formatCost(summary.totalCost)}</div>
              <div className={`metric-delta ${costChange >= 0 ? 'up' : 'down'}`}>
                {costChange >= 0 ? '↑' : '↓'} {Math.abs(costChange).toFixed(1)}%
              </div>
            </div>
            <MiniSpark values={metricSparks.cost} color="#60a5fa" />
          </div>
        </div>
        <div className="metric-card accent-green">
          <div className="metric-label">日均 Token 消耗</div>
          <div className="metric-value">{formatNumber(summary.dailyAvgTokens)}</div>
        </div>
        <div className="metric-card accent-orange">
          <div className="metric-label">日均费用</div>
          <div className="metric-value">{formatCost(summary.dailyAvgCost)}</div>
        </div>
        <div className="metric-card accent-pink">
          <div className="metric-label">已检测工具</div>
          <div className="metric-value">
            {detectedIds.length || summary.toolCount}{' '}
            <span className="metric-unit">个</span>
          </div>
        </div>
      </div>

      {status !== 'online' && !snapshot && (
        <div className="chart-card" style={{ marginBottom: 16 }}>
          <div className="chart-title" style={{ marginBottom: 8 }}>如何开启本机监测</div>
          <p className="monitor-banner-sub" style={{ marginBottom: 10 }}>
            浏览器无法直接启动电脑上的服务。换个人/公司电脑时，仓库脚本可复用，无需重新开发。
          </p>
          <ol className="monitor-steps">
            <li>
              <strong>一键启动（推荐）</strong>：在知识库中打开{' '}
              <code>02_Operations/Workspaces/personal-ops</code>，双击{' '}
              <code>启动监测.command</code>
            </li>
            <li>
              <strong>开机自启（每台电脑一次）</strong>：双击{' '}
              <code>安装开机自启.command</code>，之后登录 Mac 自动监测
            </li>
            <li>
              或终端执行：<code>npm run agent:start</code> / 安装自启{' '}
              <code>npm run agent:setup</code>
            </li>
            <li>回到本页刷新；将自动检测 Codex / Claude / Kimi / Cursor</li>
            <li>
              Cursor 若无用量：<code>npx tokscale cursor login</code> 与{' '}
              <code>npx tokscale cursor sync --json</code>（按电脑各登一次）
            </li>
          </ol>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                const cmd =
                  'cd "$HOME/obsidian_vault/02_Operations/Workspaces/personal-ops" && npm run agent:start'
                void navigator.clipboard?.writeText(cmd)
              }}
            >
              复制启动命令
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                void refresh(true)
              }}
            >
              重新检测
            </button>
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="dash-main-grid">
        <div className="chart-card token-trend-card">
          <div className="chart-header">
            <div className="chart-title">Token消耗</div>
            <div className="chart-header-controls">
              <div className="detail-view-switch" role="tablist" aria-label="统计维度">
                <button
                  type="button"
                  role="tab"
                  aria-selected={detailView === 'tool'}
                  className={`filter-btn ${detailView === 'tool' ? 'active' : ''}`}
                  onClick={() => setDetailView('tool')}
                >
                  按工具
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={detailView === 'model'}
                  className={`filter-btn ${detailView === 'model' ? 'active' : ''}`}
                  onClick={() => setDetailView('model')}
                >
                  按模型
                </button>
              </div>
              <div className="filter-group">
                {(
                  [
                    ['day', '按日'],
                    ['week', '按周'],
                    ['month', '按月'],
                  ] as const
                ).map(([g, label]) => (
                  <button
                    key={g}
                    type="button"
                    className={`filter-btn ${trendGrain === g ? 'active' : ''}`}
                    onClick={() => setTrendGrain(g)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="chart-legend trend-legend">
            {trendSeries.map((s) => (
              <div key={s.id} className="chart-legend-item trend-legend-item" title={s.id}>
                <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden>
                  <line x1="1" y1="5" x2="21" y2="5" stroke={s.color} strokeWidth="2" />
                  <circle cx="11" cy="5" r="3" fill={s.color} />
                </svg>
                {s.label}
              </div>
            ))}
          </div>
          <div
            className="line-chart tall trend-chart"
            ref={chartRef}
            onMouseMove={handleChartPointer}
            onMouseLeave={() => setHoverIdx(null)}
          >
            {chartPaths ? (
              <>
                <svg
                  viewBox={`0 0 ${chartPaths.W} ${chartPaths.H}`}
                  preserveAspectRatio="xMidYMid meet"
                  className="trend-svg"
                >
                  {chartPaths.yLabels.map((t) => (
                    <g key={`y-${t.val}`}>
                      <line
                        x1={chartPaths.padL}
                        y1={t.y}
                        x2={chartPaths.padL + chartPaths.plotW}
                        y2={t.y}
                        stroke="rgba(255,255,255,0.08)"
                        strokeWidth="1"
                        strokeDasharray="3 4"
                      />
                    <text
                      x={chartPaths.padL - 4}
                      y={t.y + 3}
                      textAnchor="end"
                      fill="rgba(235,235,245,.4)"
                      fontSize="8"
                      fontFamily="var(--font-sans)"
                    >
                      {t.label}
                    </text>
                    </g>
                  ))}
                  {chartPaths.series.map((s) => (
                    <g key={`${detailView}-${trendGrain}-${s.id}`}>
                      <path
                        d={s.d}
                        fill="none"
                        stroke={s.color}
                        strokeWidth="2"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                      {s.marks.map((p, i) => (
                        <circle
                          key={`${s.id}-m-${i}`}
                          cx={p.x}
                          cy={p.y}
                          r={3.2}
                          fill={s.color}
                          stroke="rgba(0,0,0,.35)"
                          strokeWidth="0.8"
                        />
                      ))}
                    </g>
                  ))}
                  {hoverTip && (
                    <g className="trend-hover-guide" pointerEvents="none">
                      <line
                        x1={hoverTip.x}
                        y1={chartPaths.padT}
                        x2={hoverTip.x}
                        y2={chartPaths.H - chartPaths.padB}
                        stroke="rgba(235,235,245,0.35)"
                        strokeWidth="1"
                        strokeDasharray="3 3"
                      />
                      {hoverTip.rows.map((r) => (
                        <circle
                          key={`hover-${r.id}`}
                          cx={hoverTip.x}
                          cy={r.y}
                          r={4.5}
                          fill={r.color}
                          stroke="rgba(255,255,255,0.85)"
                          strokeWidth="1.2"
                        />
                      ))}
                    </g>
                  )}
                  {chartPaths.xTicks.map((t) => (
                    <text
                      key={`x-${t.x}-${t.label}`}
                      x={t.x}
                      y={chartPaths.H - 4}
                      textAnchor="middle"
                      fill="rgba(235,235,245,.4)"
                      fontSize="8"
                      fontFamily="var(--font-sans)"
                    >
                      {t.label}
                    </text>
                  ))}
                </svg>
                {hoverTip && (
                  <div
                    className={`trend-tooltip ${hoverTip.x / chartPaths.W > 0.62 ? 'left' : 'right'}`}
                    style={{
                      left: `${(hoverTip.x / chartPaths.W) * 100}%`,
                    }}
                  >
                    <div className="trend-tooltip-date">{hoverTip.label}</div>
                    <div className="trend-tooltip-total">
                      合计 {formatNumber(hoverTip.totalTokens)}
                      {hoverTip.totalCost > 0 ? ` · ${formatCost(hoverTip.totalCost)}` : ''}
                    </div>
                    <div className="trend-tooltip-rows">
                      {hoverTip.rows.map((r) => (
                        <div key={r.id} className="trend-tooltip-row">
                          <span className="trend-tooltip-name">
                            <span className="trend-tooltip-dot" style={{ background: r.color }} />
                            {r.label}
                          </span>
                          <span className="trend-tooltip-val">
                            {formatNumber(r.tokens)}
                            {r.cost > 0 ? (
                              <span className="trend-tooltip-cost">{formatCost(r.cost)}</span>
                            ) : null}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="chart-empty">
                {detailView === 'model' ? '暂无按模型趋势' : '暂无趋势数据'}
              </div>
            )}
          </div>
        </div>

        <div className="chart-card tool-summary-card">
          <div className="donut-chart">
            <svg className="donut-svg" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="40" fill="none" stroke="var(--color-surface-2)" strokeWidth="12" />
              {donutSegments.map((seg, i) => (
                <circle
                  key={i}
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  stroke={seg.color}
                  strokeWidth="12"
                  strokeDasharray={seg.dasharray}
                  strokeDashoffset={seg.dashoffset}
                  transform="rotate(-90 50 50)"
                />
              ))}
              <text x="50" y="48" textAnchor="middle" fontSize="8" fill="var(--color-text)" fontWeight="700">
                {formatNumber(summary.totalTokens)}
              </text>
              <text x="50" y="56" textAnchor="middle" fontSize="4" fill="var(--color-text-secondary)">
                总 Token
              </text>
            </svg>
            <div className="donut-legend">
              {donutSegments.map((seg) => (
                <div key={seg.toolId} className="donut-legend-item">
                  <span className="donut-legend-dot" style={{ background: seg.color }} />
                  <span>{getToolName(seg.toolId)}</span>
                  <span style={{ marginLeft: 'auto', color: 'var(--color-text-secondary)' }}>
                    {formatPct(seg.pct)}
                  </span>
                </div>
              ))}
              {donutSegments.length === 0 && (
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)' }}>
                  连接监测后显示占比
                </div>
              )}
            </div>
          </div>

          <div className="local-env-block">
            <div className="detect-detail">
              {(snapshot?.tools || []).filter((t) => t.installed).map((t) => (
                <div key={t.id} className="detect-detail-row">
                  <div style={{ minWidth: 0 }}>
                    <div className="detect-detail-name">
                      <ToolLogo toolId={t.id} provider={t.provider} size={18} />
                      <strong>{t.name}</strong>
                    </div>
                    <div className="detect-detail-path">
                      {t.binaries?.[0]?.path || t.dataDirs?.[0] || '—'}
                    </div>
                  </div>
                  <div className="detect-detail-actions">
                    <span
                      className={`tag ${t.installed ? 'tag-success' : 'tag-warning'}`}
                      title={
                        t.configuredModel
                          ? `当前配置模型：${t.configuredModel}${t.provider ? ` · ${t.provider}` : ''}`
                          : t.status
                      }
                    >
                      {!t.installed
                        ? '未安装'
                        : t.configuredModel || (t.status === 'active' ? '已配置' : '待配置')}
                    </span>
                  </div>
                </div>
              ))}
              {!snapshot && (
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)' }}>
                  启动 token-agent 后显示检测路径
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 消耗明细表：按工具 / 按模型 */}
      <div className="chart-card dash-section">
        <div className="chart-header">
          <div className="chart-title">消耗明细</div>
          <div className="detail-view-switch" role="tablist" aria-label="明细维度">
            <button
              type="button"
              role="tab"
              aria-selected={detailView === 'tool'}
              className={`filter-btn ${detailView === 'tool' ? 'active' : ''}`}
              onClick={() => setDetailView('tool')}
            >
              按工具
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={detailView === 'model'}
              className={`filter-btn ${detailView === 'model' ? 'active' : ''}`}
              onClick={() => setDetailView('model')}
            >
              按模型
            </button>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          {detailView === 'model' ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>模型</th>
                <th>所属工具</th>
                <th style={{ textAlign: 'right' }}>总 Token</th>
                <th style={{ textAlign: 'right' }}>输入 Token</th>
                <th style={{ textAlign: 'right' }}>输出 Token</th>
                <th style={{ textAlign: 'right' }}>命中缓存</th>
                <th style={{ textAlign: 'right' }}>费用（估算）</th>
                <th style={{ textAlign: 'right' }}>日均 Token</th>
              </tr>
            </thead>
            <tbody>
              {modelRows.map((r) => (
                <tr key={r.modelId}>
                  <td>
                    <span className="tool-cell">
                      <strong>{r.label}</strong>
                      <span className="tool-model">{r.modelId}</span>
                    </span>
                  </td>
                  <td>{r.toolName}</td>
                  <td style={{ textAlign: 'right' }}>{formatNumber(r.tokens)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--color-text-secondary)' }}>
                    {formatNumber(r.inputT)}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--color-text-secondary)' }}>
                    {formatNumber(r.outputT)}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--color-text-secondary)' }}>
                    {formatNumber(r.cacheT)}
                  </td>
                  <td style={{ textAlign: 'right' }}>{formatCost(r.cost)}</td>
                  <td style={{ textAlign: 'right' }}>{formatNumber(r.avgDaily)}</td>
                </tr>
              ))}
              {modelRows.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                    当前窗口暂无按模型用量
                  </td>
                </tr>
              )}
            </tbody>
            {modelRows.length > 0 && (
              <tfoot>
                <tr>
                  <td>合计</td>
                  <td />
                  <td style={{ textAlign: 'right' }}>
                    {formatNumber(modelRows.reduce((s, r) => s + r.tokens, 0))}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {formatNumber(modelRows.reduce((s, r) => s + r.inputT, 0))}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {formatNumber(modelRows.reduce((s, r) => s + r.outputT, 0))}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {formatNumber(modelRows.reduce((s, r) => s + r.cacheT, 0))}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {formatCost(modelRows.reduce((s, r) => s + r.cost, 0))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
          ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>工具名称</th>
                <th style={{ textAlign: 'right' }}>总 Token</th>
                <th style={{ textAlign: 'right' }}>输入 Token</th>
                <th style={{ textAlign: 'right' }}>输出 Token</th>
                <th style={{ textAlign: 'right' }}>命中缓存</th>
                <th style={{ textAlign: 'right' }}>运行时长</th>
                <th style={{ textAlign: 'right' }}>费用（估算）</th>
                <th style={{ textAlign: 'right' }}>日均 Token</th>
                <th>趋势</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r) => (
                <tr key={r.toolId}>
                  <td>
                    <span className="tool-cell">
                      <ToolLogo
                        toolId={r.toolId}
                        provider={snapshot?.tools.find((x) => x.id === r.toolId)?.provider}
                        size={16}
                      />
                      {r.name}
                      {r.model ? <span className="tool-model">({r.model})</span> : null}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>{formatNumber(r.tokens)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--color-text-secondary)' }}>
                    {formatNumber(r.inputT)}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--color-text-secondary)' }}>
                    {formatNumber(r.outputT)}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--color-text-secondary)' }}>
                    {formatNumber(r.cacheT)}
                  </td>
                  <td style={{ textAlign: 'right' }}>{formatDuration(r.activeMs)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCost(r.cost)}</td>
                  <td style={{ textAlign: 'right' }}>{formatNumber(r.avgDaily)}</td>
                  <td>
                    <MiniSpark values={r.spark} color={getToolColor(r.toolId)} />
                  </td>
                </tr>
              ))}
              {tableRows.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                    {catalog.length
                      ? '已检测到工具，但当前窗口暂无用量'
                      : '尚未检测到本机 AI 工具'}
                  </td>
                </tr>
              )}
            </tbody>
            {tableRows.length > 0 && (
              <tfoot>
                <tr>
                  <td>合计</td>
                  <td style={{ textAlign: 'right' }}>{formatNumber(totals.tokens)}</td>
                  <td style={{ textAlign: 'right' }}>{formatNumber(totals.inputT)}</td>
                  <td style={{ textAlign: 'right' }}>{formatNumber(totals.outputT)}</td>
                  <td style={{ textAlign: 'right' }}>{formatNumber(totals.cacheT)}</td>
                  <td style={{ textAlign: 'right' }}>{formatDuration(totals.activeMs)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCost(totals.cost)}</td>
                  <td style={{ textAlign: 'right' }}>{formatNumber(totals.avgDaily)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
          )}
        </div>
      </div>

      {/* 消耗额度 */}
      <div className="chart-card dash-section">
        <div className="chart-header">
          <div className="chart-title">消耗额度</div>
          <button
            className="btn btn-secondary"
            style={{ fontSize: '0.72rem', padding: '4px 10px' }}
            onClick={() => fx.refresh(true)}
            disabled={fx.loading}
            title="刷新美元兑人民币汇率"
          >
            {fx.loading ? '汇率…' : `1 USD ≈ ￥${fx.rate.toFixed(4)}`}
          </button>
        </div>
          <div className="quota-fx-hint">
            OpenRouter 充值 · Cursor/ChatGPT/Kimi 官方用量 · 汇率 1 USD ≈ ￥{fx.rate.toFixed(4)}
            {fx.updatedAt ? ` · ${fx.updatedAt.slice(0, 16)}` : ''}
          </div>
          <div className="quota-list">
            {quotaRows.map((row) => {
              const t = row.tool
              const usedTokens = usage?.clients[t.id] || 0
              const tokenQuota = getQuota(t.id)
              const tokenPct = Math.min(
                Math.round((usedTokens / Math.max(tokenQuota, 1)) * 100),
                100
              )
              const cny = isForeignTool(t.id) ? foreignPlanCny(t.id) : getPriceCny(t.id)
              const detected = snapshot?.tools.find((x) => x.id === t.id)
              const label = quotaToolName(t.id, t.name, detected)
              const bill = snapshot?.billing?.byTool?.[t.id]

              // ChatGPT：按账号拆行后单独渲染（已按消耗排序）
              if (row.account) {
                const account = row.account
                const loggedIn = account.status === 'logged_in'
                const pct = Math.min(Math.round(account.usedPercent || 0), 100)
                const remain = Math.max(Math.round(account.remainingPercent ?? 100 - pct), 0)
                const accountPriceKey = `codex:${account.email}`
                const accountCny = foreignPlanCny(accountPriceKey)
                return (
                  <div key={row.key} className={`quota-item chatgpt-account ${loggedIn ? 'logged-in' : 'not-logged-in'}`}>
                    <div className="quota-head">
                      <span className="tool-cell">
                        <ToolLogo toolId={t.id} provider="ChatGPT" size={16} />
                        <span>
                          <strong>ChatGPT</strong>
                          <span className="account-email">{account.email}</span>
                        </span>
                      </span>
                      <button
                        type="button"
                        className="quota-price-chip chatgpt-plan-chip"
                        title="点击修改该账号的订阅价格"
                        onClick={() => setPriceEdit({
                          toolId: accountPriceKey,
                          name: `ChatGPT ${account.email}`,
                          unit: 'USD',
                          value: foreignPriceForEdit(accountPriceKey),
                        })}
                      >
                        <span className="quota-price-cny">
                          {loggedIn
                            ? formatPlanLabel(account.planName) || 'Plus'
                            : `${formatCost(accountCny)}/月`}
                        </span>
                        <span className="quota-pct">{loggedIn ? `${remain}%` : '未登录'}</span>
                      </button>
                    </div>
                    {loggedIn ? (
                      <>
                        <div className="quota-track">
                          <div className="quota-fill" style={{ width: `${pct}%`, background: getToolColor(t.id) }} />
                        </div>
                        <div className="quota-meta">
                          <span>已用 {pct}%{account.windowSeconds ? ` · ${Math.round(account.windowSeconds / 3600)}h 窗口` : ''}</span>
                          <span>剩余 {remain}%</span>
                        </div>
                      </>
                    ) : (
                      <div className="quota-meta account-login-hint">
                        <span>该订阅账号尚未在本机 Codex 登录</span>
                        <span>默认按 $20 ≈ {formatCost(accountCny)}/月</span>
                      </div>
                    )}
                  </div>
                )
              }

              // OpenRouter 充值制（CC Switch：remaining = total_credits - total_usage）
              if (bill?.ok && bill.kind === 'credits') {
                const total = Math.max(bill.total || 0, 0)
                const used = Math.max(bill.used || 0, 0)
                const remaining = bill.remaining ?? total - used
                const usedPct =
                  total > 0 ? Math.min(Math.round((used / total) * 100), 100) : used > 0 ? 100 : 0
                const remainPct =
                  total > 0 ? Math.max(Math.min(Math.round((remaining / total) * 100), 100), 0) : used > 0 ? 0 : 100
                return (
                  <div key={row.key} className="quota-item">
                    <div className="quota-head">
                      <span className="tool-cell">
                        <ToolLogo toolId={t.id} provider={detected?.provider || label} size={16} />
                        {label}
                      </span>
                      <button
                        type="button"
                        className="quota-price-chip"
                        title="点击修改参考套餐价格"
                        onClick={() => setPriceEdit({
                          toolId: t.id,
                          name: label,
                          unit: 'USD',
                          value: foreignPriceForEdit(t.id),
                        })}
                      >
                        <span className="quota-price-cny">
                          剩余 {formatMoneyCny(remaining, fx.rate)}
                        </span>
                        <span className="quota-pct">{remainPct}%</span>
                      </button>
                    </div>
                    <div className="quota-track">
                      <div
                        className="quota-fill"
                        style={{ width: `${usedPct}%`, background: getToolColor(t.id) }}
                      />
                    </div>
                    <div className="quota-meta">
                      <span>已用 {formatMoneyCny(used, fx.rate)}</span>
                      <span>
                        充值 {formatMoneyCny(total, fx.rate)} · 剩余{' '}
                        {formatMoneyCny(remaining, fx.rate)}
                      </span>
                    </div>
                  </div>
                )
              }

              // Kimi Code：周额度 + 5h + 余额（人民币）
              if (bill?.ok && bill.kind === 'plan_percent' && t.id === 'kimi') {
                const pct = Math.min(Math.round(bill.usedPercent ?? 0), 100)
                const remain = Math.max(Math.round(bill.remainingPercent ?? 100 - pct), 0)
                const fivePct = Math.round(bill.fiveHour?.usedPercent ?? 0)
                const bal =
                  bill.balanceCny != null ? formatCost(bill.balanceCny) : null
                return (
                  <div key={row.key} className="quota-item">
                    <div className="quota-head">
                      <span className="tool-cell">
                        <ToolLogo toolId={t.id} provider={detected?.provider} size={16} />
                        {label}
                      </span>
                      <div
                        className="quota-price-chip"
                        title="Kimi Code 官方用量（周额度 / 余额）"
                        role="button"
                        tabIndex={0}
                        onClick={() => setPriceEdit({
                          toolId: t.id,
                          name: label,
                          unit: 'CNY',
                          value: String(getPriceCny(t.id)),
                        })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            setPriceEdit({ toolId: t.id, name: label, unit: 'CNY', value: String(getPriceCny(t.id)) })
                          }
                        }}
                      >
                        <span className="quota-price-cny">
                          {bal != null ? `余额 ${bal}` : `剩余 ${remain}%`}
                        </span>
                        <span className="quota-pct">{remain}%</span>
                      </div>
                    </div>
                    <div className="quota-track">
                      <div
                        className="quota-fill"
                        style={{ width: `${pct}%`, background: getToolColor(t.id) }}
                      />
                    </div>
                    <div className="quota-meta">
                      <span>
                        周额度 {pct}%
                        {bill.fiveHour ? ` · 5h ${fivePct}%` : ''}
                        {bill.monthlyUsedCny != null
                          ? ` · 本月加购 ${formatCost(bill.monthlyUsedCny)}`
                          : ''}
                      </span>
                      <span>
                        {bal != null ? `余额 ${bal}` : `剩余 ${remain}%`}
                      </span>
                    </div>
                  </div>
                )
              }

              // Cursor / ChatGPT：官方套餐百分比
              if (bill?.ok && bill.kind === 'plan_percent') {
                const pct = Math.min(Math.round(bill.usedPercent ?? bill.totalPercentUsed ?? 0), 100)
                const remain = Math.max(
                  Math.round(bill.remainingPercent ?? 100 - pct),
                  0
                )
                const plan = formatPlanLabel(bill.planName)
                // Cursor 显示套餐名（如 Pro），不显示金额
                const priceText =
                  t.id === 'cursor'
                    ? plan || 'Pro'
                    : plan
                      ? `${plan}`
                      : `${formatCost(cny)}/月`
                return (
                  <div key={row.key} className="quota-item">
                    <div className="quota-head">
                      <span className="tool-cell">
                        <ToolLogo toolId={t.id} provider={detected?.provider} size={16} />
                        {label}
                      </span>
                      <button
                        type="button"
                        className="quota-price-chip"
                        title="点击修改参考套餐价（用量来自官方）"
                        onClick={() =>
                          setPriceEdit({
                            toolId: t.id,
                            name: label,
                            unit: t.id === 'kimi' ? 'CNY' : 'USD',
                            value: t.id === 'kimi' ? String(cny) : foreignPriceForEdit(t.id),
                          })
                        }
                      >
                        <span className="quota-price-cny">{priceText}</span>
                        <span className="quota-pct">{remain}%</span>
                      </button>
                    </div>
                    <div className="quota-track">
                      <div
                        className="quota-fill"
                        style={{ width: `${pct}%`, background: getToolColor(t.id) }}
                      />
                    </div>
                    <div className="quota-meta">
                      {t.id === 'cursor' ? (
                        <>
                          <span>
                            总用量 {pct}%
                            {bill.autoPercentUsed != null
                              ? ` · 第一方 ${Math.round(bill.autoPercentUsed)}%`
                              : ''}
                            {bill.apiPercentUsed != null
                              ? ` · API ${Math.round(bill.apiPercentUsed)}%`
                              : ''}
                          </span>
                          <span>剩余 {remain}%</span>
                        </>
                      ) : (
                        <>
                          <span>
                            已用 {pct}%
                            {bill.windowSeconds
                              ? ` · ${Math.round(bill.windowSeconds / 3600)}h 窗口`
                              : ''}
                          </span>
                          <span>剩余 {remain}%</span>
                        </>
                      )}
                    </div>
                  </div>
                )
              }

              // 回退：本机 Token 估算；外国工具无数据时套餐默认 $20 换算人民币
              const remainTokenPct = Math.max(100 - tokenPct, 0)
              return (
                <div key={row.key} className="quota-item">
                  <div className="quota-head">
                    <span className="tool-cell">
                      <ToolLogo toolId={t.id} provider={detected?.provider} size={16} />
                      {label}
                    </span>
                    <button
                      type="button"
                      className="quota-price-chip"
                      title="点击修改套餐价格"
                        onClick={() =>
                          setPriceEdit({
                            toolId: t.id,
                            name: label,
                            unit: t.id === 'kimi' ? 'CNY' : 'USD',
                            value: t.id === 'kimi' ? String(cny) : foreignPriceForEdit(t.id),
                          })
                      }
                    >
                      <span className="quota-price-cny">{formatCost(cny)}/月</span>
                      <span className="quota-pct">{remainTokenPct}%</span>
                    </button>
                  </div>
                  <div className="quota-track">
                    <div
                      className="quota-fill"
                      style={{ width: `${tokenPct}%`, background: getToolColor(t.id) }}
                    />
                  </div>
                  <div className="quota-meta">
                    <span>已用 {formatNumber(usedTokens)}</span>
                    <span>
                      额度 {formatNumber(tokenQuota)} · 剩余{' '}
                      {formatNumber(Math.max(tokenQuota - usedTokens, 0))}
                      {isForeignTool(t.id) && typeof pricesCny[t.id] !== 'number'
                        ? ` · 默认 $20 ≈ ${formatCost(cny)}/月`
                        : ''}
                    </span>
                  </div>
                </div>
              )
            })}
            {quotaRows.length === 0 && (
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)' }}>
                启动本机监测后显示可用 AI 工具套餐
              </div>
            )}
          </div>
      </div>

      {/* 大模型（页面最后） */}
      <div className="chart-card leaderboard-card">
        <div className="chart-header">
          <div>
            <div className="chart-title">大模型</div>
            <div className="leaderboard-sub">
              数据源：Artificial Analysis · Arena AI · 本地日缓存自动刷新
              {leaderboard?.updatedAt
                ? ` · 更新于 ${leaderboard.updatedAt.slice(0, 16).replace('T', ' ')}`
                : ''}
              {leaderboard?.fromCache ? ' · 缓存' : ''}
              {` · 1 USD ≈ ￥${fx.rate.toFixed(4)}`}
            </div>
          </div>
          <button
            className="btn btn-secondary"
            style={{ fontSize: '0.72rem', padding: '4px 10px' }}
            onClick={() => refreshLeaderboard(true)}
            disabled={lbLoading}
          >
            {lbLoading ? '拉取中…' : '刷新榜单'}
          </button>
        </div>
        {lbError && <div className="monitor-banner-error" style={{ marginBottom: 8 }}>{lbError}</div>}
        {leaderboard?.warnings?.length ? (
          <div className="monitor-banner-warn" style={{ marginBottom: 8 }}>
            {leaderboard.warnings[0]}
          </div>
        ) : null}
        <div className="leaderboard-scroll">
          <table className="data-table leaderboard-table">
            <thead>
              <tr>
                <th>#</th>
                <th>公司</th>
                <th>模型</th>
                <th>发布日期</th>
                <th style={{ textAlign: 'right' }}>上下文</th>
                <th style={{ textAlign: 'right' }}>综合价格</th>
                <th style={{ textAlign: 'right' }}>客观智力</th>
                <th style={{ textAlign: 'right' }}>科学推理</th>
                <th style={{ textAlign: 'right' }}>代码编程</th>
                <th style={{ textAlign: 'right' }}>Arena</th>
              </tr>
            </thead>
            <tbody>
              {(leaderboard?.models || []).map((m) => {
                const priceCny =
                  m.priceBlended != null ? usdToCny(m.priceBlended, fx.rate) : null
                return (
                  <tr key={m.slug}>
                    <td>
                      <span className={`rank-badge ${m.rank <= 3 ? 'top' : ''}`}>{m.rank}</span>
                    </td>
                    <td>
                      <div
                        className="lb-creator-cell"
                        title={m.creator && m.creator !== '—' ? m.creator : m.slug}
                      >
                        <CreatorLogo
                          creator={m.creator}
                          slug={m.slug}
                          name={m.name || m.shortName}
                          size={20}
                        />
                      </div>
                    </td>
                    <td>
                      <div className="lb-model">
                        <span className="lb-model-name">{m.shortName || m.name}</span>
                        <span className="lb-model-creator">{m.creator}</span>
                      </div>
                    </td>
                    <td className="lb-muted">{m.releaseDate || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{formatContext(m.contextWindow)}</td>
                    <td
                      style={{ textAlign: 'right' }}
                      title={
                        m.priceInput != null && m.priceOutput != null
                          ? `输入 $${m.priceInput}/1M · 输出 $${m.priceOutput}/1M`
                          : undefined
                      }
                    >
                      {priceCny != null ? formatCost(priceCny) : '—'}
                      <span className="lb-unit">/1M</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <strong>{formatScore(m.intelligence)}</strong>
                      {m.gpqa != null ? (
                        <div className="lb-subscore">GPQA {formatScore(m.gpqa)}</div>
                      ) : null}
                    </td>
                    <td style={{ textAlign: 'right' }}>{formatScore(m.science)}</td>
                    <td style={{ textAlign: 'right' }}>{formatScore(m.coding)}</td>
                    <td style={{ textAlign: 'right' }} className="lb-muted">
                      {m.arenaTextRank != null ? (
                        <>
                          T#{m.arenaTextRank}
                          {m.arenaCodeRank != null ? ` · C#${m.arenaCodeRank}` : ''}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                )
              })}
              {!lbLoading && !(leaderboard?.models?.length) && (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                    暂无榜单数据，请点击刷新或检查网络
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="leaderboard-legend">
          客观智力 = AA Intelligence Index；科学推理 = SciCode；代码编程 = AA Coding Index；
          综合价格 = (输入×3+输出)/4 按实时汇率换算人民币/百万 Token；Arena = 文本榜/代码榜名次
        </div>
      </div>

      {priceEdit && (
        <div
          className="modal-overlay"
          onClick={() => setPriceEdit(null)}
          role="presentation"
        >
          <div
            className="modal price-edit-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="price-edit-title"
          >
            <div className="modal-header">
              <div id="price-edit-title" style={{ fontWeight: 600 }}>
                修改套餐价格 · {priceEdit.name}
              </div>
              <button className="btn btn-secondary" onClick={() => setPriceEdit(null)}>
                关闭
              </button>
            </div>
            <div className="modal-body">
              <div className="price-unit-switch">
                {(['USD', 'CNY'] as const).map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    className={`filter-btn ${priceEdit.unit === unit ? 'active' : ''}`}
                    onClick={() => {
                      if (priceEdit.unit === unit) return
                      const n = parseFloat(priceEdit.value)
                      const amount = Number.isFinite(n) ? n : 0
                      const converted =
                        unit === 'CNY'
                          ? usdToCny(amount, fx.rate)
                          : cnyToUsd(amount, fx.rate)
                      setPriceEdit({
                        ...priceEdit,
                        unit,
                        value: String(converted),
                      })
                    }}
                  >
                    {unit === 'USD' ? '美元 $' : '人民币 ￥'}
                  </button>
                ))}
              </div>
              <label className="price-edit-field">
                <span className="price-edit-prefix">{priceEdit.unit === 'USD' ? '$' : '￥'}</span>
                <input
                  autoFocus
                  className="price-edit-input"
                  type="number"
                  min={0}
                  step={0.01}
                  inputMode="decimal"
                  value={priceEdit.value}
                  onChange={(e) => setPriceEdit({ ...priceEdit, value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') savePriceEdit()
                    if (e.key === 'Escape') setPriceEdit(null)
                  }}
                />
                <span className="price-edit-suffix">/月</span>
              </label>
              <div className="price-edit-preview">
                {(() => {
                  const n = parseFloat(priceEdit.value)
                  const amount = Number.isFinite(n) && n >= 0 ? n : 0
                  if (priceEdit.unit === 'USD') {
                    return <>约合 {formatCost(usdToCny(amount, fx.rate))}/月（将按此人民币保存）</>
                  }
                  return <>参考 {formatUsd(cnyToUsd(amount, fx.rate))}/月</>
                })()}
                <div className="price-edit-rate">
                  汇率 1 USD ≈ ￥{fx.rate.toFixed(4)} · 以人民币保存并直接展示
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setPriceEdit(null)}>
                取消
              </button>
              <button className="btn btn-primary" onClick={savePriceEdit}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
