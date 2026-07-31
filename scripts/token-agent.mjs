/**
 * Personal Ops · 本机 Token 监测代理
 * 参考：https://github.com/Javis603/token-monitor（tokscale 采集 + 本地 Hub）
 *
 * 用法：
 *   npm run agent          # 常驻 http://127.0.0.1:3847
 *   npm run agent:once     # 打印一次快照 JSON 后退出
 */
import http from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectLeaderboard } from './leaderboard-collect.mjs'
import { fetchOfficialBilling } from './billing-fetch.mjs'
import {
  collectOpenCode,
  findOpenCodeDb,
  readOpenCodeActiveModel,
  OPENCODE_CLIENT_ID,
  OPENCODE_DB_BASE,
} from './opencode-collect.mjs'
import {
  collectQoder,
  isQoderInstalled,
  readQoderActiveModel,
  QODER_CLIENT_ID,
  QODER_HOME,
} from './qoder-collect.mjs'
import {
  collectLocalSessionStats,
  applyLocalSessionStats,
  collectCursorActiveMs,
} from './session-stats-collect.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')
const TOKSCALE_ENTRY = path.join(PROJECT_ROOT, 'node_modules', 'tokscale', 'bin.js')
const PORT = Number(process.env.TOKEN_AGENT_PORT || 3847)
const HOST = process.env.TOKEN_AGENT_HOST || '127.0.0.1'
const CACHE_MS = Number(process.env.TOKEN_AGENT_CACHE_MS || 60_000)
const CLIENTS = ['claude', 'codex', 'kimi', 'cursor']
// OpenCode / Qoder 走本地文件，不经 tokscale；单独在 collectSnapshot 内并入快照
const NON_TOKSCALE_TOOLS = [OPENCODE_CLIENT_ID, QODER_CLIENT_ID]
const TOOL_BIN_DIRS = [
  path.join(os.homedir(), '.local', 'bin'),
  path.join(os.homedir(), '.kimi-code', 'bin'),
  path.join(os.homedir(), '.opencode', 'bin'),
  path.join(os.homedir(), '.qoder', 'bin'),
]

const TOOL_DEFS = [
  {
    id: 'claude',
    name: 'Claude Code',
    binaries: ['claude'],
    dataPaths: ['.claude/projects', '.claude'],
    tokscaleClient: 'claude',
    launch: { kind: 'cli', command: 'claude' },
  },
  {
    id: 'codex',
    name: 'ChatGPT',
    binaries: ['codex'],
    dataPaths: ['.codex/sessions', '.codex'],
    tokscaleClient: 'codex',
    launch: { kind: 'cli', command: 'codex' },
  },
  {
    id: 'kimi',
    name: 'Kimi Code',
    binaries: ['kimi', 'kimi-code'],
    dataPaths: ['.kimi/sessions', '.kimi-code/sessions', '.kimi', '.kimi-code'],
    tokscaleClient: 'kimi',
    launch: { kind: 'cli', command: 'kimi' },
  },
  {
    id: 'cursor',
    name: 'Cursor',
    binaries: ['cursor', 'cursor-agent', 'agent'],
    dataPaths: [
      '.config/tokscale/cursor-cache',
      'Library/Application Support/Cursor',
      '.cursor',
    ],
    appPaths: ['/Applications/Cursor.app'],
    tokscaleClient: 'cursor',
    launch: { kind: 'gui', app: 'Cursor', appPath: '/Applications/Cursor.app' },
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    binaries: ['opencode'],
    dataPaths: [OPENCODE_DB_BASE],
    // 仅用于本地 DB 采集，没有 tokscale 后端
    tokscaleClient: null,
    launch: { kind: 'cli', command: 'opencode' },
  },
  {
    id: 'qoder',
    name: 'Qoder',
    binaries: ['qodercli', 'qoder'],
    dataPaths: [QODER_HOME, path.join(QODER_HOME, 'projects'), path.join(QODER_HOME, 'logs')],
    tokscaleClient: null,
    launch: { kind: 'cli', command: 'qodercli' },
  },
]

let cache = { at: 0, snapshot: null }
let collecting = null

function expandHome(p) {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p.startsWith('.')
    ? path.join(os.homedir(), p)
    : p
}

/** 直接扫已知目录 + PATH，避免 launchd 精简 PATH / `which` 解析失败 */
function which(bin) {
  if (!bin) return null
  if (path.isAbsolute(bin) && fs.existsSync(bin) && fs.statSync(bin).isFile()) {
    return bin
  }
  const dirs = [
    ...TOOL_BIN_DIRS,
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean),
  ]
  const seen = new Set()
  for (const dir of dirs) {
    if (seen.has(dir)) continue
    seen.add(dir)
    const full = path.join(dir, bin)
    try {
      if (fs.existsSync(full) && fs.statSync(full).isFile()) return full
      // Qoder：~/.qoder/bin/qodercli/ 是版本目录，内含 qodercli-*
      if (bin === 'qodercli' && fs.existsSync(full) && fs.statSync(full).isDirectory()) {
        const nested = fs
          .readdirSync(full)
          .filter((n) => n.startsWith('qodercli') && !n.includes('.'))
          .map((n) => path.join(full, n))
          .find((p) => {
            try {
              return fs.statSync(p).isFile()
            } catch {
              return false
            }
          })
        if (nested) return nested
        // 也匹配带版本号的可执行文件名 qodercli-1.1.9
        const versioned = fs
          .readdirSync(full)
          .filter((n) => /^qodercli-/.test(n))
          .map((n) => path.join(full, n))
          .find((p) => {
            try {
              return fs.statSync(p).isFile()
            } catch {
              return false
            }
          })
        if (versioned) return versioned
      }
    } catch {
      /* continue */
    }
  }
  try {
    const searchPath = [...TOOL_BIN_DIRS, process.env.PATH].filter(Boolean).join(path.delimiter)
    return (
      execFileSync('/usr/bin/which', [bin], {
        encoding: 'utf8',
        env: { ...process.env, PATH: searchPath },
      }).trim() || null
    )
  } catch {
    return null
  }
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

