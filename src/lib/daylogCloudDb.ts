import { KB_BRANCH, KB_OWNER, KB_REPO } from './githubKb'
import {
  getAllEntries,
  getAllObservations,
  getAllWeeklyReports,
  saveEntry,
  saveObservation,
  saveWeeklyReport,
} from './daylogDb'
import { getProfileUpdatedAt, loadProfile, saveProfile } from './daylogProfile'
import type {
  DaylogEntry,
  DaylogProfile,
  DaylogWeeklyReport,
  ProfileObservation,
} from './daylogTypes'

const DB_DIR = '02_Operations/Workspaces/personal-ops/data/daylog'

interface CloudProfile {
  value: DaylogProfile
  updatedAt: number
}

interface DaylogCloudData {
  schemaVersion: 1
  account: string
  savedAt: string
  profile: CloudProfile
  entries: DaylogEntry[]
  weeklyReports: DaylogWeeklyReport[]
  observations: ProfileObservation[]
}

function sanitizeAccount(account: string): string {
  return account.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-') || 'unknown'
}

function dbPath(account: string): string {
  return `${DB_DIR}/${sanitizeAccount(account)}.json`
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

async function readRemote(
  token: string,
  account: string
): Promise<{ data: DaylogCloudData | null; sha?: string }> {
  const res = await fetch(
    `${contentsUrl(dbPath(account))}?ref=${encodeURIComponent(KB_BRANCH)}&t=${Date.now()}`,
    { headers: headers(token), cache: 'no-store' }
  )
  if (res.status === 404) return { data: null }
  if (!res.ok) throw new Error(`读取对话云数据库失败（GitHub ${res.status}）`)
  const json = (await res.json()) as { content?: string; sha?: string }
  if (!json.content) return { data: null, sha: json.sha }
  return {
    data: JSON.parse(decodeBase64Utf8(json.content)) as DaylogCloudData,
    sha: json.sha,
  }
}

async function localSnapshot(account: string): Promise<DaylogCloudData> {
  const [entries, weeklyReports, observations] = await Promise.all([
    getAllEntries(),
    getAllWeeklyReports(),
    getAllObservations(),
  ])
  return {
    schemaVersion: 1,
    account: sanitizeAccount(account),
    savedAt: new Date().toISOString(),
    profile: { value: loadProfile(), updatedAt: getProfileUpdatedAt() },
    entries,
    weeklyReports,
    observations,
  }
}

function mergeByKey<T>(
  local: T[],
  remote: T[],
  keyOf: (item: T) => string,
  timeOf: (item: T) => number
): T[] {
  const merged = new Map<string, T>()
  for (const item of [...remote, ...local]) {
    const key = keyOf(item)
    const previous = merged.get(key)
    if (!previous || timeOf(item) >= timeOf(previous)) merged.set(key, item)
  }
  return [...merged.values()]
}

function mergeData(local: DaylogCloudData, remote: DaylogCloudData | null): DaylogCloudData {
  if (!remote) return local
  // 旧版本地档案没有时间戳（两侧都可能为 0）；平手时以已存在的云端档案为准，
  // 避免新域名上的默认档案覆盖已经完成引导的长期档案。
  const profile = local.profile.updatedAt > remote.profile.updatedAt ? local.profile : remote.profile
  return {
    ...local,
    savedAt: new Date().toISOString(),
    profile,
    entries: mergeByKey(local.entries, remote.entries || [], (e) => e.date, (e) => e.updatedAt),
    weeklyReports: mergeByKey(
      local.weeklyReports,
      remote.weeklyReports || [],
      (r) => r.weekStart,
      (r) => r.createdAt
    ),
    observations: mergeByKey(
      local.observations,
      remote.observations || [],
      (o) => o.id,
      (o) => o.updatedAt
    ),
  }
}

async function applyMerged(data: DaylogCloudData): Promise<void> {
  await Promise.all([
    ...data.entries.map(saveEntry),
    ...data.weeklyReports.map(saveWeeklyReport),
    ...data.observations.map(saveObservation),
  ])
  if (
    data.profile.updatedAt > getProfileUpdatedAt() ||
    JSON.stringify(data.profile.value) !== JSON.stringify(loadProfile())
  ) {
    saveProfile(data.profile.value)
  }
}

async function writeRemote(
  token: string,
  account: string,
  data: DaylogCloudData,
  sha?: string
): Promise<void> {
  const content = encodeBase64Utf8(`${JSON.stringify(data, null, 2)}\n`)
  const res = await fetch(contentsUrl(dbPath(account)), {
    method: 'PUT',
    headers: headers(token),
    body: JSON.stringify({
      message: `chore(daylog): sync ${sanitizeAccount(account)} database`,
      content,
      branch: KB_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  })
  if (!res.ok) throw new Error(`写入对话云数据库失败（GitHub ${res.status}）`)
}

/** 双向合并本机缓存与 GitHub 中的账号级数据库，并将合并结果写回两侧。 */
export async function syncDaylogCloudData(
  token: string,
  account: string
): Promise<DaylogCloudData> {
  const [local, remote] = await Promise.all([localSnapshot(account), readRemote(token, account)])
  const merged = mergeData(local, remote.data)
  await applyMerged(merged)
  await writeRemote(token, account, merged, remote.sha)
  return merged
}
