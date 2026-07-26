import type { ObservationStatus, ObservationType, ProfileObservation } from './daylogTypes'
import { OBSERVATION_TYPES } from './daylogTypes'
import { getAllObservations, saveObservation, deleteObservation } from './daylogDb'

/**
 * 个人观察的生成与合并（说明书 7.6 + 11 节）。
 * AI 每日总结产出的「我对自己的一个观察」在此 upsert：
 * 文本相似则合并（occurrences+1、追加 evidenceDates），否则新建一条 pending 观察。
 */

/** 归一化：去空白与标点，用于相似度比较 */
function normalize(text: string): string {
  return text.replace(/[\s，。！？、；：""''（）《》…—·,.!?;:()\[\]]+/g, '')
}

/** 字符 bigram 的 Dice 系数（0–1） */
function bigramDice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0
  const grams = new Set<string>()
  for (let i = 0; i < a.length - 1; i += 1) grams.add(a.slice(i, i + 2))
  let hit = 0
  for (let i = 0; i < b.length - 1; i += 1) {
    if (grams.has(b.slice(i, i + 2))) hit += 1
  }
  return (2 * hit) / (a.length - 1 + b.length - 1)
}

/** 相似判定：归一化后相等 / 互相包含（≥6 字）/ bigram Dice ≥ 0.5 */
export function isSimilarObservation(a: string, b: string): boolean {
  const na = normalize(a)
  const nb = normalize(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.length >= 6 && nb.length >= 6 && (na.includes(nb) || nb.includes(na))) return true
  return bigramDice(na, nb) >= 0.5
}

function newId(): string {
  return `obs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export interface ObservationSeed {
  text: string
  type?: ObservationType
  confidence?: '低' | '中' | '高'
}

/**
 * 把一条新观察写入画像（默认 pending）。
 * 与既有非拒绝观察文本相似时合并：occurrences+1、追加证据日期、置信度取较高者。
 */
export async function upsertObservationFromSeed(seed: ObservationSeed, date: string): Promise<void> {
  const text = seed.text.trim()
  if (!text) return
  const type = seed.type && OBSERVATION_TYPES.includes(seed.type) ? seed.type : '主题'
  const confidence = seed.confidence ?? '低'
  const all = await getAllObservations()
  const similar = all.find((o) => o.status !== 'rejected' && isSimilarObservation(o.text, text))
  const now = Date.now()
  if (similar) {
    const rank = { 低: 0, 中: 1, 高: 2 } as const
    await saveObservation({
      ...similar,
      occurrences: similar.occurrences + 1,
      evidenceDates: similar.evidenceDates.includes(date)
        ? similar.evidenceDates
        : [...similar.evidenceDates, date].sort(),
      confidence: rank[confidence] > rank[similar.confidence] ? confidence : similar.confidence,
      updatedAt: now,
    })
    return
  }
  await saveObservation({
    id: newId(),
    text,
    type,
    evidenceDates: [date],
    occurrences: 1,
    confidence,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  })
}

/** 用文本相似度查找一条观察（用于总结页定位当日「我对自己的一个观察」对应的画像记录） */
export async function findObservationByText(text: string): Promise<ProfileObservation | undefined> {
  const t = text.trim()
  if (!t) return undefined
  const all = await getAllObservations()
  return all.find((o) => isSimilarObservation(o.text, t))
}

/** 把与文本相似的观察置为目标状态（确认 / 拒绝 / 改回待确认）。返回是否命中并更新。 */
export async function setObservationStatusByText(
  text: string,
  status: ObservationStatus
): Promise<boolean> {
  const obs = await findObservationByText(text)
  if (!obs) return false
  await saveObservation({ ...obs, status, updatedAt: Date.now() })
  return true
}

/** 编辑观察正文（用户纠正 AI 措辞）。文本改变后重新参与相似度合并判定。 */
export async function editObservationText(id: string, text: string): Promise<void> {
  const t = text.trim()
  const all = await getAllObservations()
  const obs = all.find((o) => o.id === id)
  if (!obs || !t) return
  await saveObservation({ ...obs, text: t, updatedAt: Date.now() })
}

/** 修改观察类型 */
export async function setObservationType(id: string, type: ObservationType): Promise<void> {
  const all = await getAllObservations()
  const obs = all.find((o) => o.id === id)
  if (!obs) return
  await saveObservation({ ...obs, type, updatedAt: Date.now() })
}

export { deleteObservation }
