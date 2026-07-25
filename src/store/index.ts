import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  dailyTokenData,
  aiTools,
  toolEvaluations,
  knowledgeTreeFull,
  fileContents,
  searchIndex,
} from './data'
import type { DailyTokenRecord, AIToolEvaluation, TreeNode } from './data'
import {
  fetchGitHubProfile,
  isWhitelisted,
  type GitHubProfile,
} from '../lib/githubAuth'
import {
  fetchKbFileContent,
  fetchKbDirListing,
  getCachedKbContent,
  setCachedKbContent,
  clearKbDirCache,
  KB_OWNER,
  KB_REPO,
  KB_BRANCH,
} from '../lib/githubKb'
import { detectWorkEnv, type WorkEnv } from '../lib/workEnv'
import { USD_CNY, usdToCny } from '../utils/helpers'

// ============ Auth Store ============
export interface AuthUser {
  id: string
  username: string
  name: string
  avatar: string
  avatarUrl: string
  htmlUrl: string
  loginMethod: 'github'
  isWhitelisted: boolean
  sessionExpiresAt: number
}

interface AuthState {
  user: AuthUser | null
  accessToken: string | null
  isPersonalDevice: boolean
  deviceId: string
  deviceEnv: WorkEnv
  authError: string | null
  loginWithToken: (token: string, isPersonal: boolean, deviceEnv: WorkEnv) => Promise<void>
  logout: () => void
  clearAuthError: () => void
  revalidate: () => Promise<boolean>
}

function createDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `device-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

function toAuthUser(profile: GitHubProfile, isPersonal: boolean): AuthUser {
  const ttl = isPersonal ? 30 * 24 * 60 * 60 * 1000 : 8 * 60 * 60 * 1000
  return {
    id: String(profile.id),
    username: profile.login,
    name: profile.name || profile.login,
    avatar: profile.login.slice(0, 2).toUpperCase(),
    avatarUrl: profile.avatar_url,
    htmlUrl: profile.html_url,
    loginMethod: 'github',
    isWhitelisted: isWhitelisted(profile.login),
    sessionExpiresAt: Date.now() + ttl,
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      isPersonalDevice: false,
      deviceId: createDeviceId(),
      deviceEnv: 'office',
      authError: null,
      clearAuthError: () => set({ authError: null }),
      loginWithToken: async (token, isPersonal, deviceEnv) => {
        const profile = await fetchGitHubProfile(token.trim())
        set({
          user: toAuthUser(profile, isPersonal),
          accessToken: token.trim(),
          isPersonalDevice: isPersonal,
          deviceEnv,
          authError: null,
        })
      },
      logout: () =>
        set({
          user: null,
          accessToken: null,
          isPersonalDevice: false,
          authError: null,
        }),
      revalidate: async () => {
        const { accessToken, user, isPersonalDevice, logout } = get()
        if (!accessToken || !user) return false
        if (user.sessionExpiresAt <= Date.now()) {
          logout()
          return false
        }
        try {
          const profile = await fetchGitHubProfile(accessToken)
          set({
            user: {
              ...toAuthUser(profile, isPersonalDevice),
              sessionExpiresAt: user.sessionExpiresAt,
            },
            authError: null,
          })
          return true
        } catch (e) {
          // 仅在凭证无效 / 非白名单时强制退出；网络异常保留本地会话
          const code = e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : ''
          if (code === 'invalid_token' || code === 'not_whitelisted') {
            logout()
            return false
          }
          return Boolean(user.isWhitelisted)
        }
      },
    }),
    {
      name: 'personal-ops-auth',
      version: 2,
      migrate: (persisted: unknown) => {
        const state = (persisted || {}) as Partial<AuthState>
        return {
          ...state,
          deviceId: state.deviceId || createDeviceId(),
          deviceEnv: state.deviceEnv || 'office',
        }
      },
      partialize: (s) => ({
        user: s.user,
        accessToken: s.accessToken,
        isPersonalDevice: s.isPersonalDevice,
        deviceId: s.deviceId,
        deviceEnv: s.deviceEnv,
      }),
    }
  )
)

// ============ Knowledge Store ============
type ContentStatus = 'idle' | 'loading' | 'ready' | 'error'

interface KnowledgeState {
  tree: TreeNode[]
  currentPath: string | null
  currentContent: string | null
  contentStatus: ContentStatus
  contentError: string | null
  searchResults: typeof searchIndex
  searchQuery: string
  /** 已展开目录（用数组保证 Zustand 能触发重渲染） */
  expandedDirs: string[]
  /** 已成功从 GitHub 同步过的目录 */
  loadedDirs: string[]
  /** 正在拉取的目录 */
  loadingDirs: string[]
  /** 目录加载错误 */
  dirErrors: Record<string, string>
  /** 打开文件：优先 GitHub 最新内容，失败再回退本地 */
  selectFile: (path: string, accessToken?: string | null) => Promise<void>
  setSearchQuery: (q: string) => void
  /** 展开/折叠；展开时按需从 GitHub 拉取下级 */
  toggleDir: (path: string, accessToken?: string | null) => Promise<void>
  /** 确保目录已从 GitHub 加载（用于默认展开目录） */
  ensureDirLoaded: (path: string, accessToken?: string | null, force?: boolean) => Promise<void>
  clearSelection: () => void
}

function findTreeNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const n of nodes) {
    if (n.path === path) return n
    if (n.children?.length) {
      const hit = findTreeNode(n.children, path)
      if (hit) return hit
    }
  }
  return null
}

/** 以 GitHub 列表为准替换子节点；保留已展开子目录的缓存 children */
function mergeChildNodes(prev: TreeNode[] | undefined, children: TreeNode[]): TreeNode[] {
  const prevByPath = new Map((prev || []).map((c) => [c.path, c]))
  return children.map((c) => {
    const old = prevByPath.get(c.path)
    if (c.type === 'folder' && old?.type === 'folder' && old.children?.length) {
      return {
        ...c,
        children: old.children,
        fileCount: old.fileCount ?? old.children.length,
      }
    }
    if (c.type === 'folder' && old?.type === 'folder') {
      return {
        ...c,
        children: old.children || [],
        fileCount: old.fileCount ?? old.children?.length ?? 0,
      }
    }
    return c
  })
}

function updateTreeChildren(nodes: TreeNode[], dirPath: string, children: TreeNode[]): TreeNode[] {
  if (!dirPath) {
    return mergeChildNodes(nodes, children)
  }
  return nodes.map((n) => {
    if (n.path === dirPath) {
      const next = mergeChildNodes(n.children, children)
      return { ...n, children: next, fileCount: next.length }
    }
    if (n.children?.length) {
      return { ...n, children: updateTreeChildren(n.children, dirPath, children) }
    }
    return n
  })
}

function listingToNodes(listing: { name: string; path: string; type: 'file' | 'folder' }[]): TreeNode[] {
  return listing.map((e) =>
    e.type === 'folder'
      ? { name: e.name, path: e.path, type: 'folder' as const, children: [], fileCount: 0 }
      : { name: e.name, path: e.path, type: 'file' as const }
  )
}

function fallbackFromIndex(path: string): string {
  const hit = searchIndex.find((i) => i.path === path)
  const title = hit?.title || path.split('/').pop() || path
  const preview = hit?.preview || '暂无预览'
  return `# ${title}\n\n${preview}\n\n---\n\n> 路径：\`${path}\`\n>\n> 未能从 GitHub 拉取正文。请确认 Token 含 \`repo\` 权限，且仓库为 \`${KB_OWNER}/${KB_REPO}\`（分支 \`${KB_BRANCH}\`）。`
}

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  tree: knowledgeTreeFull,
  currentPath: null,
  currentContent: null,
  contentStatus: 'idle',
  contentError: null,
  searchResults: searchIndex,
  searchQuery: '',
  expandedDirs: ['00_Inbox'],
  loadedDirs: [],
  loadingDirs: [],
  dirErrors: {},
  selectFile: async (path, accessToken) => {
    const cached = getCachedKbContent(path)
    const mock = fileContents[path]

    // 有 Token：始终拉 GitHub 最新；可先展示缓存/mock 作占位
    if (accessToken) {
      set({
        currentPath: path,
        currentContent: cached || mock || null,
        contentStatus: cached || mock ? 'ready' : 'loading',
        contentError: null,
      })
      try {
        const text = await fetchKbFileContent(accessToken, path, { force: true })
        setCachedKbContent(path, text)
        if (get().currentPath !== path) return
        set({
          currentContent: text,
          contentStatus: 'ready',
          contentError: null,
        })
      } catch (e) {
        if (get().currentPath !== path) return
        const msg = (e as Error).message || '加载失败'
        const fallback = cached || mock || fallbackFromIndex(path)
        set({
          currentContent: fallback.includes('未能从 GitHub')
            ? fallback
            : `${fallback}\n\n---\n\n> GitHub 最新内容拉取失败：${msg}`,
          contentStatus: cached || mock ? 'ready' : 'error',
          contentError: msg,
        })
      }
      return
    }

    if (cached || mock) {
      set({
        currentPath: path,
        currentContent: cached || mock || null,
        contentStatus: 'ready',
        contentError: null,
      })
      return
    }

    set({
      currentPath: path,
      currentContent: fallbackFromIndex(path),
      contentStatus: 'error',
      contentError: '未登录，无法从 GitHub 拉取正文',
    })
  },
  setSearchQuery: (q) => {
    if (!q.trim()) {
      set({ searchQuery: '', searchResults: searchIndex })
      return
    }
    const lower = q.toLowerCase()
    const filtered = searchIndex.filter(
      (item) =>
        item.title.toLowerCase().includes(lower) ||
        item.preview.toLowerCase().includes(lower) ||
        item.path.toLowerCase().includes(lower)
    )
    set({ searchQuery: q, searchResults: filtered })
  },
  ensureDirLoaded: async (path, accessToken, force = false) => {
    if (!accessToken) return
    if (get().loadingDirs.includes(path)) return

    set({
      loadingDirs: [...get().loadingDirs.filter((p) => p !== path), path],
      dirErrors: Object.fromEntries(
        Object.entries(get().dirErrors).filter(([k]) => k !== path)
      ),
    })

    try {
      if (force) clearKbDirCache(path)
      // force=false 时走 30s 目录缓存，过期后自动拿 GitHub 最新列表
      const listing = await fetchKbDirListing(accessToken, path, { force })
      const children = listingToNodes(listing)
      const node = path ? findTreeNode(get().tree, path) : null
      const localCount = path ? node?.children?.length || 0 : get().tree.length
      // 远程为空且本地仅有 mock 骨架时保留骨架，避免整树空白
      if (children.length === 0 && localCount > 0) {
        set({
          loadedDirs: [...get().loadedDirs.filter((p) => p !== path), path],
          loadingDirs: get().loadingDirs.filter((p) => p !== path),
        })
        return
      }
      set({
        tree: updateTreeChildren(get().tree, path, children),
        loadedDirs: [...get().loadedDirs.filter((p) => p !== path), path],
        loadingDirs: get().loadingDirs.filter((p) => p !== path),
      })
    } catch (e) {
      const msg = (e as Error).message || '目录加载失败'
      // 失败不写入 loadedDirs，允许再次展开重试
      set({
        loadingDirs: get().loadingDirs.filter((p) => p !== path),
        dirErrors: { ...get().dirErrors, [path]: msg },
      })
    }
  },
  toggleDir: async (path, accessToken) => {
    const { expandedDirs } = get()
    const isOpen = expandedDirs.includes(path)
    if (isOpen) {
      set({ expandedDirs: expandedDirs.filter((p) => p !== path) })
      return
    }

    set({ expandedDirs: [...expandedDirs, path] })
    if (!accessToken) return
    await get().ensureDirLoaded(path, accessToken, false)
  },
  clearSelection: () =>
    set({
      currentPath: null,
      currentContent: null,
      contentStatus: 'idle',
      contentError: null,
    }),
}))

