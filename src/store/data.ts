// 知识库目录树结构 - 映射 ~/obsidian_vault 真实结构
export interface TreeNode {
  name: string
  path: string
  type: 'folder' | 'file'
  children?: TreeNode[]
  fileCount?: number
}

/** 将路径列表并入目录树，补全下级文件夹与文件节点 */
export function enrichTreeWithPaths(roots: TreeNode[], paths: string[]): TreeNode[] {
  const tree: TreeNode[] = JSON.parse(JSON.stringify(roots)) as TreeNode[]
  const byPath = new Map<string, TreeNode>()

  const indexNode = (node: TreeNode) => {
    byPath.set(node.path, node)
    node.children?.forEach(indexNode)
  }
  tree.forEach(indexNode)

  const ensureFolder = (folderPath: string) => {
    if (byPath.has(folderPath)) return byPath.get(folderPath)!
    const parts = folderPath.split('/').filter(Boolean)
    let acc = ''
    let parent: TreeNode | null = null
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part
      let node = byPath.get(acc)
      if (!node) {
        node = { name: part, path: acc, type: 'folder', children: [] }
        byPath.set(acc, node)
        if (parent) {
          parent.children = parent.children || []
          parent.children.push(node)
        } else {
          tree.push(node)
        }
      }
      if (!node.children) node.children = []
      parent = node
    }
    return byPath.get(folderPath)!
  }

  for (const filePath of paths) {
    const parts = filePath.split('/').filter(Boolean)
    if (parts.length === 0) continue
    const fileName = parts[parts.length - 1]
    const parentPath = parts.slice(0, -1).join('/')
    if (!parentPath) continue
    const parent = ensureFolder(parentPath)
    parent.children = parent.children || []
    if (!parent.children.some((c) => c.path === filePath)) {
      parent.children.push({ name: fileName, path: filePath, type: 'file' })
    }
  }

  const sortAndCount = (nodes: TreeNode[]): number => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name, 'zh')
    })
    let count = 0
    for (const n of nodes) {
      if (n.type === 'file') count += 1
      else if (n.children?.length) {
        const c = sortAndCount(n.children)
        n.fileCount = c
        count += c
      } else {
        n.fileCount = n.fileCount ?? 0
      }
    }
    return count
  }
  sortAndCount(tree)
  return tree
}