/** AppleScript 双引号字符串字面量 */
function asLiteral(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function resolveLaunchBinary(command, preferredPath) {
  const candidates = [
    preferredPath,
    which(command),
    ...TOOL_BIN_DIRS.map((d) => path.join(d, command)),
    command,
  ].filter(Boolean)
  for (const c of candidates) {
    try {
      const abs = path.isAbsolute(c) ? c : which(c) || c
      if (abs && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        return path.resolve(abs)
      }
    } catch {
      /* continue */
    }
  }
  throw new Error(`找不到可执行文件：${command}`)
}

/** 在 macOS Terminal 中执行命令；其他平台尝试可用终端 */
function launchCliInTerminal(command, preferredPath) {
  const abs = resolveLaunchBinary(command, preferredPath)
  if (process.platform === 'darwin') {
    // 用绝对路径 + quoted form，避免 PATH 缺失与「Application Support」空格问题
    const binDir = path.dirname(abs)
    const script = `
set binPath to ${asLiteral(abs)}
set binDir to ${asLiteral(binDir)}
set shellCmd to "export PATH=" & quoted form of binDir & ":$PATH; exec " & quoted form of binPath
tell application "Terminal"
  activate
  do script shellCmd
end tell
`
    try {
      execFileSync('osascript', ['-e', script], {
        encoding: 'utf8',
        timeout: 15_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (e) {
      const detail = String(e.stderr || e.message || e)
      throw new Error(
        `无法打开 Terminal（请在「系统设置 → 隐私与安全性 → 自动化」中允许 osascript/Terminal）。${detail.slice(0, 160)}`
      )
    }
    return { kind: 'cli', command: abs, via: 'Terminal.app' }
  }
  if (process.platform === 'linux') {
    const shellLine = `export PATH=${shellQuote(path.dirname(abs))}:"$PATH"; exec ${shellQuote(abs)}`
    const terminals = [
      ['gnome-terminal', ['--', 'bash', '-lc', `${shellLine}; exec bash`]],
      ['x-terminal-emulator', ['-e', `bash -lc ${shellQuote(`${shellLine}; exec bash`)}`]],
      ['konsole', ['-e', 'bash', '-lc', `${shellLine}; exec bash`]],
    ]
    for (const [bin, args] of terminals) {
      if (which(bin)) {
        spawn(bin, args, { detached: true, stdio: 'ignore' }).unref()
        return { kind: 'cli', command: abs, via: bin }
      }
    }
    throw new Error('未找到可用终端')
  }
  spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', abs], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  }).unref()
  return { kind: 'cli', command: abs, via: 'cmd' }
}

function launchGuiApp(appName, appPath) {
  if (process.platform === 'darwin') {
    try {
      if (appPath && fs.existsSync(appPath)) {
        execFileSync('open', [appPath], { timeout: 10_000 })
        return { kind: 'gui', app: appName, via: appPath }
      }
      execFileSync('open', ['-a', appName], { timeout: 10_000 })
      return { kind: 'gui', app: appName, via: 'open -a' }
    } catch (e) {
      throw new Error(`无法打开 ${appName}：${e.message || e}`)
    }
  }
  if (process.platform === 'linux') {
    const bin = which(appName.toLowerCase()) || which('cursor')
    if (!bin) throw new Error(`未找到应用 ${appName}`)
    spawn(bin, [], { detached: true, stdio: 'ignore' }).unref()
    return { kind: 'gui', app: appName, via: bin }
  }
  spawn('cmd.exe', ['/c', 'start', '', appName], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  }).unref()
  return { kind: 'gui', app: appName, via: 'start' }
}

function launchTool(toolId) {
  const def = TOOL_DEFS.find((t) => t.id === toolId)
  if (!def?.launch) throw new Error(`未知工具：${toolId}`)
  const detected = detectTools().find((t) => t.id === toolId)
  if (!detected?.installed) throw new Error(`${def.name} 未检测到，无法启动`)

  if (def.launch.kind === 'gui') {
    return launchGuiApp(def.launch.app, def.launch.appPath)
  }

  const preferred =
    detected.binaries?.find((b) => b.name === def.launch.command) || detected.binaries?.[0]
  return launchCliInTerminal(def.launch.command, preferred?.path)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > 1_000_000) reject(new Error('body too large'))
    })
    req.on('end', () => {
      if (!raw.trim()) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

/** 模型短名（与前端 modelLabels 对齐） */
function formatModelShort(raw) {
  if (!raw) return null
  const key = String(raw).trim()
  const labels = {
    'kimi-for-coding': 'K2.7',
    'kimi-for-coding-highspeed': 'K2.7 Highspeed',
    k3: 'K3',
    hy3: 'HY3',
    'tencent/hy3': 'HY3',
    'tencent/hy3(free)': 'HY3(free)',
    auto: 'Auto',
    'gpt-5.6-sol': 'GPT-5.6 Sol',
    'gpt-5.6-terra': 'GPT-5.6 Terra',
    'gpt-5.5': 'GPT-5.5',
    'gpt-5.4-mini': 'GPT-5.4 mini',
    'z-ai/glm-5.2': 'GLM 5.2',
    'glm-5.2': 'GLM 5.2',
    'opencode-go/glm-5.2': 'GLM 5.2',
    'composer-2.5-fast': 'Composer 2.5',
    'cursor-grok-4.5-high-fast': 'Grok 4.5',
    qmodel_preview: 'QModel Preview',
  }
  if (labels[key]) return labels[key]
  const slug = key.includes('/') ? key.split('/').pop() : key
  if (labels[slug]) return labels[slug]
  if (/kimi-for-coding/i.test(slug)) return 'K2.7'
  if (/^k3$/i.test(slug)) return 'K3'
  if (/hy3/i.test(slug)) return /free/i.test(key) ? 'HY3(free)' : 'HY3'
  if (slug.length > 22) return slug.slice(0, 20) + '…'
  return slug
}

function readTomlKey(file, key) {
  try {
    if (!fs.existsSync(file)) return null
    const txt = fs.readFileSync(file, 'utf8')
    const re = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, 'm')
    const m = txt.match(re)
    return m ? m[1] : null
  } catch {
    return null
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

/** Codex：配置 model → 最近会话 model */
function readCodexActiveModel() {
  const cfgModel = readTomlKey(path.join(os.homedir(), '.codex', 'config.toml'), 'model')
  if (cfgModel) return { raw: cfgModel, label: formatModelShort(cfgModel), source: 'config' }

  try {
    const root = path.join(os.homedir(), '.codex', 'sessions')
    if (!fs.existsSync(root)) return null
    const files = []
    const walk = (dir, depth = 0) => {
      if (depth > 4) return
      for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name)
        let st
        try {
          st = fs.statSync(p)
        } catch {
          continue
        }
        if (st.isDirectory()) walk(p, depth + 1)
        else if (name.endsWith('.jsonl')) files.push({ p, m: st.mtimeMs })
      }
    }
    walk(root)
    files.sort((a, b) => b.m - a.m)
    for (const { p } of files.slice(0, 8)) {
      const lines = fs.readFileSync(p, 'utf8').split('\n').slice(0, 40)
      let provider = null
      let model = null
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const d = JSON.parse(line)
          const payload = d.payload || {}
          if (d.type === 'session_meta' && payload.model_provider) {
            provider = payload.model_provider
          }
          if (d.type === 'turn_context' && payload.model) {
            model = payload.model
            break
          }
        } catch {
          /* skip */
        }
      }
      if (model) {
        return {
          raw: model,
          label: formatModelShort(model),
          provider: provider || null,
          source: 'session',
        }
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

function readKimiActiveModel() {
  const raw =
    readTomlKey(path.join(os.homedir(), '.kimi-code', 'config.toml'), 'default_model') ||
    readTomlKey(path.join(os.homedir(), '.kimi', 'config.toml'), 'default_model')
  if (!raw) return null
  return { raw, label: formatModelShort(raw), source: 'config' }
}

/** Cursor：近期用量最高的模型作为展示（配置分散在多处） */
function readCursorActiveModel(monthModels, modelClients) {
  let best = null
  let bestTok = 0
  for (const [model, tokens] of Object.entries(monthModels || {})) {
    if ((modelClients || {})[model] !== 'cursor') continue
    if (tokens > bestTok) {
      bestTok = tokens
      best = model
    }
  }
  if (!best) return { raw: 'auto', label: 'Auto', source: 'default' }
  return { raw: best, label: formatModelShort(best), source: 'usage' }
}

/** 从 Claude Code 配置识别实际供应商与模型（不含密钥） */
function readClaudeRuntimeConfig() {
  const candidates = [
    path.join(os.homedir(), '.claude', 'settings.json'),
    path.join(os.homedir(), '.claude', 'settings.local.json'),
  ]
  let env = {}
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (raw?.env && typeof raw.env === 'object') {
        env = { ...env, ...raw.env }
      }
    } catch {
      /* ignore broken settings */
    }
  }
  const baseUrl = String(env.ANTHROPIC_BASE_URL || process.env.ANTHROPIC_BASE_URL || '').trim()
  const modelRaw = String(
    env.ANTHROPIC_MODEL ||
      env.ANTHROPIC_DEFAULT_SONNET_MODEL ||
      env.ANTHROPIC_DEFAULT_OPUS_MODEL ||
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL ||
      process.env.ANTHROPIC_MODEL ||
      ''
  ).trim()

  let provider = 'Anthropic'
  if (baseUrl) {
    try {
      const host = new URL(baseUrl).hostname.toLowerCase()
      if (host.includes('openrouter')) provider = 'OpenRouter'
      else if (host.includes('anthropic')) provider = 'Anthropic'
      else if (host.includes('localhost') || host.includes('127.0.0.1')) provider = 'Local Proxy'
      else {
        const label = host.replace(/^api\./, '').split('.')[0]
        provider = label ? label.charAt(0).toUpperCase() + label.slice(1) : host
      }
    } catch {
      if (/openrouter/i.test(baseUrl)) provider = 'OpenRouter'
    }
  }

  const configuredModel = modelRaw ? formatModelShort(modelRaw) : null

  return {
    provider,
    configuredModel,
    modelRaw: modelRaw || null,
    baseHost: (() => {
      try {
        return baseUrl ? new URL(baseUrl).hostname : null
      } catch {
        return null
      }
    })(),
  }
}

function detectTools(usageHint = null) {
  const claudeRuntime = readClaudeRuntimeConfig()
  const codexModel = readCodexActiveModel()
  const kimiModel = readKimiActiveModel()
  const cursorModel = readCursorActiveModel(usageHint?.models, usageHint?.modelClients)

  return TOOL_DEFS.map((def) => {
    const foundBins = def.binaries
      .map((b) => ({ name: b, path: which(b) }))
      .filter((b) => b.path)
    const dataDirs = def.dataPaths
      .map((p) => expandHome(p))
      .filter((p) => {
        try {
          return fs.existsSync(p)
        } catch {
          return false
        }
      })
    const apps = (def.appPaths || []).filter((p) => fs.existsSync(p))
    const installed = foundBins.length > 0 || dataDirs.length > 0 || apps.length > 0
    const base = {
      id: def.id,
      name: def.name,
      tokscaleClient: def.tokscaleClient,
      installed,
      binaries: foundBins,
      dataDirs,
      apps,
      status: installed ? 'detected' : 'missing',
    }
    if (!installed) return base

    if (def.id === 'claude') {
      return {
        ...base,
        provider: claudeRuntime.provider,
        configuredModel: claudeRuntime.configuredModel,
        displayName: claudeRuntime.provider,
      }
    }
    if (def.id === 'codex' && codexModel) {
      return {
        ...base,
        provider: codexModel.provider || 'ChatGPT',
        configuredModel: codexModel.label,
        displayName: def.name,
      }
    }
    if (def.id === 'kimi' && kimiModel) {
      return {
        ...base,
        provider: 'Kimi Code',
        configuredModel: kimiModel.label,
        displayName: def.name,
      }
    }
    if (def.id === 'cursor' && cursorModel) {
      return {
        ...base,
        provider: 'Cursor',
        configuredModel: cursorModel.label,
        displayName: def.name,
      }
    }
    if (def.id === 'opencode' && installed) {
      const active = readOpenCodeActiveModel()
      const label = active ? formatModelShort(active.raw) : null
      return {
        ...base,
        provider: 'OpenCode',
        configuredModel: label,
        displayName: def.name,
        // 暴露数据库名称供 UI 提示「数据来源」使用
        dataDirs: findOpenCodeDb() ? [...dataDirs, findOpenCodeDb()] : dataDirs,
      }
    }
    if (def.id === 'qoder' && installed) {
      const active = readQoderActiveModel()
      const label = active ? formatModelShort(active.raw) : null
      return {
        ...base,
        provider: 'Qoder',
        configuredModel: label,
        displayName: def.name,
        dataDirs: isQoderInstalled()
          ? [...new Set([...dataDirs, QODER_HOME])]
          : dataDirs,
      }
    }
    return base
  })
}

function runTokscale(args, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(TOKSCALE_ENTRY)) {
      reject(new Error('tokscale dependency missing; run npm install'))
      return
    }
    const child = spawn(process.execPath, [TOKSCALE_ENTRY, ...args], {
      cwd: PROJECT_ROOT,
      env: process.env,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`tokscale timeout: ${args.join(' ')}`))
    }, timeoutMs)
    child.stdout.on('data', (d) => {
      stdout += d
    })
    child.stderr.on('data', (d) => {
      stderr += d
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(stderr.trim() || `tokscale exit ${code}`))
        return
      }
      const text = stdout.trim()
      const start = Math.min(
        ...[text.indexOf('{'), text.indexOf('[')].filter((i) => i >= 0)
      )
      if (!Number.isFinite(start) || start < 0) {
        reject(new Error(`no JSON from tokscale: ${stderr.slice(0, 200)}`))
        return
      }
      try {
        resolve(JSON.parse(text.slice(start)))
      } catch (e) {
        reject(e)
      }
    })
  })
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
    /** 唯一 sessionId 数量 */
    clientSessions: {},
    /** 提问次数（tokscale messageCount；近似 role=user） */
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

