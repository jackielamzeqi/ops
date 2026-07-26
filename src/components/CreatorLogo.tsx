/** 大模型厂商图标：优先按 slug/模型名推断，再回退 creator 字段 */

import type { ReactNode } from 'react'

type IconProps = { size?: number; className?: string }

function asset(path: string): string {
  const base = import.meta.env.BASE_URL || '/'
  return `${base}${path.replace(/^\//, '')}?v=3`
}

function LetterMark({
  letter,
  bg,
  size = 18,
  className = '',
}: {
  letter: string
  bg: string
  size?: number
  className?: string
}) {
  return (
    <span
      className={`creator-logo letter ${className}`.trim()}
      style={{
        width: size,
        height: size,
        background: bg,
        fontSize: Math.max(9, Math.round(size * 0.55)),
      }}
      aria-hidden
    >
      {letter}
    </span>
  )
}

function SvgWrap({
  size = 18,
  className = '',
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={`creator-logo ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
    >
      {children}
    </svg>
  )
}

function ImgIcon({
  src,
  size = 18,
  className = '',
  title,
}: {
  src: string
  size?: number
  className?: string
  title: string
}) {
  return (
    <img
      className={`creator-logo ${className}`.trim()}
      src={src}
      alt=""
      title={title}
      width={size}
      height={size}
      draggable={false}
    />
  )
}

function OpenAIIcon(p: IconProps) {
  // 官方六瓣结标（Simple Icons / OpenAI brand），暗色界面用白色描形
  return (
    <SvgWrap {...p}>
      <path
        fill="#fff"
        d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"
      />
    </SvgWrap>
  )
}

function GoogleIcon(p: IconProps) {
  return (
    <SvgWrap {...p}>
      <circle cx="12" cy="12" r="12" fill="#fff" />
      <path fill="#4285F4" d="M20.5 12.2c0-.6-.1-1.1-.2-1.7H12v3.2h4.8a3.5 3.5 0 0 1-1.5 2.3v1.9h2.4c1.4-1.3 2.3-3.3 2.3-5.7z" />
      <path fill="#34A853" d="M12 20.5c2.4 0 4.4-.8 5.9-2.1l-2.4-1.9c-.8.5-1.9.9-3.5.9-2.6 0-4.9-1.8-5.7-4.2H3.7v2c1.5 3 4.6 5.3 8.3 5.3z" />
      <path fill="#FBBC05" d="M6.3 13.2a6.4 6.4 0 0 1 0-2.4V8.8H3.7a10 10 0 0 0 0 6.4l2.6-2z" />
      <path fill="#EA4335" d="M12 5.8c1.5 0 2.9.5 4 1.6l2.2-2.2A8.5 8.5 0 0 0 12 3.5a9.8 9.8 0 0 0-8.3 4.7l2.6 2C7.1 7.8 9.3 5.8 12 5.8z" />
    </SvgWrap>
  )
}

function MetaIcon(p: IconProps) {
  return (
    <SvgWrap {...p}>
      <rect width="24" height="24" rx="5" fill="#0866FF" />
      <path
        fill="#fff"
        d="M8.2 9.2c.9-1.3 2-2 3.1-2 1.2 0 2 .7 2.5 1.8.5-1.1 1.3-1.8 2.5-1.8 1.1 0 2.2.7 3.1 2 1 1.5 1.6 3.5 1.6 5.3h-2.1c0-1.3-.4-2.7-1.1-3.6-.5-.7-1-1-1.5-1s-1 .3-1.5 1c-.7.9-1.1 2.3-1.1 3.6H11c0-1.3-.4-2.7-1.1-3.6-.5-.7-1-1-1.5-1s-1 .3-1.5 1c-.7.9-1.1 2.3-1.1 3.6H3.7c0-1.8.6-3.8 1.6-5.3z"
      />
    </SvgWrap>
  )
}

function XaiIcon(p: IconProps) {
  return (
    <SvgWrap {...p}>
      <rect width="24" height="24" rx="5" fill="#111" stroke="rgba(255,255,255,.2)" />
      <path fill="#fff" d="M7.2 7h3l2.3 3.4L15.2 7H18l-4.1 5.4L18.3 17H15l-2.6-3.7L9.6 17H6.8l4.2-5.2L7.2 7z" />
    </SvgWrap>
  )
}

function DeepSeekIcon(p: IconProps) {
  return (
    <SvgWrap {...p}>
      <rect width="24" height="24" rx="5" fill="#4D6BFE" />
      <circle cx="12" cy="12" r="5.2" fill="none" stroke="#fff" strokeWidth="2" />
      <circle cx="12" cy="12" r="2" fill="#fff" />
    </SvgWrap>
  )
}

function MoonshotIcon(p: IconProps) {
  return (
    <SvgWrap {...p}>
      <rect width="24" height="24" rx="5" fill="#6366f1" />
      <path fill="#fff" d="M14.8 6.8a5.8 5.8 0 1 0 2.4 9.8 7.2 7.2 0 1 1-2.4-9.8z" />
    </SvgWrap>
  )
}

function MiniMaxIcon(p: IconProps) {
  return (
    <SvgWrap {...p}>
      <rect width="24" height="24" rx="5" fill="#E11D48" />
      <path fill="#fff" d="M6 17V7h2.4l2.8 5.8L14 7h2.4v10h-2.2v-6.2L11.6 17h-1.6L7.4 10.8V17H6z" />
    </SvgWrap>
  )
}

function ZhipuIcon(p: IconProps) {
  return (
    <SvgWrap {...p}>
      <rect width="24" height="24" rx="5" fill="#3859FF" />
      <path fill="#fff" d="M7 7h10v2.4h-6.4L17 16.2V17H7v-2.4h6.4L7 7.8V7z" />
    </SvgWrap>
  )
}

function MistralIcon(p: IconProps) {
  return (
    <SvgWrap {...p}>
      <rect width="24" height="24" rx="5" fill="#F7D046" />
      <path fill="#1a1a1a" d="M5.5 17V7H9l2.4 5.8L13.8 7H17v10h-2.6v-5.8L12 17h-1.6l-2.4-5.8V17H5.5z" />
    </SvgWrap>
  )
}

type BrandKey =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'meta'
  | 'xai'
  | 'alibaba'
  | 'deepseek'
  | 'moonshot'
  | 'minimax'
  | 'zhipu'
  | 'mistral'

const BRAND_META: Record<BrandKey, { title: string; render: (p: IconProps) => ReactNode }> = {
  openai: { title: 'OpenAI', render: (p) => <OpenAIIcon {...p} /> },
  anthropic: {
    title: 'Anthropic',
    render: (p) => (
      <ImgIcon src={asset('icons/creators/anthropic.svg')} size={p.size} className={p.className} title="Anthropic" />
    ),
  },
  google: { title: 'Google', render: (p) => <GoogleIcon {...p} /> },
  meta: { title: 'Meta', render: (p) => <MetaIcon {...p} /> },
  xai: { title: 'xAI', render: (p) => <XaiIcon {...p} /> },
  alibaba: {
    title: 'Alibaba',
    render: (p) => (
      <ImgIcon src={asset('icons/creators/alibaba.svg')} size={p.size} className={p.className} title="Alibaba" />
    ),
  },
  deepseek: { title: 'DeepSeek', render: (p) => <DeepSeekIcon {...p} /> },
  moonshot: { title: 'Moonshot', render: (p) => <MoonshotIcon {...p} /> },
  minimax: { title: 'MiniMax', render: (p) => <MiniMaxIcon {...p} /> },
  zhipu: { title: 'Zhipu', render: (p) => <ZhipuIcon {...p} /> },
  mistral: { title: 'Mistral', render: (p) => <MistralIcon {...p} /> },
}

/** 从 slug / 模型名推断厂商（优先于 creator 文本，避免缺字段或错标） */
export function resolveBrandKey(opts: {
  creator?: string | null
  slug?: string | null
  name?: string | null
}): BrandKey | null {
  const slug = (opts.slug || '').toLowerCase()
  const name = (opts.name || '').toLowerCase()
  const creator = (opts.creator || '').toLowerCase()
  const blob = `${slug} ${name} ${creator}`.trim()
  if (!blob) return null

  // Claude / Anthropic：slug 含 claude / sonnet / opus / haiku 即判定（即使 creator 为 —）
  if (
    /claude|anthropic/.test(blob) ||
    (/(^|[-_\s])(sonnet|opus|haiku|fable)([-_\s]|$)/.test(blob) &&
      !/qwen|alibaba|gemini|gpt|grok|llama|glm/.test(blob))
  ) {
    return 'anthropic'
  }
  if (/qwen|alibaba|tongyi|通义|阿里/.test(blob)) return 'alibaba'
  if (/\bgpt|openai|chatgpt|(^|[-_\s])o[1-9]([-_\s.]|$)/.test(blob)) return 'openai'
  if (/gemini|google|deepmind/.test(blob)) return 'google'
  if (/llama|meta\b/.test(blob)) return 'meta'
  if (/grok|xai|spacexai/.test(blob)) return 'xai'
  if (/deepseek/.test(blob)) return 'deepseek'
  if (/kimi|moonshot|月之暗面/.test(blob)) return 'moonshot'
  if (/minimax/.test(blob)) return 'minimax'
  if (/\bglm|zhipu|智谱|\bz ai\b/.test(blob)) return 'zhipu'
  if (/mistral|mixtral/.test(blob)) return 'mistral'

  const c = (opts.creator || '').trim()
  if (/^anthropic$/i.test(c)) return 'anthropic'
  if (/^openai$/i.test(c)) return 'openai'
  if (/^google$/i.test(c)) return 'google'
  if (/^alibaba$/i.test(c)) return 'alibaba'
  if (/^spacexai$/i.test(c) || /^xai$/i.test(c)) return 'xai'
  if (/^z ai$/i.test(c)) return 'zhipu'
  if (/^minimax$/i.test(c)) return 'minimax'
  return null
}

const LETTER_COLORS = ['#0a84ff', '#30d158', '#ff9f0a', '#ff453a', '#bf5af2', '#64d2ff', '#ff375f']

export function CreatorLogo({
  creator,
  slug,
  name,
  size = 18,
  className = '',
}: {
  creator?: string | null
  slug?: string | null
  name?: string | null
  size?: number
  className?: string
}) {
  const brand = resolveBrandKey({ creator, slug, name })
  if (brand) {
    const meta = BRAND_META[brand]
    return (
      <span className="creator-logo-wrap" title={meta.title}>
        {meta.render({ size, className })}
      </span>
    )
  }
  const label = (creator || name || slug || '?').trim()
  if (!label || label === '—') {
    return <LetterMark letter="?" bg="#3a3a3c" size={size} className={className} />
  }
  const letter = label.charAt(0).toUpperCase()
  const bg = LETTER_COLORS[letter.charCodeAt(0) % LETTER_COLORS.length]
  return <LetterMark letter={letter} bg={bg} size={size} className={className} />
}
