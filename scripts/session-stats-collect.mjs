/**
 * 本机会话 / 提问次数采集
 * - 会话数：唯一 session 数量
 * - 提问次数：各 session 内真正的用户 prompt 之和（role=user / turn.prompt 等）
 *
 * tokscale 的 sessionId（尤其 Cursor）常是「单次用量事件」而非对话会话；
 * messageCount 也常含 tool_result / 环境上下文，故以本地会话文件为准。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  collectQoderSessionRanges,
  QODER_CLIENT_ID,
} from './qoder-collect.mjs'

function emptyBucket() {
  return { sessions: 0, messages: 0 }
}

function emptyRanges() {
  return {
    today: emptyBucket(),
    week: emptyBucket(),
    month: emptyBucket(),
  }
}

function dayBounds() {
  const now = Date.now()
  const startToday = new Date()
  startToday.setHours(0, 0, 0, 0)
  return {
    today: startToday.getTime(),
    week: now - 7 * 86400000,
    month: now - 30 * 86400000,
  }
}

function addToRanges(ranges, ts, sessionsInc, messagesInc) {
  if (!Number.isFinite(ts) || ts <= 0) return
  const b = dayBounds()
  for (const key of ['today', 'week', 'month']) {
    if (ts >= b[key]) {
      ranges[key].sessions += sessionsInc
      ranges[key].messages += messagesInc
    }
  }
}

function safeReadLines(file) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
  } catch {
    return []
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

/** Cursor：~/.cursor/projects/.../agent-transcripts/{sessionId}/{sessionId}.jsonl */
function collectCursor() {
  const ranges = emptyRanges()
  const root = path.join(os.homedir(), '.cursor', 'projects')
  if (!fs.existsSync(root)) return ranges

  let projects
  try {
    projects = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())
  } catch {
    return ranges
  }

  for (const proj of projects) {
    const transcripts = path.join(root, proj.name, 'agent-transcripts')
    if (!fs.existsSync(transcripts)) continue
    let sessions
    try {
      sessions = fs.readdirSync(transcripts, { withFileTypes: true }).filter((d) => d.isDirectory())
    } catch {
      continue
    }
    for (const sess of sessions) {
      const sid = sess.name
      const file = path.join(transcripts, sid, `${sid}.jsonl`)
      if (!fs.existsSync(file)) continue
      let prompts = 0
      let latestTs = 0
      for (const line of safeReadLines(file)) {
        let o
        try {
          o = JSON.parse(line)
        } catch {
          continue
        }
        if (o.role !== 'user') continue
        const content = o.message?.content
        let text = ''
        if (typeof content === 'string') text = content
        else if (Array.isArray(content)) {
          for (const c of content) {
            if (c && typeof c === 'object' && typeof c.text === 'string') text += c.text
          }
        }
        // 优先计 user_query；无标记时仍计有正文的 user 消息
        if (text.includes('<user_query>') || text.trim()) {
          prompts += 1
        }
        const raw = o.timestamp || o.ts
        let tsLine = 0
        if (typeof raw === 'string') tsLine = Date.parse(raw)
        else if (typeof raw === 'number') tsLine = raw < 1e12 ? raw * 1000 : raw
        if (tsLine > latestTs) latestTs = tsLine
      }
      if (prompts <= 0) continue
      let ts = latestTs
      if (!ts) {
        try {
          ts = fs.statSync(file).mtimeMs
        } catch {
          continue
        }
      }
      addToRanges(ranges, ts, 1, prompts)
    }
  }
  return ranges
}

