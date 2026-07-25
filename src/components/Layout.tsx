import { NavLink } from 'react-router-dom'
import { useAuthStore } from '../store'
import { useDeviceType } from '../hooks/useDevice'
import { WORK_ENVS } from '../lib/workEnv'

const navItems = [
  { path: '/', label: '知识库', icon: '📚', mobileOnly: false },
  { path: '/ai-assistant', label: 'AI 工具', icon: '🤖', mobileOnly: false },
  { path: '/settings', label: '设置', icon: '⚙️', mobileOnly: false },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, deviceEnv } = useAuthStore()
  const device = useDeviceType()
  const isMobile = device === 'mobile'

  return (
    <div className="app-shell">
      {/* Desktop sidebar */}
      {!isMobile && (
        <aside className="sidebar">
          <div className="sidebar-brand">⚡ Personal Ops</div>
          <nav className="sidebar-nav">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) =>
                  `sidebar-nav-item ${isActive ? 'active' : ''}`
                }
              >
                <span className="sidebar-nav-icon">{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </nav>
          {user && (
            <div style={{ padding: '12px 16px', borderTop: '0.5px solid var(--color-separator-opaque)', marginTop: 'auto' }}>
              <div className="sidebar-profile">
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt=""
                    width={28}
                    height={28}
                    style={{ borderRadius: '50%', objectFit: 'cover' }}
                  />
                ) : (
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: 'var(--color-primary)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.75rem', fontWeight: 700, color: '#fff'
                  }}>
                    {user.avatar}
                  </div>
                )}
                <div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 500 }}>@{user.username}</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--color-text-tertiary)' }}>
                    {WORK_ENVS.find((e) => e.id === deviceEnv)?.icon} {WORK_ENVS.find((e) => e.id === deviceEnv)?.label}
                  </div>
                </div>
              </div>
            </div>
          )}
        </aside>
      )}

      {/* Main content */}
      <main className="main-content">
        <div style={{ height: '100%' }}>
          {children}
        </div>
      </main>

      {/* Mobile bottom nav */}
      {isMobile && (
        <nav className="bottom-nav">
          <div className="bottom-nav-items">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) =>
                  `bottom-nav-item ${isActive ? 'active' : ''}`
                }
              >
                <span className="bottom-nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  )
}
