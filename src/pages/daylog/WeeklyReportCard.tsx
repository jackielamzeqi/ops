import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DaylogEntry, DaylogWeeklyReport } from '../../lib/daylogTypes'
import { entryCompleted, todayStr, weekStartOf } from '../../lib/daylogStats'
import { getWeeklyReport, saveWeeklyReport } from '../../lib/daylogDb'
import { generateWeeklyReport } from '../../lib/daylogAi'

interface Props {
  entries: DaylogEntry[]
}

const FIELD_LABELS: { key: keyof Omit<DaylogWeeklyReport, 'weekStart' | 'source' | 'createdAt'>; label: string }[] = [
  { key: 'events', label: '本周经历了什么' },
  { key: 'recurringEmotions', label: '反复出现的情绪' },
  { key: 'recurringIssues', label: '反复出现的问题' },
  { key: 'improvements', label: '表达能力提升点' },
  { key: 'regressions', label: '表达能力退步点' },
  { key: 'nextWeekFocus', label: '下周重点训练目标' },
]

export default function WeeklyReportCard({ entries }: Props) {
  const weekStart = useMemo(() => weekStartOf(todayStr()), [])
  const weekEntries = useMemo(
    () => entries.filter((e) => e.date >= weekStart && e.messages.length > 0),
    [entries, weekStart]
  )
  const completedDays = useMemo(
    () => weekEntries.filter((e) => entryCompleted(e)).length,
    [weekEntries]
  )

  const [report, setReport] = useState<DaylogWeeklyReport | null>(null)
  const [loading, setLoading] = useState(false)
  const triedRef = useRef(false)

  const generate = useCallback(async () => {
    setLoading(true)
    try {
      const res = await generateWeeklyReport(weekEntries)
      const r: DaylogWeeklyReport = { weekStart, ...res, createdAt: Date.now() }
      await saveWeeklyReport(r)
      setReport(r)
    } finally {
      setLoading(false)
    }
  }, [weekEntries, weekStart])

  /* 进入趋势页：先读已持久化的周报；没有且本周有完成记录则自动生成一次 */
  useEffect(() => {
    if (triedRef.current) return
    triedRef.current = true
    let cancelled = false
    getWeeklyReport(weekStart)
      .then(async (r) => {
        if (cancelled) return
        if (r) {
          setReport(r)
          return
        }
        if (completedDays >= 1) await generate()
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [weekStart, completedDays, generate])

  if (!report && !loading) return null

  return (
    <div className="chart-card" style={{ marginBottom: 16 }}>
      <div className="chart-header">
        <div className="chart-title">本周周报（{weekStart.slice(5)} 起）</div>
      </div>
      {loading && !report ? (
        <div className="daylog-weekly-loading">正在生成本周周报…</div>
      ) : report ? (
        <>
          {FIELD_LABELS.map((f) => (
            <div key={f.key} className="daylog-weekly-row">
              <div className="daylog-weekly-label">{f.label}</div>
              <div className="daylog-weekly-text">{report[f.key] || '（无）'}</div>
            </div>
          ))}
          <div className="daylog-weekly-foot">
            <span className="daylog-source-hint">
              {report.source === 'ai' ? 'AI 生成' : '本地生成（AI 不可用时的降级模板）'}
            </span>
            <button className="btn btn-secondary" onClick={() => void generate()} disabled={loading}>
              {loading ? '重新生成中…' : '重新生成'}
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}
