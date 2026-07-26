import { useMemo, useState } from 'react'
import type { DaylogEntry, LanguageScoreDims } from '../../lib/daylogTypes'
import { SCORE_DIMENSIONS } from '../../lib/daylogTypes'
import {
  computeDailyTextMetrics,
  computeHabitStats,
  computeTopEmotions,
  entryCompleted,
  getMinAnswers,
  lastNDates,
  setMinAnswers as persistMinAnswers,
  todayStr,
} from '../../lib/daylogStats'
import WeeklyReportCard from './WeeklyReportCard'

interface Props {
  entries: DaylogEntry[]
  onSelectDate: (date: string) => void
}

const CHART_W = 400
const CHART_H = 200
const PAD_L = 28
const PAD_R = 8
const PAD_T = 8
const PAD_B = 18

/** 六维趋势线颜色（沿用 metric-card 的 accent 色系） */
const DIM_COLORS: Record<keyof LanguageScoreDims, string> = {
  completeness: '#60a5fa',
  structure: '#34d399',
  evidence: '#fb923c',
  emotionPrecision: '#a78bfa',
  reflection: '#fbbf24',
  conciseness: '#f472b6',
}

interface ChartSeries {
  label: string
  color: string
  /** 与 dates 对齐，null 表示该日无数据（跨缺日连线） */
  data: (number | null)[]
}

