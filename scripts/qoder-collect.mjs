/**
 * Personal Ops · Qoder CLI 用量采集
 *
 * 数据来源（本机，不经 tokscale）：
 * 1. ~/.qoder/logs/sessions/.../segments/*.jsonl
 *    - model.response.completed：input/output/cache tokens + model
 *    - turn.finished：turn 时长
 *    - input.prompt.received：用户提问
 * 2. ~/.qoder/projects/.../{sessionId}.jsonl
 *    - 当日志 token 全为 0（当前 CLI 常见）时，按可见正文粗估 tokens
 *    - 补会话数 / 模型标签
 *
 * 密钥（.auth/user）绝不读取、不输出。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const QODER_CLIENT_ID = 'qoder'
export const QODER_DATA_BASE = path.join(os.homedir(), '.qoder')

function emptyPeriod() {
  return {
    totalTokens: 0,
    totalCostUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    clients: {},
    clientCosts: {},
    clientActiveMs: {},
    clientCacheRead: {},
    clientSessions: {},
    clientMessages: {},
    models: {},
    modelCosts: {},
    modelClients: {},
    modelInput: {},
    modelOutput: {},
    modelCacheRead: {},
    modelSessions: {},
    modelMessages: {},
  }
}

function readJsonSafe(file) {
  try {
    if (!fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function walkFiles(root, pred, out = []) {
  if (!root || !fs.existsSync(root)) return out
  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const ent of entries) {
    const full = path.join(root, ent.name)
    if (ent.isDirectory()) walkFiles(full, pred, out)
    else if (ent.isFile() && pred(full, ent.name)) out.push(full)
  }
  return out
}

function parseTs(raw) {
  if (raw == null) return 0
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // 秒 / 毫秒
    return raw < 1e12 ? Math.round(raw * 1000) : raw
  }
  const s = String(raw).trim()
  if (!s) return 0
  const n = Date.parse(s)
  return Number.isFinite(n) ? n : 0
}

function localDay(ts) {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function estimateTokensFromChars(chars) {
  // 中英混排粗估；略偏向保守
  const n = Math.max(0, Number(chars) || 0)
  return Math.max(0, Math.round(n / 4))
}

function contentCharCount(content) {
  if (content == null) return 0
  if (typeof content === 'string') return content.length
  if (!Array.isArray(content)) return 0
  let n = 0
  for (const b of content) {
    if (typeof b === 'string') {
      n += b.length
      continue
    }
    if (!b || typeof b !== 'object') continue
    if (typeof b.text === 'string') n += b.text.length
    if (typeof b.thinking === 'string') n += b.thinking.length
    if (typeof b.content === 'string') n += b.content.length
    else if (Array.isArray(b.content)) n += contentCharCount(b.content)
  }
  return n
}

function isHumanUserEvent(o) {
  if (!o || o.type !== 'user') return false
  if (o.isMeta) return false
  const origin = o.origin?.kind
  if (origin && origin !== 'human') return false
  const msg = o.message
  if (!msg) return false
  const content = msg.content
  if (typeof content === 'string') {
    if (/^<(command-message|local-command|command-name)/i.test(content.trim())) return false
    return content.trim().length > 0
  }
  if (Array.isArray(content)) {
    // tool_result 不算用户提问
    if (content.every((b) => b && typeof b === 'object' && b.type === 'tool_result')) return false
    return contentCharCount(content) > 0
  }
  return false
}

function addUsageToPeriod(period, row) {
  const input = Number(row.input || 0)
  const output = Number(row.output || 0)
  const cacheRead = Number(row.cacheRead || 0)
  const cacheWrite = Number(row.cacheWrite || 0)
  const tokens = input + output + cacheRead + cacheWrite
  const cost = Number(row.cost || 0)
  const modelId = row.model ? String(row.model) : null
  const sessionId = row.sessionId ? String(row.sessionId) : ''
  const userMsgs = Number(row.userMsgs || 0)
  const activeMs = Number(row.activeMs || 0)

  period.inputTokens += input
  period.outputTokens += output
  period.cacheReadTokens += cacheRead
  period.totalTokens += tokens
  period.totalCostUsd += cost
  period.clients[QODER_CLIENT_ID] = (period.clients[QODER_CLIENT_ID] || 0) + tokens
  period.clientCosts[QODER_CLIENT_ID] =
    (period.clientCosts[QODER_CLIENT_ID] || 0) + cost
  period.clientCacheRead[QODER_CLIENT_ID] =
    (period.clientCacheRead[QODER_CLIENT_ID] || 0) + cacheRead
  if (sessionId) {
    // sessions 按唯一 session 在外层汇总，这里只记 messages / activeMs
  }
  if (userMsgs > 0) {
    period.clientMessages[QODER_CLIENT_ID] =
      (period.clientMessages[QODER_CLIENT_ID] || 0) + userMsgs
  }
  if (activeMs > 0) {
    period.clientActiveMs[QODER_CLIENT_ID] =
      (period.clientActiveMs[QODER_CLIENT_ID] || 0) + activeMs
  }
  if (modelId) {
    period.models[modelId] = (period.models[modelId] || 0) + tokens
    period.modelCosts[modelId] = (period.modelCosts[modelId] || 0) + cost
    period.modelClients[modelId] = QODER_CLIENT_ID
    period.modelInput[modelId] = (period.modelInput[modelId] || 0) + input
    period.modelOutput[modelId] = (period.modelOutput[modelId] || 0) + output
    period.modelCacheRead[modelId] =
      (period.modelCacheRead[modelId] || 0) + cacheRead
    if (userMsgs > 0) {
      period.modelMessages[modelId] = (period.modelMessages[modelId] || 0) + userMsgs
    }
  }
}

function finalizePeriod(p) {
  p.totalCostUsd = Math.round(p.totalCostUsd * 1e6) / 1e6
  return p
}

/** 读取最近选用的模型（~/.qoder/.models/default） */
export function readQoderActiveModel() {
  const cfg = readJsonSafe(path.join(QODER_DATA_BASE, '.models', 'default'))
  if (!cfg) return null
  const key = cfg.key || cfg.model || cfg.uid
  if (!key) return null
  return { raw: String(key), modelID: String(key), providerID: 'qoder' }
}

