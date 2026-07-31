/**
 * Personal Ops · Qoder CLI 用量采集
 * Qoder 把每次模型调用写入 ~/.qoder/logs/sessions/ 下 segments/*.jsonl
 * （type=model.response.completed / turn.finished），会话正文在 ~/.qoder/projects/ 下 *.jsonl。
 * 不是 tokscale 客户端，故由本模块独立产出，再在 token-agent 内并入整体快照。
 * 不读取 .auth / 凭证文件。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const QODER_CLIENT_ID = 'qoder'
export const QODER_HOME = path.join(os.homedir(), '.qoder')
export const QODER_LOGS = path.join(QODER_HOME, 'logs', 'sessions')
export const QODER_PROJECTS = path.join(QODER_HOME, 'projects')

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

/** 是否已安装 / 有本地数据 */
export function isQoderInstalled() {
  const bins = [
    path.join(os.homedir(), '.local', 'bin', 'qodercli'),
    path.join(QODER_HOME, 'bin', 'qodercli'),
  ]
  for (const p of bins) {
    try {
      if (fs.existsSync(p)) return true
    } catch {
      /* continue */
    }
  }
  return fs.existsSync(QODER_HOME)
}

/** 当前默认模型：~/.qoder/.models/default，或最近一次 runtime-config */
export function readQoderActiveModel() {
  const def = readJsonSafe(path.join(QODER_HOME, '.models', 'default'))
  if (def?.key) {
    return { raw: String(def.key), modelID: String(def.key), providerID: 'qoder' }
  }
  // 回退：扫最近的 runtime-config（带非空 model）
  const files = walkFiles(QODER_PROJECTS, (_f, name) => name.endsWith('.jsonl'))
  let best = null
  let bestTs = 0
  for (const file of files) {
    let lines
    try {
      lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    } catch {
      continue
    }
    for (const line of lines) {
      if (!line || !line.includes('runtime-config')) continue
      try {
        const o = JSON.parse(line)
        if (o?.type !== 'runtime-config' || !o.model) continue
        const ts = Number(o.timestamp || 0)
        if (ts >= bestTs) {
          bestTs = ts
          best = String(o.model)
        }
      } catch {
        /* continue */
      }
    }
  }
  if (!best) return null
  return { raw: best, modelID: best, providerID: 'qoder' }
}

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

function finalizePeriod(p) {
  p.totalCostUsd = Math.round(p.totalCostUsd * 1e6) / 1e6
  return p
}

function parseTs(raw) {
  if (!raw) return 0
  if (typeof raw === 'number') {
    // 秒 / 毫秒
    return raw < 1e12 ? raw * 1000 : raw
  }
  const t = Date.parse(String(raw))
  return Number.isFinite(t) ? t : 0
}