/** Claude Code：~/.claude/projects 下各 {sessionId}.jsonl；排除 tool_result-only */
function collectClaude() {
  const ranges = emptyRanges()
  const root = path.join(os.homedir(), '.claude', 'projects')
  const files = walkFiles(root, (_full, name) => name.endsWith('.jsonl'))
  for (const file of files) {
    let prompts = 0
    let latestTs = 0
    for (const line of safeReadLines(file)) {
      let o
      try {
        o = JSON.parse(line)
      } catch {
        continue
      }
      const raw = o.timestamp || o.ts
      let nts = 0
      if (typeof raw === 'string') nts = Date.parse(raw)
      else if (typeof raw === 'number') nts = raw < 1e12 ? raw * 1000 : raw
      if (nts > latestTs) latestTs = nts
      if (o.type !== 'user') continue
      const content = o.message?.content
      if (Array.isArray(content) && content.length > 0) {
        const onlyTool = content.every(
          (c) => c && typeof c === 'object' && c.type === 'tool_result'
        )
        if (onlyTool) continue
      }
      if (content == null || content === '') continue
      if (Array.isArray(content) && content.length === 0) continue
      prompts += 1
    }
    if (prompts <= 0) continue
    let ts = latestTs
    if (!ts) {
      try {
        ts = fs.statSync(file).mtimeMs
      } catch {
        continue
      }
    }
    addToRanges(ranges, ts, 1, prompts)
  }
  return ranges
}

function isCodexEnvOnly(content) {
  if (!Array.isArray(content) || content.length === 0) return true
  const text = content
    .map((c) => (c && typeof c === 'object' ? c.text || '' : ''))
    .join('')
  const t = text.trim()
  if (!t) return true
  return /^<environment_context>[\s\S]*<\/environment_context>\s*$/.test(t)
}

/** Codex：~/.codex/sessions 下 rollout-*.jsonl */
function collectCodex() {
  const ranges = emptyRanges()
  const root = path.join(os.homedir(), '.codex', 'sessions')
  const files = walkFiles(root, (_f, name) => name.endsWith('.jsonl'))
  for (const file of files) {
    let prompts = 0
    let latestTs = 0
    for (const line of safeReadLines(file)) {
      let o
      try {
        o = JSON.parse(line)
      } catch {
        continue
      }
      const tsRaw = o.timestamp
      let ts = 0
      if (typeof tsRaw === 'string') ts = Date.parse(tsRaw)
      else if (typeof tsRaw === 'number') ts = tsRaw < 1e12 ? tsRaw * 1000 : tsRaw
      if (ts > latestTs) latestTs = ts
      if (o.type !== 'response_item') continue
      const pl = o.payload || {}
      if (pl.type !== 'message' || pl.role !== 'user') continue
      if (isCodexEnvOnly(pl.content)) continue
      prompts += 1
    }
    if (prompts <= 0) continue
    let ts = latestTs
    if (!ts) {
      try {
        ts = fs.statSync(file).mtimeMs
      } catch {
        continue
      }
    }
    addToRanges(ranges, ts, 1, prompts)
  }
  return ranges
}

/** Kimi Code：各 session 目录下 agents/main/wire.jsonl 的 turn.prompt */
function collectKimi() {
  const ranges = emptyRanges()
  const roots = [
    path.join(os.homedir(), '.kimi-code', 'sessions'),
    path.join(os.homedir(), '.kimi', 'sessions'),
  ]
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    // walk session_* directories
    const stack = [root]
    while (stack.length) {
      const dir = stack.pop()
      let entries
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const ent of entries) {
        const full = path.join(dir, ent.name)
        if (!ent.isDirectory()) continue
        if (ent.name.startsWith('session_')) {
          const wire = path.join(full, 'agents', 'main', 'wire.jsonl')
          const state = path.join(full, 'state.json')
          let prompts = 0
          for (const line of safeReadLines(wire)) {
            let o
            try {
              o = JSON.parse(line)
            } catch {
              continue
            }
            if (o.type === 'turn.prompt') prompts += 1
          }
          if (prompts <= 0) continue
          let ts = 0
          try {
            if (fs.existsSync(state)) {
              const st = JSON.parse(fs.readFileSync(state, 'utf8'))
              ts = Number(st.updatedAt || st.createdAt || 0)
            }
          } catch {
            /* ignore */
          }
          if (!ts) {
            try {
              ts = fs.statSync(fs.existsSync(wire) ? wire : state).mtimeMs
            } catch {
              continue
            }
          } else if (ts < 1e12) ts *= 1000
          addToRanges(ranges, ts, 1, prompts)
        } else {
          stack.push(full)
        }
      }
    }
  }
  return ranges
}