export const knowledgeTree: TreeNode[] = [
  {
    name: '00_Inbox',
    path: '00_Inbox',
    type: 'folder',
    fileCount: 19,
    children: [
      { name: 'Briefing', path: '00_Inbox/Briefing', type: 'folder' },
      { name: 'TODO', path: '00_Inbox/TODO', type: 'folder' },
      { name: 'vChat', path: '00_Inbox/vChat', type: 'folder' },
      { name: '2026-07-02-Pass凭证暂存产品定位', path: '00_Inbox/2026-07-02-Pass凭证暂存产品定位', type: 'folder' },
      { name: '2026-07-02-云端取餐码识别链路耗时', path: '00_Inbox/2026-07-02-云端取餐码识别链路耗时', type: 'folder' },
      { name: '2026-07-02-外销智慧服务技术链路', path: '00_Inbox/2026-07-02-外销智慧服务技术链路', type: 'folder' },
      { name: '2026-07-02-安卓17-Screen-Reactions合作评估', path: '00_Inbox/2026-07-02-安卓17-Screen-Reactions合作评估', type: 'folder' },
      { name: '2026-07-02-小V记忆与截屏关系', path: '00_Inbox/2026-07-02-小V记忆与截屏关系', type: 'folder' },
      { name: '2026-07-02-端侧票券码可行性评估', path: '00_Inbox/2026-07-02-端侧票券码可行性评估', type: 'folder' },
      { name: '2026-07-03-券码卡包可用性测试', path: '00_Inbox/2026-07-03-券码卡包可用性测试', type: 'folder' },
      { name: '2026-07-03-取餐码OS6版本发布计划', path: '00_Inbox/2026-07-03-取餐码OS6版本发布计划', type: 'folder' },
      { name: '2026-07-03-截屏直达技术链路', path: '00_Inbox/2026-07-03-截屏直达技术链路', type: 'folder' },
      { name: '2026-07-06-OS7指标风险池', path: '00_Inbox/2026-07-06-OS7指标风险池', type: 'folder' },
      { name: '2026-07-06-截屏小V解题决策', path: '00_Inbox/2026-07-06-截屏小V解题决策', type: 'folder' },
      { name: '2026-07-06-票券码AI可行性评估', path: '00_Inbox/2026-07-06-票券码AI可行性评估', type: 'folder' },
      { name: '2026-07-07-外销AI功能屏蔽', path: '00_Inbox/2026-07-07-外销AI功能屏蔽', type: 'folder' },
      { name: '2026-07-09-小V记忆识屏算法指标', path: '00_Inbox/2026-07-09-小V记忆识屏算法指标', type: 'folder' },
      { name: '2026-07-11-截屏二期埋点', path: '00_Inbox/2026-07-11-截屏二期埋点', type: 'folder' },
      { name: '2026-07-14-取餐码推送机型版本', path: '00_Inbox/2026-07-14-取餐码推送机型版本', type: 'folder' },
    ],
  },
  {
    name: '01_Raw',
    path: '01_Raw',
    type: 'folder',
    fileCount: 60,
    children: [
      { name: 'Calls', path: '01_Raw/Calls', type: 'folder' },
      { name: 'Chat', path: '01_Raw/Chat', type: 'folder' },
      { name: 'Meetings', path: '01_Raw/Meetings', type: 'folder' },
      { name: 'Notes', path: '01_Raw/Notes', type: 'folder' },
      { name: 'Reports', path: '01_Raw/Reports', type: 'folder' },
      { name: 'Requirements', path: '01_Raw/Requirements', type: 'folder' },
      { name: 'Snap', path: '01_Raw/Snap', type: 'folder' },
    ],
  },
  {
    name: '02_Operations',
    path: '02_Operations',
    type: 'folder',
    fileCount: 30,
    children: [
      { name: 'Decisions', path: '02_Operations/Decisions', type: 'folder' },
      { name: 'GitHub', path: '02_Operations/GitHub', type: 'folder' },
      { name: 'Projects', path: '02_Operations/Projects', type: 'folder' },
      { name: 'Sites', path: '02_Operations/Sites', type: 'folder' },
      { name: 'Tasks', path: '02_Operations/Tasks', type: 'folder' },
    ],
  },
  {
    name: '03_Wiki',
    path: '03_Wiki',
    type: 'folder',
    fileCount: 25,
    children: [
      { name: 'Concepts', path: '03_Wiki/Concepts', type: 'folder' },
      { name: 'Relationships', path: '03_Wiki/Relationships', type: 'folder' },
      { name: 'Reviews', path: '03_Wiki/Reviews', type: 'folder' },
      { name: 'Syntheses', path: '03_Wiki/Syntheses', type: 'folder' },
      { name: 'Theses', path: '03_Wiki/Theses', type: 'folder' },
    ],
  },
  {
    name: '99_System',
    path: '99_System',
    type: 'folder',
    fileCount: 15,
    children: [
      { name: 'Assets', path: '99_System/Assets', type: 'folder' },
      { name: 'Gateway', path: '99_System/Gateway', type: 'folder' },
      { name: 'Governance', path: '99_System/Governance', type: 'folder' },
      { name: 'Prompts', path: '99_System/Prompts', type: 'folder' },
      { name: 'Runtime', path: '99_System/Runtime', type: 'folder' },
      { name: 'Skills', path: '99_System/Skills', type: 'folder' },
      { name: 'Templates', path: '99_System/Templates', type: 'folder' },
      { name: 'Workflows', path: '99_System/Workflows', type: 'folder' },
    ],
  },
]

