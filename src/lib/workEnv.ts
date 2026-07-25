/** 工作环境：用于 AI 工具面板筛选与自动选中 */

export type WorkEnv = 'office' | 'personal' | 'cloud' | 'mobile'

export const WORK_ENVS: { id: WorkEnv; label: string; icon: string }[] = [
  { id: 'office', label: '办公电脑', icon: '💻' },
  { id: 'personal', label: '个人电脑', icon: '💻' },
  { id: 'cloud', label: '云服务器', icon: '☁️' },
  { id: 'mobile', label: '移动终端', icon: '📱' },
]

export function detectWorkEnv(_isPersonalDevice: boolean): WorkEnv {
  const params = new URLSearchParams(window.location.search)
  const forced = params.get('env') as WorkEnv | null
  if (forced && WORK_ENVS.some((e) => e.id === forced)) return forced

  const ua = navigator.userAgent || ''
  const width = window.innerWidth

  // 云环境启发式：远程桌面 / 无头 / 明确标记
  if (
    /Cloud|Codespaces|Gitpod|GitHub Codespaces|Cursor Remote|SSH/i.test(ua) ||
    localStorage.getItem('personal-ops-force-cloud') === '1'
  ) {
    return 'cloud'
  }

  // 移动端优先
  if (width < 768 || /Android|iPhone|iPad|iPod|Mobile/i.test(ua)) {
    return 'mobile'
  }

  // 「个人设备」只控制登录时长，不代表工作环境。
  // 工作环境仅在登录页选择；登录后锁定，切换需退出并用新 PAT 重新登录。
  return 'office'
}
