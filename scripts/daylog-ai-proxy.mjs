/**
 * Daylog AI 本地代理（密钥不进前端，解决浏览器 CORS）
 * 用法：npm run daylog-proxy
 * 默认监听 http://127.0.0.1:8790
 *
 * 后端选择（POST /chat，优先级从高到低）：
 *   1. ChatGPT（codex CLI）：codex exec 非交互模式，prompt 走 stdin
 *   2. Kimi Code（kimi CLI）：kimi -p "<prompt>"，stdout 即回复
 *   3. API key 兜底：DAYLOG_AI_API_KEY 配置时转发 OpenAI 兼容接口
 * 可用 DAYLOG_AI_BACKEND=codex|kimi|api 强制指定后端。
 *
 * 环境变量：
 *   DAYLOG_AI_BACKEND   可选，强制后端：codex | kimi | api
 *   DAYLOG_AI_API_KEY   API 兜底通道密钥（OpenAI 兼容）
 *   DAYLOG_AI_BASE_URL  默认 https://api.moonshot.cn/v1
 *   DAYLOG_AI_MODEL     默认 moonshot-v1-8k
 *   DAYLOG_AI_PORT      默认 8790
 */
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.DAYLOG_AI_PORT || 8790)
const API_KEY = process.env.DAYLOG_AI_API_KEY || ''
const BASE_URL = (process.env.DAYLOG_AI_BASE_URL || 'https://api.moonshot.cn/v1').replace(/\/+$/, '')
const MODEL = process.env.DAYLOG_AI_MODEL || 'moonshot-v1-8k'
const ALLOW_ORIGIN = process.env.CORS_ORIGIN || '*'
const CLI_TIMEOUT_MS = 240_000

/* ===== CLI 可执行文件查找（PATH + 已知目录，结果缓存） ===== */

const EXTRA_BIN_DIRS = [
  path.join(os.homedir(), '.kimi-code', 'bin'),
  path.join(os.homedir(), 'node', 'bin'),
  '/usr/local/bin',
  '/opt/homebrew/bin',
  path.join(os.homedir(), 'Library', 'Application Support', 'QClaw', 'npm-global', 'bin'),
]

const whichCache = new Map()
function which(bin) {
  if (whichCache.has(bin)) return whichCache.get(bin)
  const dirs = [
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean),
    ...EXTRA_BIN_DIRS,
  ]
  const seen = new Set()
  let found = null
  for (const dir of dirs) {
    if (seen.has(dir)) continue
    seen.add(dir)
    const full = path.join(dir, bin)
    try {
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        found = full
        break
      }
    } catch {
      /* continue */
    }
  }
  whichCache.set(bin, found)
  return found
}

/* ===== 后端探测（缓存一次；探测不到时不缓存，下个请求再试） ===== */

const BACKEND_LABELS = {
  codex: 'ChatGPT (codex CLI)',
  kimi: 'Kimi Code (kimi CLI)',
  api: `API (${MODEL})`,
}

let backendCache = null
function detectBackend() {
  if (backendCache) return backendCache
  const forced = (process.env.DAYLOG_AI_BACKEND || '').trim().toLowerCase()
  const candidates = forced ? [forced] : ['codex', 'kimi', 'api']
  for (const id of candidates) {
    if (id === 'codex') {
      const bin = which('codex')
      if (bin) return (backendCache = { id, label: BACKEND_LABELS.codex, bin })
    } else if (id === 'kimi') {
      const bin = which('kimi')
      if (bin) return (backendCache = { id, label: BACKEND_LABELS.kimi, bin })
    } else if (id === 'api' && API_KEY) {
      return (backendCache = { id, label: BACKEND_LABELS.api })
    }
  }
  return null
}

/* ===== prompt 组装与图片处理 ===== */

function buildPrompt(messages, responseJson) {
  const systemParts = messages.filter((m) => m.role === 'system').map((m) => m.content)
  const convo = messages.filter((m) => m.role !== 'system')
  const lines = []
  lines.push('【指令】')
  lines.push('这是纯对话任务：请直接输出回复文本，不要使用任何工具、不要读写文件、不要执行命令。')
  for (const s of systemParts) lines.push(s)
  lines.push('')
  lines.push('【对话记录】')
  for (const m of convo) lines.push(`${m.role === 'user' ? '用户' : '助手'}：${m.content}`)
  lines.push('')
  lines.push('【请继续】')
  lines.push('请接着上面的对话，以「助手」的身份直接输出下一段回复内容，不要加角色前缀。')
  if (responseJson) lines.push('只输出合法 JSON，不要输出任何其他内容。')
  return lines.join('\n')
}

/** 仅取最后一条用户消息上的图片（data URL），避免每次带上全部历史图 */
function extractImages(messages) {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  if (!lastUser || !Array.isArray(lastUser.images)) return []
  return lastUser.images.filter((s) => typeof s === 'string' && s.startsWith('data:image/'))
}