// 文件内容模拟
export const fileContents: Record<string, string> = {
  '00_Inbox/README.md': `# 00_Inbox\n\n收件箱——所有新捕获的信息先进入这里，等待分类和加工。\n\n## 子目录\n\n- **Briefing**: 每日简报\n- **TODO**: 待办事项\n- **vChat**: 对话记录\n- 日期前缀文件夹: 按日期组织的临时调研主题\n\n## 规则\n\n1. Inbox 中的内容每周清理一次\n2. 已加工的迁移到 01_Raw 或 03_Wiki\n3. 超过 30 天未处理的归档或删除`,
  '00_Inbox/TODO/README.md': `# TODO\n\n## 进行中\n\n- [ ] 截屏直达二期埋点上线\n- [ ] 取餐码推送机型版本对齐\n- [ ] OS7指标风险池评审\n\n## 待办\n\n- [ ] 票券码AI可行性评估\n- [ ] 小V记忆识屏算法指标对齐\n- [ ] 外销AI功能屏蔽方案确认`,
  '00_Inbox/Briefing/README.md': `# 每日简报\n\n生成每日工作简报，包含：\n\n- 今日会议\n- 待处理任务\n- 进度更新\n- 风险提示`,
  '00_Inbox/vChat/README.md': `# vChat\n\n对话记录区——保存重要的 IM 对话、邮件讨论等内容。`,
  '01_Raw/Chat/README.md': `# Chat\n\n聊天记录归档。按年份组织。`,
  '01_Raw/Meetings/04/2026-04-08 截屏接入贴纸库动效评审.md': `# 截屏接入贴纸库动效评审\n\n**日期**: 2026-04-08\n**参会**: 设计组、开发组、产品组\n\n## 议题\n\n1. 贴纸库动效接入截屏流程\n2. 动效时长与性能影响\n3. 用户感知测试方案\n\n## 结论\n\n- 动效时长控制在 300ms 以内\n- 贴纸库预加载方案通过\n- 下周二出视觉稿`,
}

