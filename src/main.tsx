import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './styles/global.css'

// 版本升级仅清理可重建的页面缓存；登录凭证和设备环境必须跨版本保留。
const APP_VERSION = 'v2.4'
const STORED_VERSION = localStorage.getItem('personal-ops-version')
if (STORED_VERSION !== APP_VERSION) {
  console.log(`[Init] Version changed: ${STORED_VERSION || 'none'} → ${APP_VERSION}, clearing old storage`)
  const keysToClear = [
    'personal-ops-knowledge',
    'personal-ops-ai',
    'personal-ops-tasks',
    'personal-ops-approvals',
    // subscriptions 保留用户编辑的套餐价，不随版本清空
  ]
  keysToClear.forEach(k => localStorage.removeItem(k))
  localStorage.setItem('personal-ops-version', APP_VERSION)
}

// 清除所有旧版 persist 数据（避免结构不兼容导致白屏）
const STORAGE_KEYS_TO_CHECK = [
  'personal-ops-auth',
  'personal-ops-knowledge',
  'personal-ops-ai',
  'personal-ops-tasks',
  'personal-ops-approvals',
]
for (const key of STORAGE_KEYS_TO_CHECK) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) continue
    const parsed = JSON.parse(raw)
    // zustand persist 格式: { state: {...}, version: number }
    // 如果结构不对或 state 里的字段不兼容，直接清除
    if (!parsed || typeof parsed !== 'object' || !('state' in parsed)) {
      localStorage.removeItem(key)
      console.log(`[Init] Cleared invalid storage: ${key}`)
    }
  } catch {
    localStorage.removeItem(key)
    console.log(`[Init] Cleared corrupt storage: ${key}`)
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
)