// ============ AI Assistant Store ============
type Period = '7d' | '30d' | 'all'
type TrendGrain = 'day' | 'week' | 'month'

interface AIAssistantState {
  dailyData: DailyTokenRecord[]
  evaluations: AIToolEvaluation[]
  period: Period
  trendGrain: TrendGrain
  selectedTools: Set<string>
  workEnv: WorkEnv
  setPeriod: (p: Period) => void
  setTrendGrain: (g: TrendGrain) => void
  toggleTool: (id: string) => void
  setSelectedTools: (ids: Set<string>) => void
  setWorkEnv: (env: WorkEnv) => void
  syncWorkEnvFromLogin: (isPersonalDevice: boolean) => void
  getFilteredData: () => DailyTokenRecord[]
  getSummary: () => {
    totalTokens: number
    totalCost: number
    dailyAvgTokens: number
    dailyAvgCost: number
    activeDays: number
    toolCount: number
    prevTotalTokens: number
    prevTotalCost: number
    prevActiveDays: number
  }
  getToolBreakdown: () => { toolId: string; tokenPct: number; costPct: number; taskPct: number }[]
  getDailyTrend: () => Record<string, number | string>[]
  getRanking: () => AIToolEvaluation[]
  getDateRangeLabel: () => string
}

function periodCutoff(period: Period): number {
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 9999
  return Date.now() - days * 86400000
}

