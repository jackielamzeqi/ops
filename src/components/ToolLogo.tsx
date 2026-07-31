const LOGO: Record<string, string> = {
  claude: 'claude.svg',
  openrouter: 'openrouter.svg',
  codex: 'chatgpt.svg',
  chatgpt: 'chatgpt.svg',
  kimi: 'kimi.svg',
  cursor: 'cursor.svg',
  opencode: 'opencode.svg',
  qoder: 'qoder.png',
}

/** Claude 走 OpenRouter 时显示 OpenRouter 品牌标 */
export function resolveToolLogoId(toolId: string, provider?: string | null): string {
  if (toolId === 'claude' && provider && /openrouter/i.test(provider)) {
    return 'openrouter'
  }
  return toolId
}

export function toolLogoSrc(toolId: string): string {
  const file = LOGO[toolId] || 'cursor.svg'
  const base = import.meta.env.BASE_URL || '/'
  return `${base}icons/tools/${file}?v=5`
}

export function ToolLogo({
  toolId,
  provider,
  size = 16,
  className = '',
}: {
  toolId: string
  provider?: string | null
  size?: number
  className?: string
}) {
  const id = resolveToolLogoId(toolId, provider)
  return (
    <img
      className={`tool-logo ${className}`.trim()}
      src={toolLogoSrc(id)}
      alt=""
      width={size}
      height={size}
      draggable={false}
    />
  )
}
