import type { DaylogEntry, DaylogHabit, DaylogMessage } from './daylogTypes'

/** 本地时区 YYYY-MM-DD */
export function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayStr(): string {
  return formatDate(new Date())
}

/** 最近 n 天日期（含今天，升序） */
export function lastNDates(n: number): string[] {
  const out: string[] = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i -= 1) {
    out.push(formatDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)))
  }
  return out
}

const WEEKDAYS = '日一二三四五六'

/** 如「7月25日 周五」 */
export function dateLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`)
  if (Number.isNaN(d.getTime())) return dateStr
  return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEKDAYS[d.getDay()]}`
}

/** 按时段问候：凌晨/上午/下午/晚上 */
export function greetingByHour(hour = new Date().getHours()): string {
  if (hour < 5) return '夜深了'
  if (hour < 12) return '上午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

/* ===== 最低完成标准（localStorage，1~5 条，默认 3） ===== */

const MIN_ANSWERS_KEY = 'daylog-min-answers'
export const DEFAULT_MIN_ANSWERS = 3

export function getMinAnswers(): number {
  try {
    const n = Number(localStorage.getItem(MIN_ANSWERS_KEY))
    if (Number.isFinite(n) && n >= 1 && n <= 5) return Math.round(n)
  } catch {
    /* localStorage 不可用时用默认值 */
  }
  return DEFAULT_MIN_ANSWERS
}

export function setMinAnswers(n: number): number {
  const v = Math.max(1, Math.min(5, Math.round(n)))
  try {
    localStorage.setItem(MIN_ANSWERS_KEY, String(v))
  } catch {
    /* ignore */
  }
  return v
}

/** 动态完成判定：用户消息数 ≥ 最低完成标准（不依赖写入时的 completed 标志，改设置后历史判定随之更新） */
export function entryCompleted(e: DaylogEntry, min: number = getMinAnswers()): boolean {
  return e.messages.filter((m) => m.role === 'user').length >= min
}

/** 连续记录天数：今天已完成则从今天算起，否则从昨天算起，向前逐日连续 */
export function computeStreak(entries: DaylogEntry[], min: number = getMinAnswers()): number {
  const done = new Set(entries.filter((e) => entryCompleted(e, min)).map((e) => e.date))
  const today = todayStr()
  const start = new Date()
  if (!done.has(today)) start.setDate(start.getDate() - 1)
  let streak = 0
  for (let i = 0; i < 3650; i += 1) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() - i)
    if (done.has(formatDate(d))) streak += 1
    else break
  }
  return streak
}

/** 从对话消息推导习惯数据（时长/有效回答数/输入方式） */
export function computeHabitFromMessages(messages: DaylogMessage[]): DaylogHabit | null {
  const userMsgs = messages.filter((m) => m.role === 'user')
  if (messages.length === 0 || userMsgs.length === 0) return null
  const first = messages[0].ts
  const last = messages[messages.length - 1].ts
  const durationMinutes = Math.max(1, Math.round((last - first) / 60000))
  const voiceCount = userMsgs.filter((m) => m.inputMode === 'voice').length
  const inputMode: DaylogHabit['inputMode'] =
    voiceCount === 0 ? 'text' : voiceCount === userMsgs.length ? 'voice' : 'mixed'
  return { durationMinutes, answerCount: userMsgs.length, inputMode }
}

export interface DaylogHabitStats {
  streak: number
  /** 历史最长连续完成天数（与当前连续分开展示） */
  longestStreak: number
  monthRate: number
  avgDuration: number
  avgAnswers: number
  voiceRatio: number
  /** 最常记录时段（按每天首条用户消息的小时分桶），无数据时为 null */
  mostActivePeriod: { label: string; count: number } | null
}

/** 历史最长连续完成天数 */
export function computeLongestStreak(entries: DaylogEntry[], min: number = getMinAnswers()): number {
  const dates = entries
    .filter((e) => entryCompleted(e, min))
    .map((e) => e.date)
    .sort()
  let best = 0
  let cur = 0
  for (let i = 0; i < dates.length; i += 1) {
    if (i > 0) {
      const prev = new Date(`${dates[i - 1]}T12:00:00`).getTime()
      const now = new Date(`${dates[i]}T12:00:00`).getTime()
      cur = now - prev === 86_400_000 ? cur + 1 : 1
    } else {
      cur = 1
    }
    if (cur > best) best = cur
  }
  return best
}

/** 时段分桶：按首条用户消息的小时 */
const ACTIVE_PERIODS: [number, number, string][] = [
  [0, 6, '0-6 点'],
  [6, 9, '6-9 点'],
  [9, 12, '9-12 点'],
  [12, 15, '12-15 点'],
  [15, 18, '15-18 点'],
  [18, 21, '18-21 点'],
  [21, 24, '21-24 点'],
]

export function computeMostActivePeriod(
  entries: DaylogEntry[]
): { label: string; count: number } | null {
  const counts = new Map<string, number>()
  for (const e of entries) {
    const first = e.messages.find((m) => m.role === 'user')
    if (!first) continue
    const h = new Date(first.ts).getHours()
    const period = ACTIVE_PERIODS.find(([a, b]) => h >= a && h < b)
    if (!period) continue
    counts.set(period[2], (counts.get(period[2]) || 0) + 1)
  }
  let best: { label: string; count: number } | null = null
  for (const [label, count] of counts) {
    if (!best || count > best.count) best = { label, count }
  }
  return best
}