/** Cursor 缓存命中不计入「实际用量」（否则 cacheRead 会把总量抬高一个数量级） */
function entryBillableTokens(e) {
  const input = e.input || 0
  const output = e.output || 0
  const reasoning = e.reasoning || 0
  const cacheRead = e.cacheRead || 0
  const cacheWrite = e.cacheWrite || 0
  if ((e.client || '') === 'cursor') return input + output + reasoning
  return input + output + reasoning + cacheRead + cacheWrite
}

function periodFromEntries(payload) {
  const period = emptyPeriod()
  const entries = payload?.entries || []
  const clientSessionSets = {}
  const modelSessionSets = {}
  for (const e of entries) {
    const tokens = entryBillableTokens(e)
    const cost = Number(e.cost || 0)
    const client = e.client || 'unknown'
    const cacheRead = e.cacheRead || 0
    const msgs = Number(e.messageCount || 0)
    const sessionId = e.sessionId ? String(e.sessionId) : ''
    period.inputTokens += e.input || 0
    period.outputTokens += e.output || 0
    period.cacheReadTokens += cacheRead
    period.totalTokens += tokens
    period.totalCostUsd += cost
    period.clients[client] = (period.clients[client] || 0) + tokens
    period.clientCosts[client] = (period.clientCosts[client] || 0) + cost
    period.clientCacheRead[client] = (period.clientCacheRead[client] || 0) + cacheRead
    period.clientMessages[client] = (period.clientMessages[client] || 0) + msgs
    if (sessionId) {
      if (!clientSessionSets[client]) clientSessionSets[client] = new Set()
      clientSessionSets[client].add(sessionId)
    }
    // 部分客户端在 performance.totalDurationMs 有时长
    const dur = Number(e.performance?.totalDurationMs || 0)
    if (dur > 0) {
      period.clientActiveMs[client] = (period.clientActiveMs[client] || 0) + dur
    }
    if (e.model && e.model !== '<synthetic>') {
      const model = String(e.model)
      period.models[model] = (period.models[model] || 0) + tokens
      period.modelCosts[model] = (period.modelCosts[model] || 0) + cost
      period.modelClients[model] = client
      period.modelInput[model] = (period.modelInput[model] || 0) + (e.input || 0)
      period.modelOutput[model] =
        (period.modelOutput[model] || 0) + (e.output || 0) + (e.reasoning || 0)
      period.modelCacheRead[model] = (period.modelCacheRead[model] || 0) + cacheRead
      period.modelMessages[model] = (period.modelMessages[model] || 0) + msgs
      if (sessionId) {
        if (!modelSessionSets[model]) modelSessionSets[model] = new Set()
        modelSessionSets[model].add(sessionId)
      }
    }
  }
  for (const [client, set] of Object.entries(clientSessionSets)) {
    period.clientSessions[client] = set.size
  }
  for (const [model, set] of Object.entries(modelSessionSets)) {
    period.modelSessions[model] = set.size
  }
  period.totalCostUsd = Math.round(period.totalCostUsd * 1e6) / 1e6
  return period
}

