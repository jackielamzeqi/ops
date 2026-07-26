import type { DaylogProfile } from './daylogTypes'

/**
 * Daylog 个人档案持久化（说明书 7.1）。
 * 仅存 localStorage（键 daylog-profile），不上传、不进 IndexedDB。
 */

const PROFILE_KEY = 'daylog-profile'

export function createDefaultProfile(): DaylogProfile {
  return {
    nickname: '你',
    mbti: null,
    relationStyle: null,
    goals: [],
    feedbackStyle: 'gentle',
    feedbackStyleSecondary: null,
    defaultDuration: 5,
    memoryLevel: 'summary',
    onboarded: false,
  }
}

/** 读取档案；不存在或损坏时返回默认值（onboarded=false 会触发首次引导） */
export function loadProfile(): DaylogProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (!raw) return createDefaultProfile()
    const parsed = JSON.parse(raw) as Partial<DaylogProfile>
    const base = createDefaultProfile()
    return {
      ...base,
      ...parsed,
      nickname: typeof parsed.nickname === 'string' && parsed.nickname.trim() ? parsed.nickname : base.nickname,
      goals: Array.isArray(parsed.goals) ? parsed.goals : base.goals,
      mbti: parsed.mbti ?? null,
      relationStyle: parsed.relationStyle ?? null,
      feedbackStyleSecondary: parsed.feedbackStyleSecondary ?? null,
      onboarded: parsed.onboarded === true,
    }
  } catch {
    return createDefaultProfile()
  }
}

export function saveProfile(profile: DaylogProfile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  } catch {
    /* 存储不可用时静默失败，不阻断使用 */
  }
}