/** 通用折线图：0-maxValue 刻度，多系列，可选图例 */
function TrendChart({
  dates,
  days,
  series,
  maxValue = 100,
  unit = '',
  legend = false,
}: {
  dates: string[]
  days: number
  series: ChartSeries[]
  maxValue?: number
  unit?: string
  legend?: boolean
}) {
  const plotW = CHART_W - PAD_L - PAD_R
  const plotH = CHART_H - PAD_T - PAD_B
  const xAt = (i: number) => PAD_L + (dates.length <= 1 ? plotW / 2 : (i / (dates.length - 1)) * plotW)
  const yAt = (v: number) => PAD_T + (1 - v / maxValue) * plotH
  const tickEvery = days <= 7 ? 1 : days <= 30 ? 5 : 15
  const xTicks = dates
    .map((date, i) => ({ x: xAt(i), label: date.slice(5) }))
    .filter((_, i) => i % tickEvery === 0)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((r) => ({
    v: Math.round(maxValue * r),
    y: yAt(maxValue * r),
  }))
  const hasData = series.some((s) => s.data.some((v) => v != null))
  if (!hasData) return null

  return (
    <div>
      <div className="daylog-chart">
        <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="xMidYMid meet">
          {yTicks.map((t) => (
            <g key={`y-${t.v}`}>
              <line
                x1={PAD_L}
                y1={t.y}
                x2={CHART_W - PAD_R}
                y2={t.y}
                stroke="rgba(255,255,255,0.08)"
                strokeWidth="1"
                strokeDasharray="3 4"
              />
              <text
                x={PAD_L - 4}
                y={t.y + 3}
                textAnchor="end"
                fill="rgba(235,235,245,.4)"
                fontSize="8"
                fontFamily="var(--font-sans)"
              >
                {t.v}
              </text>
            </g>
          ))}
          {series.map((s) => {
            const pts = s.data
              .map((v, i) => (v == null ? null : { x: xAt(i), y: yAt(v), v, label: dates[i].slice(5) }))
              .filter((p): p is NonNullable<typeof p> => p !== null)
            if (pts.length === 0) return null
            const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
            return (
              <g key={s.label}>
                <path
                  d={d}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {pts.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={2.6} fill={s.color} stroke="rgba(0,0,0,.35)" strokeWidth="0.8">
                    <title>{`${p.label} ${s.label}：${p.v}${unit}`}</title>
                  </circle>
                ))}
              </g>
            )
          })}
          {xTicks.map((t, i) => (
            <text
              key={`x-${i}`}
              x={t.x}
              y={CHART_H - 4}
              textAnchor="middle"
              fill="rgba(235,235,245,.4)"
              fontSize="8"
              fontFamily="var(--font-sans)"
            >
              {t.label}
            </text>
          ))}
        </svg>
      </div>
      {legend && (
        <div className="daylog-legend">
          {series.map((s) => (
            <span key={s.label} className="daylog-legend-item">
              <span className="daylog-legend-dot" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** 每日记录完成日历：月历视图，完成日期高亮，点击跳回顾 */
function CalendarCard({
  entries,
  minAnswers,
  onSelectDate,
}: {
  entries: DaylogEntry[]
  minAnswers: number
  onSelectDate: (date: string) => void
}) {
  const currentMonth = todayStr().slice(0, 7)
  const [month, setMonth] = useState(currentMonth)

  const doneSet = useMemo(
    () => new Set(entries.filter((e) => entryCompleted(e, minAnswers)).map((e) => e.date)),
    [entries, minAnswers]
  )

  const cells = useMemo(() => {
    const first = new Date(`${month}-01T12:00:00`)
    const leadNulls = (first.getDay() + 6) % 7 // 周一开头
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
    const out: (string | null)[] = Array.from({ length: leadNulls }, () => null)
    for (let d = 1; d <= daysInMonth; d += 1) {
      out.push(`${month}-${String(d).padStart(2, '0')}`)
    }
    return out
  }, [month])

  function shiftMonth(n: number) {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + n, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const today = todayStr()

  return (
    <div className="chart-card" style={{ marginBottom: 16 }}>
      <div className="daylog-cal-head">
        <div className="chart-title">记录日历 · {month.replace('-', ' 年 ')} 月</div>
        <div className="daylog-cal-nav">
          <button onClick={() => shiftMonth(-1)} title="上个月">
            ‹
          </button>
          <button onClick={() => shiftMonth(1)} disabled={month >= currentMonth} title="下个月">
            ›
          </button>
        </div>
      </div>
      <div className="daylog-cal-grid">
        {['一', '二', '三', '四', '五', '六', '日'].map((w) => (
          <div key={w} className="daylog-cal-week">
            {w}
          </div>
        ))}
        {cells.map((date, i) =>
          date === null ? (
            <div key={`empty-${i}`} />
          ) : (
            <div
              key={date}
              className={`daylog-cal-day ${doneSet.has(date) ? 'done' : ''} ${date === today ? 'today' : ''} ${
                date > today ? 'future' : ''
              }`}
              onClick={doneSet.has(date) ? () => onSelectDate(date) : undefined}
              title={doneSet.has(date) ? '点击查看该日回顾' : undefined}
            >
              {Number(date.slice(8))}
            </div>
          )
        )}
      </div>
      <div className="daylog-cal-hint">高亮为已完成日期（≥{minAnswers} 条回答），点击可查看当日回顾</div>
    </div>
  )
}

export default function TrendsView({ entries, onSelectDate }: Props) {
  const [days, setDays] = useState<7 | 30 | 90>(7)
  const [minAnswers, setMinAnswers] = useState(getMinAnswers)

  const dates = useMemo(() => lastNDates(days), [days])
  const scored = useMemo(
    () =>
      entries
        .filter((e) => e.languageScore && e.date >= dates[0])
        .sort((a, b) => a.date.localeCompare(b.date)),
    [entries, dates]
  )
  const stats = useMemo(
    () => computeHabitStats(entries, days, minAnswers),
    [entries, days, minAnswers]
  )
  const textMetrics = useMemo(() => computeDailyTextMetrics(entries, dates), [entries, dates])
  const topEmotions = useMemo(
    () => computeTopEmotions(entries, dates[0]),
    [entries, dates]
  )

  /* 总分系列 */
  const totalSeries = useMemo<ChartSeries[]>(() => {
    const byDate = new Map(scored.map((e) => [e.date, e.languageScore!.total]))
    return [
      { label: '总分', color: 'var(--color-primary)', data: dates.map((d) => byDate.get(d) ?? null) },
    ]
  }, [scored, dates])

  /* 六维系列 */
  const dimSeries = useMemo<ChartSeries[]>(
    () =>
      SCORE_DIMENSIONS.map((dim) => {
        const byDate = new Map(scored.map((e) => [e.date, e.languageScore![dim.key]]))
        return {
          label: dim.label,
          color: DIM_COLORS[dim.key],
          data: dates.map((d) => byDate.get(d) ?? null),
        }
      }),
    [scored, dates]
  )

  /* 文本指标系列（只画有记录的日期） */
  const vagueSeries = useMemo<ChartSeries[]>(
    () => [
      {
        label: '每百字模糊词',
        color: '#fb923c',
        data: textMetrics.map((m) => (m.chars > 0 ? m.vaguePerHundred : null)),
      },
    ],
    [textMetrics]
  )
  const sentenceSeries = useMemo<ChartSeries[]>(
    () => [
      {
        label: '句均字数',
        color: '#60a5fa',
        data: textMetrics.map((m) => (m.chars > 0 ? m.avgSentenceLen : null)),
      },
    ],
    [textMetrics]
  )
  const vocabSeries = useMemo<ChartSeries[]>(
    () => [
      {
        label: '词汇丰富度',
        color: '#34d399',
        data: textMetrics.map((m) => (m.chars > 0 ? m.vocabRichness : null)),
      },
    ],
    [textMetrics]
  )
  const vagueMax = useMemo(
    () => Math.max(2, Math.ceil(Math.max(0, ...textMetrics.map((m) => m.vaguePerHundred)) * 1.2)),
    [textMetrics]
  )
  const sentenceMax = useMemo(
    () => Math.max(10, Math.ceil(Math.max(0, ...textMetrics.map((m) => m.avgSentenceLen)) * 1.2)),
    [textMetrics]
  )

  /* 雷达图：周期内六项维度平均值 */
  const radar = useMemo(() => {
    if (scored.length === 0) return null
    const dims = {} as LanguageScoreDims
    for (const dim of SCORE_DIMENSIONS) {
      dims[dim.key] = Math.round(
        scored.reduce((s, e) => s + (e.languageScore![dim.key] || 0), 0) / scored.length
      )
    }
    const size = 260
    const c = size / 2
    const R = 92
    const angleAt = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / SCORE_DIMENSIONS.length
    const pointAt = (i: number, ratio: number) => ({
      x: c + Math.cos(angleAt(i)) * R * ratio,
      y: c + Math.sin(angleAt(i)) * R * ratio,
    })
    const poly = SCORE_DIMENSIONS.map((dim, i) => {
      const p = pointAt(i, (dims[dim.key] || 0) / 100)
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
    }).join(' ')
    const rings = [0.25, 0.5, 0.75, 1].map((r) =>
      SCORE_DIMENSIONS.map((_, i) => {
        const p = pointAt(i, r)
        return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
      }).join(' ')
    )
    const axes = SCORE_DIMENSIONS.map((dim, i) => {
      const end = pointAt(i, 1)
      const labelP = pointAt(i, 1.22)
      return { dim, end, labelP, value: dims[dim.key] }
    })
    return { size, c, poly, rings, axes }
  }, [scored])

  const habitCards = [
    { label: '连续记录', value: `${stats.streak}`, unit: '天', accent: 'accent-green' },
    { label: '最长连续纪录', value: `${stats.longestStreak}`, unit: '天', accent: 'accent-gold' },
    { label: '本月完成率', value: `${stats.monthRate}`, unit: '%', accent: 'accent-blue' },
    { label: '平均对话时长', value: `${stats.avgDuration}`, unit: '分钟', accent: 'accent-purple' },
    { label: '平均有效回答', value: `${stats.avgAnswers}`, unit: '条', accent: 'accent-orange' },
    { label: '语音输入占比', value: `${stats.voiceRatio}`, unit: '%', accent: 'accent-pink' },
    {
      label: '最常记录时间',
      value: stats.mostActivePeriod ? stats.mostActivePeriod.label.replace(' 点', '') : '—',
      unit: stats.mostActivePeriod ? '点' : '',
      accent: 'accent-blue',
    },
  ]

  const maxEmotion = topEmotions.length ? topEmotions[0].count : 1

  return (
    <div>
      <WeeklyReportCard entries={entries} />

      <div className="filter-group" style={{ width: 'fit-content', marginBottom: 16 }}>
        {([7, 30, 90] as const).map((d) => (
          <button
            key={d}
            className={`filter-btn ${days === d ? 'active' : ''}`}
            onClick={() => setDays(d)}
          >
            {d} 天
          </button>
        ))}
      </div>

      <div className="chart-card" style={{ marginBottom: 16 }}>
        <div className="chart-header">
          <div className="chart-title">语言技术指数</div>
        </div>
        {totalSeries[0].data.some((v) => v != null) ? (
          <TrendChart dates={dates} days={days} series={totalSeries} maxValue={100} unit=" 分" />
        ) : (
          <div className="chart-empty">最近 {days} 天还没有评分记录</div>
        )}
      </div>

      <div className="chart-card" style={{ marginBottom: 16 }}>
        <div className="chart-header">
          <div className="chart-title">六项能力趋势</div>
        </div>
        {dimSeries.some((s) => s.data.some((v) => v != null)) ? (
          <TrendChart dates={dates} days={days} series={dimSeries} maxValue={100} legend />
        ) : (
          <div className="chart-empty">完成一次复盘后，这里会显示六项能力的变化</div>
        )}
      </div>

      <CalendarCard entries={entries} minAnswers={minAnswers} onSelectDate={onSelectDate} />

      <div className="chart-card" style={{ marginBottom: 16 }}>
        <div className="chart-header">
          <div className="chart-title">六项能力（周期内平均）</div>
        </div>
        {radar ? (
          <div className="daylog-radar-wrap">
            <svg width={radar.size} height={radar.size} viewBox={`0 0 ${radar.size} ${radar.size}`}>
              {radar.rings.map((r, i) => (
                <polygon key={`ring-${i}`} points={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
              ))}
              {radar.axes.map((a) => (
                <g key={a.dim.key}>
                  <line
                    x1={radar.c}
                    y1={radar.c}
                    x2={a.end.x}
                    y2={a.end.y}
                    stroke="rgba(255,255,255,0.08)"
                    strokeWidth="1"
                  />
                  <text
                    x={a.labelP.x}
                    y={a.labelP.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="rgba(235,235,245,.55)"
                    fontSize="10"
                    fontFamily="var(--font-sans)"
                  >
                    {a.dim.label} {a.value}
                  </text>
                </g>
              ))}
              <polygon
                points={radar.poly}
                fill="rgba(10, 132, 255, 0.22)"
                stroke="var(--color-primary)"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        ) : (
          <div className="chart-empty">完成一次复盘后，这里会显示能力雷达图</div>
        )}
      </div>

      <div className="chart-card" style={{ marginBottom: 16 }}>
        <div className="chart-header">
          <div className="chart-title">模糊词趋势（每百字频次）</div>
        </div>
        {vagueSeries[0].data.some((v) => v != null) ? (
          <TrendChart dates={dates} days={days} series={vagueSeries} maxValue={vagueMax} unit=" 次/百字" />
        ) : (
          <div className="chart-empty">最近 {days} 天还没有对话记录</div>
        )}
      </div>

      <div className="chart-card" style={{ marginBottom: 16 }}>
        <div className="chart-header">
          <div className="chart-title">高频情绪词（近 {days} 天）</div>
        </div>
        {topEmotions.length > 0 ? (
          <div>
            {topEmotions.map((e) => (
              <div key={e.word} className="daylog-emo-row">
                <div className="daylog-emo-word">{e.word}</div>
                <div className="daylog-emo-track">
                  <div className="daylog-emo-fill" style={{ width: `${(e.count / maxEmotion) * 100}%` }} />
                </div>
                <div className="daylog-emo-count">{e.count} 次</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="chart-empty">这段时间的记录里没有出现常见情绪词</div>
        )}
      </div>

      <div className="chart-card" style={{ marginBottom: 16 }}>
        <div className="chart-header">
          <div className="chart-title">句子平均长度</div>
        </div>
        {sentenceSeries[0].data.some((v) => v != null) ? (
          <TrendChart dates={dates} days={days} series={sentenceSeries} maxValue={sentenceMax} unit=" 字" />
        ) : (
          <div className="chart-empty">最近 {days} 天还没有对话记录</div>
        )}
      </div>

      <div className="chart-card" style={{ marginBottom: 16 }}>
        <div className="chart-header">
          <div className="chart-title">词汇丰富度（unique 字 / 总字数）</div>
        </div>
        {vocabSeries[0].data.some((v) => v != null) ? (
          <TrendChart dates={dates} days={days} series={vocabSeries} maxValue={100} unit="%" />
        ) : (
          <div className="chart-empty">最近 {days} 天还没有对话记录</div>
        )}
      </div>

      <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        {habitCards.map((c) => (
          <div key={c.label} className={`metric-card ${c.accent}`}>
            <div className="metric-card-top">
              <div>
                <div className="metric-label">{c.label}</div>
                <span className="metric-value">{c.value}</span>
                {c.unit && <span className="metric-unit"> {c.unit}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="chart-card" style={{ marginBottom: 16 }}>
        <div className="daylog-min-row">
          <div>
            <div className="chart-title">完成标准</div>
            <div className="daylog-min-hint">每日有效回答达到该数量即计为完成（影响连续天数、完成率与日历高亮）</div>
          </div>
          <div className="daylog-stepper">
            <button
              onClick={() => setMinAnswers((v) => persistMinAnswers(v - 1))}
              disabled={minAnswers <= 1}
              title="减少"
            >
              −
            </button>
            <span className="daylog-stepper-val">{minAnswers}</span>
            <button
              onClick={() => setMinAnswers((v) => persistMinAnswers(v + 1))}
              disabled={minAnswers >= 5}
              title="增加"
            >
              ＋
            </button>
            <span className="daylog-min-unit">条</span>
          </div>
        </div>
      </div>
    </div>
  )
}