/** 解析 Cursor Pro 等订阅的月费上限（美元），默认 $20 */
function cursorPlanUsdFromBilling(bill) {
  if (!bill?.ok) return null
  if (bill.billingMode !== 'subscription' && bill.kind !== 'plan_percent') return null
  if (typeof bill.limitCents === 'number' && bill.limitCents > 0) {
    return bill.limitCents / 100
  }
  const m = String(bill.priceLabel || '').match(/\$?\s*([\d.]+)/)
  if (m) return Number(m[1])
  if (String(bill.planName || '').toLowerCase().includes('pro')) return 20
  return 20
}

/**
 * Cursor 订阅套餐按「官方用量占比 × 月费」计费，且不超过月费上限。
 * tokscale 会按 API 标价估出几百美元，对 Pro 订阅不成立。
 */
function rescaleClientCost(period, client, nextCost) {
  if (!period?.clientCosts) return
  const old = Number(period.clientCosts[client] || 0)
  const next = Math.round(Math.max(0, nextCost) * 1e6) / 1e6
  if (!(old > 0) || Math.abs(old - next) < 1e-9) {
    period.clientCosts[client] = next
    return
  }
  const ratio = next / old
  period.clientCosts[client] = next
  period.totalCostUsd = Math.round((Number(period.totalCostUsd || 0) - old + next) * 1e6) / 1e6
  for (const [mid, tool] of Object.entries(period.modelClients || {})) {
    if (tool !== client || !period.modelCosts?.[mid]) continue
    period.modelCosts[mid] = Math.round(period.modelCosts[mid] * ratio * 1e6) / 1e6
  }
}