export function findQoderDataDir() {
  try {
    if (fs.existsSync(QODER_DATA_BASE) && fs.statSync(QODER_DATA_BASE).isDirectory()) {
      return QODER_DATA_BASE
    }
  } catch {
    /* ignore */
  }
  return null
}

/**
 * 从 session segment 日志抽取用量事件。
 * @returns {Array<{ts, day, sessionId, model, input, output, cacheRead, cacheWrite, activeMs, userMsgs, source}>}
 */
function collectLogEvents(sinceMs) {
  const root = path.join(QODER_DATA_BASE, 'logs', 'sessions')
  const files = walkFiles(root, (_f, name) => name.endsWith('.jsonl'))
  const events = []

  for (const file of files) {
    // .../sessions/{project}/{sessionId}/segments/{stamp}.jsonl
    const parts = file.split(path.sep)
    const segIdx = parts.lastIndexOf('segments')
    const sessionId = segIdx > 0 ? parts[segIdx - 1] : ''
    let text
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      let o
      try {
        o = JSON.parse(line)
      } catch {
        continue
      }
      const ts = parseTs(o.ts)
      if (!ts || ts < sinceMs) continue
      const type = o.type
      const data = o.data || {}

      if (type === 'model.response.completed') {
        events.push({
          ts,
          day: localDay(ts),
          sessionId,
          model: data.model || 'ultimate',
          input: Number(data.input_tokens || 0),
          output: Number(data.output_tokens || 0),
          cacheRead: Number(data.cache_read_input_tokens || 0),
          cacheWrite: Number(data.cache_creation_input_tokens || 0),
          activeMs: 0,
          userMsgs: 0,
          source: 'log-response',
        })
      } else if (type === 'turn.finished') {
        events.push({
          ts,
          day: localDay(ts),
          sessionId,
          model: null,
          input: Number(data.input_tokens || 0),
          output: Number(data.output_tokens || 0),
          cacheRead: Number(data.cache_read_input_tokens || 0),
          cacheWrite: Number(data.cache_creation_input_tokens || 0),
          activeMs: Number(data.duration_ms || 0),
          userMsgs: 0,
          source: 'log-turn',
        })
      } else if (type === 'input.prompt.received') {
        events.push({
          ts,
          day: localDay(ts),
          sessionId,
          model: null,
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          activeMs: 0,
          userMsgs: 1,
          source: 'log-prompt',
        })
      }
    }
  }
  return events
}

