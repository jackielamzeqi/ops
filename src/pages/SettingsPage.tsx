import { useAuthStore } from '../store'
import { useNavigate } from 'react-router-dom'
import { useDeviceType, useOnlineStatus } from '../hooks/useDevice'
import { WORK_ENVS } from '../lib/workEnv'

export default function SettingsPage() {
  const { user, logout, isPersonalDevice, deviceId, deviceEnv } = useAuthStore()
  const navigate = useNavigate()
  const device = useDeviceType()
  const online = useOnlineStatus()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const sessionRemaining = user
    ? Math.max(0, Math.ceil((user.sessionExpiresAt - Date.now()) / (1000 * 60 * 60)))
    : 0

  const envLabel = WORK_ENVS.find((e) => e.id === deviceEnv)

  return (
    <div className="fade-in">
      <h1 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: '24px' }}>设置</h1>

      <div className="card">
        <div className="card-title">账号</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>GitHub</span>
            <a
              href={user?.htmlUrl}
              target="_blank"
              rel="noreferrer"
              style={{ fontWeight: 500, color: 'var(--color-primary)', textDecoration: 'none' }}
            >
              @{user?.username}
            </a>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>显示名</span>
            <span style={{ fontWeight: 500 }}>{user?.name}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>设备标识</span>
            <span style={{ fontWeight: 500 }} title={deviceId}>{deviceId.slice(0, 8)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>登录方式</span>
            <span className="tag tag-primary">GitHub OAuth / Token</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>白名单</span>
            <span className="tag tag-success">已授权</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>设备类型</span>
            <span className={`tag ${isPersonalDevice ? 'tag-success' : 'tag-warning'}`}>
              {isPersonalDevice ? '个人设备' : '临时设备'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>会话剩余</span>
            <span style={{ fontWeight: 500 }}>
              {sessionRemaining > 0 ? `${sessionRemaining} 小时` : '已过期'}
            </span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">设备与环境</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>设备</span>
            <span style={{ fontWeight: 500 }}>
              {device === 'mobile' ? '📱 手机' : device === 'tablet' ? '📲 平板' : '💻 桌面'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>工作环境</span>
            <span style={{ fontWeight: 500 }}>
              {envLabel?.icon} {envLabel?.label || deviceEnv}
            </span>
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--color-text-tertiary)', lineHeight: 1.55 }}>
            工作环境在登录时选择。若要切换，请先退出当前 GitHub 账号，用新的 PAT 重新登录后再选环境。
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>网络</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.85rem' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: online ? 'var(--color-success)' : 'var(--color-danger)' }} />
              {online ? '在线' : '离线'}
            </span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">本机监测（跨环境）</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
          <p style={{ margin: '0 0 8px' }}>
            网页不能直接启动电脑进程。个人/公司电脑共用同一套脚本：
          </p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>
              一键：双击 <code>启动监测.command</code>
            </li>
            <li>
              自启：双击 <code>安装开机自启.command</code>（每台一次）
            </li>
            <li>
              终端：<code>npm run agent:start</code> / <code>npm run agent:setup</code>
            </li>
          </ul>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginTop: 12, width: '100%' }}
          onClick={() => {
            const cmd =
              'cd "$HOME/obsidian_vault/02_Operations/Workspaces/personal-ops" && npm run agent:start'
            void navigator.clipboard?.writeText(cmd)
            alert('已复制启动命令，粘贴到终端回车即可')
          }}
        >
          复制一键启动命令
        </button>
      </div>

      <div className="card">
        <div className="card-title">PWA</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: '0.85rem' }}>添加到主屏幕</span>
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>安装为独立应用</div>
            </div>
            <button className="btn btn-secondary" onClick={() => alert('请在浏览器菜单中选择"添加到主屏幕"')}>安装</button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem' }}>离线缓存</span>
            <span className="tag tag-success">已启用</span>
          </div>
        </div>
      </div>

      <button className="btn btn-danger" style={{ width: '100%' }} onClick={handleLogout}>退出登录</button>

      <div style={{ textAlign: 'center', marginTop: 24, fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>
        Personal Ops v2.4.0 · personal-ops<br />© 2026
      </div>
    </div>
  )
}
