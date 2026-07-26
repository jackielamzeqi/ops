import { useEffect, useMemo, useState } from 'react'
import type { DaylogEntry, DaylogSummary, ObservationStatus } from '../../lib/daylogTypes'
import { SCORE_DIMENSIONS, eventsArray, strOf } from '../../lib/daylogTypes'
import { dateLabel, todayStr } from '../../lib/daylogStats'
import {
  findObservationByText,
  setObservationStatusByText,
} from '../../lib/daylogObservations'

interface Props {
  date: string
  entry: DaylogEntry | null
  upsertEntry: (e: DaylogEntry) => Promise<void>
  onGoToday: () => void
}

/* 字段配置：key / 标签 / 行数 / 20-40 字提示 */
const TEXT_FIELDS: { key: keyof Pick<DaylogSummary, 'oneLiner' | 'insight' | 'tomorrowAction' | 'quote'>; label: string; rows: number; hint?: string; max?: number }[] = [
  { key: 'oneLiner', label: '今日一句话', rows: 2, hint: '用 20–40 字概括今天最重要的主题', max: 60 },
  { key: 'insight', label: '长期启发', rows: 3, hint: '从今天经历提炼可跨场景复用的认识' },
  { key: 'tomorrowAction', label: '明日最小行动', rows: 2, hint: '一个不超过 15 分钟、可以执行的动作' },
  { key: 'quote', label: '今日金句', rows: 2, hint: '从你的原话中挑一句最有代表性的话（可稍加整理）' },
]

const LAYER_FIELDS: { key: keyof NonNullable<DaylogSummary['layers']>; label: string; hint: string }[] = [
  { key: 'fact', label: '事实', hint: '确定发生的' },
  { key: 'thought', label: '想法/解释', hint: '你以为的' },
  { key: 'emotion', label: '情绪', hint: '当时感受' },
  { key: 'need', label: '真实需要', hint: '你真正想要的' },
]

