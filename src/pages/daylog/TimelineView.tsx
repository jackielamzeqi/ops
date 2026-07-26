import { useEffect, useMemo, useState } from 'react'
import type { DaylogEntry, ObservationStatus, ObservationType, ProfileObservation } from '../../lib/daylogTypes'
import { OBSERVATION_TYPES, eventsArray, strOf } from '../../lib/daylogTypes'
import { dateLabel } from '../../lib/daylogStats'
import {
  editObservationText,
  setObservationStatusByText,
  setObservationType,
} from '../../lib/daylogObservations'
import { deleteObservation, getAllObservations } from '../../lib/daylogDb'

interface Props {
  entries: DaylogEntry[]
  onSelect: (date: string) => void
  /** 仅当 memoryLevel 变化时刷新观察（暂停记忆提示用） */
  memoryPaused: boolean
  onToggleMemory: () => void
}

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function entryToMarkdown(e: DaylogEntry): string {
  const s = e.summary
  const lines: string[] = [`# 每日复盘 · ${e.date}`, '']
  if (e.languageScore) {
    lines.push(
      `- 语言技术指数：${e.languageScore.total}/100（${e.source === 'local' ? '本地生成' : 'AI 生成'}）`
    )
  }
  if (e.habit) {
    lines.push(`- 对话：${e.habit.answerCount} 条回答 · 约 ${e.habit.durationMinutes} 分钟`)
  }
  lines.push('')
  if (s) {
    const events = eventsArray(s)
    if (s.oneLiner || s.quote) lines.push('## 今日一句话', '', (s.oneLiner || s.quote), '')
    if (events.length) lines.push('## 关键事件', '', ...events.map((ev) => `- ${ev}`), '')
    const arc = s.emotionArc ?? (s.emotions ? { start: strOf(s.emotions) } : {})
    if (arc.start || arc.end || arc.reason) {
      lines.push('## 情绪变化', '')
      if (arc.start || arc.end) lines.push(`${arc.start || '？'} → ${arc.end || '？'}`)
      if (arc.reason) lines.push('', `原因：${arc.reason}`)
      lines.push('')
    }
    const L = s.layers ?? {}
    if (L.fact || L.thought || L.emotion || L.need) {
      lines.push('## 事实 / 想法 / 情绪 / 需要', '')
      if (L.fact) lines.push(`- 事实：${L.fact}`)
      if (L.thought) lines.push(`- 想法：${L.thought}`)
      if (L.emotion) lines.push(`- 情绪：${L.emotion}`)
      if (L.need) lines.push(`- 需要：${L.need}`)
      lines.push('')
    }
    if (s.observation) lines.push('## 我对自己的一个观察（待确认）', '', `可能 ${s.observation}`, '')
    const insightTxt = s.insight || strOf(s.insights)
    if (insightTxt) lines.push('## 长期启发', '', insightTxt, '')
    const actionTxt = s.tomorrowAction || strOf(s.actions)
    if (actionTxt) lines.push('## 明日最小行动', '', actionTxt, '')
  }
  if (e.feedback) {
    lines.push('## 评分依据', '')
    for (const t of e.feedback.strengths) lines.push(`- 优点：${t}`)
    for (const t of e.feedback.improvements) lines.push(`- 改进：${t}`)
    lines.push('')
  }
  return lines.join('\n')
}

const STATUS_LABEL: Record<ObservationStatus, string> = {
  pending: '待确认',
  confirmed: '已确认',
  rejected: '已驳回',
}