function writeTempImages(dataUrls) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daylog-img-'))
  const files = []
  dataUrls.forEach((d, i) => {
    const m = d.match(/^data:image\/(\w+);base64,(.+)$/)
    if (!m) return
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1]
    const file = path.join(dir, `img-${i}.${ext}`)
    fs.writeFileSync(file, Buffer.from(m[2], 'base64'))
    files.push(file)
  })
  return { dir, files }
}

/* ===== CLI 调用（超时 kill） ===== */

function runCli(cmd, args, stdinText) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(new Error(`CLI 调用超时（${Math.round(CLI_TIMEOUT_MS / 1000)} 秒），已终止`))
    }, CLI_TIMEOUT_MS)
    child.stdout.on('data', (d) => {
      stdout += d
    })
    child.stderr.on('data', (d) => {
      stderr += d
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
    if (stdinText != null) child.stdin.write(stdinText)
    child.stdin.end()
  })
}

async function askCodex(bin, prompt, imageFiles) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daylog-codex-'))
  const outFile = path.join(outDir, 'last-message.md')
  const args = [
    'exec',
    '--sandbox', 'read-only',
    '--skip-git-repo-check',
    '--ephemeral',
    '--color', 'never',
    '-o', outFile,
  ]
  if (imageFiles.length) args.push('-i', ...imageFiles)
  args.push('-') // prompt 从 stdin 读取
  try {
    const { code, stdout, stderr } = await runCli(bin, args, prompt)
    let text = ''
    try {
      text = fs.readFileSync(outFile, 'utf8').trim()
    } catch {
      /* 读不到输出文件则回退 stdout */
    }
    if (!text) text = stdout.trim()
    if (!text) throw new Error(`codex 无输出（exit ${code}）：${stderr.slice(-300)}`)
    return text
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
}

async function askKimi(bin, prompt) {
  const { code, stdout, stderr } = await runCli(bin, ['-p', prompt], null)
  const text = stdout.trim()
  if (!text) throw new Error(`kimi 无输出（exit ${code}）：${stderr.slice(-300)}`)
  return text
}

/* ===== HTTP ===== */

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Accept',
  })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

async function handleChat(req, res) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  let payload
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    return send(res, 400, { error: '请求体不是合法 JSON' })
  }
  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    return send(res, 400, { error: '缺少 messages 字段' })
  }

  const backend = detectBackend()
  if (!backend) {
    return send(res, 500, {
      error:
        '未找到可用 AI 后端：未检测到 codex / kimi CLI，也未配置 DAYLOG_AI_API_KEY。' +
        '请安装其中之一，或配置 API key 后重启代理。',
    })
  }

  const responseJson = Boolean(payload.responseJson)
  const images = extractImages(payload.messages)

  try {
    if (backend.id === 'codex') {
      const prompt = buildPrompt(payload.messages, responseJson)
      const { dir, files } = images.length ? writeTempImages(images) : { dir: null, files: [] }
      try {
        const text = await askCodex(backend.bin, prompt, files)
        return send(res, 200, { text })
      } finally {
        if (dir) fs.rmSync(dir, { recursive: true, force: true })
      }
    }

    if (backend.id === 'kimi') {
      let prompt = buildPrompt(payload.messages, responseJson)
      if (images.length) {
        prompt += '\n\n（用户附带了图片，当前对话通道无法查看图片，请仅基于文字回复）'
      }
      const text = await askKimi(backend.bin, prompt)
      return send(res, 200, { text })
    }

    // api 兜底：转发 OpenAI 兼容接口（文本通道，附带图片时追加说明）
    const apiMessages = payload.messages.map((m) => ({ role: m.role, content: m.content }))
    if (images.length) {
      apiMessages.push({
        role: 'user',
        content: '（用户附带了图片，当前对话通道无法查看图片，请仅基于文字回复）',
      })
    }
    const upstream = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: apiMessages,
        temperature: 0.7,
        ...(responseJson ? { response_format: { type: 'json_object' } } : {}),
      }),
    })
    const data = await upstream.json().catch(() => null)
    if (!upstream.ok) {
      return send(res, upstream.status, {
        error: data?.error?.message || `上游 AI 接口返回 ${upstream.status}`,
      })
    }
    const text = data?.choices?.[0]?.message?.content ?? ''
    return send(res, 200, { text })
  } catch (e) {
    return send(res, 502, { error: `调用 ${backend.label} 失败：${String(e?.message || e)}` })
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '')

  const url = new URL(req.url || '/', `http://${req.headers.host}`)

  if (req.method === 'GET' && url.pathname === '/health') {
    const backend = detectBackend()
    return send(res, 200, { ok: true, backend: backend?.id ?? null, label: backend?.label ?? null })
  }

  if (req.method === 'POST' && url.pathname === '/chat') {
    return handleChat(req, res)
  }

  send(res, 404, { error: 'not found' })
})

server.listen(PORT, '127.0.0.1', () => {
  const backend = detectBackend()
  console.log(
    `Daylog AI proxy: http://127.0.0.1:${PORT} (backend: ${backend ? backend.label : '无可用后端'})`
  )
})