// 搜索索引
export const searchIndex: { path: string; title: string; preview: string }[] = [
  { path: '00_Inbox/TODO/README.md', title: 'TODO', preview: '截屏直达二期埋点上线、取餐码推送机型版本对齐、OS7指标风险池评审...' },
  { path: '00_Inbox/Briefing/README.md', title: 'Briefing 每日简报', preview: '生成每日工作简报，包含今日会议、待处理任务、进度更新...' },
  { path: '00_Inbox/2026-07-02-Pass凭证暂存产品定位/context.md', title: 'Pass凭证暂存产品定位', preview: '研究 Pass 凭证暂存的产品定位和场景...' },
  { path: '00_Inbox/2026-07-02-云端取餐码识别链路耗时/context.md', title: '云端取餐码识别链路耗时', preview: '分析云端取餐码识别的全链路耗时...' },
  { path: '00_Inbox/2026-07-02-外销智慧服务技术链路/context.md', title: '外销智慧服务技术链路', preview: '外销版本智慧服务的技术链路梳理...' },
  { path: '00_Inbox/2026-07-02-安卓17-Screen-Reactions合作评估/context.md', title: '安卓17 Screen-Reactions合作评估', preview: '评估安卓17 Screen-Reactions合作的可能性和价值...' },
  { path: '00_Inbox/2026-07-02-小V记忆与截屏关系/context.md', title: '小V记忆与截屏关系', preview: '分析小V记忆功能与截屏的关联关系...' },
  { path: '00_Inbox/2026-07-02-端侧票券码可行性评估/context.md', title: '端侧票券码可行性评估', preview: '评估端侧票券码识别的可行性...' },
  { path: '00_Inbox/2026-07-03-券码卡包可用性测试/context.md', title: '券码卡包可用性测试', preview: '券码卡包功能的可用性测试报告...' },
  { path: '00_Inbox/2026-07-03-取餐码OS6版本发布计划/context.md', title: '取餐码OS6版本发布计划', preview: '取餐码在OS6版本的发布计划...' },
  { path: '00_Inbox/2026-07-03-截屏直达技术链路/context.md', title: '截屏直达技术链路', preview: '截屏直达的技术链路分析...' },
  { path: '00_Inbox/2026-07-06-OS7指标风险池/context.md', title: 'OS7指标风险池', preview: 'OS7版本的核心指标风险池...' },
  { path: '00_Inbox/2026-07-06-截屏小V解题决策/context.md', title: '截屏小V解题决策', preview: '截屏与小V解题的决策评估...' },
  { path: '00_Inbox/2026-07-06-票券码AI可行性评估/context.md', title: '票券码AI可行性评估', preview: '票券码AI识别的可行性评估...' },
  { path: '00_Inbox/2026-07-07-外销AI功能屏蔽/context.md', title: '外销AI功能屏蔽', preview: '外销版本AI功能屏蔽方案...' },
  { path: '00_Inbox/2026-07-09-小V记忆识屏算法指标/context.md', title: '小V记忆识屏算法指标', preview: '小V记忆识屏算法的核心指标...' },
  { path: '00_Inbox/2026-07-11-截屏二期埋点/context.md', title: '截屏二期埋点', preview: '截屏直达二期的埋点方案...' },
  { path: '00_Inbox/2026-07-14-取餐码推送机型版本/context.md', title: '取餐码推送机型版本', preview: '取餐码推送的机型和版本覆盖...' },
  { path: '01_Raw/Meetings/04/2026-04-08 截屏接入贴纸库动效评审.md', title: '截屏接入贴纸库动效评审', preview: '贴纸库动效接入截屏流程评审...' },
  { path: '01_Raw/Meetings/04/2026-04-08 截屏直达升版策划评审.md', title: '截屏直达升版策划评审', preview: '截屏直达升版策划评审会议纪要...' },
  { path: '01_Raw/Meetings/04/2026-04-14 内销截屏直达可行性评审.md', title: '内销截屏直达可行性评审', preview: '内销截屏直达可行性评审...' },
  { path: '01_Raw/Meetings/04/2026-04-14 外销截屏直达设置方案PRD评审.md', title: '外销截屏直达设置方案PRD评审', preview: '外销截屏直达设置方案PRD评审...' },
  { path: '01_Raw/Meetings/04/2026-04-20 外销截屏直达升版二期PRD评审.md', title: '外销截屏直达升版二期PRD评审', preview: '外销截屏直达升版二期PRD评审...' },
  { path: '01_Raw/Meetings/04/2026-04-22 券码卡UI升版评审.md', title: '券码卡UI升版评审', preview: '券码卡UI升版评审会议纪要...' },
  { path: '01_Raw/Meetings/04/2026-04-22 取餐码UI升版评审.md', title: '取餐码UI升版评审', preview: '取餐码UI升版评审会议纪要...' },
  { path: '01_Raw/Meetings/04/2026-04-22 算法可行性评审.md', title: '算法可行性评审', preview: '算法可行性评审会议纪要...' },
  { path: '01_Raw/Meetings/04/2026-04-23_1430 内销识屏记二期PRD评审.md', title: '内销识屏记二期PRD评审', preview: '内销识屏记二期PRD评审...' },
  { path: '01_Raw/Meetings/04/2026-04-23_1930 内销票券码可行性评审.md', title: '内销票券码可行性评审', preview: '内销票券码可行性评审...' },
  { path: '01_Raw/Meetings/04/2026-04-24_1630 外销截屏直达策划评审.md', title: '外销截屏直达策划评审', preview: '外销截屏直达策划评审...' },
  { path: '01_Raw/Meetings/04/2026-04-27_1430 离线大模型PRD升版评审.md', title: '离线大模型PRD升版评审', preview: '离线大模型PRD升版评审...' },
  { path: '01_Raw/Meetings/04/2026-04-29_1000 截屏隐藏状态栏和导航栏PRD评审.md', title: '截屏隐藏状态栏和导航栏PRD评审', preview: '截屏隐藏状态栏和导航栏PRD评审...' },
  { path: '01_Raw/Meetings/05/2026-05-09_1100 截屏直达新增离线大模型策划评审.md', title: '截屏直达新增离线大模型策划评审', preview: '截屏直达新增离线大模型策划评审...' },
  { path: '01_Raw/Meetings/05/2026-05-11_1900 识屏记接入小v建议.md', title: '识屏记接入小v建议', preview: '识屏记接入小v建议...' },
  { path: '01_Raw/Meetings/05/2026-05-12_1600 小v记忆接入智慧截屏二期PRD评审.md', title: '小v记忆接入智慧截屏二期PRD评审', preview: '小v记忆接入智慧截屏二期PRD评审...' },
  { path: '01_Raw/Meetings/05/2026-05-13 截屏直达一期埋点需求评审.md', title: '截屏直达一期埋点需求评审', preview: '截屏直达一期埋点需求评审...' },
  { path: '01_Raw/Meetings/05/2026-05-13_1900 取餐码UI改版.md', title: '取餐码UI改版', preview: '取餐码UI改版评审...' },
  { path: '01_Raw/Meetings/05/2026-05-15 取餐码改版需求评审.md', title: '取餐码改版需求评审', preview: '取餐码改版需求评审...' },
  { path: '01_Raw/Meetings/05/2026-05-15_1000 票券码场景及字段数据策略.md', title: '票券码场景及字段数据策略', preview: '票券码场景及字段数据策略...' },
  { path: '01_Raw/Meetings/05/2026-05-18_1915 超级卡包测试用例评审.md', title: '超级卡包测试用例评审', preview: '超级卡包测试用例评审...' },
  { path: '01_Raw/Meetings/05/2026-05-19_1000 原子岛专项会议.md', title: '原子岛专项会议', preview: '原子岛专项会议纪要...' },
  { path: '01_Raw/Meetings/05/2026-05-19_1630 取餐码改版策划评审.md', title: '取餐码改版策划评审', preview: '取餐码改版策划评审...' },
  { path: '01_Raw/Meetings/05/2026-05-25_1430 取件码识别和提醒需求评审.md', title: '取件码识别和提醒需求评审', preview: '取件码识别和提醒需求评审...' },
  { path: '01_Raw/Meetings/05/2026-05-26_1000 取餐码改版UI评审.md', title: '取餐码改版UI评审', preview: '取餐码改版UI评审...' },
  { path: '01_Raw/Meetings/05/2026-05-26_1430 原子岛专项例会.md', title: '原子岛专项例会', preview: '原子岛专项例会纪要...' },
  { path: '01_Raw/Meetings/05/2026-05-26_1930 截屏直达算法软件设计方案评审.md', title: '截屏直达算法软件设计方案评审', preview: '截屏直达算法软件设计方案评审...' },
  { path: '01_Raw/Meetings/06/2026-06-03_1400 截屏AI多窗口触发识别策略评审.md', title: '截屏AI多窗口触发识别策略评审', preview: '截屏AI多窗口触发识别策略评审...' },
  { path: '01_Raw/Meetings/06/2026-06-05_1000 截屏AI管理功能介绍PRD评审.md', title: '截屏AI管理功能介绍PRD评审', preview: '截屏AI管理功能介绍PRD评审...' },
  { path: '01_Raw/Meetings/06/2026-06-09_1430 OS7.0软件变更评审.md', title: 'OS7.0软件变更评审', preview: 'OS7.0软件变更评审...' },
  { path: '01_Raw/Meetings/06/2026-06-10_1000 OS7.0软件变更评审.md', title: 'OS7.0软件变更评审', preview: 'OS7.0软件变更评审...' },
  { path: '01_Raw/Meetings/06/2026-06-11_1000 OS7.0截屏直达升版评审.md', title: 'OS7.0截屏直达升版评审', preview: 'OS7.0截屏直达升版评审...' },
  { path: '01_Raw/Meetings/06/2026-06-12_1000 截屏直达灰度复盘.md', title: '截屏直达灰度复盘', preview: '截屏直达灰度复盘...' },
  { path: '01_Raw/Meetings/06/2026-06-16_1000 OS7.0截屏AI升版PRD评审.md', title: 'OS7.0截屏AI升版PRD评审', preview: 'OS7.0截屏AI升版PRD评审...' },
  { path: '01_Raw/Meetings/06/2026-06-17_1000 截屏AI管理升版功能介绍评审.md', title: '截屏AI管理升版功能介绍评审', preview: '截屏AI管理升版功能介绍评审...' },
  { path: '01_Raw/Meetings/06/2026-06-18_1000 OS7.0软件变更截屏需求评审.md', title: 'OS7.0软件变更截屏需求评审', preview: 'OS7.0软件变更截屏需求评审...' },
  { path: '01_Raw/Meetings/06/2026-06-23_1000 截屏二期埋点需求评审.md', title: '截屏二期埋点需求评审', preview: '截屏二期埋点需求评审...' },
  { path: '01_Raw/Meetings/06/2026-06-24_1000 截屏AI边缘场景评审.md', title: '截屏AI边缘场景评审', preview: '截屏AI边缘场景评审...' },
  { path: '01_Raw/Meetings/06/2026-06-25_1000 截屏AI边缘场景产品决策评审.md', title: '截屏AI边缘场景产品决策评审', preview: '截屏AI边缘场景产品决策评审...' },
  { path: '01_Raw/Meetings/06/2026-06-26_1000 OS7.0截屏AI升版PRD终审.md', title: 'OS7.0截屏AI升版PRD终审', preview: 'OS7.0截屏AI升版PRD终审...' },
  { path: '01_Raw/Meetings/07/2026-07-01_1000 OS7.0截屏AI升版PRD再审.md', title: 'OS7.0截屏AI升版PRD再审', preview: 'OS7.0截屏AI升版PRD再审...' },
  { path: '01_Raw/Meetings/07/2026-07-02_1000 截屏AI专利评审.md', title: '截屏AI专利评审', preview: '截屏AI专利评审...' },
  { path: '01_Raw/Meetings/07/2026-07-03_1000 截屏AI边缘场景产品决策点评审.md', title: '截屏AI边缘场景产品决策点评审', preview: '截屏AI边缘场景产品决策点评审...' },
  { path: '02_Operations/Decisions/README.md', title: 'Decisions', preview: '产品决策记录...' },
  { path: '02_Operations/Projects/SPD2601_OS7.0/README.md', title: 'SPD2601 OS7.0', preview: 'OS7.0 项目空间...' },
  { path: '02_Operations/Projects/SPD2614_精细交互专项/README.md', title: 'SPD2614 精细交互专项', preview: '精细交互专项项目...' },
  { path: '02_Operations/Projects/SPD2622_RSA5.0/README.md', title: 'SPD2622 RSA5.0', preview: 'RSA5.0 海外项目...' },
  { path: '02_Operations/Projects/截屏AI专利/README.md', title: '截屏AI专利', preview: '截屏AI专利项目...' },
  { path: '02_Operations/Projects/截屏AI多窗口触发识别策略/README.md', title: '截屏AI多窗口触发识别策略', preview: '截屏AI多窗口触发识别策略...' },
  { path: '02_Operations/Projects/截屏AI管理-OS7功能介绍/README.md', title: '截屏AI管理 OS7功能介绍', preview: '截屏AI管理 OS7功能介绍...' },
  { path: '02_Operations/Projects/截屏AI边缘场景-产品决策点/README.md', title: '截屏AI边缘场景 产品决策点', preview: '截屏AI边缘场景产品决策点...' },
  { path: '02_Operations/Projects/截屏直达二期埋点/README.md', title: '截屏直达二期埋点', preview: '截屏直达二期埋点...' },
  { path: '02_Operations/Sites/report-workflow-showcase/README.md', title: 'report-workflow-showcase', preview: '报告工作流展示站点...' },
  { path: '02_Operations/Sites/smartshot-km/README.md', title: 'smartshot-km', preview: '智慧截屏知识管理站点...' },
  { path: '02_Operations/Tasks/done/README.md', title: '已完成任务', preview: '已完成的任务归档...' },
  { path: '02_Operations/Tasks/dropped/README.md', title: '已放弃任务', preview: '已放弃的任务归档...' },
  { path: '03_Wiki/Concepts/SmartShot/README.md', title: 'SmartShot 概念', preview: '智慧截屏概念定义...' },
  { path: '03_Wiki/Concepts/VivoAssistant/README.md', title: 'VivoAssistant 概念', preview: '小V助手概念定义...' },
  { path: '03_Wiki/Concepts/VivoSuggestion/README.md', title: 'VivoSuggestion 概念', preview: 'vivo 建议概念定义...' },
  { path: '03_Wiki/Concepts/Travel/README.md', title: 'Travel 概念', preview: '旅行助手概念定义...' },
  { path: '03_Wiki/Concepts/Globalization/README.md', title: 'Globalization 概念', preview: '全球化概念定义...' },
  { path: '03_Wiki/Relationships/Department/README.md', title: '部门关系', preview: '部门组织架构和关系...' },
  { path: '03_Wiki/Relationships/Module/README.md', title: '模块关系', preview: '产品模块关系...' },
  { path: '03_Wiki/Relationships/Summaries/README.md', title: '关系摘要', preview: '关键关系摘要...' },
  { path: '03_Wiki/Reviews/Daily_Review/README.md', title: '每日复盘', preview: '每日工作复盘...' },
  { path: '03_Wiki/Reviews/MEAT/README.md', title: 'MEAT 复盘', preview: 'MEAT 框架复盘...' },
  { path: '03_Wiki/Reviews/Travel/README.md', title: '旅行复盘', preview: '旅行相关复盘...' },
  { path: '03_Wiki/Syntheses/README.md', title: '综合', preview: '综合性文章和笔记...' },
  { path: '03_Wiki/Theses/README.md', title: '论点', preview: '观点和论点记录...' },
  { path: '99_System/Gateway/README.md', title: 'Gateway', preview: '系统网关配置...' },
  { path: '99_System/Governance/README.md', title: 'Governance', preview: '治理规则...' },
  { path: '99_System/Prompts/README.md', title: 'Prompts', preview: '提示词模板...' },
  { path: '99_System/Templates/README.md', title: 'Templates', preview: '文档模板...' },
  { path: '99_System/Workflows/README.md', title: 'Workflows', preview: '工作流定义...' },
]