/** 我的观察与长期画像（说明书 7.6 + 13 节） */
function ObservationsCard({
  observations,
  onChanged,
  memoryPaused,
  onToggleMemory,
}: {
  observations: ProfileObservation[]
  onChanged: () => void
  memoryPaused: boolean
  onToggleMemory: () => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftText, setDraftText] = useState('')

  const pending = observations.filter((o) => o.status === 'pending')
  const confirmed = observations.filter((o) => o.status === 'confirmed')
  const rejected = observations.filter((o) => o.status === 'rejected')

  async function setStatus(o: ProfileObservation, status: ObservationStatus) {
    await setObservationStatusByText(o.text, status)
    onChanged()
  }
  async function remove(o: ProfileObservation) {
    await deleteObservation(o.id)
    onChanged()
  }
  async function saveEdit(o: ProfileObservation) {
    await editObservationText(o.id, draftText.trim() || o.text)
    setEditingId(null)
    onChanged()
  }
  async function changeType(o: ProfileObservation, type: ObservationType) {
    await setObservationType(o.id, type)
    onChanged()
  }

  function renderObs(o: ProfileObservation) {
    const isEditing = editingId === o.id
    return (
      <div key={o.id} className={`daylog-pobs-item obs-status-${o.status}`}>
        {isEditing ? (
          <>
            <textarea
              className="input"
              rows={2}
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
            />
            <div className="daylog-pobs-row">
              <button className="btn btn-primary btn-sm" onClick={() => void saveEdit(o)}>保存</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>取消</button>
            </div>
          </>
        ) : (
          <>
            <div className="daylog-pobs-text">可能 {o.text}</div>
            <div className="daylog-pobs-meta">
              <span className={`daylog-pobs-status s-${o.status}`}>{STATUS_LABEL[o.status]}</span>
              <select
                className="daylog-pobs-type"
                value={o.type}
                onChange={(e) => void changeType(o, e.target.value as ObservationType)}
                title="观察类型"
              >
                {OBSERVATION_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <span className="daylog-pobs-source">
                出现 {o.occurrences} 次 · 来源 {o.evidenceDates.length} 天
              </span>
              <span className="daylog-pobs-conf">置信度 {o.confidence}</span>
            </div>
          </>
        )}
        <div className="daylog-pobs-dates">
          {o.evidenceDates.map((d) => (
            <span key={d} className="daylog-pobs-date" title={d}>{d.slice(5)}</span>
          ))}
        </div>
        <div className="daylog-pobs-actions">
          {o.status !== 'confirmed' && (
            <button className="btn btn-primary btn-sm" onClick={() => void setStatus(o, 'confirmed')}>确认</button>
          )}
          {o.status !== 'rejected' && (
            <button className="btn btn-secondary btn-sm" onClick={() => void setStatus(o, 'rejected')}>不准确</button>
          )}
          {o.status !== 'pending' && (
            <button className="btn btn-ghost btn-sm" onClick={() => void setStatus(o, 'pending')}>改回待确认</button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => { setEditingId(o.id); setDraftText(o.text) }}>修改</button>
          <button className="btn btn-ghost btn-sm danger" onClick={() => void remove(o)}>删除</button>
        </div>
      </div>
    )
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="daylog-pobs-head">
        <div className="card-title">我的观察与长期画像</div>
        <button
          className={`daylog-mem-btn ${memoryPaused ? 'paused' : 'active'}`}
          onClick={onToggleMemory}
          title="切换记忆方式（仅本次 / 保存已确认画像）"
        >
          {memoryPaused ? '记忆已暂停（仅本次）' : '长期记忆：保存已确认画像'}
        </button>
      </div>
      {memoryPaused && (
        <div className="daylog-pobs-mem-hint">
          已暂停长期记忆：新的 AI 观察仍会生成，但只在本次会话内可见，不会被写入长期画像。
        </div>
      )}

      {observations.length === 0 && (
        <div className="daylog-pobs-empty">
          完成一次复盘后，AI 生成的「我对自己的一个观察」会出现在这里，默认为待确认；确认后才会进入长期画像。
        </div>
      )}

      {pending.length > 0 && (
        <>
          <div className="daylog-pobs-section-label">待确认（{pending.length}）</div>
          {pending.map(renderObs)}
        </>
      )}
      {confirmed.length > 0 && (
        <>
          <div className="daylog-pobs-section-label">已确认画像（{confirmed.length}）</div>
          {confirmed.map(renderObs)}
        </>
      )}
      {rejected.length > 0 && (
        <details className="daylog-pobs-rejected">
          <summary>已驳回（{rejected.length}）</summary>
          {rejected.map(renderObs)}
        </details>
      )}
    </div>
  )
}

export default function TimelineView({ entries, onSelect, memoryPaused, onToggleMemory }: Props) {
  const [query, setQuery] = useState('')
  const [observations, setObservations] = useState<ProfileObservation[]>([])

  const loadObs = useMemo(
    () => () => {
      getAllObservations()
        .then(setObservations)
        .catch(() => setObservations([]))
    },
    []
  )
  useEffect(() => { loadObs() }, [loadObs])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries
      .filter((e) => e.summary)
      .filter((e) => {
        if (!q) return true
        const s = e.summary!
        const events = eventsArray(s).join(' ')
        const haystack = [
          e.date, s.oneLiner, events, s.emotionArc?.start, s.emotionArc?.end, s.emotionArc?.reason,
          s.layers?.fact, s.layers?.thought, s.layers?.emotion, s.layers?.need,
          s.observation, s.insight, strOf(s.insights), s.tomorrowAction, strOf(s.actions), s.quote,
        ].filter(Boolean).join('\n').toLowerCase()
        return haystack.includes(q)
      })
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [entries, query])

  const groups = useMemo(() => {
    const map = new Map<string, DaylogEntry[]>()
    for (const e of filtered) {
      const month = e.date.slice(0, 7)
      const list = map.get(month)
      if (list) list.push(e)
      else map.set(month, [e])
    }
    return [...map.entries()]
  }, [filtered])

  function exportAll() {
    download(
      `daylog-export-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(entries, null, 2),
      'application/json'
    )
  }

  return (
    <div>
      <ObservationsCard
        observations={observations}
        onChanged={loadObs}
        memoryPaused={memoryPaused}
        onToggleMemory={onToggleMemory}
      />

      <div className="daylog-toolbar">
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索总结、事件、情绪、观察…"
        />
        <button className="btn btn-secondary" onClick={exportAll} disabled={entries.length === 0}>
          导出全部 JSON
        </button>
      </div>

      {groups.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">🗓</div>
          <div>{query ? '没有匹配的记录' : '还没有历史记录'}</div>
        </div>
      )}

      {groups.map(([month, list]) => (
        <div key={month}>
          <div className="daylog-tl-month">{month.replace('-', ' 年 ')} 月</div>
          {list.map((e) => (
            <div key={e.date} className="daylog-tl-item" onClick={() => onSelect(e.date)}>
              <div className="daylog-tl-date">{dateLabel(e.date)}</div>
              {e.languageScore && (
                <span className="tag tag-primary">{e.languageScore.total} 分</span>
              )}
              <div className="daylog-tl-quote">{e.summary?.oneLiner || e.summary?.quote || eventsArray(e.summary)[0] || ''}</div>
              <button
                className="daylog-tl-export"
                title="导出 Markdown"
                onClick={(ev) => {
                  ev.stopPropagation()
                  download(`daylog-${e.date}.md`, entryToMarkdown(e), 'text/markdown')
                }}
              >
                导出
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}