/**
 * 当日志 token 全 0 时，从 transcript 粗估每个 session 的用量。
 * 同时给出会话数 / 提问数 / 活跃时长回退。
 */
function collectTranscriptFallback(sinceMs) {
  const root = path.join(QODER_DATA_BASE, 'projects')
  const files = walkFiles(
    root,
    (_f, name) => name.endsWith('.jsonl') && !name.includes('segments')
  )
  const bySession = new Map()

  for (const file of files) {
    const sessionId = path.basename(file, '.jsonl')
    let text
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    let inputChars = 0
    let outputChars = 0
    let userMsgs = 0
    let model = null
    let firstTs = 0
    let lastTs = 0

    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      let o
      try {
        o = JSON.parse(line)
      } catch {
        continue
      }
      const ts = parseTs(o.timestamp)
      if (!ts) continue
      if (!firstTs || ts < firstTs) firstTs = ts
      if (ts > lastTs) lastTs = ts

      if (o.type === 'assistant') {
        const msg = o.message || {}
        if (msg.model) model = String(msg.model)
        outputChars += contentCharCount(msg.content)
      } else if (isHumanUserEvent(o)) {
        userMsgs += 1
        inputChars += contentCharCount(o.message?.content)
      } else if (o.type === 'user') {
        // tool_result 计入上下文输入估算
        const content = o.message?.content
        if (Array.isArray(content) && content.some((b) => b?.type === 'tool_result')) {
          inputChars += contentCharCount(content)
        }
      }
    }

    // 以最后活动时间判断是否落入窗口；无时间戳则跳过
    if (!lastTs || lastTs < sinceMs) continue
    bySession.set(sessionId, {
      sessionId,
      ts: lastTs,
      day: localDay(lastTs),
      model: model || 'ultimate',
      input: estimateTokensFromChars(inputChars),
      output: estimateTokensFromChars(outputChars),
      cacheRead: 0,
      cacheWrite: 0,
      activeMs: firstTs && lastTs > firstTs ? lastTs - firstTs : 0,
      userMsgs,
      source: 'transcript-estimate',
    })
  }
  return [...bySession.values()]
}

/**
 * 采集 Qoder CLI 用量。
 * @returns {{ installed, dataDir, today, week, month, history, activeMs, estimated }}
 */