/** 可展开的完整目录树：骨架 + 搜索索引 + 本地 mock 文件 */
export const knowledgeTreeFull: TreeNode[] = enrichTreeWithPaths(knowledgeTree, [
  ...Object.keys(fileContents),
  ...searchIndex.map((i) => i.path),
])

// AI 工具数据
export interface AITool {
  id: string
  name: string
  vendor: string
  models: string[]
  subscriptionPrice: number
  apiInputPrice: number
  apiOutputPrice: number
  color: string
  icon: string
}

// 本机可检测工具优先（Codex / Claude / Kimi / Cursor / OpenCode）
// subscriptionPrice：目录默认美元/月；应用内持久化为人民币，编辑后按录入值直接展示
// OpenCode 走按量计费（BYOK），目录默认 0；Token 用量来自本地 SQLite
export const aiTools: AITool[] = [
  { id: 'codex', name: 'ChatGPT', vendor: 'OpenAI', models: ['gpt-5.5', 'gpt-5.4-mini'], subscriptionPrice: 20, apiInputPrice: 18, apiOutputPrice: 72, color: '#10a37f', icon: '🟢' },
  { id: 'claude', name: 'Claude Code', vendor: 'Anthropic', models: ['Claude Sonnet', 'Claude Opus'], subscriptionPrice: 20, apiInputPrice: 22, apiOutputPrice: 108, color: '#d97757', icon: '🟠' },
  { id: 'kimi', name: 'Kimi Code', vendor: '月之暗面', models: ['kimi-for-coding', 'k3'], subscriptionPrice: 14, apiInputPrice: 8.6, apiOutputPrice: 8.6, color: '#6366f1', icon: '🔵' },
  { id: 'cursor', name: 'Cursor', vendor: 'Anysphere', models: ['Cursor Agent', 'Cursor CLI'], subscriptionPrice: 20, apiInputPrice: 0, apiOutputPrice: 0, color: '#a3a3a3', icon: '⬜' },
  { id: 'opencode', name: 'OpenCode', vendor: 'OpenCode', models: ['glm-5.2'], subscriptionPrice: 0, apiInputPrice: 0.5, apiOutputPrice: 1.5, color: '#5b8def', icon: '🔵' },
  { id: 'qoder', name: 'Qoder', vendor: 'Qoder', models: ['auto', 'qmodel_preview'], subscriptionPrice: 0, apiInputPrice: 0, apiOutputPrice: 0, color: '#1366EC', icon: '🔷' },
]

