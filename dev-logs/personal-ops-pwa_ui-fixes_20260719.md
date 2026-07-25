# Personal Ops PWA — UI 布局修复 (2026-07-19 19:37)

## 修复的问题

### 1. 设置页 header 被截断/内容贴边 (P0)
**根因**：`Layout.tsx` 桌面端给 `main-content` 设置了 inline `padding: 0`，覆盖了 CSS 里的 `padding: 24px 32px`。
**修复**：移除 inline `padding: 0`，让 CSS 的 `padding: 24px 32px` 正常生效。
**验证**：设置页标题距顶 24px（修复前 0px），不再贴边。

### 2. AI 助理页 stat 卡片 5+1 布局不平衡 (P0)
**根因**：`.metrics-grid` 用 `repeat(auto-fit, minmax(160px, 1fr))`，在 ~976px 内容宽度下只能容纳 5 列，第 6 个换行。
**修复**：改为响应式固定列数：
- 桌面：`repeat(6, 1fr)`（6 卡一行等宽）
- ≤1100px：`repeat(3, 1fr)`
- ≤768px：`repeat(2, 1fr)`

### 3. 知识库树长文件夹名换行 (P1)
**根因**：`.tree-item` 是 flex 容器，文本 span 默认 `min-width: auto` 会换行撑高行高。
**修复**：
- CSS 新增 `.tree-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }`
- KnowledgePage 给 name span 加 `className="tree-name"` + `title={node.name}`（hover 显示全名）

## 验证结果
- puppeteer 全流程截图验证：登录 → 知识库 → AI 助理 → 设置 全部正常
- 桌面 + 手机视图均正常
- 零运行时错误
- `npm run build` 通过（58 modules, 4.3s, JS 217KB gzip 70KB, CSS 12.9KB gzip 3.1KB）

## 未修复（低优先级，暂不影响使用）
- mock 数据 100% 增长（demo 数据，后续接真实 GitHub 数据时自然解决）
- 环形图比例合计 99.9%（打磨级）
- 移动端底部 nav 间距微调（打磨级）
