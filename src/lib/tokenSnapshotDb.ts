import { KB_BRANCH, KB_OWNER, KB_REPO } from './githubKb'
import type { TokenSnapshot } from './tokenMonitor'
import type { WorkEnv } from './workEnv'

const DB_DIR = '02_Operations/Workspaces/personal-ops/data/token-usage'

interface StoredSnapshot {
  schemaVersion: 2
  /** GitHub login，与工作环境共同绑定一条缓存 */
  account: string
  workEnv: WorkEnv
  savedAt: string
  snapshot: TokenSnapshot
}

function sanitizeAccount(account: string): string {
  const s = account.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
  return s || 'unknown'
}

/** 账号 + 工作环境绑定路径：token-usage/{account}/{env}.json */
function pathFor(account: string, env: WorkEnv): string {
  return `${DB_DIR}/${sanitizeAccount(account)}/${env}.json`
}

/** 旧版仅按环境存储的路径（兼容读取） */
function legacyPathFor(env: WorkEnv): string {
  return `${DB_DIR}/${env}.json`
}

function contentsUrl(path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  return `https://api.github.com/repos/${KB_OWNER}/${KB_REPO}/contents/${encoded}`
}

function headers(token: string): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

function decodeBase64Utf8(value: string): string {
  const binary = atob(value.replace(/\n/g, ''))
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
}

function parseStored(raw: string): TokenSnapshot | null {
  const stored = JSON.parse(raw) as StoredSnapshot
  if (!stored?.snapshot) return null
  return {
    ...stored.snapshot,
    cached: true,
    updatedAt: stored.savedAt || stored.snapshot.updatedAt,
  }
}

async function fetchStoredAtPath(token: string, path: string): Promise<TokenSnapshot | null> {
  const res = await fetch(`${contentsUrl(path)}?ref=${encodeURIComponent(KB_BRANCH)}&t=${Date.now()}`, {
    headers: headers(token),
    cache: 'no-store',
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`读取缓存失败（GitHub ${res.status}）`)
  const data = (await res.json()) as { content?: string }
  if (!data.content) return null
  return parseStored(decodeBase64Utf8(data.content))
}

/** 读取当前账号 + 工作环境绑定的跨端快照；若无则回退旧版仅按环境的文件。 */
export async function readTokenSnapshot(
  token: string,
  account: string,
  env: WorkEnv
): Promise<TokenSnapshot | null> {
  const bound = await fetchStoredAtPath(token, pathFor(account, env))
  if (bound) return bound
  return fetchStoredAtPath(token, legacyPathFor(env))
}

/** 将一次本机采集结果写入「账号 + 工作环境」绑定路径；冲突时重取 SHA 后重试一次。 */
export async function writeTokenSnapshot(
  token: string,
  account: string,
  env: WorkEnv,
  snapshot: TokenSnapshot
): Promise<void> {
  const login = sanitizeAccount(account)
  const path = pathFor(login, env)
  const stored: StoredSnapshot = {
    schemaVersion: 2,
    account: login,
    workEnv: env,
    savedAt: new Date().toISOString(),
    snapshot: { ...snapshot, cached: false },
  }
  const content = encodeBase64Utf8(`${JSON.stringify(stored, null, 2)}\n`)

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await fetch(`${contentsUrl(path)}?ref=${encodeURIComponent(KB_BRANCH)}&t=${Date.now()}`, {
      headers: headers(token),
      cache: 'no-store',
    })
    const sha = current.ok ? ((await current.json()) as { sha?: string }).sha : undefined
    if (!current.ok && current.status !== 404) {
      throw new Error(`读取数据库版本失败（GitHub ${current.status}）`)
    }

    const res = await fetch(contentsUrl(path), {
      method: 'PUT',
      headers: headers(token),
      body: JSON.stringify({
        message: `chore(token-usage): update ${login}/${env} snapshot`,
        content,
        branch: KB_BRANCH,
        ...(sha ? { sha } : {}),
      }),
    })
    if (res.ok) return
    if (res.status !== 409 || attempt === 1) {
      throw new Error(`写入 Token 数据库失败（GitHub ${res.status}）`)
    }
  }
}