export type WorkEnvId = 'office' | 'personal' | 'cloud' | 'mobile'

// 每日 Token 数据（30天模拟）
export interface DailyTokenRecord {
  date: string
  toolId: string
  model: string
  env: WorkEnvId
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  cost: number
  taskCount: number
  scenario: string
  quality: 'directly_usable' | 'minor_edit' | 'major_rework'
  reworkRounds: number
}

function generateDailyData(): DailyTokenRecord[] {
  const records: DailyTokenRecord[] = []
  const scenarios = ['PRD撰写', '竞品研究', '长文档总结', '截图分析', '数据分析', '代码与Demo', '知识库整理', '邮件沟通']
  const models: Record<string, string> = {
    chatgpt: 'GPT-4o', claude: 'Claude 3.5 Sonnet', kimi: 'kimi-k1.5',
    hunyuan: 'hunyuan-pro', glm: 'GLM-4-Plus', deepseek: 'deepseek-chat'
  }
  const qualities: DailyTokenRecord['quality'][] = ['directly_usable', 'minor_edit', 'major_rework']
  const envs: WorkEnvId[] = ['office', 'personal', 'cloud', 'mobile']
  // 办公权重更高，贴近真实使用
  const envWeights = [0.42, 0.28, 0.12, 0.18]

  const pickEnv = (): WorkEnvId => {
    const r = Math.random()
    let acc = 0
    for (let i = 0; i < envs.length; i++) {
      acc += envWeights[i]
      if (r <= acc) return envs[i]
    }
    return 'office'
  }

  for (let d = 29; d >= 0; d--) {
    const date = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)
    const count = Math.floor(Math.random() * 4) + 2
    for (let i = 0; i < count; i++) {
      const tool = aiTools[Math.floor(Math.random() * aiTools.length)]
      const inputT = Math.floor(Math.random() * 80000) + 5000
      const outputT = Math.floor(Math.random() * 30000) + 2000
      const cacheT = Math.floor(Math.random() * 20000)
      const cost = (inputT * tool.apiInputPrice + outputT * tool.apiOutputPrice) / 1000000
      records.push({
        date,
        toolId: tool.id,
        model: models[tool.id] || tool.models[0],
        env: pickEnv(),
        inputTokens: inputT,
        outputTokens: outputT,
        cacheTokens: cacheT,
        cost: Math.round(cost * 100) / 100,
        taskCount: Math.floor(Math.random() * 8) + 2,
        scenario: scenarios[Math.floor(Math.random() * scenarios.length)],
        quality: qualities[Math.floor(Math.random() * qualities.length)],
        reworkRounds: Math.floor(Math.random() * 3),
      })
    }
  }
  return records
}

