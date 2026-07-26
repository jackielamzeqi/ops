import type {
  DaylogEntry,
  DaylogFeedback,
  DaylogHabit,
  DaylogMessage,
  DaylogMode,
  DaylogProfile,
  DaylogSummary,
  LanguageScore,
  LanguageScoreDimDetail,
  LanguageScoreDims,
  ObservationType,
} from './daylogTypes'
import {
  clampScore,
  computeTotalScore,
  DAYLOG_FEEDBACK_STYLES,
  DAYLOG_GOALS,
  DAYLOG_MODES,
  eventsArray,
  OBSERVATION_TYPES,
  strOf,
} from './daylogTypes'
import { computeTopEmotions } from './daylogStats'

/** 把 DaylogSummary 文本化为周报 digest 用段落（对齐新结构 + 兼容旧字段）。 */
function summaryToDigest(s: DaylogSummary): string {
  const events = eventsArray(s).join('；')
  const arc = s.emotionArc ?? {}
  const layers = s.layers ?? {}
  const parts: string[] = []
  if (s.oneLiner) parts.push(`一句话：${s.oneLiner}`)
  if (events) parts.push(`事件：${events}`)
  const emo = [arc.start, arc.end].filter(Boolean).join(' → ')
  if (emo) parts.push(`情绪变化：${emo}${arc.reason ? `（${arc.reason}）` : ''}`)
  else if (s.emotions) parts.push(`情绪：${strOf(s.emotions)}`)
  const layerParts = [
    layers.fact && `事实：${layers.fact}`,
    layers.thought && `想法：${layers.thought}`,
    layers.emotion && `情绪：${layers.emotion}`,
    layers.need && `需要：${layers.need}`,
  ].filter(Boolean)
  if (layerParts.length) parts.push(layerParts.join('；'))
  if (s.observation) parts.push(`观察（待确认）：${s.observation}`)
  if (s.insight) parts.push(`长期启发：${s.insight}`)
  else if (s.insights) parts.push(`思考：${strOf(s.insights)}`)
  if (s.tomorrowAction) parts.push(`明日行动：${s.tomorrowAction}`)
  else if (s.actions) parts.push(`明日行动：${strOf(s.actions)}`)
  if (s.quote) parts.push(`金句：${s.quote}`)
  return parts.join('\n')
}

/**
 * Daylog AI 客户端：密钥不进前端，请求一律走代理。
 * 本地开发：Vite 代理 /daylog-ai → scripts/daylog-ai-proxy.mjs
 * 生产：VITE_DAYLOG_AI_PROXY 指向 Cloudflare Worker（worker/daylog-ai-proxy.js）
 */
const ENDPOINT = (import.meta.env.VITE_DAYLOG_AI_PROXY as string | undefined) || '/daylog-ai'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  /** 仅最后一条用户消息携带图片（data URL），避免每次带上全部历史图 */
  images?: string[]
}