function applyCursorSubscriptionCosts(snap) {
  const bill = snap?.billing?.byTool?.cursor
  const planUsd = cursorPlanUsdFromBilling(bill)
  if (planUsd == null || !(planUsd > 0)) return

  const monthTarget =
    typeof bill.usedPercent === 'number'
      ? Math.min(planUsd, (Math.max(0, bill.usedPercent) / 100) * planUsd)
      : Math.min(Number(snap.month?.clientCosts?.cursor || 0), planUsd)

  const weekCap = (planUsd * 7) / 31
  const dayCap = planUsd / 31

  if (snap.month) {
    rescaleClientCost(
      snap.month,
      'cursor',
      Math.min(Number(snap.month.clientCosts?.cursor || 0), monthTarget, planUsd)
    )
  }
  if (snap.week) {
    rescaleClientCost(
      snap.week,
      'cursor',
      Math.min(Number(snap.week.clientCosts?.cursor || 0), weekCap)
    )
  }
  if (snap.today) {
    rescaleClientCost(
      snap.today,
      'cursor',
      Math.min(Number(snap.today.clientCosts?.cursor || 0), dayCap)
    )
  }
  for (const d of snap.history || []) {
    rescaleClientCost(d, 'cursor', Math.min(Number(d.clientCosts?.cursor || 0), dayCap))
  }
  for (const t of snap.tools || []) {
    if (t.id === 'cursor') t.monthCostUsd = snap.month?.clientCosts?.cursor || 0
  }
}