export const dailyTokenData = generateDailyData()

// AI 工具评估指标
export interface AIToolEvaluation {
  toolId: string
  taskCompletion: number
  reasoning: number
  longContext: number
  multimodal: number
  agentCapability: number
  outputQuality: number
  stability: number
  costROI: number
  dataSecurity: number
  overallScore: number
}

export const toolEvaluations: AIToolEvaluation[] = [
  { toolId: 'claude', taskCompletion: 92, reasoning: 95, longContext: 90, multimodal: 85, agentCapability: 90, outputQuality: 93, stability: 88, costROI: 75, dataSecurity: 85, overallScore: 89.5 },
  { toolId: 'chatgpt', taskCompletion: 88, reasoning: 87, longContext: 82, multimodal: 90, agentCapability: 85, outputQuality: 86, stability: 85, costROI: 78, dataSecurity: 80, overallScore: 85.8 },
  { toolId: 'kimi', taskCompletion: 82, reasoning: 80, longContext: 92, multimodal: 75, agentCapability: 70, outputQuality: 80, stability: 78, costROI: 88, dataSecurity: 75, overallScore: 80.0 },
  { toolId: 'glm', taskCompletion: 78, reasoning: 76, longContext: 80, multimodal: 72, agentCapability: 68, outputQuality: 76, stability: 75, costROI: 90, dataSecurity: 82, overallScore: 76.3 },
  { toolId: 'deepseek', taskCompletion: 80, reasoning: 82, longContext: 75, multimodal: 65, agentCapability: 72, outputQuality: 78, stability: 76, costROI: 95, dataSecurity: 78, overallScore: 77.8 },
  { toolId: 'hunyuan', taskCompletion: 75, reasoning: 74, longContext: 76, multimodal: 78, agentCapability: 65, outputQuality: 74, stability: 72, costROI: 92, dataSecurity: 88, overallScore: 74.4 },
]