/** 把 entry.summary 规整为新结构（兼容旧版一次性映射） */
function useNormalized(entry: DaylogEntry | null): DaylogSummary | null {
  return useMemo(() => {
    if (!entry?.summary) return null
    const s = entry.summary
    return {
      oneLiner: s.oneLiner || s.quote || '',
      events: eventsArray(s),
      emotionArc: s.emotionArc ?? (s.emotions ? { start: strOf(s.emotions) } : {}),
      layers: s.layers ?? {},
      observation: s.observation ?? '',
      insight: s.insight || strOf(s.insights) || '',
      tomorrowAction: s.tomorrowAction || strOf(s.actions) || '',
      quote: s.quote ?? '',
    }
  }, [entry])
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

export default function ReviewView({ date, entry, upsertEntry, onGoToday }: Props) {
  const base = useNormalized(entry)
  const [form, setForm] = useState<DaylogSummary | null>(null)
  const [saved, setSaved] = useState(false)
  const [obsStatus, setObsStatus] = useState<ObservationStatus | 'none'>('none')
  const [scoreInaccurate, setScoreInaccurate] = useState<boolean>(Boolean(entry?.scoreFeedback === 'inaccurate'))

  useEffect(() => {
    setForm(base ? { ...base } : null)
    setSaved(false)
    setScoreInaccurate(Boolean(entry?.scoreFeedback === 'inaccurate'))
    // 用观察库的实时状态确定「我对自己的一个观察」当前是待确认/已确认/已拒绝
    if (base?.observation) {
      let cancelled = false
      findObservationByText(base.observation).then((o) => {
        if (cancelled) return
        setObsStatus(o ? o.status : 'none')
      })
      return () => { cancelled = true }
    }
    setObsStatus('none')
  }, [base, entry])

  if (!entry || !entry.summary || !form) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">🌙</div>
        <div>{dateLabel(date)} 这一天还没有复盘记录</div>
        {date === todayStr() && (
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={onGoToday}>
            去「今日」开始复盘
          </button>
        )}
      </div>
    )
  }

  const score = entry.languageScore

  function setField<K extends keyof DaylogSummary>(key: K, value: DaylogSummary[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f))
  }

  async function save() {
    if (!entry || !form) return
    // 保留旧版兼容字段空值，避免时间线/导出解析旧字段时缺失
    const summary: DaylogSummary = { ...form }
    await upsertEntry({ ...entry, summary })
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2000)
  }

  /** 确认 / 拒绝「我对自己的一个观察」（同步观察库 + UI 状态） */
  async function resolveObservation(status: ObservationStatus) {
    if (!form?.observation) return
    const ok = await setObservationStatusByText(form.observation, status)
    if (ok) setObsStatus(status)
  }

  async function toggleScoreInaccurate() {
    if (!entry) return
    const next = !scoreInaccurate
    setScoreInaccurate(next)
    await upsertEntry({ ...entry, scoreFeedback: next ? 'inaccurate' : null })
  }

  function exportMarkdown() {
    const s = form
    if (!s || !entry) return
    const lines: string[] = [`# 每日复盘 · ${entry.date}`, '']
    if (entry!.languageScore) lines.push(`- 语言技术指数：${entry!.languageScore.total}/100（${entry!.source === 'local' ? '本地生成' : 'AI 生成'}）`)
    if (entry!.habit) lines.push(`- 对话：${entry!.habit.answerCount} 条回答 · 约 ${entry!.habit.durationMinutes} 分钟`)
    lines.push('')
    if (s.oneLiner) lines.push('## 今日一句话', '', s.oneLiner, '')
    if (s.events.length) lines.push('## 关键事件', '', ...s.events.map((e) => `- ${e}`), '')
    const arc = s.emotionArc
    if (arc.start || arc.end || arc.reason) {
      lines.push('## 情绪变化', '')
      if (arc.start || arc.end) lines.push(`${arc.start || '？'} → ${arc.end || '？'}`)
      if (arc.reason) lines.push('', `原因：${arc.reason}`)
      lines.push('')
    }
    const L = s.layers
    if (L.fact || L.thought || L.emotion || L.need) {
      lines.push('## 事实 / 想法 / 情绪 / 需要', '')
      if (L.fact) lines.push(`- 事实：${L.fact}`)
      if (L.thought) lines.push(`- 想法：${L.thought}`)
      if (L.emotion) lines.push(`- 情绪：${L.emotion}`)
      if (L.need) lines.push(`- 需要：${L.need}`)
      lines.push('')
    }
    if (s.observation) lines.push('## 我对自己的一个观察（待确认）', '', `可能 ${s.observation}`, '')
    if (s.insight) lines.push('## 长期启发', '', s.insight, '')
    if (s.tomorrowAction) lines.push('## 明日最小行动', '', s.tomorrowAction, '')
    if (s.quote) lines.push('## 今日金句', '', `> ${s.quote}`, '')
    if (entry!.feedback) {
      lines.push('## 语言能力反馈', '')
      for (const t of entry!.feedback.strengths) lines.push(`- 做得好：${t}`)
      for (const t of entry!.feedback.improvements) lines.push(`- 可以试试：${t}`)
      lines.push('')
    }
    download(`daylog-${entry!.date}.md`, lines.join('\n'), 'text/markdown')
  }

  return (
    <div className="fade-in">
      <div className="daylog-review-head">
        <div className="daylog-review-date">{dateLabel(date)}</div>
        <span className={`tag ${entry.source === 'local' ? 'tag-warning' : 'tag-primary'}`}>
          {entry.source === 'local' ? '本地生成' : 'AI 生成'}
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-secondary" onClick={exportMarkdown}>导出 Markdown</button>
      </div>

      {/* ===== 语言能力反馈（说明书 7.5 + AC-06：总分 + 六项 + 证据句 + 建议） ===== */}
      {score && (
        <div className="card">
          <div className="card-title">语言能力反馈</div>
          <div className="daylog-score-total">
            <span className="daylog-score-num">{score.total}</span>
            <span className="daylog-score-max">/ 100</span>
            {score.modelVersion && (
              <span className="daylog-score-ver">模型 {score.modelVersion}</span>
            )}
          </div>
          <div className="model-bars" style={{ minHeight: 0 }}>
            {SCORE_DIMENSIONS.map((d) => {
              const detail = score.details?.[d.key]
              return (
              <div key={d.key} className="model-bar-row">
                <div className="model-bar-label">
                  <span>
                    {d.label}
                    <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 4 }}>
                      {Math.round(d.weight * 100)}%
                    </span>
                  </span>
                </div>
                <div className="model-bar-track">
                  <div
                    className="model-bar-fill"
                    style={{ width: `${score[d.key]}%`, background: 'var(--color-primary)' }}
                  />
                </div>
                <div className="model-bar-value">{score[d.key]}</div>
                {(detail?.evidence || detail?.note) && (
                  <div className="daylog-dim-detail">
                    {detail.evidence && <div className="daylog-dim-evidence">“{detail.evidence}”</div>}
                    {detail.note && <div className="daylog-dim-note">{detail.note}</div>}
                  </div>
                )}
              </div>
              )
            })}
          </div>

          {entry.feedback && (
            <div className="daylog-feedback-block">
              {entry.feedback.strengths.length > 0 && (
                <>
                  <div className="daylog-section-label">做得好的</div>
                  <ul className="daylog-feedback">
                    {entry.feedback.strengths.map((s, i) => (
                      <li key={`s-${i}`}>{s}</li>
                    ))}
                  </ul>
                </>
              )}
              {entry.feedback.improvements.length > 0 && (
                <>
                  <div className="daylog-section-label">可以试试</div>
                  <ul className="daylog-feedback">
                    {entry.feedback.improvements.map((s, i) => (
                      <li key={`i-${i}`}>{s}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          <div className="daylog-score-foot">
            <button
              className={`daylog-toggle-btn ${scoreInaccurate ? 'active' : ''}`}
              onClick={() => void toggleScoreInaccurate()}
            >
              {scoreInaccurate ? '已标记为判断不准确' : 'AI 判断不准确？'}
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title">今日总结（可编辑）</div>

        {TEXT_FIELDS.map((f) => (
          <div key={f.key} className="daylog-field">
            <div className="daylog-field-label">
              {f.label}
              {f.hint && <span className="daylog-field-hint"> · {f.hint}</span>}
            </div>
            <textarea
              className="input"
              rows={f.rows}
              maxLength={f.max}
              value={(form[f.key] as string) ?? ''}
              onChange={(e) => setField(f.key, e.target.value)}
            />
            {f.max && (
              <div className="daylog-field-count">{((form[f.key] as string) || '').length}/{f.max}</div>
            )}
          </div>
        ))}

        {/* 关键事件 1–3 件 */}
        <div className="daylog-field">
          <div className="daylog-field-label">
            关键事件<span className="daylog-field-hint"> · 1–3 件真正影响情绪或判断的事</span>
          </div>
          {form.events.map((ev, i) => (
            <div key={i} className="daylog-event-row">
              <textarea
                className="input"
                rows={2}
                value={ev}
                placeholder={`事件 ${i + 1}`}
                onChange={(e) => {
                  const next = [...form.events]
                  next[i] = e.target.value
                  setField('events', next)
                }}
              />
              <button
                className="daylog-event-remove"
                title="移除"
                onClick={() => setField('events', form.events.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
          {form.events.length < 3 && (
            <button
              className="daylog-event-add"
              onClick={() => setField('events', [...form.events, ''])}
            >
              ＋ 添加一件
            </button>
          )}
        </div>

        {/* 情绪变化 */}
        <div className="daylog-field">
          <div className="daylog-field-label">情绪变化</div>
          <div className="daylog-arc-grid">
            <input
              className="input"
              placeholder="开始时的情绪词与强度"
              value={form.emotionArc.start ?? ''}
              onChange={(e) => setField('emotionArc', { ...form.emotionArc, start: e.target.value })}
            />
            <input
              className="input"
              placeholder="结束时的情绪词与强度"
              value={form.emotionArc.end ?? ''}
              onChange={(e) => setField('emotionArc', { ...form.emotionArc, end: e.target.value })}
            />
            <input
              className="input daylog-arc-full"
              placeholder="变化原因"
              value={form.emotionArc.reason ?? ''}
              onChange={(e) => setField('emotionArc', { ...form.emotionArc, reason: e.target.value })}
            />
          </div>
        </div>

        {/* 事实 / 想法 / 情绪 / 需要 */}
        <div className="daylog-field">
          <div className="daylog-field-label">
            事实 / 想法 / 情绪 / 需要<span className="daylog-field-hint"> · 区分层次，避免把想法当事实</span>
          </div>
          <div className="daylog-layers-grid">
            {LAYER_FIELDS.map((l) => (
              <label key={l.key} className="daylog-layer-item">
                <div className="daylog-layer-head">
                  <span>{l.label}</span>
                  <span className="daylog-layer-hint">{l.hint}</span>
                </div>
                <textarea
                  className="input"
                  rows={2}
                  value={form.layers?.[l.key] ?? ''}
                  onChange={(e) => setField('layers', { ...(form.layers ?? {}), [l.key]: e.target.value })}
                />
              </label>
            ))}
          </div>
        </div>

        {/* 我对自己的一个观察（AI 生成，默认待确认） */}
        {form.observation && (
          <div className={`daylog-obs-card obs-status-${obsStatus}`}>
            <div className="daylog-obs-label">
              我对自己的一个观察
              <span className="daylog-obs-status">
                {obsStatus === 'confirmed' ? '已确认' : obsStatus === 'rejected' ? '已驳回' : '待确认'}
              </span>
            </div>
            <div className="daylog-obs-text">可能 {form.observation}</div>
            {entry.observation && (
              <div className="daylog-obs-meta">
                类型 · {entry.observation.type}　置信度 · {entry.observation.confidence}
              </div>
            )}
            <div className="daylog-obs-actions">
              <button
                className="btn btn-primary btn-sm"
                disabled={obsStatus === 'confirmed'}
                onClick={() => void resolveObservation('confirmed')}
              >
                确认写入画像
              </button>
              <button
                className="btn btn-secondary btn-sm"
                disabled={obsStatus === 'rejected'}
                onClick={() => void resolveObservation('rejected')}
              >
                不准确
              </button>
              {obsStatus !== 'none' && obsStatus !== 'pending' && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => void resolveObservation('pending')}
                >
                  撤销
                </button>
              )}
            </div>
          </div>
        )}

        <div className="daylog-save-row">
          {saved && <span className="daylog-saved-hint">已保存</span>}
          <button className="btn btn-primary" onClick={() => void save()}>
            保存修改
          </button>
        </div>
      </div>
    </div>
  )
}