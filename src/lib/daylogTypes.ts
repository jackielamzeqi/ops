/** Daylog 每日复盘 —— 数据类型定义（总结/评分结构对齐 PRD 第八节 JSON） */

export type DaylogInputMode = 'voice' | 'text'

/** 消息来源：快捷回答 / 键盘输入 / 语音输入 */
export type DaylogMessageSource = 'quick' | 'typed' | 'voice'

/** 对话模式：回顾一天 / 说说情绪 / 理清一件事 / 安静一下 */
export type DaylogMode = 'review' | 'emotion' | 'clarify' | 'quiet'

export const DAYLOG_MODES: { id: DaylogMode; label: string; desc: string }[] = [
  { id: 'review', label: '回顾一天', desc: '按事件、情绪、想法慢慢过一遍今天' },
  { id: 'emotion', label: '说说情绪', desc: '先命名感受，再看它从哪里来' },
  { id: 'clarify', label: '理清一件事', desc: '把一件纠结的事拆成事实、想法和下一步' },
  { id: 'quiet', label: '安静一下', desc: '轻量陪伴，短回复、少问题' },
]

export interface DaylogMessage {
  role: 'user' | 'assistant'
  text: string
  /** 仅用户消息记录输入方式 */
  inputMode?: DaylogInputMode
  /** 用户消息来源（快捷回答正文按发送原文保存） */
  source?: DaylogMessageSource
  /** 本地弱化提示（如「好的，先不分析」）：不冒充用户消息，也不会发给 AI */
  kind?: 'hint'
  /** 图片附件（压缩后的 data URL，最长边 ≤1024，JPEG 0.8） */
  images?: string[]
  ts: number
}

/** 情绪变化：开始/结束的情绪词与强度 + 变化原因 */
export interface DaylogEmotionArc {
  start?: string
  end?: string
  reason?: string
}

/** 事实 / 想法 / 情绪 / 需要 四层（帮助区分层次，避免把想法当事实） */
export interface DaylogLayers {
  fact?: string
  thought?: string
  emotion?: string
  need?: string
}

/** 今日总结（说明书 7.5，全部可编辑） */
export interface DaylogSummary {
  /** 今日一句话（20–40 字概括） */
  oneLiner: string
  /** 关键事件（1–3 件） */
  events: string[]
  /** 情绪变化 */
  emotionArc: DaylogEmotionArc
  /** 事实/想法/情绪/需要 */
  layers: DaylogLayers
  /** 我对自己的一个观察（AI 生成，默认待确认，与观察页联动） */
  observation: string
  /** 长期启发 */
  insight: string
  /** 明日最小行动（≤15 分钟可执行） */
  tomorrowAction: string
  /** 今日金句（保留，时间线/导出在用） */
  quote: string
  /* ===== 旧版字段（V1 数据兼容，仅显示层一次性映射，不再生成） ===== */
  emotions?: string
  insights?: string
  gains?: string
  actions?: string
}

/**
 * 旧版总结（events 为字符串、字段为 emotions/insights/gains/actions）
 * 一次性映射为新结构；缺失字段给空值，不写回数据库。
 */
export function normalizeSummary(raw: DaylogSummary): DaylogSummary {
  const events = eventsArray(raw)
  return {
    oneLiner: raw.oneLiner || raw.quote || events[0] || '',
    events,
    emotionArc: raw.emotionArc ?? (raw.emotions ? { start: raw.emotions } : {}),
    layers: raw.layers ?? {},
    observation: raw.observation ?? '',
    insight: raw.insight ?? [raw.insights, raw.gains].filter(Boolean).join(' '),
    tomorrowAction: raw.tomorrowAction ?? raw.actions ?? '',
    quote: raw.quote ?? '',
  }
}

/** 单维度的证据句与可解释反馈（AI 生成；本地兜底可能没有） */
export interface LanguageScoreDimDetail {
  /** 证据句：从用户原话引用 */
  evidence?: string
  /** 一句可解释反馈 */
  note?: string
}

/**
 * 语言技术指数六个子维度（0-100，说明书 8.1）；
 * total 由前端按权重重算，不信任 AI 给出的总分。
 * 旧版 entries 使用另一组维度 key（clarity/concreteness/logic/vocabulary/engagement），
 * 用 isCurrentScore 判断，图表遇到旧 key 的数据点跳过（总分折线不受影响）。
 */
