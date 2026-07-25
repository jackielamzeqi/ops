// 格式化数字
export function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toString()
}

/** USD → CNY 回退汇率（优先用 useExchangeRate 实时汇率） */
export const USD_CNY = 7.2

// 格式化费用（人民币 ￥）
export function formatCost(n: number): string {
  const v = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (v >= 1000) return `${sign}￥${v.toFixed(0)}`
  return `${sign}￥${v.toFixed(2)}`
}

export function formatUsd(n: number): string {
  const v = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  return `${sign}$${v.toFixed(2)}`
}

export function usdToCny(usd: number, rate: number = USD_CNY): number {
  return Math.round(usd * rate * 100) / 100
}

export function cnyToUsd(cny: number, rate: number = USD_CNY): number {
  if (!rate) return 0
  return Math.round((cny / rate) * 100) / 100
}

// 格式化百分比
export function formatPct(n: number): string {
  return n.toFixed(1) + '%'
}

/** 运行时长：毫秒 → 1h 23m / 45m / 12s */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '—'
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  if (h <= 0) return `${m}m`
  if (m <= 0) return `${h}h`
  return `${h}h ${m}m`
}

// 计算变化率
export function calcChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0
  return ((current - previous) / previous) * 100
}

// 格式化日期
export function formatDateShort(date: string): string {
  const d = new Date(date)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

// 获取工具颜色
export function getToolColor(toolId: string): string {
  const colors: Record<string, string> = {
    chatgpt: '#10a37f',
    claude: '#d97757',
    kimi: '#6366f1',
    hunyuan: '#006eff',
    glm: '#3b82f6',
    deepseek: '#8b5cf6',
    codex: '#10a37f',
    cursor: '#a3a3a3',
  }
  return colors[toolId] || '#888'
}

// 获取工具名称
export function getToolName(toolId: string): string {
  const names: Record<string, string> = {
    chatgpt: 'ChatGPT',
    claude: 'Claude CLI',
    kimi: 'Kimi Code',
    hunyuan: '混元',
    glm: 'GLM',
    deepseek: 'DeepSeek',
    codex: 'ChatGPT',
    cursor: 'Cursor',
  }
  return names[toolId] || toolId
}

// 获取工具图标
export function getToolIcon(toolId: string): string {
  const icons: Record<string, string> = {
    chatgpt: '🟢',
    claude: '🟠',
    kimi: '🔵',
    hunyuan: '🐧',
    glm: '🟣',
    deepseek: '🟪',
    codex: '🟢',
    cursor: '⬜',
  }
  return icons[toolId] || '⚪'
}

// 质量文本
export function qualityText(q: string): string {
  const map: Record<string, string> = {
    directly_usable: '直接可用',
    minor_edit: '小幅修改',
    major_rework: '大量返工',
  }
  return map[q] || q
}

// 质量颜色
export function qualityColor(q: string): string {
  const map: Record<string, string> = {
    directly_usable: 'var(--color-success)',
    minor_edit: 'var(--color-warning)',
    major_rework: 'var(--color-danger)',
  }
  return map[q] || 'var(--color-text-tertiary)'
}
