import type { DaylogMode } from './daylogTypes'

/**
 * 快捷回答本地预设池（说明书 7.3，CHAT-03）。
 * 按对话模式 × 阶段（开场/中段/收尾）备候选，每次随机取 2–4 条不重复；
 * 快捷回答不能代替用户原话保存 —— 点击后正文按发送原文存为用户消息（source: 'quick'）。
 */

export type QuickPhase = 'opening' | 'middle' | 'closing'

const POOL: Record<DaylogMode, Record<QuickPhase, string[]>> = {
  review: {
    opening: [
      '今天整体还不错',
      '有点累，想慢慢说',
      '发生了一件让我在意的事',
      '不知道从哪说起，你带我吧',
      '今天挺平淡的',
    ],
    middle: [
      '当时我没多想就做了',
      '其实我有点生气',
      '说不清楚，就是心里有点堵',
      '这件事最近好像经常发生',
      '现在想起来还是有点在意',
      '我后来又想了想，觉得……',
    ],
    closing: [
      '今天差不多就这些',
      '明天想先做一件小事',
      '帮我总结一下今天吧',
      '暂时想不到别的了',
    ],
  },
  emotion: {
    opening: [
      '心里有点闷',
      '今天情绪起伏很大',
      '说不上来的烦躁',
      '其实今天心情不错',
      '有点低落，但说不清原因',
    ],
    middle: [
      '更像是被忽略了',
      '更接近委屈',
      '我也说不清楚为什么',
      '身体上也觉得紧绷',
      '这种感觉很熟悉',
      '大概是焦虑吧',
    ],
    closing: [
      '说出来好受一些了',
      '想给这种情绪起个名字',
      '今天就聊到这吧',
      '帮我看看这种情绪从哪来',
    ],
  },
  clarify: {
    opening: [
      '有件事一直拿不定主意',
      '想理清一段关系里的问题',
      '工作上有个纠结的决定',
      '脑子里很乱，想捋一捋',
    ],
    middle: [
      '我担心的是最坏的结果',
      '两边各有利弊',
      '其实我更在意别人的看法',
      '让我先把事实部分说清楚',
      '这个问题拖了很久了',
    ],
    closing: [
      '现在清楚一些了',
      '帮我列出可选的方案',
      '我想先复述一下结论',
      '剩下的明天再想',
    ],
  },
  quiet: {
    opening: [
      '只想安静地待一会儿',
      '今天不想多说',
      '陪我坐一会儿就好',
      '随便聊聊吧',
    ],
    middle: ['嗯', '还好', '今天就这样吧', '谢谢你在这儿', '没什么特别想说的'],
    closing: ['我想休息了', '今晚就到这吧', '晚安', '明天再继续'],
  },
}

function shuffled<T>(list: T[]): T[] {
  const arr = [...list]
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/** 随机取 2–4 条不重复的快捷回答 */
export function getQuickReplies(mode: DaylogMode, phase: QuickPhase): string[] {
  const list = POOL[mode]?.[phase] ?? POOL.review[phase]
  const want = Math.min(list.length, 2 + Math.floor(Math.random() * 3))
  return shuffled(list).slice(0, Math.max(2, want))
}
