import { useCallback, useEffect, useRef, useState } from 'react'
import type { DaylogEntry, DaylogProfile } from '../lib/daylogTypes'
import { todayStr } from '../lib/daylogStats'
import { getAllEntries, saveEntry } from '../lib/daylogDb'
import { createDefaultProfile, loadProfile, saveProfile } from '../lib/daylogProfile'
import { syncDaylogCloudData } from '../lib/daylogCloudDb'
import { useAuthStore } from '../store'
import TodayView from './daylog/TodayView'
import ReviewView from './daylog/ReviewView'
import TrendsView from './daylog/TrendsView'
import TimelineView from './daylog/TimelineView'
import OnboardingView from './daylog/OnboardingView'

type DaylogView = 'today' | 'review' | 'trends' | 'timeline'

const VIEWS: { id: DaylogView; label: string }[] = [
  { id: 'today', label: '今日' },
  { id: 'review', label: '回顾' },
  { id: 'trends', label: '趋势' },
  { id: 'timeline', label: '时间线' },
]

export default function DaylogPage() {
  const { accessToken, user } = useAuthStore()
  const [view, setView] = useState<DaylogView>('today')
  const [navVisible, setNavVisible] = useState(true)
  const [entries, setEntries] = useState<DaylogEntry[]>([])
  const [selectedDate, setSelectedDate] = useState(todayStr())
  const [profile, setProfile] = useState<DaylogProfile>(() => loadProfile())
  const [profileEditing, setProfileEditing] = useState(false)
  const scrollStopTimer = useRef<number | null>(null)
  const lastScrollTop = useRef(0)
  const cloudSyncTimer = useRef<number | null>(null)
  const cloudSyncing = useRef(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        if (accessToken && user?.username) {
          cloudSyncing.current = true
          const merged = await syncDaylogCloudData(accessToken, user.username)
          if (!cancelled) {
            setEntries(merged.entries.sort((a, b) => a.date.localeCompare(b.date)))
            setProfile(merged.profile.value)
          }
        } else {
          const local = await getAllEntries()
          if (!cancelled) setEntries(local)
        }
      } catch {
        const local = await getAllEntries().catch(() => [])
        if (!cancelled) setEntries(local)
      } finally {
        cloudSyncing.current = false
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [accessToken, user?.username])

  useEffect(() => {
    if (!accessToken || !user?.username) return
    const sync = () => {
      if (cloudSyncing.current) return
      if (cloudSyncTimer.current !== null) window.clearTimeout(cloudSyncTimer.current)
      cloudSyncTimer.current = window.setTimeout(async () => {
        cloudSyncing.current = true
        try {
          await syncDaylogCloudData(accessToken, user.username)
        } catch {
          // 离线时保留本地缓存；下次进入页面自动重试合并。
        } finally {
          cloudSyncing.current = false
        }
      }, 1500)
    }
    window.addEventListener('daylog-data-changed', sync)
    return () => {
      window.removeEventListener('daylog-data-changed', sync)
      if (cloudSyncTimer.current !== null) window.clearTimeout(cloudSyncTimer.current)
    }
  }, [accessToken, user?.username])

  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>('.main-content')
    if (!scroller) return

    lastScrollTop.current = scroller.scrollTop
    const handleScroll = () => {
      const current = scroller.scrollTop
      const delta = current - lastScrollTop.current

      if (current <= 12 || delta < -3) setNavVisible(true)
      else if (delta > 3) setNavVisible(false)

      lastScrollTop.current = current
      if (scrollStopTimer.current !== null) window.clearTimeout(scrollStopTimer.current)
      scrollStopTimer.current = window.setTimeout(() => setNavVisible(true), 180)
    }

    scroller.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', handleScroll)
      if (scrollStopTimer.current !== null) window.clearTimeout(scrollStopTimer.current)
    }
  }, [])

  /** 实时持久化：写 IndexedDB 并同步内存状态 */
  const upsertEntry = useCallback(async (entry: DaylogEntry) => {
    const next = { ...entry, updatedAt: Date.now() }
    await saveEntry(next)
    setEntries((prev) => {
      const idx = prev.findIndex((e) => e.date === next.date)
      if (idx >= 0) {
        const copy = [...prev]
        copy[idx] = next
        return copy
      }
      return [...prev, next].sort((a, b) => a.date.localeCompare(b.date))
    })
  }, [])

  const selectedEntry = entries.find((e) => e.date === selectedDate) ?? null
  const showOnboarding = !profile.onboarded || profileEditing

  function handleProfileDone(p: DaylogProfile) {
    saveProfile(p)
    setProfile(p)
    setProfileEditing(false)
  }

  function handleSkipAll() {
    handleProfileDone({ ...createDefaultProfile(), onboarded: true })
  }

  return (
    <div className="daylog-page fade-in">
      <div className={`daylog-seg-wrap ${navVisible ? 'is-visible' : 'is-hidden'}`}>
        <div className="daylog-seg">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={`daylog-seg-btn ${view === v.id ? 'active' : ''}`}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {view === 'today' && (
        <TodayView
          entries={entries}
          upsertEntry={upsertEntry}
          profile={profile}
          onShowReview={() => {
            setSelectedDate(todayStr())
            setView('review')
          }}
          onEditProfile={() => setProfileEditing(true)}
          onShowTimeline={() => setView('timeline')}
        />
      )}
      {view === 'review' && (
        <ReviewView
          date={selectedDate}
          entry={selectedEntry}
          upsertEntry={upsertEntry}
          onGoToday={() => setView('today')}
        />
      )}
      {view === 'trends' && (
        <TrendsView
          entries={entries}
          onSelectDate={(date) => {
            setSelectedDate(date)
            setView('review')
          }}
        />
      )}
      {view === 'timeline' && (
        <TimelineView
          entries={entries}
          onSelect={(date) => {
            setSelectedDate(date)
            setView('review')
          }}
          memoryPaused={profile.memoryLevel === 'session'}
          onToggleMemory={() => {
            const next = profile.memoryLevel === 'session'
              ? { ...profile, memoryLevel: 'profile' as const }
              : { ...profile, memoryLevel: 'session' as const }
            saveProfile(next)
            setProfile(next)
          }}
        />
      )}

      {/* ONB-01~06：首次设置全屏引导；个人设置复用同组件 */}
      {showOnboarding && (
        <OnboardingView
          initial={profile}
          editing={profileEditing}
          onDone={handleProfileDone}
          onSkipAll={handleSkipAll}
          onClose={() => setProfileEditing(false)}
        />
      )}
    </div>
  )
}