/** 各工具运行时长（tokscale time-metrics） */
/** 将同结构 src period 合并进 dst period（叠加数字 + 合并 clients/models map） */
function mergePeriod(dst, src) {
  if (!src) return
  dst.totalTokens += src.totalTokens || 0
  dst.totalCostUsd = Math.round((dst.totalCostUsd + (src.totalCostUsd || 0)) * 1e6) / 1e6
  dst.inputTokens += src.inputTokens || 0
  dst.outputTokens += src.outputTokens || 0
  dst.cacheReadTokens += src.cacheReadTokens || 0
  for (const key of [
    'clients',
    'clientCosts',
    'clientActiveMs',
    'clientCacheRead',
    'clientSessions',
    'clientMessages',
    'models',
    'modelCosts',
    'modelClients',
    'modelInput',
    'modelOutput',
    'modelCacheRead',
    'modelSessions',
    'modelMessages',
  ]) {
    const dstMap = dst[key] || {}
    const srcMap = src[key] || {}
    for (const [k, v] of Object.entries(srcMap)) {
      if (key === 'modelClients') {
        // 单值保留即可
        if (!dstMap[k]) dstMap[k] = v
      } else {
        dstMap[k] = (dstMap[k] || 0) + Number(v || 0)
      }
    }
    dst[key] = dstMap
  }
}

