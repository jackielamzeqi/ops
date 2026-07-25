import { useCallback, useEffect, useState } from 'react'
import {
  fetchModelLeaderboard,
  type LeaderboardSnapshot,
} from '../lib/modelLeaderboard'

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

async function fetchFromAgent(force: boolean): Promise<LeaderboardSnapshot | null> {
  try {
    const q = force ? '?refresh=1' : ''
    const res = await fetch(`${agentBase()}/api/leaderboard${q}`, {
      signal: withTimeout(120_000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as LeaderboardSnapshot
    return data?.ok ? data : null
  } catch {
    return null
  }
}

export function useModelLeaderboard() {
  const [data, setData] = useState<LeaderboardSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    try {
      // 优先本机 agent（有日缓存）；失败则浏览器直连权威镜像
      const fromAgent = await fetchFromAgent(force)
      if (fromAgent) {
        setData(fromAgent)
        return
      }
      const snap = await fetchModelLeaderboard(force)
      setData(snap)
      if (!snap.ok) setError(snap.warnings[0] || '榜单暂不可用')
    } catch (e) {
      setError((e as Error).message || '榜单加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh(false)
    // 页面保持打开时，跨日自动再拉一次
    const id = window.setInterval(() => {
      void refresh(false)
    }, 60 * 60 * 1000)
    return () => window.clearInterval(id)
  }, [refresh])

  return { data, loading, error, refresh }
}