function dayKey(ts) {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addUsage(period, { input, output, cacheRead, cacheWrite, modelId, sessionId, activeMs }) {
  const tokens = input + output + cacheRead + cacheWrite
  period.inputTokens += input
  period.outputTokens += output
  period.cacheReadTokens += cacheRead
  period.totalTokens += tokens
  period.clients[QODER_CLIENT_ID] = (period.clients[QODER_CLIENT_ID] || 0) + tokens
  period.clientCosts[QODER_CLIENT_ID] = period.clientCosts[QODER_CLIENT_ID] || 0
  period.clientCacheRead[QODER_CLIENT_ID] =
    (period.clientCacheRead[QODER_CLIENT_ID] || 0) + cacheRead
  if (sessionId) {
    // 会话数在外层按 Set 汇总后再写入，这里先不累加
  }
  if (activeMs > 0) {
    period.clientActiveMs[QODER_CLIENT_ID] =
      (period.clientActiveMs[QODER_CLIENT_ID] || 0) + activeMs
  }
  if (modelId) {
    period.models[modelId] = (period.models[modelId] || 0) + tokens
    period.modelCosts[modelId] = period.modelCosts[modelId] || 0
    period.modelClients[modelId] = QODER_CLIENT_ID
    period.modelInput[modelId] = (period.modelInput[modelId] || 0) + input
    period.modelOutput[modelId] = (period.modelOutput[modelId] || 0) + output
    period.modelCacheRead[modelId] = (period.modelCacheRead[modelId] || 0) + cacheRead
  }
}

/**
 * 从 segment 日志抽出用量事件。
 * 优先 model.response.completed（单次请求）；turn.finished 仅补 duration。
 */
function collectUsageEvents(sinceMs) {
  const files = walkFiles(QODER_LOGS, (_f, name) => name.endsWith('.jsonl'))
  /** @type {Map<string, {ts:number,sessionId:string,model:string,input:number,output:number,cacheRead:number,cacheWrite:number,activeMs:number,requestId?:string}>} */
  const byRequest = new Map()
  /** turn_id → duration_ms */
  const turnDur = new Map()

  for (const file of files) {
    // .../logs/sessions/<project>/<sessionId>/segments/<run>.jsonl
    const parts = file.split(path.sep)
    const segIdx = parts.lastIndexOf('segments')
    const sessionId = segIdx > 0 ? parts[segIdx - 1] : ''
    let lines
    try {
      lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    } catch {
      continue
    }
    for (const line of lines) {
      if (!line) continue
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
      if (type === 'turn.finished') {
        const turnId = o.turn_id || ''
        const dur = Number(data.duration_ms || 0)
        if (turnId && dur > 0) turnDur.set(turnId, dur)
        // 若没有对应 request completed，用 turn 级 token 兜底
        const reqKey = o.request_id || turnId || `${sessionId}:${ts}`
        if (!byRequest.has(reqKey)) {
          byRequest.set(reqKey, {
            ts,
            sessionId,
            model: String(data.model || 'auto'),
            input: Number(data.input_tokens || 0),
            output: Number(data.output_tokens || 0),
            cacheRead: Number(data.cache_read_input_tokens || 0),
            cacheWrite: Number(data.cache_creation_input_tokens || 0),
            activeMs: dur > 0 ? dur : 0,
            requestId: o.request_id,
            turnId,
          })
        } else {
          const row = byRequest.get(reqKey)
          if (dur > 0 && !(row.activeMs > 0)) row.activeMs = dur
        }
        continue
      }
      if (type !== 'model.response.completed') continue
      const reqKey = o.request_id || o.loop_id || `${sessionId}:${o.seq || ts}`
      byRequest.set(reqKey, {
        ts,
        sessionId,
        model: String(data.model || 'auto'),
        input: Number(data.input_tokens || 0),
        output: Number(data.output_tokens || 0),
        cacheRead: Number(data.cache_read_input_tokens || 0),
        cacheWrite: Number(data.cache_creation_input_tokens || 0),
        activeMs: turnDur.get(o.turn_id) || 0,
        requestId: o.request_id,
        turnId: o.turn_id,
      })
    }
  }

  // 补 duration（completed 先于 finished 出现时）
  for (const row of byRequest.values()) {
    if (!(row.activeMs > 0) && row.turnId && turnDur.has(row.turnId)) {
      row.activeMs = turnDur.get(row.turnId)
    }
  }
  return [...byRequest.values()]
}

/** 本机会话 / 用户提问次数（按 session 文件） */
export function collectQoderSessionRanges() {
  const ranges = {
    today: { sessions: 0, messages: 0 },
    week: { sessions: 0, messages: 0 },
    month: { sessions: 0, messages: 0 },
  }
  const now = Date.now()
  const startToday = new Date()
  startToday.setHours(0, 0, 0, 0)
  const bounds = {
    today: startToday.getTime(),
    week: now - 7 * 86400000,
    month: now - 30 * 86400000,
  }

  const files = walkFiles(QODER_PROJECTS, (_f, name) => name.endsWith('.jsonl'))
  for (const file of files) {
    let lines
    try {
      lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    } catch {
      continue
    }
    let sessionTs = 0
    let userMsgs = 0
    for (const line of lines) {
      if (!line) continue
      let o
      try {
        o = JSON.parse(line)
      } catch {
        continue
      }
      const ts = parseTs(o.timestamp)
      if (ts > sessionTs) sessionTs = ts
      if (o.type === 'user' && !o.isMeta) {
        userMsgs += 1
        if (ts > sessionTs) sessionTs = ts
      }
    }
    if (!sessionTs) {
      try {
        sessionTs = fs.statSync(file).mtimeMs
      } catch {
        continue
      }
    }
    for (const key of ['today', 'week', 'month']) {
      if (sessionTs >= bounds[key]) {
        ranges[key].sessions += 1
        ranges[key].messages += userMsgs
      }
    }
  }
  return ranges
}

/**
 * 采集 Qoder 用量。
 * @returns {{ installed, today, week, month, history, activeMs, sessionRanges }}
 */
export function collectQoder() {
  if (!isQoderInstalled()) {
    return {
      installed: false,
      today: null,
      week: null,
      month: null,
      history: [],
      activeMs: { today: 0, week: 0, month: 0 },
      sessionRanges: null,
    }
  }

  const now = Date.now()
  const startToday = new Date()
  startToday.setHours(0, 0, 0, 0)
  const todayMs = startToday.getTime()
  const weekMs = now - 7 * 86400000
  const monthMs = now - 30 * 86400000

  const events = collectUsageEvents(monthMs - 86400000)
  const today = emptyPeriod()
  const week = emptyPeriod()
  const month = emptyPeriod()
  const dayMap = new Map()
  const sessionSets = { today: new Set(), week: new Set(), month: new Set() }

  for (const e of events) {
    const row = {
      input: e.input,
      output: e.output,
      cacheRead: e.cacheRead,
      cacheWrite: e.cacheWrite,
      modelId: e.model || 'auto',
      sessionId: e.sessionId,
      activeMs: e.activeMs || 0,
    }
    if (e.ts >= todayMs) {
      addUsage(today, row)
      if (e.sessionId) sessionSets.today.add(e.sessionId)
    }
    if (e.ts >= weekMs) {
      addUsage(week, row)
      if (e.sessionId) sessionSets.week.add(e.sessionId)
    }
    if (e.ts >= monthMs) {
      addUsage(month, row)
      if (e.sessionId) sessionSets.month.add(e.sessionId)
      const day = dayKey(e.ts)
      let b = dayMap.get(day)
      if (!b) {
        b = emptyPeriod()
        dayMap.set(day, b)
      }
      addUsage(b, row)
    }
  }

  const sessionRanges = collectQoderSessionRanges()
  for (const [range, period] of [
    ['today', today],
    ['week', week],
    ['month', month],
  ]) {
    const sess =
      sessionRanges[range]?.sessions || sessionSets[range].size || 0
    const msgs = sessionRanges[range]?.messages || 0
    period.clientSessions[QODER_CLIENT_ID] = sess
    period.clientMessages[QODER_CLIENT_ID] = msgs
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
      messages: 0,
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
    today,
    week,
    month,
    history,
    activeMs: {
      today: today.clientActiveMs[QODER_CLIENT_ID] || 0,
      week: week.clientActiveMs[QODER_CLIENT_ID] || 0,
      month: month.clientActiveMs[QODER_CLIENT_ID] || 0,
    },
    sessionRanges,
  }
}
