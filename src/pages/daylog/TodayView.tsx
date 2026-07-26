import { useEffect, useMemo, useRef, useState } from 'react'
import type { DaylogEntry, DaylogMessage, DaylogMode, DaylogProfile } from '../../lib/daylogTypes'
import { createEmptyEntry, DAYLOG_MODES } from '../../lib/daylogTypes'
import {
  computeHabitFromMessages,
  computeStreak,
  dateLabel,
  entryCompleted,
  getMinAnswers,
  greetingByHour,
  lastNDates,
  todayStr,
} from '../../lib/daylogStats'
import { askNextQuestion, generateDailyReport, getBackendInfo } from '../../lib/daylogAi'
import { checkSafety } from '../../lib/daylogSafety'
import { getQuickReplies, type QuickPhase } from '../../lib/daylogQuickReplies'
import { upsertObservationFromSeed } from '../../lib/daylogObservations'

interface Props {
  entries: DaylogEntry[]
  upsertEntry: (e: DaylogEntry) => Promise<void>
  profile: DaylogProfile
  onShowReview: () => void
  onEditProfile: () => void
  onShowTimeline: () => void
}

interface RecognitionLike {
  stop: () => void
  start: () => void
}

const TEXTAREA_MAX_HEIGHT = 160
const MOOD_LEVELS = ['😞', '😕', '😐', '🙂', '😄']

/** 图片压缩：最长边 ≤1024px，JPEG 0.8，输出 data URL */
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, 1024 / Math.max(img.width, img.height, 1))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      URL.revokeObjectURL(url)
      if (!ctx) return reject(new Error('当前环境不支持图片处理'))
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', 0.8))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片读取失败'))
    }
    img.src = url
  })
}

