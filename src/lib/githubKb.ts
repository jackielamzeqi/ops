/** 从 GitHub 私有知识库仓库拉取文件内容 */

export const KB_OWNER =
  (import.meta.env.VITE_GITHUB_KB_OWNER as string | undefined)?.trim() || 'jackielamzeqi'
export const KB_REPO =
  (import.meta.env.VITE_GITHUB_KB_REPO as string | undefined)?.trim() || 'obsidian_vault'
export const KB_BRANCH =
  (import.meta.env.VITE_GITHUB_KB_BRANCH as string | undefined)?.trim() || 'main'

export interface KbDirEntry {
  name: string
  path: string
  type: 'file' | 'folder'
}

const contentCache = new Map<string, string>()
const dirCache = new Map<string, { at: number; entries: KbDirEntry[] }>()
const DIR_CACHE_MS = 30_000

const REQUEST_TIMEOUT_MS = 15_000
/** 网络抖动 / 5xx 自动重试的退避间隔 */
const RETRY_DELAYS_MS = [600, 1800]

/** 带超时与自动重试的 GitHub API 请求；网络级失败返回中文错误 */
async function githubFetch(url: string, token: string, accept: string): Promise<Response> {
  let lastError: unknown = null
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]))
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        headers: {
          // 注意：不要加 Cache-Control 请求头——GitHub API 的 CORS
          // 预检不允许它，浏览器会直接抛 Failed to fetch。
          // 绕过 HTTP 缓存用 cache: 'no-store' 即可。
          Accept: accept,
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        cache: 'no-store',
        signal: controller.signal,
      })
      if (res.status >= 500 && attempt < RETRY_DELAYS_MS.length) {
        lastError = new Error(`GitHub 服务异常（${res.status}）`)
        continue
      }
      return res
    } catch (e) {
      lastError = e
    } finally {
      clearTimeout(timer)
    }
  }
  if (lastError instanceof DOMException && lastError.name === 'AbortError') {
    throw new Error('连接 GitHub 超时，请检查网络或代理')
  }
  const raw = lastError instanceof Error ? lastError.message : ''
  if (!raw || /failed to fetch|networkerror|load failed/i.test(raw)) {
    throw new Error('无法连接 GitHub，请检查网络或代理')
  }
  throw new Error(raw)
}

function encodePath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join('/')
}

function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ''))
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder('utf-8').decode(bytes)
}

export function getCachedKbContent(path: string): string | null {
  return contentCache.get(path) ?? null
}

export function setCachedKbContent(path: string, content: string) {
  contentCache.set(path, content)
}

export function clearKbContentCache(path?: string) {
  if (path) contentCache.delete(path)
  else contentCache.clear()
}

export function clearKbDirCache(path?: string) {
  if (path != null) dirCache.delete(path)
  else dirCache.clear()
}

/** 列出目录下一级内容 */
export async function fetchKbDirListing(
  token: string,
  dirPath: string,
  opts?: { force?: boolean }
): Promise<KbDirEntry[]> {
  const key = dirPath || ''
  const cached = dirCache.get(key)
  if (!opts?.force && cached && Date.now() - cached.at < DIR_CACHE_MS) {
    return cached.entries
  }

  const url =
    `https://api.github.com/repos/${KB_OWNER}/${KB_REPO}/contents/${encodePath(key)}` +
    `?ref=${encodeURIComponent(KB_BRANCH)}`

  let res: Response
  try {
    res = await githubFetch(url, token, 'application/vnd.github+json')
  } catch (e) {
    // 网络失败：回退最近一次成功的目录列表，保证目录树可用
    if (cached) return cached.entries
    throw e
  }
  if (!res.ok) {
    if (res.status === 404) {
      dirCache.set(key, { at: Date.now(), entries: [] })
      return []
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error('GitHub 权限不足，请使用含 repo 权限的 Token 重新登录')
    }
    throw new Error(`GitHub API 错误（${res.status}）`)
  }
  const data = (await res.json()) as
    | { name: string; path: string; type: string }[]
    | { message?: string }
  if (!Array.isArray(data)) {
    throw new Error((data as { message?: string }).message || '无法读取目录')
  }
  const entries = data
    .filter((e) => e.type === 'file' || e.type === 'dir')
    .map((e) => ({
      name: e.name,
      path: e.path,
      type: e.type === 'dir' ? ('folder' as const) : ('file' as const),
    }))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name, 'zh')
    })
  dirCache.set(key, { at: Date.now(), entries })
  return entries
}

/** 拉取仓库文件正文（Markdown/文本） */
export async function fetchKbFileContent(
  token: string,
  path: string,
  opts?: { force?: boolean }
): Promise<string> {
  if (!opts?.force) {
    const cached = contentCache.get(path)
    if (cached) return cached
  }

  const url =
    `https://api.github.com/repos/${KB_OWNER}/${KB_REPO}/contents/${encodePath(path)}` +
    `?ref=${encodeURIComponent(KB_BRANCH)}`

  const res = await githubFetch(url, token, 'application/vnd.github.raw+json')

  if (res.ok) {
    const ct = res.headers.get('content-type') || ''
    // raw 优先；部分环境仍返回 JSON
    if (ct.includes('application/json')) {
      const data = (await res.json()) as { content?: string; encoding?: string; message?: string }
      if (data.encoding === 'base64' && data.content) {
        const text = decodeBase64Utf8(data.content)
        contentCache.set(path, text)
        return text
      }
      throw new Error(data.message || '无法解析文件内容')
    }
    const text = await res.text()
    contentCache.set(path, text)
    return text
  }

  // 回退：标准 contents JSON
  const jsonRes = await githubFetch(url, token, 'application/vnd.github+json')
  if (!jsonRes.ok) {
    if (jsonRes.status === 404) throw new Error('仓库中未找到该文件')
    if (jsonRes.status === 401 || jsonRes.status === 403) {
      throw new Error('GitHub 权限不足，请使用含 repo 权限的 Token 重新登录')
    }
    throw new Error(`GitHub API 错误（${jsonRes.status}）`)
  }
  const data = (await jsonRes.json()) as {
    type?: string
    content?: string
    encoding?: string
    message?: string
  }
  if (data.type === 'dir') throw new Error('这是文件夹，请选择具体文件')
  if (data.encoding === 'base64' && data.content) {
    const text = decodeBase64Utf8(data.content)
    contentCache.set(path, text)
    return text
  }
  throw new Error(data.message || '无法读取文件内容')
}