export interface LanguageScore {
  /** 信息完整度（权重 15%） */
  completeness: number
  /** 结构与逻辑（权重 20%） */
  structure: number
  /** 具体性与证据（权重 15%） */
  evidence: number
  /** 情绪词精度（权重 15%） */
  emotionPrecision: number
  /** 因果与反思（权重 20%） */
  reflection: number
  /** 表达简洁度（权重 15%） */
  conciseness: number
  total: number
  /** 每维证据句与可解释反馈 */
  details?: Partial<Record<keyof LanguageScoreDims, LanguageScoreDimDetail>>
  /** 生成时的模型/后端版本（如 'ChatGPT (codex CLI)' / 'local'） */
  modelVersion?: string
}

export type LanguageScoreDims = Omit<LanguageScore, 'total' | 'details' | 'modelVersion'>

/** 是否为当前版（说明书 8.1）六维评分 */
export function isCurrentScore(s: LanguageScore): boolean {
  return typeof (s as unknown as Record<string, unknown>).completeness === 'number'
}

export interface DaylogFeedback {
  strengths: string[]
  /** 最多 3 条 */
  improvements: string[]
}

export interface DaylogHabit {
  durationMinutes: number
  answerCount: number
  inputMode: 'voice' | 'text' | 'mixed'
}

/** AI 周报：以周一日期为 key 持久化在 IndexedDB weeklyReports store */
export interface DaylogWeeklyReport {
  /** 周一日期 YYYY-MM-DD，IndexedDB 主键 */
  weekStart: string
  /** 本周经历了什么 */
  events: string
  /** 反复出现的情绪 */
  recurringEmotions: string
  /** 反复出现的问题 */
  recurringIssues: string
  /** 表达能力提升点 */
  improvements: string
  /** 表达能力退步点 */
  regressions: string
  /** 下周重点训练目标 */
  nextWeekFocus: string
  source: 'ai' | 'local'
  createdAt: number
}

export interface DaylogEntry {
  /** YYYY-MM-DD（本地时区），同时是 IndexedDB 主键 */
  date: string
  /** 对话模式（开始复盘时选定，影响 AI 第一问与后续策略） */
  mode?: DaylogMode
  /** 开始前可选的今日状态自评（可跳过；缺省字段表示未填） */
  moodStart?: { level?: number; word?: string }
  messages: DaylogMessage[]
  summary: DaylogSummary | null
  languageScore: LanguageScore | null
  /** 用户标记「AI 判断不准确」（说明书 8.1：允许用户反馈评分） */
  scoreFeedback?: 'inaccurate' | null
  feedback: DaylogFeedback | null
  habit: DaylogHabit | null
  /** 有效回答 ≥3 条即视为完成 */
  completed: boolean
  /** 总结/评分来源：AI 生成 or 本地启发式 */
  source: 'ai' | 'local'
  /** 「我对自己的一个观察」的来源元信息：生成时落库为待确认 ProfileObservation，
   * 这里只存一份快照用于总结页展示状态；状态以观察库为唯一来源（isSimilarObservation 匹配）。 */
  observation?: {
    type: ObservationType
    confidence: '低' | '中' | '高'
  }
  createdAt: number
  updatedAt: number
}

export const SCORE_DIMENSIONS: { key: keyof LanguageScoreDims; label: string; weight: number }[] = [
  { key: 'completeness', label: '信息完整度', weight: 0.15 },
  { key: 'structure', label: '结构与逻辑', weight: 0.2 },
  { key: 'evidence', label: '具体性与证据', weight: 0.15 },
  { key: 'emotionPrecision', label: '情绪词精度', weight: 0.15 },
  { key: 'reflection', label: '因果与反思', weight: 0.2 },
  { key: 'conciseness', label: '表达简洁度', weight: 0.15 },
]

/** 前端按固定权重重算总分（0-100，四舍五入） */
export function computeTotalScore(dims: LanguageScoreDims): number {
  const total = SCORE_DIMENSIONS.reduce((sum, d) => sum + (dims[d.key] || 0) * d.weight, 0)
  return Math.round(Math.max(0, Math.min(100, total)))
}

export function clampScore(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.round(Math.max(0, Math.min(100, n)))
}

/**
 * 安全读取 events：旧版数据可能存成字符串，新版是 string[]；
 * 统一返回 string[]（运行时兼容，TS 侧不再出现「never」收窄）。
 */
