import { useCallback, useEffect, useState } from 'react'
import {
  fetchAgentHealth,
  fetchTokenSnapshot,
  type TokenSnapshot,
} from '../lib/tokenMonitor'
import { readTokenSnapshot, writeTokenSnapshot } from '../lib/tokenSnapshotDb'
import type { WorkEnv } from '../lib/workEnv'

export type MonitorStatus = 'checking' | 'online' | 'offline' | 'loading' | 'error'

/**
 * 进入 AI 工作页时连接本机监测；成功后写入「账号 + 工作环境」绑定的持久库。
 * 本机未连接时回退读取同账号同环境的跨端缓存。
 */
export function useTokenMonitor(
  workEnv: WorkEnv,
  account: string | null,
  accessToken: string | null,
  pollMs = 120_000
) {
  const [status, setStatus] = useState<MonitorStatus>('checking')
  const [snapshot, setSnapshot] = useState<TokenSnapshot | null>(null)
  const [error, setError] = useState('')

  const loadCache = useCallback(async (): Promise<TokenSnapshot | null> => {
    if (!accessToken || !account) return null
    return readTokenSnapshot(accessToken, account, workEnv)
  }, [accessToken, account, workEnv])

  const refresh = useCallback(
    async (force = false) => {
      setStatus((s) => (s === 'offline' || s === 'checking' ? 'loading' : s))
      try {
        const ok = await fetchAgentHealth()
        if (!ok) {
          const cached = await loadCache()
          setSnapshot(cached)
          setStatus('offline')
          setError(
            cached
              ? '本机监测未连接，已显示该账号·工作环境的数据库缓存'
              : '未检测到本机监测服务，请双击「启动监测.command」或执行 npm run agent:start'
          )
          return cached
        }

        setStatus('loading')
        const snap = await fetchTokenSnapshot(force)
        setSnapshot(snap)

        if (accessToken && account) {
          try {
            await writeTokenSnapshot(accessToken, account, workEnv, snap)
            setError('')
          } catch (e) {
            setError(e instanceof Error ? e.message : '实时数据持久化失败')
          }
        } else {
          setError('')
        }
        setStatus('online')
        return snap
      } catch (e) {
        try {
          const cached = await loadCache()
          if (cached) {
            setSnapshot(cached)
            setStatus('offline')
            setError(
              `${e instanceof Error ? e.message : '监测采集失败'} · 已回退数据库缓存`
            )
            return cached
          }
        } catch {
          /* ignore cache fallback errors */
        }
        setStatus('error')
        setError(e instanceof Error ? e.message : '监测采集失败')
        return null
      }
    },
    [accessToken, account, loadCache, workEnv]
  )

  useEffect(() => {
    void refresh(false)
    const t = setInterval(() => void refresh(false), pollMs)
    return () => clearInterval(t)
  }, [refresh, pollMs])

  return { status, snapshot, error, refresh }
}
