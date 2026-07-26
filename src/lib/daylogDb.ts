import type { DaylogEntry, DaylogWeeklyReport, ProfileObservation } from './daylogTypes'

const DB_NAME = 'personal-ops-daylog'
/**
 * v1：entries（keyPath date）
 * v2：新增 weeklyReports（keyPath weekStart）
 * v3：新增 observations（keyPath id）
 * onupgradeneeded 对每个 store 都做存在性检查：
 * 老库升级时只补建缺失的 store，不动既有数据；全新库一次建齐。
 */
const DB_VERSION = 3
const STORE_ENTRIES = 'entries'
const STORE_WEEKLY = 'weeklyReports'
const STORE_OBSERVATIONS = 'observations'

function notifyChanged(): void {
  window.dispatchEvent(new CustomEvent('daylog-data-changed'))
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
        db.createObjectStore(STORE_ENTRIES, { keyPath: 'date' })
      }
      if (!db.objectStoreNames.contains(STORE_WEEKLY)) {
        db.createObjectStore(STORE_WEEKLY, { keyPath: 'weekStart' })
      }
      if (!db.objectStoreNames.contains(STORE_OBSERVATIONS)) {
        db.createObjectStore(STORE_OBSERVATIONS, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb()
  try {
    const tx = db.transaction(storeName, mode)
    return await wrap(run(tx.objectStore(storeName)))
  } finally {
    db.close()
  }
}

/* ===== 每日记录 ===== */

export function getEntry(date: string): Promise<DaylogEntry | undefined> {
  return withStore(STORE_ENTRIES, 'readonly', (s) => s.get(date))
}

export function saveEntry(entry: DaylogEntry): Promise<IDBValidKey> {
  return withStore(STORE_ENTRIES, 'readwrite', (s) => s.put(entry)).then((key) => {
    notifyChanged()
    return key
  })
}

export async function getAllEntries(): Promise<DaylogEntry[]> {
  const all = await withStore(
    STORE_ENTRIES,
    'readonly',
    (s) => s.getAll() as IDBRequest<DaylogEntry[]>
  )
  return all.sort((a, b) => a.date.localeCompare(b.date))
}

export function deleteEntry(date: string): Promise<undefined> {
  return withStore(STORE_ENTRIES, 'readwrite', (s) => s.delete(date)).then((result) => {
    notifyChanged()
    return result
  })
}

/* ===== 周报 ===== */

export function getWeeklyReport(weekStart: string): Promise<DaylogWeeklyReport | undefined> {
  return withStore(STORE_WEEKLY, 'readonly', (s) => s.get(weekStart))
}

export function saveWeeklyReport(report: DaylogWeeklyReport): Promise<IDBValidKey> {
  return withStore(STORE_WEEKLY, 'readwrite', (s) => s.put(report)).then((key) => {
    notifyChanged()
    return key
  })
}

export async function getAllWeeklyReports(): Promise<DaylogWeeklyReport[]> {
  return withStore(
    STORE_WEEKLY,
    'readonly',
    (s) => s.getAll() as IDBRequest<DaylogWeeklyReport[]>
  )
}

/* ===== 个人观察 ===== */

export async function getAllObservations(): Promise<ProfileObservation[]> {
  const all = await withStore(
    STORE_OBSERVATIONS,
    'readonly',
    (s) => s.getAll() as IDBRequest<ProfileObservation[]>
  )
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function saveObservation(obs: ProfileObservation): Promise<IDBValidKey> {
  return withStore(STORE_OBSERVATIONS, 'readwrite', (s) => s.put(obs)).then((key) => {
    notifyChanged()
    return key
  })
}

export function deleteObservation(id: string): Promise<undefined> {
  return withStore(STORE_OBSERVATIONS, 'readwrite', (s) => s.delete(id)).then((result) => {
    notifyChanged()
    return result
  })
}

/* ===== 数据管理（说明书 12 节，AC-09） ===== */

/** 清空全部会话记录 */
export function clearEntries(): Promise<undefined> {
  return withStore(STORE_ENTRIES, 'readwrite', (s) => s.clear()).then((result) => {
    notifyChanged()
    return result
  })
}

/** 清空长期画像（观察） */
export function clearObservations(): Promise<undefined> {
  return withStore(STORE_OBSERVATIONS, 'readwrite', (s) => s.clear()).then((result) => {
    notifyChanged()
    return result
  })
}
