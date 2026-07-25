/** GitHub 身份校验：白名单 + Device Flow / Token */

export const GITHUB_ALLOWED_USERS = ['jackielamzeqi'] as const

export const GITHUB_CLIENT_ID = (import.meta.env.VITE_GITHUB_CLIENT_ID as string | undefined)?.trim() || ''

/** 生产环境可配 OAuth 代理（同源或 CORS 放行）；开发走 Vite proxy `/gh-oauth` */
export const GITHUB_OAUTH_PROXY =
  (import.meta.env.VITE_GITHUB_OAUTH_PROXY as string | undefined)?.trim() ||
  (import.meta.env.DEV ? '/gh-oauth' : '')

export interface GitHubProfile {
  id: number
  login: string
  name: string | null
  avatar_url: string
  html_url: string
}

export class GitHubAuthError extends Error {
  code: 'network' | 'invalid_token' | 'not_whitelisted' | 'oauth' | 'cancelled'
  constructor(code: GitHubAuthError['code'], message: string) {
    super(message)
    this.code = code
  }
}

export function isWhitelisted(login: string): boolean {
  return GITHUB_ALLOWED_USERS.some((u) => u.toLowerCase() === login.toLowerCase())
}

export async function fetchGitHubProfile(token: string): Promise<GitHubProfile> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (res.status === 401 || res.status === 403) {
    throw new GitHubAuthError('invalid_token', 'GitHub 授权无效或已过期，请重新登录')
  }
  if (!res.ok) {
    throw new GitHubAuthError('network', `GitHub API 错误（${res.status}）`)
  }
  const data = (await res.json()) as GitHubProfile
  if (!data?.login) {
    throw new GitHubAuthError('invalid_token', '无法读取 GitHub 账号信息')
  }
  if (!isWhitelisted(data.login)) {
    throw new GitHubAuthError(
      'not_whitelisted',
      `账号 @${data.login} 不在访问白名单中，无法查看知识库`
    )
  }
  return data
}

interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

function oauthUrl(path: string): string {
  const base = GITHUB_OAUTH_PROXY.replace(/\/$/, '')
  if (!base) {
    throw new GitHubAuthError('oauth', '未配置 OAuth 代理，无法使用设备码登录')
  }
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

export async function startDeviceFlow(): Promise<DeviceCodeResponse> {
  if (!GITHUB_CLIENT_ID) {
    throw new GitHubAuthError('oauth', '未配置 VITE_GITHUB_CLIENT_ID')
  }
  const res = await fetch(oauthUrl('/login/device/code'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      scope: 'read:user repo',
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new GitHubAuthError('oauth', `设备码申请失败：${text || res.status}`)
  }
  return (await res.json()) as DeviceCodeResponse
}

export async function pollDeviceToken(
  deviceCode: string,
  intervalSec: number,
  signal?: AbortSignal
): Promise<string> {
  const interval = Math.max(intervalSec, 5) * 1000
  while (!signal?.aborted) {
    await new Promise((r) => setTimeout(r, interval))
    if (signal?.aborted) throw new GitHubAuthError('cancelled', '已取消登录')

    const res = await fetch(oauthUrl('/login/oauth/access_token'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    })
    const data = (await res.json()) as {
      access_token?: string
      error?: string
      error_description?: string
      interval?: number
    }
    if (data.access_token) return data.access_token
    if (data.error === 'authorization_pending') continue
    if (data.error === 'slow_down') {
      await new Promise((r) => setTimeout(r, (data.interval || 5) * 1000))
      continue
    }
    if (data.error === 'expired_token') {
      throw new GitHubAuthError('oauth', '设备码已过期，请重试')
    }
    if (data.error === 'access_denied') {
      throw new GitHubAuthError('cancelled', '你已拒绝 GitHub 授权')
    }
    throw new GitHubAuthError('oauth', data.error_description || data.error || 'OAuth 失败')
  }
  throw new GitHubAuthError('cancelled', '已取消登录')
}

export function canUseDeviceFlow(): boolean {
  return Boolean(GITHUB_CLIENT_ID && GITHUB_OAUTH_PROXY)
}

export const GITHUB_TOKEN_CREATE_URL =
  'https://github.com/settings/tokens/new?description=Personal-Ops&scopes=read:user,repo'