/**
 * Cursor 的 tokscale time-metrics 恒为 0（usage 事件无 duration）。
 * 用 ~/.config/tokscale/cursor-cache/usage.csv 的事件时间戳估算活跃时长：
 * - 相邻事件间隔 ≤ 空闲阈值：计入间隔
 * - 超过阈值：仅计入一轮默认耗时（生成结束）
 */
export function collectCursorActiveMs() {
  const csvPath = path.join(
    os.homedir(),
    '.config',
    'tokscale',
    'cursor-cache',
    'usage.csv'
  )
  const empty = { today: 0, week: 0, month: 0 }
  if (!fs.existsSync(csvPath)) return empty

  let text
  try {
    text = fs.readFileSync(csvPath, 'utf8')
  } catch {
    return empty
  }

  const lines = text.split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return empty

  const header = lines[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim())
  const dateIdx = header.findIndex((h) => /^date$/i.test(h))
  if (dateIdx < 0) return empty

  const times = []
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i])
    const raw = cols[dateIdx]
    if (!raw) continue
    const t = Date.parse(raw)
    if (Number.isFinite(t)) times.push(t)
  }
  times.sort((a, b) => a - b)
  if (!times.length) return empty

  const IDLE_CAP_MS = 3 * 60 * 1000
  const MIN_TURN_MS = 30 * 1000
  const now = Date.now()
  const startToday = new Date()
  startToday.setHours(0, 0, 0, 0)
  // 与 tokscale --month 对齐：自然月月初
  const startMonth = new Date(startToday.getFullYear(), startToday.getMonth(), 1)

  const bounds = {
    today: startToday.getTime(),
    week: now - 7 * 86400000,
    month: startMonth.getTime(),
  }

  const out = { ...empty }
  for (const [range, since] of Object.entries(bounds)) {
    const ev = times.filter((t) => t >= since)
    let active = 0
    for (let i = 0; i < ev.length - 1; i++) {
      const gap = ev[i + 1] - ev[i]
      if (!(gap >= 0)) continue
      active += gap <= IDLE_CAP_MS ? gap : MIN_TURN_MS
    }
    if (ev.length > 0) active += MIN_TURN_MS
    out[range] = Math.round(active)
  }
  return out
}

/** 简易 CSV 行解析（支持引号字段） */
function parseCsvLine(line) {
  const out = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQ = false
      } else cur += ch
    } else if (ch === '"') {
      inQ = true
    } else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

/**
 * @returns {{
 *   today: Record<string,{sessions:number,messages:number}>,
 *   week: Record<string,{sessions:number,messages:number}>,
 *   month: Record<string,{sessions:number,messages:number}>,
 * }}
 */
export function collectLocalSessionStats() {
  const byTool = {
    cursor: collectCursor(),
    claude: collectClaude(),
    codex: collectCodex(),
    kimi: collectKimi(),
    [QODER_CLIENT_ID]: collectQoderSessionRanges(),
  }
  const out = { today: {}, week: {}, month: {} }
  for (const range of ['today', 'week', 'month']) {
    for (const [tool, ranges] of Object.entries(byTool)) {
      out[range][tool] = { ...ranges[range] }
    }
  }
  return out
}

/** 用本机准确统计覆盖 period 的 clientSessions / clientMessages，并按 token 占比分摊到模型 */
export function applyLocalSessionStats(period, rangeStats) {
  if (!period || !rangeStats) return
  for (const [client, stat] of Object.entries(rangeStats)) {
    if (!stat) continue
    const sessions = Number(stat.sessions || 0)
    const messages = Number(stat.messages || 0)
    period.clientSessions = period.clientSessions || {}
    period.clientMessages = period.clientMessages || {}
    period.clientSessions[client] = sessions
    period.clientMessages[client] = messages

    const clientTokens = Number(period.clients?.[client] || 0)
    const modelClients = period.modelClients || {}
    period.modelSessions = period.modelSessions || {}
    period.modelMessages = period.modelMessages || {}
    for (const [mid, tool] of Object.entries(modelClients)) {
      if (tool !== client) continue
      const share = clientTokens > 0 ? Number(period.models?.[mid] || 0) / clientTokens : 0
      period.modelSessions[mid] = Math.round(sessions * share)
      period.modelMessages[mid] = Math.round(messages * share)
    }
  }
}