/** 把 OpenCode 的按日 history 合并到现有 history 列表（按日期对齐） */
function mergeHistory(hist, ocHist) {
  if (!ocHist || !ocHist.length) return
  const byDate = new Map(hist.map((d) => [d.date, d]))
  for (const od of ocHist) {
    let existing = byDate.get(od.date)
    if (!existing) {
      existing = {
        date: od.date,
        totalTokens: 0,
        totalCostUsd: 0,
        messages: 0,
        activeTimeMs: 0,
        clients: {},
        clientCosts: {},
        models: {},
        modelCosts: {},
        modelClients: {},
      }
      hist.push(existing)
      byDate.set(od.date, existing)
    }
    existing.totalTokens += od.totalTokens || 0
    existing.totalCostUsd = Math.round(
      (existing.totalCostUsd + (od.totalCostUsd || 0)) * 1e6
    ) / 1e6
    existing.activeTimeMs = (existing.activeTimeMs || 0) + (od.activeTimeMs || 0)
    for (const [k, v] of Object.entries(od.clients || {})) {
      existing.clients[k] = (existing.clients[k] || 0) + Number(v || 0)
    }
    for (const [k, v] of Object.entries(od.clientCosts || {})) {
      existing.clientCosts[k] = (existing.clientCosts[k] || 0) + Number(v || 0)
    }
    for (const [k, v] of Object.entries(od.models || {})) {
      existing.models[k] = (existing.models[k] || 0) + Number(v || 0)
    }
    for (const [k, v] of Object.entries(od.modelCosts || {})) {
      existing.modelCosts[k] = (existing.modelCosts[k] || 0) + Number(v || 0)
    }
    for (const [k, v] of Object.entries(od.modelClients || {})) {
      if (!existing.modelClients[k]) existing.modelClients[k] = v
    }
  }
  hist.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

async function collectClientActiveMs(clients, rangeFlag) {
  const map = {}
  await Promise.all(
    clients.map(async (id) => {
      try {
        const raw = await runTokscale(
          ['time-metrics', '--json', '-c', id, rangeFlag, '--no-spinner'],
          60_000
        )
        map[id] = Number(raw?.metrics?.total_active_time_ms || 0)
      } catch {
        map[id] = 0
      }
    })
  )
  return map
}

function historyFromGraph(graph) {
  const contributions = graph?.contributions || []
  return contributions.map((c) => {
    const byClient = {}
    const costs = {}
    const byModel = {}
    const modelCosts = {}
    const modelClients = {}
    for (const row of c.clients || []) {
      const id = row.client
      const t = row.tokens || {}
      const tokens = entryBillableTokens({
        client: id,
        input: t.input || 0,
        output: t.output || 0,
        cacheRead: t.cacheRead || 0,
        cacheWrite: t.cacheWrite || 0,
        reasoning: t.reasoning || 0,
      })
      byClient[id] = (byClient[id] || 0) + tokens
      costs[id] = (costs[id] || 0) + Number(row.cost || 0)
      const model = row.modelId || row.model
      if (model && model !== '<synthetic>') {
        const mid = String(model)
        byModel[mid] = (byModel[mid] || 0) + tokens
        modelCosts[mid] = (modelCosts[mid] || 0) + Number(row.cost || 0)
        modelClients[mid] = id
      }
    }
    const clientSum = Object.values(byClient).reduce((a, b) => a + b, 0)
    const totals = c.totals || {}
    return {
      date: c.date,
      // 优先用按客户端修正后的合计（Cursor 已剔除 cache）
      totalTokens: clientSum || totals.tokens || 0,
      totalCostUsd: totals.cost || 0,
      messages: totals.messages || 0,
      activeTimeMs: Number(c.activeTimeMs || 0),
      clients: byClient,
      clientCosts: costs,
      models: byModel,
      modelCosts,
      modelClients,
      breakdown: c.tokenBreakdown || null,
    }
  })
}

async function collectSnapshot() {
  let detected = detectTools()
  const installedClients = detected
    .filter((t) => t.installed && t.tokscaleClient)
    .map((t) => t.tokscaleClient)
  const clientCsv = (installedClients.length ? installedClients : CLIENTS).join(',')
  const clients = installedClients.length ? installedClients : [...CLIENTS]

  const warnings = []
  let today = emptyPeriod()
  let week = emptyPeriod()
  let month = emptyPeriod()
  let history = []
  let durations = { today: {}, week: {}, month: {} }

  try {
    const [todayRaw, weekRaw, monthRaw, graphRaw, durToday, durWeek, durMonth] =
      await Promise.all([
        runTokscale([
          '--json',
          '--client',
          clientCsv,
          '--group-by',
          'client,session,model',
          '--today',
        ]),
        runTokscale([
          '--json',
          '--client',
          clientCsv,
          '--group-by',
          'client,session,model',
          '--week',
        ]),
        runTokscale([
          '--json',
          '--client',
          clientCsv,
          '--group-by',
          'client,session,model',
          '--month',
        ]),
        runTokscale(['graph', '--client', clientCsv, '--no-spinner']),
        collectClientActiveMs(clients, '--today'),
        collectClientActiveMs(clients, '--week'),
        collectClientActiveMs(clients, '--month'),
      ])
    today = periodFromEntries(todayRaw)
    week = periodFromEntries(weekRaw)
    month = periodFromEntries(monthRaw)
    today.clientActiveMs = { ...today.clientActiveMs, ...durToday }
    week.clientActiveMs = { ...week.clientActiveMs, ...durWeek }
    month.clientActiveMs = { ...month.clientActiveMs, ...durMonth }
    // time-metrics 优先覆盖
    for (const [id, ms] of Object.entries(durToday)) today.clientActiveMs[id] = ms
    for (const [id, ms] of Object.entries(durWeek)) week.clientActiveMs[id] = ms
    for (const [id, ms] of Object.entries(durMonth)) month.clientActiveMs[id] = ms
    durations = { today: durToday, week: durWeek, month: durMonth }
    history = historyFromGraph(graphRaw)
    for (const w of todayRaw.warnings || []) warnings.push(w)
    for (const w of weekRaw.warnings || []) {
      if (!warnings.includes(w)) warnings.push(w)
    }
    for (const w of monthRaw.warnings || []) {
      if (!warnings.includes(w)) warnings.push(w)
    }
  } catch (e) {
    warnings.push(`tokscale 采集失败：${e.message || e}`)
  }

  // Cursor：tokscale time-metrics 无时长，用 usage.csv 事件间隔估算
  try {
    const cursorDur = collectCursorActiveMs()
    for (const range of ['today', 'week', 'month']) {
      const ms = Number(cursorDur[range] || 0)
      if (!(ms > 0)) continue
      // tokscale 对 cursor 恒为 0，直接写入；若将来有官方值则仅在为 0 时回退
      const cur = Number(durations[range]?.cursor || 0)
      if (cur > 0) continue
      if (!durations[range]) durations[range] = {}
      durations[range].cursor = ms
      const period = range === 'today' ? today : range === 'week' ? week : month
      if (period) {
        period.clientActiveMs = period.clientActiveMs || {}
        period.clientActiveMs.cursor = ms
      }
    }
  } catch (e) {
    warnings.push(`Cursor 运行时长估算失败：${e.message || e}`)
  }

  // OpenCode 数据来自本地 SQLite，独立采集后并入快照
  try {
    const oc = collectOpenCode()
    if (oc.installed) {
      mergePeriod(today, oc.today)
      mergePeriod(week, oc.week)
      mergePeriod(month, oc.month)
      if (oc.history?.length) {
        if (!history.length) history = []
        mergeHistory(history, oc.history)
      }
      durations.today[OPENCODE_CLIENT_ID] = oc.activeMs.today
      durations.week[OPENCODE_CLIENT_ID] = oc.activeMs.week
      durations.month[OPENCODE_CLIENT_ID] = oc.activeMs.month
      today.clientActiveMs[OPENCODE_CLIENT_ID] = oc.activeMs.today
      week.clientActiveMs[OPENCODE_CLIENT_ID] = oc.activeMs.week
      month.clientActiveMs[OPENCODE_CLIENT_ID] = oc.activeMs.month
    }
  } catch (e) {
    warnings.push(`OpenCode 采集失败：${e.message || e}`)
  }

  // Qoder CLI：本地 segment JSONL，独立采集后并入快照
  try {
    const qd = collectQoder()
    if (qd.installed) {
      mergePeriod(today, qd.today)
      mergePeriod(week, qd.week)
      mergePeriod(month, qd.month)
      if (qd.history?.length) {
        if (!history.length) history = []
        mergeHistory(history, qd.history)
      }
      durations.today[QODER_CLIENT_ID] = qd.activeMs.today
      durations.week[QODER_CLIENT_ID] = qd.activeMs.week
      durations.month[QODER_CLIENT_ID] = qd.activeMs.month
      today.clientActiveMs[QODER_CLIENT_ID] = qd.activeMs.today
      week.clientActiveMs[QODER_CLIENT_ID] = qd.activeMs.week
      month.clientActiveMs[QODER_CLIENT_ID] = qd.activeMs.month
    }
  } catch (e) {
    warnings.push(`Qoder 采集失败：${e.message || e}`)
  }

  // 本机会话文件：纠正 Cursor 等工具的会话数 / 用户提问次数
  try {
    const localSessions = collectLocalSessionStats()
    applyLocalSessionStats(today, localSessions.today)
    applyLocalSessionStats(week, localSessions.week)
    applyLocalSessionStats(month, localSessions.month)
  } catch (e) {
    warnings.push(`会话统计采集失败：${e.message || e}`)
  }

  // 用量出来后再补 Cursor 等模型标签
  detected = detectTools(month)

  // 标记有用量 / 仅安装
  const tools = detected.map((t) => {
    const tokens = month.clients[t.id] || 0
    let status = t.status
    if (t.installed && tokens > 0) status = 'active'
    else if (t.installed) status = 'waiting'
    return { ...t, status, monthTokens: tokens, monthCostUsd: month.clientCosts[t.id] || 0 }
  })

  // 官方额度：OpenRouter credits / Cursor Plan&Usage / ChatGPT wham
  let billing = { byTool: {}, errors: [], updatedAt: null }
  try {
    billing = await fetchOfficialBilling()
    for (const e of billing.errors || []) {
      if (!warnings.includes(e)) warnings.push(e)
    }
  } catch (e) {
    warnings.push(`官方额度查询失败：${e.message || e}`)
  }

  const snap = {
    ok: true,
    source: 'token-agent',
    reference: 'https://github.com/Javis603/token-monitor',
    engine: 'tokscale',
    updatedAt: new Date().toISOString(),
    hostname: os.hostname(),
    platform: `${process.platform}-${process.arch}`,
    tools,
    trackedClients: tools.filter((t) => t.installed).map((t) => t.id),
    today,
    week,
    month,
    durations,
    history,
    billing,
    warnings,
  }
  // Cursor Pro 等订阅：费用不超过月套餐价（默认 $20）
  applyCursorSubscriptionCosts(snap)
  return snap
}

async function getSnapshot(force = false) {
  if (!force && cache.snapshot && Date.now() - cache.at < CACHE_MS) {
    return { ...cache.snapshot, cached: true }
  }
  if (collecting) return collecting
  collecting = collectSnapshot()
    .then((snap) => {
      cache = { at: Date.now(), snapshot: snap }
      collecting = null
      return { ...snap, cached: false }
    })
    .catch((err) => {
      collecting = null
      throw err
    })
  return collecting
}

function send(res, status, body) {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  })
  res.end(json)
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {})
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`)

  if (url.pathname === '/api/health') {
    return send(res, 200, {
      ok: true,
      role: 'personal-ops-token-agent',
      port: PORT,
      now: new Date().toISOString(),
    })
  }

  if (url.pathname === '/api/detect') {
    return send(res, 200, { ok: true, tools: detectTools() })
  }

  if (url.pathname === '/api/stats' || url.pathname === '/api/snapshot') {
    try {
      const force = url.searchParams.get('refresh') === '1'
      const snap = await getSnapshot(force)
      return send(res, 200, snap)
    } catch (e) {
      return send(res, 500, { ok: false, error: String(e.message || e) })
    }
  }

  if (url.pathname === '/api/leaderboard') {
    try {
      const force = url.searchParams.get('refresh') === '1'
      const snap = await collectLeaderboard(force)
      return send(res, 200, snap)
    } catch (e) {
      return send(res, 500, { ok: false, error: String(e.message || e) })
    }
  }

  if (url.pathname === '/api/launch' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req)
      const toolId = String(body.toolId || url.searchParams.get('tool') || '').trim()
      if (!toolId) return send(res, 400, { ok: false, error: '缺少 toolId' })
      const result = launchTool(toolId)
      return send(res, 200, { ok: true, toolId, ...result })
    } catch (e) {
      return send(res, 500, { ok: false, error: String(e.message || e) })
    }
  }

  send(res, 404, { ok: false, error: 'not found' })
}

const once = process.argv.includes('--once')
if (once) {
  const snap = await collectSnapshot()
  console.log(JSON.stringify(snap, null, 2))
  process.exit(0)
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => send(res, 500, { ok: false, error: String(e) }))
})

server.listen(PORT, HOST, () => {
  console.log(`[token-agent] http://${HOST}:${PORT}`)
  console.log(`[token-agent] GET /api/health|/api/detect|/api/stats|/api/leaderboard · POST /api/launch`)
  console.log(`[token-agent] 参考 Javis603/token-monitor · 引擎 tokscale`)
  // 预热 Token + 日更榜单
  getSnapshot(true).catch((e) => console.warn('[token-agent] warmup failed:', e.message))
  collectLeaderboard(false)
    .then((s) => console.log(`[token-agent] leaderboard ready · ${s.models?.length || 0} models`))
    .catch((e) => console.warn('[token-agent] leaderboard warmup failed:', e.message))
  // 每 24 小时自动刷新榜单
  setInterval(
    () => {
      collectLeaderboard(true)
        .then((s) => console.log(`[token-agent] leaderboard daily refresh · ${s.models?.length || 0}`))
        .catch((e) => console.warn('[token-agent] leaderboard refresh failed:', e.message))
    },
    24 * 60 * 60 * 1000
  )
})