export function eventsArray(s: Pick<DaylogSummary, 'events'> | null | undefined): string[] {
  if (!s) return []
  const e = s.events as unknown
  if (Array.isArray(e)) return e.map(String).filter(Boolean)
  if (typeof e === 'string' && e.trim()) return [e.trim()]
  return []
}

/** 安全读取字符串形式的旧版字段（events 之外），返回 string */
export function strOf(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/* ===== 个人档案（说明书 7.1，ONB-01~06） ===== */

export type DaylogFeedbackStyle = 'gentle' | 'rational' | 'direct'

export const DAYLOG_FEEDBACK_STYLES: { id: DaylogFeedbackStyle; label: string; desc: string }[] = [
  { id: 'gentle', label: '温和陪伴', desc: '先接住情绪，再慢慢梳理' },
  { id: 'rational', label: '理性分析', desc: '帮你拆结构、找因果' },
  { id: 'direct', label: '直接建议', desc: '更快进入可执行的方案' },
]

/** 支持目标（0–6 多选） */
export type DaylogGoal = 'relation' | 'emotion' | 'explore' | 'solution' | 'inspiration' | 'pastime'

export const DAYLOG_GOALS: { id: DaylogGoal; label: string }[] = [
  { id: 'relation', label: '转变为更安全的关系模式' },
  { id: 'emotion', label: '排解情绪' },
  { id: 'explore', label: '探索自己' },
  { id: 'solution', label: '获得解决方案与建议' },
  { id: 'inspiration', label: '获得启发与灵感' },
  { id: 'pastime', label: '打发时间' },
]

export type DaylogDuration = 3 | 5 | 10

export const DAYLOG_DURATIONS: { value: DaylogDuration; label: string }[] = [
  { value: 3, label: '3 分钟 · 轻量' },
  { value: 5, label: '5 分钟 · 标准' },
  { value: 10, label: '10 分钟 · 深入' },
]

/** 记忆权限：仅本次 / 保存每日总结 / 保存已确认画像 */
export type DaylogMemoryLevel = 'session' | 'summary' | 'profile'

export const DAYLOG_MEMORY_LEVELS: { id: DaylogMemoryLevel; label: string; desc: string }[] = [
  { id: 'session', label: '仅本次', desc: '对话只保留在今天，不沉淀长期信息' },
  { id: 'summary', label: '保存每日总结', desc: '每天留下一份可编辑的总结' },
  { id: 'profile', label: '保存已确认画像', desc: '你确认过的观察才会进入长期画像' },
]

export interface DaylogProfile {
  /** 称呼，默认「你」 */
  nickname: string
  /** MBTI，可选；null 表示不确定/不想填写（仅用于调整沟通方式，不代表专业判断） */
  mbti: string | null
  /** 关系模式，可选；同上 */
  relationStyle: string | null
  /** 支持目标，0–6 项 */
  goals: DaylogGoal[]
  feedbackStyle: DaylogFeedbackStyle
  /** 次风格，可空 */
  feedbackStyleSecondary: DaylogFeedbackStyle | null
  defaultDuration: DaylogDuration
  memoryLevel: DaylogMemoryLevel
  /** 是否已完成首次设置 */
  onboarded: boolean
}

export function createEmptyEntry(date: string): DaylogEntry {
  const now = Date.now()
  return {
    date,
    messages: [],
    summary: null,
    languageScore: null,
    feedback: null,
    habit: null,
    completed: false,
    source: 'ai',
    createdAt: now,
    updatedAt: now,
  }
}

/* ===== 个人观察（说明书 7.6 + 11 节 ProfileObservation） ===== */

export type ObservationType = '主题' | '触发点' | '有效方法' | '价值观'

export const OBSERVATION_TYPES: ObservationType[] = ['主题', '触发点', '有效方法', '价值观']

export type ObservationStatus = 'pending' | 'confirmed' | 'rejected'

/**
 * 长期画像观察：AI 生成一律先进入 pending（待确认），
 * 未经用户确认不得进入已确认画像（AC-05）。
 */
export interface ProfileObservation {
  id: string
  /** 以「可能/似乎」措辞呈现，不下定论 */
  text: string
  type: ObservationType
  /** 证据来源（出现过的日期） */
  evidenceDates: string[]
  occurrences: number
  confidence: '低' | '中' | '高'
  status: ObservationStatus
  createdAt: number
  updatedAt: number
}
