# Personal Ops PWA v2 重构记录

## 目标
按 Apple HMI 设计规范重构 PWA，极简化人机协同交互系统。删除首页/任务/审批中心，知识库作为默认首页，AI助理改为数据看板。

## 关键变更

### 删除的页面
- ❌ HomePage.tsx
- ❌ TasksPage.tsx
- ❌ ApprovalPage.tsx
- ❌ AIPage.tsx（旧版 AI 执行）

### 新增/重构的页面
- ✅ KnowledgePage.tsx — 知识库作为首页，显示真实目录树
- ✅ AIAssistantPage.tsx — AI 工具评估与使用数据看板
- ✅ LoginPage.tsx — 极简登录
- ✅ SettingsPage.tsx — 简化设置

### 导航结构
从 6 项简化为 3 项：
- 知识库（首页）
- AI 助理
- 设置

### 知识库页面
- 左侧：文件树，映射 ~/obsidian_vault 真实目录结构
  - 00_Inbox（19个子项：Briefing/TODO/vChat + 16个日期主题）
  - 01_Raw（7个子目录：Calls/Chat/Meetings/Notes/Reports/Requirements/Snap）
  - 02_Operations（5个子目录：Decisions/GitHub/Projects/Sites/Tasks）
  - 03_Wiki（5个子目录：Concepts/Relationships/Reviews/Syntheses/Theses）
  - 99_System（8个子目录：Assets/Gateway/Governance/Prompts/Runtime/Skills/Templates/Workflows）
- 顶部：实时搜索，匹配标题/预览/路径
- 右侧：文件内容查看
- 手机端：上下布局，文件树在上

### AI 助理页面（数据看板）
基于需求文档完整实现：
1. **顶部指标**：总Token/总费用/日均Token/日均费用/使用天数/工具数量，含环比变化
2. **工具筛选**：6个工具 chip 可切换显示
3. **每日 Token 趋势折线图**：SVG 绘制，支持总计/输入/输出切换
4. **工具使用占比环形图**：SVG donut chart
5. **工具使用明细**：条形图 + 文字统计
6. **详细数据表格**：9列数据
7. **套餐与额度**：订阅工具的额度进度条
8. **个人模型效能榜单**：基于9个评估指标的综合排名
9. **场景分析**：按使用场景的条形图
10. **成本优化建议**：智能提示

### 设计语言
- 纯黑背景 (#000000) Apple 暗色模式
- 毛玻璃侧边栏
- 0.5px 分割线
- SF Pro 字体栈
- 圆角 8-20px 分级
- 安全区域适配

## 技术变更
- 新增 store/data.ts：知识库树、搜索索引、AI工具数据、每日Token记录、评估指标
- 重构 store/index.ts：AuthStore + KnowledgeStore + AIAssistantStore
- 新增 utils/helpers.ts：格式化函数、工具颜色/名称/图标映射
- 重构 global.css：Apple HMI 设计系统
- App.tsx 路由简化为 3 页

## 构建结果
- ✅ 57 个模块，1.54s 完成
- ✅ JS 215KB (gzip 69KB) + CSS 12.7KB (gzip 3.1KB)
- ✅ PWA Service Worker 正常
- ✅ 预览服务器 http://localhost:3000