export default function TodayView({ entries, upsertEntry, profile, onShowReview, onEditProfile, onShowTimeline }: Props) {
  const today = todayStr()
  const entry = entries.find((e) => e.date === today) ?? null
  const messages = useMemo(() => entry?.messages ?? [], [entry])

  const draftKey = `daylog-draft-${today}`

  const [inChat, setInChat] = useState(false)
  const [mode, setMode] = useState<DaylogMode>('review')
  const [moodLevel, setMoodLevel] = useState<number | null>(null)
  const [moodWord, setMoodWord] = useState('')
  const [light, setLight] = useState(profile.defaultDuration === 3)
  const [typing, setTyping] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [draft, setDraft] = useState(() => {
    try {
      return localStorage.getItem(draftKey) ?? ''
    } catch {
      return ''
    }
  })
  const [pendingImages, setPendingImages] = useState<string[]>([])
  const [offlineHint, setOfflineHint] = useState(false)
  const [backendLabel, setBackendLabel] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const voiceUsedRef = useRef(false)
  const recogRef = useRef<RecognitionLike | null>(null)
  const sendingRef = useRef(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const answerCount = messages.filter((m) => m.role === 'user').length
  const started = messages.length > 0
  const canSend = (draft.trim().length > 0 || pendingImages.length > 0) && !typing
  const minAnswers = getMinAnswers()
  // 说明书 8.2：完成 = 当天已生成并保存总结。首页「查看今日总结」「已完成」以总结为准，
  // 避免只聊了三句但没生成总结时按钮点了进空白页（无响应）。
  const hasSummaryToday = Boolean(entry?.summary)
  const todayDone = hasSummaryToday
  const activeMode: DaylogMode = entry?.mode ?? mode
  const activeModeLabel = DAYLOG_MODES.find((m) => m.id === activeMode)?.label ?? '回顾一天'

  const streak = useMemo(() => computeStreak(entries), [entries])
  const week = useMemo(
    () =>
      lastNDates(7).map((date) => ({
        date,
        done: entries.some((e) => e.date === date && entryCompleted(e, minAnswers)),
      })),
    [entries]
  )
  const scoreTrend = useMemo(() => {
    const scoredAll = entries
      .filter((e) => e.languageScore)
      .sort((a, b) => a.date.localeCompare(b.date))
    if (scoredAll.length === 0) return null
    const latest = scoredAll[scoredAll.length - 1].languageScore!.total
    const prev = scoredAll.length >= 2 ? scoredAll[scoredAll.length - 2].languageScore!.total : null

    // 近 7 天总分平均（HOME-05）
    const week7 = lastNDates(7)
    const week7Set = new Set(week7)
    const week7Scored = scoredAll.filter((e) => week7Set.has(e.date))
    const avg7 = week7Scored.length
      ? Math.round(week7Scored.reduce((s, e) => s + e.languageScore!.total, 0) / week7Scored.length)
      : null

    // 一句变化提示：对比最近一次与近 7 天均值，挑出相对最弱的维度给一句轻提示
    let hint: string | null = null
    if (week7Scored.length >= 1) {
      const latestEntry = scoredAll[scoredAll.length - 1]
      const ls = latestEntry.languageScore!
      const dims = ['completeness', 'structure', 'evidence', 'emotionPrecision', 'reflection', 'conciseness'] as const
      type DimKey = typeof dims[number]
      let worst: DimKey = dims[0]
      for (const d of dims) if (ls[d] < ls[worst]) worst = d
      const dimHint: Record<string, string> = {
        completeness: '信息更完整，可继续交代背景与结果',
        structure: '表达更具体，但因果链仍可加强',
        evidence: '整体清晰，可以多用具体例子作证据',
        emotionPrecision: '情绪词更准确，试试再细一层',
        reflection: '看到了触发点，下一步可验证这个解释是否唯一',
        conciseness: '内容更集中，核心意思可以更早出现',
      }
      hint = latest >= (avg7 ?? latest)
        ? `近 7 天平均 ${avg7} 分，今天保持不错；${dimHint[worst]}`
        : `近 7 天平均 ${avg7} 分，今天略低于近期；${dimHint[worst]}`
    }
    return { latest, delta: prev == null ? null : latest - prev, avg7, hint }
  }, [entries])

  /* 快捷回答 chips：最后一条是正常 AI 消息时显示，每条新 AI 消息重新抽取 */
  const lastMsg = messages[messages.length - 1]
  const showChips =
    inChat && !typing && !todayDone && lastMsg?.role === 'assistant' && lastMsg.kind !== 'hint'
  const quickPhase: QuickPhase =
    answerCount === 0 ? 'opening' : answerCount < minAnswers ? 'middle' : 'closing'
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const chips = useMemo(
    () => (showChips ? getQuickReplies(activeMode, quickPhase) : []),
    [showChips, activeMode, quickPhase, lastMsg?.ts]
  )

  const speechSupported =
    typeof window !== 'undefined' &&
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)

  useEffect(() => {
    getBackendInfo().then((info) => setBackendLabel(info?.label ?? null))
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, typing])

  /* 草稿持久化（CHAT-07 / AC-08）：按日期写 localStorage，发送成功清空 */
  useEffect(() => {
    try {
      if (draft) localStorage.setItem(draftKey, draft)
      else localStorage.removeItem(draftKey)
    } catch {
      /* 存储不可用时忽略 */
    }
  }, [draft, draftKey])

  /* textarea 自适应高度：初始 1 行，随内容增长，封顶 160px 后内部滚动 */
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`
    ta.style.overflowY = ta.scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden'
  }, [draft])

  /** 插入一条本地弱化提示：不冒充用户消息，也不会发给 AI */
  async function addHint(base: DaylogEntry, text: string) {
    await upsertEntry({
      ...base,
      messages: [...base.messages, { role: 'assistant', kind: 'hint', text, ts: Date.now() }],
    })
  }

  async function start() {
    if (started || typing) return
    setTyping(true)
    const q = await askNextQuestion({ profile, mode, light, messages: [] })
    setOfflineHint(q.source === 'local')
    const base = entry ?? createEmptyEntry(today)
    const word = moodWord.trim()
    const moodStart =
      moodLevel != null || word
        ? { ...(moodLevel != null ? { level: moodLevel } : {}), ...(word ? { word } : {}) }
        : undefined
    await upsertEntry({
      ...base,
      mode,
      ...(moodStart ? { moodStart } : {}),
      messages: [...base.messages, { role: 'assistant', text: q.text, ts: Date.now() }],
    })
    setTyping(false)
    setInChat(true)
  }

  async function handlePickImages(files: FileList | null) {
    if (!files?.length) return
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      try {
        const dataUrl = await compressImage(file)
        setPendingImages((prev) => [...prev, dataUrl])
      } catch {
        /* 跳过无法处理的图片 */
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function send(textArg?: string, source: 'typed' | 'quick' = 'typed') {
    const text = (textArg ?? draft).trim()
    const images = pendingImages
    if ((!text && images.length === 0) || sendingRef.current) return
    sendingRef.current = true
    try {
      const voice = voiceUsedRef.current
      voiceUsedRef.current = false
      setDraft('')
      setPendingImages([])

      const base = entries.find((e) => e.date === today) ?? createEmptyEntry(today)
      const userMsg: DaylogMessage = {
        role: 'user',
        text: text || '（图片）',
        inputMode: voice ? 'voice' : 'text',
        source: voice ? 'voice' : source,
        ...(images.length ? { images } : {}),
        ts: Date.now(),
      }
      let next: DaylogEntry = { ...base, messages: [...base.messages, userMsg] }
      next.completed = next.messages.filter((m) => m.role === 'user').length >= minAnswers
      next.habit = computeHabitFromMessages(next.messages)
      await upsertEntry(next)

      /* 安全流程（AC-10）：命中高危关键词不走 AI，直接返回固定安全文案 */
      const safetyReply = text ? checkSafety(text) : null
      if (safetyReply) {
        setPendingDirective(null)
        next = {
          ...next,
          messages: [...next.messages, { role: 'assistant', text: safetyReply, ts: Date.now() }],
        }
        await upsertEntry(next)
        return
      }

      setTyping(true)
      const q = await askNextQuestion({
        profile,
        mode: activeMode,
        light,
        messages: next.messages,
      })
      setOfflineHint(q.source === 'local')
      next = {
        ...next,
        messages: [...next.messages, { role: 'assistant', text: q.text, ts: Date.now() }],
      }
      next.habit = computeHabitFromMessages(next.messages)
      await upsertEntry(next)
    } finally {
      setTyping(false)
      sendingRef.current = false
    }
  }

  /** 「轻量一点」：切换轻量模式（状态条与按钮行共用） */
  async function toggleLight() {
    if (light) return
    setLight(true)
    const base = entries.find((e) => e.date === today) ?? createEmptyEntry(today)
    await addHint(base, '已切换为轻量模式：回复会更短，问题更少。')
  }

  async function generate() {
    const base = entries.find((e) => e.date === today)
    if (!base || generating) return
    setGenerating(true)
    try {
      const habit = computeHabitFromMessages(base.messages)
      const report = await generateDailyReport(base.messages, habit)
      // 说明书 7.5 / 7.6：观察默认进入「待确认」画像，未经确认不写已确认画像（AC-05）
      if (report.summary.observation && report.observationMeta) {
        await upsertObservationFromSeed(
          { text: report.summary.observation, type: report.observationMeta.type, confidence: report.observationMeta.confidence },
          today
        )
      }
      await upsertEntry({
        ...base,
        summary: report.summary,
        languageScore: report.languageScore,
        feedback: report.feedback,
        habit,
        source: report.source,
        ...(report.summary.observation && report.observationMeta
          ? { observation: { type: report.observationMeta.type, confidence: report.observationMeta.confidence } }
          : {}),
        completed: true,
      })
      onShowReview()
    } finally {
      setGenerating(false)
    }
  }

  function toggleVoice() {
    if (!speechSupported) return
    if (listening) {
      recogRef.current?.stop()
      setListening(false)
      return
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const recog = new SR()
    recog.lang = 'zh-CN'
    recog.interimResults = true
    recog.continuous = true
    let finalText = ''
    recog.onresult = (ev: any) => {
      let interim = ''
      for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
        const r = ev.results[i]
        if (r.isFinal) finalText += r[0].transcript
        else interim += r[0].transcript
      }
      if (finalText.trim()) voiceUsedRef.current = true
      const combined = (finalText + interim).trim()
      if (combined) setDraft(combined)
    }
    recog.onend = () => setListening(false)
    recog.onerror = () => setListening(false)
    recogRef.current = recog
    setListening(true)
    try {
      recog.start()
    } catch {
      setListening(false)
    }
  }

  /* ===== 对话首页（着陆区） ===== */
  if (!inChat) {
    return (
      <div className="daylog-hero card">
        <div className="daylog-date">{dateLabel(today)}</div>
        <div className="daylog-greeting">
          {greetingByHour()}，{profile.nickname}
        </div>
        {todayDone && <div className="daylog-done-badge">✓ 今日已完成</div>}
        <div className="daylog-streak">
          {streak > 0 ? `已连续记录 ${streak} 天` : '今晚开始第一段记录'}
        </div>

        {/* HOME-01：主按钮三种状态 */}
        {todayDone ? (
          <button className="daylog-start-btn" onClick={onShowReview}>
            查看今日总结
          </button>
        ) : started ? (
          <>
            <div className="daylog-mode-now">上次聊到一半 · {activeModeLabel}</div>
            <button className="daylog-start-btn" onClick={() => setInChat(true)}>
              继续今日对话
            </button>
          </>
        ) : (
          <>
            {/* HOME-02：四种模式入口 */}
            <div className="daylog-mode-grid">
              {DAYLOG_MODES.map((m) => (
                <button
                  key={m.id}
                  className={`daylog-mode-card ${mode === m.id ? 'active' : ''}`}
                  onClick={() => setMode(m.id)}
                >
                  <div className="daylog-mode-name">{m.label}</div>
                  <div className="daylog-mode-desc">{m.desc}</div>
                </button>
              ))}
            </div>

            {/* HOME-03：今日状态（可跳过） */}
            <div className="daylog-mood">
              <div className="daylog-mood-label">今日状态（可跳过）</div>
              <div className="daylog-mood-row">
                {MOOD_LEVELS.map((emoji, i) => (
                  <button
                    key={i}
                    className={`daylog-mood-btn ${moodLevel === i + 1 ? 'active' : ''}`}
                    title={`${i + 1} 级`}
                    onClick={() => setMoodLevel((prev) => (prev === i + 1 ? null : i + 1))}
                  >
                    {emoji}
                  </button>
                ))}
                <input
                  className="daylog-mood-input"
                  value={moodWord}
                  onChange={(e) => setMoodWord(e.target.value)}
                  placeholder="一个情绪词"
                  maxLength={10}
                />
              </div>
            </div>

            <button className="daylog-start-btn" onClick={start} disabled={typing}>
              {typing ? '正在准备第一个问题…' : '开始今日复盘'}
            </button>
          </>
        )}

        {/* HOME-04 / HOME-05：习惯数据与趋势预览 */}
        <div className="daylog-dots">
          {week.map((d) => (
            <span
              key={d.date}
              className={`daylog-dot ${d.done ? 'done' : ''}`}
              title={`${d.date.slice(5)} ${d.done ? '已完成' : '未记录'}`}
            />
          ))}
        </div>
        <div className="daylog-dots-hint">最近 7 天</div>
        {scoreTrend && (
          <div className="daylog-score-line">
            <div>
              最近一次语言技术指数 <strong>{scoreTrend.latest}</strong>
              {scoreTrend.delta != null && scoreTrend.delta !== 0 && (
                <span className={`daylog-delta ${scoreTrend.delta > 0 ? 'up' : 'down'}`}>
                  {scoreTrend.delta > 0 ? '↑' : '↓'} {Math.abs(scoreTrend.delta)} 分
                </span>
              )}
              {scoreTrend.delta === 0 && <span className="daylog-delta flat">与上次持平</span>}
            </div>
            {scoreTrend.hint && <div className="daylog-score-hint">{scoreTrend.hint}</div>}
          </div>
        )}

        <div className="daylog-hero-links">
          <button className="daylog-hero-link" onClick={onEditProfile}>
            个人设置
          </button>
          {/* HOME-06：隐私入口，本轮先链到时间线（导出所在处） */}
          <button className="daylog-hero-link" onClick={onShowTimeline}>
            数据与隐私
          </button>
        </div>
      </div>
    )
  }

  /* ===== 对话进行中 ===== */
  return (
    <div>
      {/* CHAT-05：顶部状态条，非强制进度条 */}
      <div className="daylog-status">
        <span className="daylog-status-mode">{activeModeLabel}</span>
        <span className="daylog-status-duration">约 {light ? 3 : profile.defaultDuration} 分钟</span>
        <span className="daylog-composer-spacer" />
        {!light && (
          <button className="daylog-status-light" onClick={() => void toggleLight()}>
            轻量一点
          </button>
        )}
        <button className="daylog-status-light" onClick={() => setInChat(false)}>
          返回首页
        </button>
      </div>

      <div className="daylog-chat">
        {messages.map((m, i) =>
          m.kind === 'hint' ? (
            <div key={`${m.ts}-${i}`} className="daylog-hint-line">
              {m.text}
            </div>
          ) : (
            <div key={`${m.ts}-${i}`} className={`daylog-msg ${m.role}`}>
              <div className="daylog-msg-inner">
                {m.images && m.images.length > 0 && (
                  <div className="daylog-bubble-imgs">
                    {m.images.map((src, j) => (
                      <img key={j} src={src} className="daylog-bubble-img" alt="图片附件" />
                    ))}
                  </div>
                )}
                <div className="daylog-bubble">{m.text}</div>
                {m.role === 'user' && m.source === 'voice' && (
                  <div className="daylog-msg-meta right">🎙 语音输入</div>
                )}
                {m.role === 'user' && m.source === 'quick' && (
                  <div className="daylog-msg-meta right">快捷回答</div>
                )}
              </div>
            </div>
          )
        )}
        {typing && (
          <div className="daylog-msg assistant">
            <div className="daylog-typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {answerCount >= minAnswers && !entry?.summary && (
        <button className="daylog-generate-btn" onClick={generate} disabled={generating || typing}>
          {generating ? '正在生成总结…' : '生成今日总结'}
        </button>
      )}
      {entry?.summary && (
        <button className="daylog-generate-btn" onClick={onShowReview}>
          查看今日总结
        </button>
      )}

      <div className="daylog-chat-dock">
        {/* CHAT-03：快捷回答 chips，始终保留自由输入 */}
        {chips.length > 0 && (
          <div className="daylog-chips">
            {chips.map((c) => (
              <button key={c} className="daylog-chip" onClick={() => void send(c, 'quick')}>
                {c}
              </button>
            ))}
          </div>
        )}

        <div className="daylog-input-area">
        <div className="daylog-composer">
          {pendingImages.length > 0 && (
            <div className="daylog-thumbs">
              {pendingImages.map((src, i) => (
                <div key={i} className="daylog-thumb">
                  <img src={src} alt="待发送图片" />
                  <button
                    className="daylog-thumb-remove"
                    title="移除图片"
                    onClick={() => setPendingImages((prev) => prev.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            className="daylog-composer-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={listening ? '正在聆听，请说话…' : '说说你的想法…'}
            rows={1}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
          />
          <div className="daylog-composer-actions">
            <button
              className="daylog-action-btn"
              onClick={() => fileInputRef.current?.click()}
              title="添加图片"
            >
              ＋ 添加
            </button>
            <div className="daylog-composer-spacer" />
            {speechSupported && (
              <button
                className={`daylog-action-btn ${listening ? 'recording' : ''}`}
                onClick={toggleVoice}
                title={listening ? '停止语音输入' : '语音输入'}
              >
                {listening ? '⏹ 停止' : '🎙 语音'}
              </button>
            )}
            <button
              className="daylog-action-btn primary"
              onClick={() => void send()}
              disabled={!canSend}
              title="发送"
            >
              ➤ 发送
            </button>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => void handlePickImages(e.target.files)}
        />
        {!speechSupported && (
          <div className="daylog-voice-hint">当前浏览器不支持语音输入，请使用键盘输入</div>
        )}
        {offlineHint && (
          <div className="daylog-local-hint">AI 代理未连接，当前使用本地预设问题</div>
        )}
        {!offlineHint && backendLabel && (
          <div className="daylog-local-hint">由 {backendLabel} 驱动</div>
        )}
        </div>
      </div>
    </div>
  )
}