export function collectQoder() {
  const dataDir = findQoderDataDir()
  if (!dataDir) {
    return {
      installed: false,
      dataDir: null,
      today: null,
      week: null,
      month: null,
      history: [],
      activeMs: { today: 0, week: 0, month: 0 },
      estimated: false,
    }
  }

  const now = Date.now()
  const startToday = new Date()
  startToday.setHours(0, 0, 0, 0)
  const todayMs = startToday.getTime()
  const weekMs = now - 7 * 86400000
  const monthMs = now - 30 * 86400000
  const sinceMs = monthMs - 86400000

  const logEvents = collectLogEvents(sinceMs)
  const logTokenSum = logEvents.reduce(
    (s, e) => s + Number(e.input || 0) + Number(e.output || 0) + Number(e.cacheRead || 0) + Number(e.cacheWrite || 0),
    0
  )

  // 官方日志 token 有值 → 用日志；否则用 transcript 粗估（当前 CLI 常见全 0）
  const useEstimate = logTokenSum <= 0
  const transcriptRows = useEstimate ? collectTranscriptFallback(sinceMs) : []

  // 会话集合：优先日志 sessionId，否则 transcript
  const sessionMeta = new Map()
  for (const e of logEvents) {
    if (!e.sessionId) continue
    const prev = sessionMeta.get(e.sessionId) || { ts: 0, day: null, model: null, userMsgs: 0, activeMs: 0 }
    if (e.ts > prev.ts) {
      prev.ts = e.ts
      prev.day = e.day
    }
    if (e.model) prev.model = e.model
    prev.userMsgs += Number(e.userMsgs || 0)
    prev.activeMs += Number(e.activeMs || 0)
    sessionMeta.set(e.sessionId, prev)
  }
  for (const r of transcriptRows) {
    const prev = sessionMeta.get(r.sessionId) || { ts: 0, day: null, model: null, userMsgs: 0, activeMs: 0 }
    if (r.ts > prev.ts) {
      prev.ts = r.ts
      prev.day = r.day
    }
    if (r.model && !prev.model) prev.model = r.model
    if (!prev.userMsgs && r.userMsgs) prev.userMsgs = r.userMsgs
    if (!prev.activeMs && r.activeMs) prev.activeMs = r.activeMs
    sessionMeta.set(r.sessionId, prev)
  }

  const today = emptyPeriod()
  const week = emptyPeriod()
  const month = emptyPeriod()
  const dayMap = new Map()
  const sessionSeen = { today: new Set(), week: new Set(), month: new Set() }

  const bumpSession = (periodKey, sessionId, model) => {
    if (!sessionId || sessionSeen[periodKey].has(sessionId)) return
    sessionSeen[periodKey].add(sessionId)
    const period = periodKey === 'today' ? today : periodKey === 'week' ? week : month
    period.clientSessions[QODER_CLIENT_ID] =
      (period.clientSessions[QODER_CLIENT_ID] || 0) + 1
    if (model) {
      period.modelSessions[model] = (period.modelSessions[model] || 0) + 1
      period.modelClients[model] = QODER_CLIENT_ID
    }
  }

  // Token / 时长 / 提问：日志路径
  if (!useEstimate) {
    for (const e of logEvents) {
      // turn.finished 的 token 与 response.completed 可能重复；token 只计 response
      const row =
        e.source === 'log-turn'
          ? { ...e, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
          : e
      if (e.ts >= todayMs) {
        addUsageToPeriod(today, row)
        bumpSession('today', e.sessionId, e.model || sessionMeta.get(e.sessionId)?.model)
      }
      if (e.ts >= weekMs) {
        addUsageToPeriod(week, row)
        bumpSession('week', e.sessionId, e.model || sessionMeta.get(e.sessionId)?.model)
      }
      if (e.ts >= monthMs) {
        addUsageToPeriod(month, row)
        bumpSession('month', e.sessionId, e.model || sessionMeta.get(e.sessionId)?.model)
        if (e.day) {
          let b = dayMap.get(e.day)
          if (!b) {
            b = emptyPeriod()
            dayMap.set(e.day, b)
          }
          addUsageToPeriod(b, row)
        }
      }
    }
  } else {
    for (const r of transcriptRows) {
      if (r.ts >= todayMs) {
        addUsageToPeriod(today, r)
        bumpSession('today', r.sessionId, r.model)
      }
      if (r.ts >= weekMs) {
        addUsageToPeriod(week, r)
        bumpSession('week', r.sessionId, r.model)
      }
      if (r.ts >= monthMs) {
        addUsageToPeriod(month, r)
        bumpSession('month', r.sessionId, r.model)
        if (r.day) {
          let b = dayMap.get(r.day)
          if (!b) {
            b = emptyPeriod()
            dayMap.set(r.day, b)
          }
          addUsageToPeriod(b, r)
        }
      }
    }
  }

  finalizePeriod(today)
  finalizePeriod(week)
  finalizePeriod(month)

  const history = []
  for (const [date, p] of dayMap) {
    finalizePeriod(p)
    history.push({
      date,
      totalTokens: p.totalTokens,
      totalCostUsd: p.totalCostUsd,
      messages: p.clientMessages[QODER_CLIENT_ID] || 0,
      activeTimeMs: p.clientActiveMs[QODER_CLIENT_ID] || 0,
      clients: p.clients,
      clientCosts: p.clientCosts,
      models: p.models,
      modelCosts: p.modelCosts,
      modelClients: p.modelClients,
    })
  }
  history.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  return {
    installed: true,
    dataDir,
    today,
    week,
    month,
    history,
    activeMs: {
      today: today.clientActiveMs[QODER_CLIENT_ID] || 0,
      week: week.clientActiveMs[QODER_CLIENT_ID] || 0,
      month: month.clientActiveMs[QODER_CLIENT_ID] || 0,
    },
    estimated: useEstimate,
  }
}