export const useAIAssistantStore = create<AIAssistantState>((set, get) => ({
  dailyData: dailyTokenData,
  evaluations: toolEvaluations,
  period: '30d',
  trendGrain: 'day',
  selectedTools: new Set(aiTools.map((t) => t.id)),
  workEnv: 'office',
  setPeriod: (p) => set({ period: p }),
  setTrendGrain: (g) => set({ trendGrain: g }),
  toggleTool: (id) => {
    const { selectedTools } = get()
    const next = new Set(selectedTools)
    if (next.has(id)) {
      if (next.size > 1) next.delete(id)
    } else next.add(id)
    set({ selectedTools: next })
  },
  setSelectedTools: (ids) => set({ selectedTools: ids }),
  setWorkEnv: (env) => set({ workEnv: env }),
  syncWorkEnvFromLogin: (isPersonalDevice) => {
    set({ workEnv: detectWorkEnv(isPersonalDevice) })
  },
  getFilteredData: () => {
    const { period, dailyData, workEnv, selectedTools } = get()
    const cutoff = periodCutoff(period)
    return dailyData.filter(
      (d) =>
        new Date(d.date).getTime() >= cutoff &&
        d.env === workEnv &&
        selectedTools.has(d.toolId)
    )
  },
  getSummary: () => {
    const data = get().getFilteredData()
    const { period, dailyData, workEnv, selectedTools } = get()
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 30
    const prevCutoff = Date.now() - days * 2 * 86400000
    const prevCutoffStart = Date.now() - days * 86400000
    const prevData = dailyData.filter(
      (d) =>
        new Date(d.date).getTime() >= prevCutoff &&
        new Date(d.date).getTime() < prevCutoffStart &&
        d.env === workEnv &&
        selectedTools.has(d.toolId)
    )

    const totalTokens = data.reduce((s, d) => s + d.inputTokens + d.outputTokens, 0)
    const totalCost = data.reduce((s, d) => s + d.cost, 0)
    const activeDays = new Set(data.map((d) => d.date)).size
    const toolCount = new Set(data.map((d) => d.toolId)).size
    const prevTotalTokens = prevData.reduce((s, d) => s + d.inputTokens + d.outputTokens, 0)
    const prevTotalCost = prevData.reduce((s, d) => s + d.cost, 0)
    const prevActiveDays = new Set(prevData.map((d) => d.date)).size

    return {
      totalTokens,
      totalCost: Math.round(totalCost * 100) / 100,
      dailyAvgTokens: activeDays ? Math.round(totalTokens / activeDays) : 0,
      dailyAvgCost: activeDays ? Math.round((totalCost / activeDays) * 100) / 100 : 0,
      activeDays,
      toolCount,
      prevTotalTokens,
      prevTotalCost: Math.round(prevTotalCost * 100) / 100,
      prevActiveDays,
    }
  },
  getToolBreakdown: () => {
    const data = get().getFilteredData()
    const totalTokens = data.reduce((s, d) => s + d.inputTokens + d.outputTokens, 0) || 1
    const totalCost = data.reduce((s, d) => s + d.cost, 0) || 1
    const totalTasks = data.reduce((s, d) => s + d.taskCount, 0) || 1
    const toolIds = [...new Set(data.map((d) => d.toolId))]

    return toolIds.map((toolId) => {
      const toolData = data.filter((d) => d.toolId === toolId)
      const tokens = toolData.reduce((s, d) => s + d.inputTokens + d.outputTokens, 0)
      const cost = toolData.reduce((s, d) => s + d.cost, 0)
      const tasks = toolData.reduce((s, d) => s + d.taskCount, 0)
      return {
        toolId,
        tokenPct: (tokens / totalTokens) * 100,
        costPct: (cost / totalCost) * 100,
        taskPct: (tasks / totalTasks) * 100,
      }
    }).sort((a, b) => b.tokenPct - a.tokenPct)
  },
  getDailyTrend: () => {
    const data = get().getFilteredData()
    const dates = [...new Set(data.map((d) => d.date))].sort()
    return dates.map((date) => {
      const row: Record<string, number | string> = { date }
      aiTools.forEach((t) => {
        const dayData = data.filter((d) => d.date === date && d.toolId === t.id)
        row[t.id] = dayData.reduce((s, d) => s + d.inputTokens + d.outputTokens, 0)
      })
      return row
    })
  },
  getRanking: () => {
    return [...get().evaluations].sort((a, b) => b.overallScore - a.overallScore)
  },
  getDateRangeLabel: () => {
    const { period } = get()
    const end = new Date()
    const start = new Date()
    if (period === '7d') start.setDate(end.getDate() - 6)
    else if (period === '30d') start.setDate(end.getDate() - 29)
    else start.setDate(end.getDate() - 29)
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return `${fmt(start)} ~ ${fmt(end)}`
  },
}))

