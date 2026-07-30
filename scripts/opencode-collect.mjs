/**
 * Personal Ops · OpenCode 用量采集
 * OpenCode 把每次会话的 token 计数写入本地 SQLite（~/.local/share/opencode/opencode.db），
 * 这里直接读 DB 聚合今日 / 近 7 天 / 近 30 天 / 按日 history，与 tokscale 的 period 对齐。
 *
 * OpenCode 不是 tokscale 客户端，故由本模块独立产出，再在 token-agent 内并入整体快照。
 * 密钥文件（auth.json）绝不读取、不输出。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

/** OpenCode 可能放置 DB 的位置（XDG / macOS / Windows）。 */
const DB_CANDIDATES = [
  path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db'),
  path.join(os.homedir(), '.local', 'state', 'opencode', 'opencode.db'),
  path.join(os.homedir(), 'Library', 'Application Support', 'opencode', 'opencode.db'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'opencode', 'opencode.db'),
]

export const OPENCODE_CLIENT_ID = 'opencode'
export const OPENCODE_DB_BASE = path.join(os.homedir(), '.local', 'share', 'opencode')

/** 找到可读取的 OpenCode 数据库 */
export function findOpenCodeDb() {
  for (const p of DB_CANDIDATES) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
    } catch {
      /* continue */
    }
  }
  return null
}