/** 趋势页习惯指标：连续天数、本月完成率、平均对话时长、平均有效回答次数、语音输入占比 */
export function computeHabitStats(
  entries: DaylogEntry[],
  days: number,
  min: number = getMinAnswers()
): DaylogHabitStats {
  const cutoff = lastNDates(days)[0]
  const period = entries.filter((e) => e.date >= cutoff)

  const now = new Date()
  const monthPrefix = formatDate(now).slice(0, 7)
  const elapsedDays = now.getDate()
  const monthDone = entries.filter(
    (e) => e.date.startsWith(monthPrefix) && entryCompleted(e, min)
  ).length

  const habits = period.map((e) => e.habit).filter((h): h is DaylogHabit => Boolean(h))
  const avgDuration = habits.length
    ? Math.round(habits.reduce((s, h) => s + h.durationMinutes, 0) / habits.length)
    : 0
  const avgAnswers = habits.length
    ? Math.round((habits.reduce((s, h) => s + h.answerCount, 0) / habits.length) * 10) / 10
    : 0

  const userMsgs = period.flatMap((e) => e.messages).filter((m) => m.role === 'user')
  const voiceCount = userMsgs.filter((m) => m.inputMode === 'voice').length
  const voiceRatio = userMsgs.length ? Math.round((voiceCount / userMsgs.length) * 100) : 0

  return {
    streak: computeStreak(entries, min),
    longestStreak: computeLongestStreak(entries, min),
    monthRate: elapsedDays ? Math.round((monthDone / elapsedDays) * 100) : 0,
    avgDuration,
    avgAnswers,
    voiceRatio,
    mostActivePeriod: computeMostActivePeriod(period),
  }
}

/* ===== 周辅助 ===== */

/** 所在周的周一日期（YYYY-MM-DD） */
export function weekStartOf(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`)
  const dow = (d.getDay() + 6) % 7 // 周一 = 0
  d.setDate(d.getDate() - dow)
  return formatDate(d)
}

/** 日期加减 n 天 */
export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00`)
  d.setDate(d.getDate() + n)
  return formatDate(d)
}

/* ===== 文本指标（全部本地计算，不依赖 AI） ===== */

export const VAGUE_WORDS = ['挺好', '很烦', '那个', '有点', '还行', '东西', '感觉', '随便', '反正', '差不多']
export const EMOTION_WORDS = ['开心', '高兴', '焦虑', '累', '烦', '平静', '兴奋', '难过', '期待', '压力', '放松', '沮丧', '满足']

function userTextOf(e: DaylogEntry): string {
  return e.messages
    .filter((m) => m.role === 'user')
    .map((m) => m.text)
    .join('\n')
}

function countWord(text: string, word: string): number {
  let n = 0
  let idx = text.indexOf(word)
  while (idx >= 0) {
    n += 1
    idx = text.indexOf(word, idx + word.length)
  }
  return n
}

export interface DailyTextMetric {
  date: string
  /** 用户消息总字数（去空白） */
  chars: number
  /** 模糊词出现次数 */
  vagueCount: number
  /** 每百字模糊词频次 */
  vaguePerHundred: number
  /** 句均字数 */
  avgSentenceLen: number
  /** 词汇丰富度：unique 字符数 / 总字符数（0-100） */
  vocabRichness: number
}

/** 按天计算文本指标，与 dates 对齐；无记录的日期全部为 0 */
export function computeDailyTextMetrics(entries: DaylogEntry[], dates: string[]): DailyTextMetric[] {
  const byDate = new Map(entries.map((e) => [e.date, e]))
  return dates.map((date) => {
    const empty: DailyTextMetric = {
      date,
      chars: 0,
      vagueCount: 0,
      vaguePerHundred: 0,
      avgSentenceLen: 0,
      vocabRichness: 0,
    }
    const e = byDate.get(date)
    if (!e) return empty
    const text = userTextOf(e)
    const chars = text.replace(/\s/g, '').length
    if (!chars) return empty
    const vagueCount = VAGUE_WORDS.reduce((n, w) => n + countWord(text, w), 0)
    const sentences = text
      .split(/[。！？!?\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2)
    const avgSentenceLen = sentences.length ? Math.round((chars / sentences.length) * 10) / 10 : 0
    const words = text.replace(/[^一-龥a-zA-Z0-9]/g, '')
    const vocabRichness = words.length ? Math.round((new Set(words).size / words.length) * 100) : 0
    return {
      date,
      chars,
      vagueCount,
      vaguePerHundred: Math.round((vagueCount / chars) * 1000) / 10,
      avgSentenceLen,
      vocabRichness,
    }
  })
}

/** 周期内高频情绪词（按出现次数降序） */
export function computeTopEmotions(
  entries: DaylogEntry[],
  sinceDate: string,
  limit = 8
): { word: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const e of entries) {
    if (e.date < sinceDate) continue
    const text = userTextOf(e)
    if (!text) continue
    for (const w of EMOTION_WORDS) {
      const c = countWord(text, w)
      if (c) counts.set(w, (counts.get(w) || 0) + c)
    }
  }
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}
