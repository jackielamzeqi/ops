import { useAuthStore, useAIAssistantStore } from '../store'
import { useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import {
  GitHubAuthError,
  GITHUB_TOKEN_CREATE_URL,
  canUseDeviceFlow,
  pollDeviceToken,
  startDeviceFlow,
} from '../lib/githubAuth'
import { WORK_ENVS, type WorkEnv } from '../lib/workEnv'

type Mode = 'idle' | 'device' | 'token'

export default function LoginPage() {
  const { loginWithToken } = useAuthStore()
  const navigate = useNavigate()
  const [isPersonal, setIsPersonal] = useState(true)
  const [deviceEnv, setDeviceEnv] = useState<WorkEnv>('office')
  const [mode, setMode] = useState<Mode>('idle')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [token, setToken] = useState('')
  const [userCode, setUserCode] = useState('')
  const [verifyUrl, setVerifyUrl] = useState('https://github.com/login/device')
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const finishLogin = async (accessToken: string) => {
    await loginWithToken(accessToken, isPersonal, deviceEnv)
    useAIAssistantStore.getState().setWorkEnv(deviceEnv)
    navigate('/')
  }

  const handleDeviceLogin = async () => {
    setError('')
    setLoading(true)
    setMode('device')
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const device = await startDeviceFlow()
      setUserCode(device.user_code)
      setVerifyUrl(device.verification_uri)
      window.open(device.verification_uri, '_blank', 'noopener,noreferrer')
      const accessToken = await pollDeviceToken(device.device_code, device.interval, ac.signal)
      await finishLogin(accessToken)
    } catch (e) {
      if (e instanceof GitHubAuthError && e.code === 'cancelled') {
        setError('已取消登录')
      } else if (e instanceof GitHubAuthError) {
        setError(e.message)
      } else {
        setError('GitHub 登录失败，请改用 Token 登录')
      }
      setMode('idle')
    } finally {
      setLoading(false)
    }
  }

  const handleTokenLogin = async () => {
    setError('')
    if (!token.trim()) {
      setError('请粘贴 GitHub Token')
      return
    }
    setLoading(true)
    try {
      await finishLogin(token.trim())
    } catch (e) {
      if (e instanceof GitHubAuthError) setError(e.message)
      else setError('登录失败，请检查 Token 是否有效')
    } finally {
      setLoading(false)
    }
  }

  const handlePrimary = () => {
    if (canUseDeviceFlow()) handleDeviceLogin()
    else setMode('token')
  }

  return (
    <div className="login-page fade-in">
      <div className="login-card">
        <div style={{ fontSize: '2.5rem', marginBottom: '16px' }}>⚡</div>
        <h1 className="login-title">Personal Ops</h1>
        <p className="login-subtitle">使用 GitHub 账号登录后才能访问知识库</p>

        <div style={{ marginBottom: 18 }}>
          <div className="login-hint" style={{ marginBottom: 8 }}>选择本机工作环境</div>
          <div className="env-switcher" style={{ justifyContent: 'center', marginBottom: 0 }}>
            {WORK_ENVS.map((env) => (
              <button
                type="button"
                key={env.id}
                className={`env-chip ${deviceEnv === env.id ? 'active' : ''}`}
                onClick={() => setDeviceEnv(env.id)}
                disabled={loading}
              >
                <span>{env.icon}</span>{env.label}
              </button>
            ))}
          </div>
          <p className="login-hint" style={{ marginTop: 8 }}>
            登录后工作环境锁定；切换需先退出，再用新的 PAT 重新登录并选择
          </p>
        </div>

        {mode === 'device' && loading ? (
          <div className="login-device">
            <div className="login-device-code">{userCode || '····-····'}</div>
            <p className="login-hint">
              请在 GitHub 打开授权页并输入上方代码
              <br />
              <a href={verifyUrl} target="_blank" rel="noreferrer">
                {verifyUrl}
              </a>
            </p>
            <button
              className="btn btn-secondary"
              style={{ marginTop: 12 }}
              onClick={() => {
                abortRef.current?.abort()
                setMode('idle')
                setLoading(false)
              }}
            >
              取消
            </button>
          </div>
        ) : mode === 'token' ? (
          <div className="login-token">
            <p className="login-hint" style={{ marginBottom: 12, textAlign: 'left' }}>
              1. 创建具有 <code>read:user</code> 权限的 Token
              <br />
              2. 粘贴到下方（仅保存在本机浏览器）
            </p>
            <a
              className="btn btn-secondary"
              style={{ width: '100%', marginBottom: 12, display: 'block', textDecoration: 'none' }}
              href={GITHUB_TOKEN_CREATE_URL}
              target="_blank"
              rel="noreferrer"
            >
              打开 GitHub 创建 Token
            </a>
            <input
              className="login-token-input"
              type="password"
              placeholder="粘贴 ghp_… 或 github_pat_…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
            />
            <button
              className="btn btn-primary login-btn"
              style={{ marginTop: 12 }}
              disabled={loading}
              onClick={handleTokenLogin}
            >
              {loading ? '正在验证…' : '验证并登录'}
            </button>
            <button
              className="btn btn-secondary"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => {
                setMode('idle')
                setError('')
              }}
            >
              返回
            </button>
          </div>
        ) : (
          <>
            <button className="btn btn-primary login-btn" onClick={handlePrimary} disabled={loading}>
              {loading ? '正在登录…' : '使用 GitHub 登录'}
            </button>
            {canUseDeviceFlow() && (
              <button
                className="btn btn-secondary"
                style={{ width: '100%', marginTop: 8 }}
                onClick={() => setMode('token')}
              >
                使用 Token 登录
              </button>
            )}
            {!canUseDeviceFlow() && (
              <p className="login-hint" style={{ marginTop: 12 }}>
                将通过 GitHub Token 验证身份；仅白名单账号可访问知识库
              </p>
            )}
            <label className="login-checkbox">
              <input
                type="checkbox"
                checked={isPersonal}
                onChange={(e) => setIsPersonal(e.target.checked)}
                style={{ accentColor: 'var(--color-primary)' }}
              />
              这是我的个人设备
            </label>
            <p className="login-hint">
              {isPersonal
                ? `登录保持 30 天 · 保存为「${WORK_ENVS.find((e) => e.id === deviceEnv)?.label}」`
                : `登录保持 8 小时 · 保存为「${WORK_ENVS.find((e) => e.id === deviceEnv)?.label}」`}
            </p>
          </>
        )}

        {error && <div className="login-error">{error}</div>}
      </div>
    </div>
  )
}
