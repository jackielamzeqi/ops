/** 将 tokscale / 供应商原始模型名规范为可读短名 */

const MODEL_LABELS: Record<string, string> = {
  'kimi-for-coding': 'K2.7',
  'kimi-for-coding-highspeed': 'K2.7 Highspeed',
  k3: 'K3',
  hy3: 'HY3',
  'tencent/hy3': 'HY3',
  'tencent/hy3(free)': 'HY3(free)',
  auto: 'Auto',
  'composer-2.5-fast': 'Composer 2.5',
  'composer-2.5': 'Composer 2.5',
  'cursor-grok-4.5-high-fast': 'Grok 4.5',
  'grok-4.5-fast-xhigh': 'Grok 4.5',
  'z-ai/glm-5.2': 'GLM 5.2',
  'glm-5.2': 'GLM 5.2',
  'opencode-go/glm-5.2': 'GLM 5.2',
  'gpt-5.5': 'GPT-5.5',
  'gpt-5.4-mini': 'GPT-5.4 mini',
  'gpt-5.6-sol': 'GPT-5.6 Sol',
  'gpt-5.6-terra': 'GPT-5.6 Terra',
  'gpt-5.6-luna': 'GPT-5.6 Luna',
  'claude-fable-5-thinking-high': 'Claude Fable 5',
  qmodel_preview: 'QModel Preview',
}

export function formatModelLabel(raw: string): string {
  if (!raw) return '—'
  const key = raw.trim()
  if (MODEL_LABELS[key]) return MODEL_LABELS[key]
  const lower = key.toLowerCase()
  if (MODEL_LABELS[lower]) return MODEL_LABELS[lower]

  // kimi-code/kimi-for-coding → K2.7
  const slug = key.includes('/') ? key.split('/').pop()! : key
  if (MODEL_LABELS[slug]) return MODEL_LABELS[slug]

  if (/kimi-for-coding/i.test(slug)) return 'K2.7'
  if (/^k3$/i.test(slug)) return 'K3'
  if (/hy3/i.test(slug)) return 'HY3'

  // 去掉过长前缀，保留可读尾段
  if (slug.length > 28) return slug.slice(0, 26) + '…'
  return slug
}
