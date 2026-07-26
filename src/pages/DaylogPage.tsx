import { useCallback, useEffect, useState } from 'react'
import type { DaylogEntry, DaylogProfile } from '../lib/daylogTypes'
import { todayStr } from '../lib/daylogStats'
import { getAllEntries, saveEntry } from '../lib/daylogDb'
import { createDefaultProfile, loadProfile, saveProfile } from '../lib/daylogProfile'
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
  const [view, setView] = useState<DaylogView>('today')
  const [entries, setEntries] = useState<DaylogEntry[]>([])
  const [selectedDate, setSelectedDate] = useState(todayStr())
  const [profile, setProfile] = useState<DaylogProfile>(() => loadProfile())
  const [profileEditing, setProfileEditing] = useState(false)

  useEffect(() => {
    getAllEntries()
      .then(setEntries)
      .catch(() => setEntries([]))
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
