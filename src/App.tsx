import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAIAssistantStore, useAuthStore } from './store'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import KnowledgePage from './pages/KnowledgePage'
import AIAssistantPage from './pages/AIAssistantPage'
import SettingsPage from './pages/SettingsPage'

function App() {
  const { user, accessToken, deviceEnv } = useAuthStore()
  const setWorkEnv = useAIAssistantStore((s) => s.setWorkEnv)
  const isLoggedIn =
    Boolean(user && accessToken && user.isWhitelisted && user.sessionExpiresAt > Date.now())

  useEffect(() => {
    if (isLoggedIn) setWorkEnv(deviceEnv)
  }, [deviceEnv, isLoggedIn, setWorkEnv])

  if (!isLoggedIn) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<KnowledgePage />} />
        <Route path="/ai-assistant" element={<AIAssistantPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

export default App