// ============ 套餐价格（人民币持久化，列表直接展示） ============
type PriceMap = Record<string, number>
type QuotaMap = Record<string, number>

/** 目录默认美元价 → 人民币默认（固定回退汇率，仅作初始值） */
const defaultCnyPrices: PriceMap = Object.fromEntries(
  aiTools.map((t) => [t.id, usdToCny(t.subscriptionPrice, USD_CNY)])
)

const defaultQuotas: QuotaMap = {
  codex: 20_000_000,
  claude: 15_000_000,
  kimi: 15_000_000,
  cursor: 15_000_000,
}

interface SubscriptionState {
  /** 各工具月费，单位：人民币（用户编辑后原样保存） */
  pricesCny: PriceMap
  /** 各工具月额度 Token */
  quotas: QuotaMap
  setPriceCny: (toolId: string, cny: number) => void
  setQuota: (toolId: string, tokens: number) => void
  getPriceCny: (toolId: string) => number
  getQuota: (toolId: string) => number
}

export const useSubscriptionStore = create<SubscriptionState>()(
  persist(
    (set, get) => ({
      pricesCny: {},
      quotas: { ...defaultQuotas },
      setPriceCny: (toolId, cny) => {
        const n = Number.isFinite(cny) && cny >= 0 ? Math.round(cny * 100) / 100 : 0
        set((s) => ({ pricesCny: { ...s.pricesCny, [toolId]: n } }))
      },
      setQuota: (toolId, tokens) => {
        const n = Number.isFinite(tokens) && tokens > 0 ? Math.round(tokens) : defaultQuotas[toolId] || 15_000_000
        set((s) => ({ quotas: { ...s.quotas, [toolId]: n } }))
      },
      getPriceCny: (toolId) => {
        const v = get().pricesCny[toolId]
        if (typeof v === 'number') return v
        // 多账号订阅使用 `工具:账号` 独立存储；首次使用继承工具默认价。
        const baseToolId = toolId.split(':')[0]
        return defaultCnyPrices[baseToolId] ?? 0
      },
      getQuota: (toolId) => {
        const v = get().quotas[toolId]
        return typeof v === 'number' ? v : defaultQuotas[toolId] ?? 15_000_000
      },
    }),
    {
      name: 'personal-ops-subscriptions',
      version: 3,
      migrate: (persisted: unknown, version) => {
        const s = (persisted || {}) as {
          pricesUsd?: PriceMap
          pricesCny?: PriceMap
          quotas?: QuotaMap
        }
        if (version < 2 && s.pricesUsd && !s.pricesCny) {
          const pricesCny: PriceMap = {}
          for (const [id, usd] of Object.entries(s.pricesUsd)) {
            pricesCny[id] = usdToCny(Number(usd) || 0, USD_CNY)
          }
          return { pricesCny, quotas: s.quotas || { ...defaultQuotas } }
        }
        const pricesCny = { ...(s.pricesCny || {}) }
        if (version < 3) {
          // 旧版把默认值也持久化了；移除未修改的默认项，之后可按实时汇率显示 $20。
          for (const [id, value] of Object.entries(pricesCny)) {
            if (value === defaultCnyPrices[id]) delete pricesCny[id]
          }
        }
        return {
          pricesCny,
          quotas: s.quotas || { ...defaultQuotas },
        }
      },
    }
  )
)
