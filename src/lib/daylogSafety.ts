/**
 * Daylog 安全流程（说明书 13 节，AC-10）。
 * 命中自伤/自杀/高危关键词时不走 AI，直接返回固定安全文案；
 * 该轮不进入常规复盘或人格分析。system prompt 中另有同等指令兜底。
 */

const RISK_PATTERNS: RegExp[] = [
  /自杀/,
  /自残/,
  /自伤/,
  /不想活/,
  /活不下去/,
  /活下去没意思/,
  /伤害自己/,
  /轻生/,
  /结束生命/,
  /结束这一切/,
  /一了百了/,
  /想死/,
  /寻死/,
  /自我了断/,
  /离开这个世界/,
]

const SAFETY_REPLY = `谢谢你愿意告诉我这些，这一定很不容易。我想先确认一件事：你现在是安全的吗？

这些感受很重要，也值得被真实的人认真听见。如果可以，请现在就联系一个你信任的人，或者拨打专业支持热线：
· 北京心理危机研究与干预中心：010-82951332（24 小时）
· 全国心理援助热线：12356

今晚我们先不做常规复盘。你想说什么，我都在这里听。`

/** 检测高危文本；命中返回固定安全文案，未命中返回 null */
export function checkSafety(text: string): string | null {
  if (!text) return null
  const normalized = text.replace(/\s+/g, '')
  return RISK_PATTERNS.some((re) => re.test(normalized)) ? SAFETY_REPLY : null
}