function readJsonSafe(file) {
  try {
    if (!fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** OpenCode 在 ~/.local/state/opencode/model.json 维护最近使用的模型 */
export function readOpenCodeActiveModel() {
  const cfg = readJsonSafe(
    path.join(os.homedir(), '.local', 'state', 'opencode', 'model.json')
  )
  const recent = cfg?.recent?.[0]
  if (!recent?.modelID) return null
  const raw = recent.providerID
    ? `${recent.providerID}/${recent.modelID}`
    : String(recent.modelID)
  return { raw, modelID: String(recent.modelID), providerID: recent.providerID || null }
}

/** 解析 session.model 字段（JSON 字符串 / 纯 id）→ 简短模型 id */
function parseModelId(raw) {
  if (!raw) return null
  const s = typeof raw === 'string' ? raw : String(raw)
  try {
    const o = JSON.parse(s)
    if (o && typeof o.id === 'string') return o.id
  } catch {
    /* not json */
  }
  const t = s.trim()
  return t || null
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

function addRowToPeriod(period, row) {
  const input = Number(row.input || 0)
  const output = Number(row.output || 0)
  const reasoning = Number(row.reasoning || 0)
  const cacheRead = Number(row.cache_read || 0)
  const cacheWrite = Number(row.cache_write || 0)
  // 与 token-agent 的 entryBillableTokens 保持一致（非 cursor 都计 cache）
  const tokens = input + output + reasoning + cacheRead + cacheWrite
  const cost = Number(row.cost || 0)
  const modelId = parseModelId(row.model_raw)
  const sessionId = row.session_id ? String(row.session_id) : ''
  const userMsgs = Number(row.user_msgs || 0)

  period.inputTokens += input
  period.outputTokens += output
  period.cacheReadTokens += cacheRead
  period.totalTokens += tokens
  period.totalCostUsd += cost
  period.clients[OPENCODE_CLIENT_ID] =
    (period.clients[OPENCODE_CLIENT_ID] || 0) + tokens
  period.clientCosts[OPENCODE_CLIENT_ID] =
    (period.clientCosts[OPENCODE_CLIENT_ID] || 0) + cost
  period.clientCacheRead[OPENCODE_CLIENT_ID] =
    (period.clientCacheRead[OPENCODE_CLIENT_ID] || 0) + cacheRead
  if (sessionId) {
    period.clientSessions[OPENCODE_CLIENT_ID] =
      (period.clientSessions[OPENCODE_CLIENT_ID] || 0) + 1
  }
  if (userMsgs > 0) {
    period.clientMessages[OPENCODE_CLIENT_ID] =
      (period.clientMessages[OPENCODE_CLIENT_ID] || 0) + userMsgs
  }
  const activeMs = Number(row.active_ms || 0)
  if (activeMs > 0) {
    period.clientActiveMs[OPENCODE_CLIENT_ID] =
      (period.clientActiveMs[OPENCODE_CLIENT_ID] || 0) + activeMs
  }
  if (modelId) {
    period.models[modelId] = (period.models[modelId] || 0) + tokens
    period.modelCosts[modelId] = (period.modelCosts[modelId] || 0) + cost
    period.modelClients[modelId] = OPENCODE_CLIENT_ID
    period.modelInput[modelId] = (period.modelInput[modelId] || 0) + input
    period.modelOutput[modelId] =
      (period.modelOutput[modelId] || 0) + output + reasoning
    period.modelCacheRead[modelId] =
      (period.modelCacheRead[modelId] || 0) + cacheRead
    if (sessionId) {
      period.modelSessions[modelId] = (period.modelSessions[modelId] || 0) + 1
    }
    if (userMsgs > 0) {
      period.modelMessages[modelId] = (period.modelMessages[modelId] || 0) + userMsgs
    }
  }
}

function finalizePeriod(p) {
  p.totalCostUsd = Math.round(p.totalCostUsd * 1e6) / 1e6
  return p
}

function execSqlite(dbPath, sql) {
  // 以只读 URI 模式打开，避免锁住正在写入的 OpenCode
  return execFileSync('sqlite3', ['-readonly', '-json', `file:${dbPath}?mode=ro`, sql], {
    encoding: 'utf8',
    timeout: 8000,
  })
}

/** 取最近 untilMs 之前的全部会话行（含原始时间戳用于二次分桶） */
function queryRows(dbPath, sinceMs) {
  const since = Math.floor(sinceMs)
  const sql = `
    SELECT
      s.id                  AS session_id,
      s.time_updated        AS ts,
      strftime('%Y-%m-%d', s.time_updated/1000, 'unixepoch', 'localtime') AS day,
      s.model               AS model_raw,
      s.agent,
      s.tokens_input        AS input,
      s.tokens_output       AS output,
      s.tokens_reasoning    AS reasoning,
      s.tokens_cache_read   AS cache_read,
      s.tokens_cache_write  AS cache_write,
      s.cost,
      (s.time_updated - s.time_created) AS active_ms,
      (
        SELECT COUNT(*)
        FROM message m
        WHERE m.session_id = s.id
          AND json_extract(m.data, '$.role') = 'user'
      ) AS user_msgs
    FROM session s
    WHERE s.time_updated >= ${since}
      AND s.time_archived IS NULL
    ORDER BY s.time_updated ASC
  `
  let raw
  try {
    raw = execSqlite(dbPath, sql)
  } catch {
    raw = ''
  }
  const t = String(raw || '').trim()
  if (!t) return []
  // sqlite3 -json 在空命中时输出空字符串
  try {
    const rows = JSON.parse(t)
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}

/**
 * 采集 OpenCode 用量。
 * @returns { installed, dbPath, today, week, month, history, activeMs }
 *   各 period 与 token-agent.emptyPeriod() 形态一致（clients/models 等字段已填）
 */
export function collectOpenCode() {
  const dbPath = findOpenCodeDb()
  if (!dbPath) {
    return {
      installed: false,
      dbPath: null,
      today: null,
      week: null,
      month: null,
      history: [],
      activeMs: { today: 0, week: 0, month: 0 },
    }
  }

  const now = Date.now()
  const startToday = new Date()
  startToday.setHours(0, 0, 0, 0)
  const todayMs = startToday.getTime()
  const weekMs = now - 7 * 86400000
  const monthMs = now - 30 * 86400000
  // 多取 1 天缓冲，避免夏令时 / 时区让月首日裁切错位
  const rows = queryRows(dbPath, monthMs - 86400000)

  const today = emptyPeriod()
  const week = emptyPeriod()
  const month = emptyPeriod()
  const dayMap = new Map()

  for (const r of rows) {
    const ts = Number(r.ts || 0)
    if (!ts) continue
    if (ts >= todayMs) addRowToPeriod(today, r)
    if (ts >= weekMs) addRowToPeriod(week, r)
    if (ts >= monthMs) {
      addRowToPeriod(month, r)
      const day = r.day
      if (day && ts >= monthMs) {
        let b = dayMap.get(day)
        if (!b) {
          b = emptyPeriod()
          dayMap.set(day, b)
        }
        addRowToPeriod(b, r)
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
      messages: 0,
      activeTimeMs: p.clientActiveMs[OPENCODE_CLIENT_ID] || 0,
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
    dbPath,
    today,
    week,
    month,
    history,
    activeMs: {
      today: today.clientActiveMs[OPENCODE_CLIENT_ID] || 0,
      week: week.clientActiveMs[OPENCODE_CLIENT_ID] || 0,
      month: month.clientActiveMs[OPENCODE_CLIENT_ID] || 0,
    },
  }
}