async function chat(messages: ChatMessage[], responseJson = false): Promise<string> {
  const res = await fetch(`${ENDPOINT}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, responseJson }),
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(data?.error || `AI 代理请求失败（${res.status}）`)
  }
  const data = (await res.json()) as { text?: string }
  if (!data?.text) throw new Error('AI 代理返回为空')
  return data.text
}

export interface BackendInfo {
  backend: 'codex' | 'kimi' | 'api' | null
  label: string | null
}

/** 查询代理当前实际使用的后端（代理不可达时返回 null） */
export async function getBackendInfo(): Promise<BackendInfo | null> {
  try {
    const res = await fetch(`${ENDPOINT}/health`)
    if (!res.ok) return null
    return (await res.json()) as BackendInfo
  } catch {
    return null
  }
}

/* ===== 共用基础人设（说明书 10.1；askNextQuestion / generateDailyReport 共用） ===== */

const BASE_PERSONA = `你是一名理性、稳定、尊重边界的每日回顾伙伴。你的目标不是替用户下结论，而是通过简短反馈和一次一个的问题，帮助用户说清事实、想法、情绪、需要与行动。
- 回复优先使用用户自己的词，不机械复述整段内容。
- 默认每轮遵循「承接—观察—确认—追问」：1 句承接 + 1 个观察（降低确定性，例如「我可能理解为……对吗？」）+ 1 个问题，问题放在最后。
- 一次只问一个问题，不连续抛出多个问题。
- 不评价用户、不说教、不空泛安慰（如「抱抱你，一切都会好起来」）；反馈必须对应用户刚刚说的具体内容。
- 观察不等于结论：涉及人格、关系模式的推测一律用「可能/似乎」表述，并允许用户纠正。
- 鼓励自主判断，不制造依赖；合适时提醒用户也可以找可信任的人一起讨论。
- 安全兜底：用户出现自伤、自杀或现实安全风险信号时，立即停止常规复盘与人格分析，优先确认其当下安全，并鼓励联系可信任的人和专业支持（全国心理援助热线 12356，北京心理危机研究与干预中心 010-82951332）。`

/** 状态策略（说明书 7.4），注入采访者 prompt */
const STATE_STRATEGIES = `状态策略：
- 普通复盘（情绪强度低至中）：按「事件 → 情绪 → 想法 → 需要 → 启发 → 行动」自然推进，不机械挨个问。
- 高情绪强度（崩溃、强烈焦虑、无法思考）：先稳定，减少分析和问题数量，确认对方是否需要建议，不马上讲道理。
- 低精力（回复很短、疲惫、明确不想深入）：切换轻量，只问「最想留下的一件事」，不强迫完成完整流程。
- 积极体验（兴奋、满足、感恩、成就感）：先陪用户品味，提炼可复用的条件，不急着转向问题和改进。
- 求方案（用户明确要解决问题）：先复述目标和约束，再给不超过 3 个方案及取舍；未经允许不给大量建议。`

const MODE_STRATEGIES: Record<DaylogMode, string> = {
  review: '陪用户完整回顾今天：从一件具体的事开始，逐步走到情绪、想法和明天的行动。',
  emotion: '聚焦情绪本身：先帮助命名情绪（可从相近情绪词入手）、定位来源，再视强度决定是否给轻量稳定方法。',
  clarify: '帮用户把一件事理清：区分事实与推测、明确真正的卡点，最后再谈可选的下一步。',
  quiet: '轻量陪伴：回复很短、少提问，允许沉默和简短回应，不主动展开分析。',
}

/** 拼接采访者 system prompt：人设 + 用户档案 + 对话模式 + 时长模式 + 状态策略 */
function buildInterviewerPrompt(profile: DaylogProfile | null | undefined, mode: DaylogMode, light: boolean): string {
  const parts: string[] = [BASE_PERSONA, STATE_STRATEGIES]

  if (profile) {
    const lines: string[] = []
    lines.push(`称呼用户为「${profile.nickname || '你'}」。`)
    if (profile.goals.length > 0) {
      const goalLabels = profile.goals
        .map((g) => DAYLOG_GOALS.find((x) => x.id === g)?.label)
        .filter(Boolean)
        .join('、')
      lines.push(`用户的支持目标：${goalLabels}；据此决定对话路径与建议类型。`)
    }
    const primary = DAYLOG_FEEDBACK_STYLES.find((s) => s.id === profile.feedbackStyle)?.label
    const secondary = DAYLOG_FEEDBACK_STYLES.find((s) => s.id === profile.feedbackStyleSecondary)?.label
    if (primary) lines.push(`反馈风格：主「${primary}」${secondary ? `，次「${secondary}」` : ''}；据此调整文案与建议顺序。`)
    if (profile.mbti || profile.relationStyle) {
      const tags = [profile.mbti && `MBTI ${profile.mbti}`, profile.relationStyle && `关系模式「${profile.relationStyle}」`]
        .filter(Boolean)
        .join('，')
      lines.push(`用户自述：${tags}。仅用于调整沟通方式，不代表专业判断，不要在回复中给用户贴标签。`)
    }
    parts.push(`用户档案：\n${lines.join('\n')}`)
  }

  const modeLabel = DAYLOG_MODES.find((m) => m.id === mode)?.label ?? '回顾一天'
  parts.push(`当前对话模式：${modeLabel}。${MODE_STRATEGIES[mode]}`)

  parts.push(
    light
      ? '当前为轻量时长模式：回复控制在 60 个中文字符以内，少提问，允许只承接不追问。'
      : '每条回复 60–150 个中文字符。'
  )
  parts.push('直接输出回复本身，不要任何前缀或解释。')
  return parts.join('\n\n')
}

export interface AskResult {
  text: string
  source: 'ai' | 'local'
}

export interface AskInput {
  /** 用户档案（称呼/目标/反馈风格会注入 prompt） */
  profile?: DaylogProfile | null
  /** 对话模式，默认 review */
  mode?: DaylogMode
  /** 一次性指令（如「先别分析」「给我建议」），仅注入本轮 */
  directive?: string
  /** 轻量模式：更短回复、更少问题 */
  light?: boolean
  messages: DaylogMessage[]
  /** 显式指定随最后一条用户消息发送的图片；缺省时取消息记录里最后一条用户消息的图片 */
  images?: string[]
}

export async function askNextQuestion(input: AskInput): Promise<AskResult> {
  const { profile, mode = 'review', directive, light = false, messages: history, images } = input
  // 本地提示（kind: 'hint'）不发给 AI
  const historyForAI = history.filter((m) => m.kind !== 'hint')
  try {
    let system = buildInterviewerPrompt(profile, mode, light)
    if (directive) system += `\n\n本轮附加指令（仅本轮有效）：${directive}`
    const msgs: ChatMessage[] = [{ role: 'system', content: system }]
    if (historyForAI.length === 0) {
      msgs.push({
        role: 'user',
        content: `（对话还没开始，请以「${mode === 'quiet' ? '安静陪伴' : '每日回顾伙伴'}」的身份向用户道一声晚安问候，并根据当前模式提出第一个低门槛问题）`,
      })
    } else {
      // 仅最后一条用户消息携带图片，避免每次都传全部历史图
      let lastUserIdx = -1
      for (let i = historyForAI.length - 1; i >= 0; i -= 1) {
        if (historyForAI[i].role === 'user') {
          lastUserIdx = i
          break
        }
      }
      historyForAI.forEach((m, i) => {
        const imgs = i === lastUserIdx ? (images?.length ? images : m.images) : undefined
        msgs.push({
          role: m.role,
          content: m.text,
          ...(imgs?.length ? { images: imgs } : {}),
        })
      })
    }
    const text = (await chat(msgs)).trim()
    if (!text) throw new Error('AI 返回为空')
    return { text, source: 'ai' }
  } catch {
    return { text: localNextQuestion(historyForAI), source: 'local' }
  }
}

/* ===== 本地预设追问策略（离线兜底） ===== */

const BASE_QUESTIONS = [
  '今天有什么值得记录的事吗？',
  '今天情绪变化最大的瞬间是什么时候？',
  '当时你是怎么想的？又是怎么处理的？',
  '今天有什么新的认识或发现吗？',
  '明天想做点什么改变？',
]

const FOLLOWUPS = [
  '能具体说说当时发生了什么吗？',
  '这件事为什么对你重要？',
  '你真正担心的是什么？',
  '有没有一个更准确的词来形容那种感觉？',
  '这背后是不是暴露了什么长期存在的问题？',
]

const VAGUE_RE = /(挺好|很烦|那个|有点|还行|差不多|一般|没啥|还好|不知道)/

function localNextQuestion(history: DaylogMessage[]): string {
  const answers = history.filter((m) => m.role === 'user')
  if (answers.length === 0) return `夜深了，聊聊今天吧。${BASE_QUESTIONS[0]}`
  const last = answers[answers.length - 1]
  if (last.text.length < 12 || VAGUE_RE.test(last.text)) {
    return FOLLOWUPS[(answers.length - 1) % FOLLOWUPS.length]
  }
  if (answers.length < BASE_QUESTIONS.length) return BASE_QUESTIONS[answers.length]
  return '今天还有想补充的吗？如果没有，可以点下方「生成今日总结」。'
}

/* ===== 每日总结与评分 ===== */

const REPORT_PROMPT = `${BASE_PERSONA}

现在你的任务是：根据用户与你的对话，输出一份严格的 JSON（不要输出任何其他文字、不要 markdown 代码块），格式：
{"summary":{"oneLiner":"今日一句话（20-40字概括）","events":["关键事件1","关键事件2"],"emotionArc":{"start":"开始时的情绪词与强度","end":"结束时的情绪词与强度","reason":"变化原因"},"layers":{"fact":"确定发生的事实","thought":"用户的想法/解释","emotion":"情绪","need":"真实需要"},"observation":"我对自己的一个观察","insight":"长期启发","tomorrowAction":"明日最小行动","quote":"今日金句"},"observationMeta":{"type":"主题","confidence":"低"},"languageScore":{"completeness":{"score":0,"evidence":"证据句","note":"一句反馈"},"structure":{"score":0,"evidence":"证据句","note":"一句反馈"},"evidence":{"score":0,"evidence":"证据句","note":"一句反馈"},"emotionPrecision":{"score":0,"evidence":"证据句","note":"一句反馈"},"reflection":{"score":0,"evidence":"证据句","note":"一句反馈"},"conciseness":{"score":0,"evidence":"证据句","note":"一句反馈"}},"feedback":{"strengths":["优点1"],"improvements":["建议1"]}}
要求：
1. 全部使用中文。events 只保留 1-3 件真正影响情绪或判断的事件；tomorrowAction 是一个不超过 15 分钟、可以执行的动作；quote 从用户原话中挑一句最有代表性的话（可稍加整理）。
2. layers 帮助用户区分层次，避免把想法当事实；对话中没有充分依据的层可以留空字符串。
3. observation 用「可能/似乎」措辞，不下定论（例如「被打断时，你似乎会用更多解释来争取理解」）；observationMeta.type ∈ 主题/触发点/有效方法/价值观，confidence ∈ 低/中/高；没有可靠观察时 observation 留空字符串。
4. languageScore 评估用户当天的语言表达能力，六个维度均为 0-100 的整数：completeness 信息完整度、structure 结构与逻辑、evidence 具体性与证据、emotionPrecision 情绪词精度、reflection 因果与反思、conciseness 表达简洁度。每维的 evidence 引用用户原话作为评分证据句，note 是一句可解释的具体反馈（哪里好、下一步怎么练）。评分要克制，普通人的随意表达一般在 50-70 之间。
5. feedback.strengths 列出表达上的优点（1-3 条）；feedback.improvements 最多 3 条具体改进建议。
6. 只输出 JSON 对象本身。`

export interface ObservationMeta {
  type: ObservationType
  confidence: '低' | '中' | '高'
}

export interface ReportResult {
  summary: DaylogSummary
  languageScore: LanguageScore
  feedback: DaylogFeedback
  /** summary.observation 对应的分类与置信度（本地兜底为 null） */
  observationMeta: ObservationMeta | null
  source: 'ai' | 'local'
}

/** AI 可能把每维返回成数字或 {score,evidence,note} 对象，统一解析 */
function parseDim(raw: unknown): { score: number; detail?: LanguageScoreDimDetail } {
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    const detail: LanguageScoreDimDetail = {}
    if (typeof o.evidence === 'string' && o.evidence.trim()) detail.evidence = o.evidence.trim()
    if (typeof o.note === 'string' && o.note.trim()) detail.note = o.note.trim()
    return { score: clampScore(o.score), detail: Object.keys(detail).length ? detail : undefined }
  }
  return { score: clampScore(raw) }
}

export async function generateDailyReport(
  history: DaylogMessage[],
  habit: DaylogHabit | null,
  modelLabel?: string | null
): Promise<ReportResult> {
  const transcript = history
    .filter((m) => m.kind !== 'hint')
    .map((m) => `${m.role === 'user' ? '用户' : '采访者'}：${m.text}`)
    .join('\n')
  try {
    const raw = await chat(
      [
        { role: 'system', content: REPORT_PROMPT },
        {
          role: 'user',
          content: `对话记录：\n${transcript}\n\n（补充：有效回答 ${habit?.answerCount ?? 0} 条，对话约 ${habit?.durationMinutes ?? 0} 分钟）`,
        },
      ],
      true
    )
    const parsed = extractJson(raw) as {
      summary?: Record<string, unknown>
      observationMeta?: { type?: string; confidence?: string }
      languageScore?: Record<string, unknown>
      feedback?: Partial<DaylogFeedback>
    }
    const s = parsed.summary ?? {}
    const arc = (s.emotionArc ?? {}) as Record<string, unknown>
    const layers = (s.layers ?? {}) as Record<string, unknown>
    const summary: DaylogSummary = {
      oneLiner: String(s.oneLiner || ''),
      events: Array.isArray(s.events)
        ? s.events.map(String).filter(Boolean).slice(0, 3)
        : typeof s.events === 'string' && s.events.trim()
          ? [s.events.trim()]
          : [],
      emotionArc: {
        ...(arc.start ? { start: String(arc.start) } : {}),
        ...(arc.end ? { end: String(arc.end) } : {}),
        ...(arc.reason ? { reason: String(arc.reason) } : {}),
      },
      layers: {
        ...(layers.fact ? { fact: String(layers.fact) } : {}),
        ...(layers.thought ? { thought: String(layers.thought) } : {}),
        ...(layers.emotion ? { emotion: String(layers.emotion) } : {}),
        ...(layers.need ? { need: String(layers.need) } : {}),
      },
      observation: String(s.observation || ''),
      insight: String(s.insight || ''),
      tomorrowAction: String(s.tomorrowAction || ''),
      quote: String(s.quote || ''),
    }
    const dimKeys: (keyof LanguageScoreDims)[] = [
      'completeness',
      'structure',
      'evidence',
      'emotionPrecision',
      'reflection',
      'conciseness',
    ]
    const ls = parsed.languageScore ?? {}
    const dims = {} as LanguageScoreDims
    const details: Partial<Record<keyof LanguageScoreDims, LanguageScoreDimDetail>> = {}
    for (const k of dimKeys) {
      const { score, detail } = parseDim(ls[k])
      dims[k] = score
      if (detail) details[k] = detail
    }
    // 总分在前端按权重重算，不信任 AI 的 total
    const languageScore: LanguageScore = {
      ...dims,
      total: computeTotalScore(dims),
      ...(Object.keys(details).length ? { details } : {}),
      modelVersion: modelLabel || 'unknown',
    }
    const feedback: DaylogFeedback = {
      strengths: Array.isArray(parsed.feedback?.strengths)
        ? parsed.feedback.strengths.map(String).filter(Boolean).slice(0, 3)
        : [],
      improvements: Array.isArray(parsed.feedback?.improvements)
        ? parsed.feedback.improvements.map(String).filter(Boolean).slice(0, 3)
        : [],
    }
    let observationMeta: ObservationMeta | null = null
    if (summary.observation) {
      const t = parsed.observationMeta?.type
      const c = parsed.observationMeta?.confidence
      observationMeta = {
        type: OBSERVATION_TYPES.includes(t as ObservationType) ? (t as ObservationType) : '主题',
        confidence: c === '中' || c === '高' ? c : '低',
      }
    }
    if (!summary.oneLiner && !summary.quote && summary.events.length === 0) {
      throw new Error('AI 返回内容不完整')
    }
    return { summary, languageScore, feedback, observationMeta, source: 'ai' }
  } catch {
    return { ...localReport(history, habit), observationMeta: null, source: 'local' }
  }
}

/** 从返回文本中提取 JSON：先取 ```json 代码块，否则取首尾花括号之间的内容 */
function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
  return JSON.parse(candidate)
}

/* ===== 本地启发式总结与评分（离线兜底） ===== */

const VAGUE_WORDS = ['挺好', '很烦', '那个', '有点', '还行', '差不多', '一般', '没啥', '还好']
const EMOTION_WORDS = ['开心', '高兴', '烦', '焦虑', '紧张', '累', '难过', '生气', '平静', '兴奋', '失落', '放松', '郁闷']

function countOccurrences(text: string, word: string): number {
  let n = 0
  let idx = text.indexOf(word)
  while (idx >= 0) {
    n += 1
    idx = text.indexOf(word, idx + word.length)
  }
  return n
}

function localReport(
  history: DaylogMessage[],
  habit: DaylogHabit | null
): { summary: DaylogSummary; languageScore: LanguageScore; feedback: DaylogFeedback } {
  const userTexts = history.filter((m) => m.role === 'user').map((m) => m.text)
  const all = userTexts.join('\n')
  const sentences = all
    .split(/[。！？!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4)

  const emotionSentence = sentences.find((s) => EMOTION_WORDS.some((w) => s.includes(w)))
  const actionSentence = sentences.find((s) => s.includes('明天') || s.includes('打算') || s.includes('计划'))
  const quote = sentences.reduce((best, s) => (s.length > (best?.length || 0) && s.length <= 60 ? s : best), sentences[0] || '')

  const summary: DaylogSummary = {
    oneLiner: sentences[0]?.slice(0, 40) || '今天也是认真度过的一天。',
    events: sentences.slice(0, 3).map((s) => s.slice(0, 80)),
    emotionArc: emotionSentence ? { start: emotionSentence.slice(0, 20) } : {},
    layers: {
      fact: sentences[0] || '',
      thought: sentences.find((s) => /(觉得|以为|认为|感觉)/.test(s)) || '',
      emotion: emotionSentence || '',
      need: '',
    },
    observation: '',
    insight: sentences.slice(2, 4).join('。'),
    tomorrowAction: actionSentence || '',
    quote: quote || '',
  }

  const answerCount = habit?.answerCount ?? userTexts.length
  const totalChars = all.replace(/\s/g, '').length
  const avgLen = totalChars / Math.max(1, answerCount)
  const vagueCount = VAGUE_WORDS.reduce((n, w) => n + countOccurrences(all, w), 0)
  const sentenceCount = Math.max(1, sentences.length)
  const hasEmotion = EMOTION_WORDS.some((w) => all.includes(w))
  const hasConnector = /(因为|所以|然后|但是|于是|如果|因此|导致|从而|之所以|原因是)/.test(all)
  const hasDetail = totalChars > 80 && vagueCount <= 2

  // 新六维（说明书 8.1）：信息完整度 / 结构与逻辑 / 具体性与证据 / 情绪词精度 / 因果与反思 / 表达简洁度
  const dims: LanguageScoreDims = {
    completeness: clampScore(48 + Math.min(22, answerCount * 5) + (sentences.length >= 3 ? 8 : 0)),
    structure: clampScore(46 + Math.min(24, sentenceCount * 3) + (answerCount >= 4 ? 8 : 0) + (hasConnector ? 6 : 0)),
    evidence: clampScore(48 + (hasDetail ? 16 : 0) + Math.min(20, totalChars / 30) - vagueCount * 4),
    emotionPrecision: clampScore(45 + (hasEmotion ? 18 : 0) - vagueCount * 4),
    reflection: clampScore(46 + (hasConnector ? 18 : 0) + Math.min(12, answerCount * 2)),
    conciseness: clampScore(56 - vagueCount * 4 - Math.max(0, Math.round((avgLen - 48) / 3))),
  }
  const languageScore: LanguageScore = { ...dims, total: computeTotalScore(dims), modelVersion: 'local' }

  const strengths: string[] = []
  if (answerCount >= 3) strengths.push('愿意完整回顾一天，回答了多个问题')
  if (hasEmotion) strengths.push('能觉察并说出自己的情绪')
  if (avgLen >= 30) strengths.push('表达比较充分，不只是只言片语')
  if (strengths.length === 0) strengths.push('完成了今天的复盘记录')

  const improvements: string[] = []
  if (vagueCount > 0) improvements.push('「挺好 / 还行 / 有点」这类模糊词出现较多，试试换成更准确的描述')
  if (avgLen < 25) improvements.push('回答普遍偏短，可以多说一句「为什么」')
  if (!actionSentence) improvements.push('可以试着为明天留一个具体的小行动')
  if (!hasConnector) improvements.push('试试用「因为 / 所以 / 但是」把因果连起来，结构会更清楚')
  if (improvements.length === 0) improvements.push('保持这个节奏，继续记录')

  return { summary, languageScore, feedback: { strengths: strengths.slice(0, 3), improvements: improvements.slice(0, 3) } }
}

/* ===== AI 周报 ===== */

const WEEKLY_REPORT_PROMPT = `你是一位每周复盘助手。根据用户本周（周一至今天）的每日复盘摘要，输出一份严格的 JSON（不要输出任何其他文字、不要 markdown 代码块），格式：
{"events":"本周经历了什么","recurringEmotions":"反复出现的情绪","recurringIssues":"反复出现的问题","improvements":"表达能力提升点","regressions":"表达能力退步点","nextWeekFocus":"下周重点训练目标"}
要求：
1. 全部使用中文，各字段 1-3 句话，克制、具体，不要说教。
2. improvements / regressions 聚焦语言表达能力（清晰度、结构、具体性、逻辑、词汇、对话推进），结合每日评分与表达特点。
3. 只输出 JSON 对象本身。`

export interface WeeklyReportFields {
  events: string
  recurringEmotions: string
  recurringIssues: string
  improvements: string
  regressions: string
  nextWeekFocus: string
}

export interface WeeklyReportResult extends WeeklyReportFields {
  source: 'ai' | 'local'
}

export async function generateWeeklyReport(weekEntries: DaylogEntry[]): Promise<WeeklyReportResult> {
  try {
    const digest = weekEntries
      .filter((e) => e.messages.length > 0)
      .map((e) => {
        const parts = [`【${e.date}】`]
        if (e.summary) {
          parts.push(summaryToDigest(e.summary))
        } else {
          const userTexts = e.messages
            .filter((m) => m.role === 'user')
            .map((m) => m.text)
            .join('；')
          parts.push(`（未生成总结）用户回答：${userTexts.slice(0, 400)}`)
        }
        if (e.observation) parts.push(`观察类型：${e.observation.type}（置信度 ${e.observation.confidence}）`)
        if (e.languageScore) parts.push(`语言技术指数：${e.languageScore.total}/100`)
        return parts.join('\n')
      })
      .join('\n\n')
    if (!digest.trim()) throw new Error('本周暂无记录')
    const raw = await chat(
      [
        { role: 'system', content: WEEKLY_REPORT_PROMPT },
        { role: 'user', content: `本周每日复盘记录：\n${digest}` },
      ],
      true
    )
    const parsed = extractJson(raw) as Partial<WeeklyReportFields>
    const fields: WeeklyReportFields = {
      events: String(parsed.events || ''),
      recurringEmotions: String(parsed.recurringEmotions || ''),
      recurringIssues: String(parsed.recurringIssues || ''),
      improvements: String(parsed.improvements || ''),
      regressions: String(parsed.regressions || ''),
      nextWeekFocus: String(parsed.nextWeekFocus || ''),
    }
    if (!fields.events && !fields.recurringEmotions) throw new Error('AI 返回内容不完整')
    return { ...fields, source: 'ai' }
  } catch {
    return { ...localWeeklyReport(weekEntries), source: 'local' }
  }
}

/** 本地周报模板（AI 不可用时静默降级）：天数、主要情绪词、平均指数变化 */
function localWeeklyReport(weekEntries: DaylogEntry[]): WeeklyReportFields {
  const recorded = weekEntries.filter((e) => e.messages.length > 0)
  const scored = recorded
    .filter((e) => e.languageScore)
    .sort((a, b) => a.date.localeCompare(b.date))
  const emotions = computeTopEmotions(recorded, '0000-00-00', 3)

  const avg = scored.length
    ? Math.round(scored.reduce((s, e) => s + e.languageScore!.total, 0) / scored.length)
    : null
  const delta =
    scored.length >= 2
      ? scored[scored.length - 1].languageScore!.total - scored[0].languageScore!.total
      : null

  const events =
    `本周共记录 ${recorded.length} 天。` +
    (avg != null ? `平均语言技术指数 ${avg} 分。` : '本周还没有生成评分。')
  const recurringEmotions = emotions.length
    ? `本周反复提到的情绪：${emotions.map((e) => `${e.word}（${e.count} 次）`).join('、')}。`
    : '本周记录中很少提到情绪词，可以尝试多描述感受。'
  const recurringIssues = '（本地生成的周报无法归纳具体问题，连接 AI 后可获得更准确的分析）'
  const improvements =
    delta != null && delta > 0
      ? `语言技术指数较周初上升 ${delta} 分，表达状态在向好。`
      : delta != null
        ? '表达状态整体平稳。'
        : '记录天数还太少，暂时看不出变化。'
  const regressions =
    delta != null && delta < 0
      ? `语言技术指数较周初下降 ${-delta} 分，注意别退回模糊、简短的表达。`
      : '暂无明显退步。'
  const nextWeekFocus = '保持每日记录，回答时试着多说一句「为什么」，把感受说得更具体。'
  return { events, recurringEmotions, recurringIssues, improvements, regressions, nextWeekFocus }
}
