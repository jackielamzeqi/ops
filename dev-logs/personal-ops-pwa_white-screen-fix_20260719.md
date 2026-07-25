# Personal Ops PWA v2 — 白屏修复

## 日期
2026-07-19

## 问题
PWA v2 重构后页面白屏，无法正常显示任何内容。

## 根因
`src/store/index.ts` 中 `useAIAssistantStore` 初始化时引用了 `dailyData` 变量，但 import 语句导入的是 `dailyTokenData`——**变量名不一致导致 `ReferenceError: dailyData is not defined`**。

该错误在 store 创建时立即抛出，导致整个 React 应用崩溃，由于已添加 ErrorBoundary，页面显示为空白（ErrorBoundary 捕获了错误但无 UI 输出）。

## 修复内容

### 1. 核心修复：变量名对齐
```diff
- dailyData,
+ dailyData: dailyTokenData,
```
将 store 初始化中的 `dailyData` 改为 `dailyData: dailyTokenData`，使用对象简写语法对齐 import 名称。

### 2. TS 类型修复
- `getDailyTrend` 返回类型从 `{ date: string; [toolId: string]: number }[]` 改为 `Record<string, number | string>[]`，避免索引签名冲突。

### 3. CSS 修复
- `.bar-row` 选择器缺少 `.` 前缀，写成了标签选择器 `bar-row`，已修复。

### 4. 清理
- 移除 debug 用的 `console.log` 语句。
- 移除临时调试脚本 `pw-debug.cjs` 和 `pw-verify.cjs`。

## 验证
使用 puppeteer-core + 系统 Chrome 进行端到端验证：
1. **登录页** — 正常渲染，显示 Personal Ops 标题、GitHub 登录按钮、个人设备复选框
2. **登录后** — 成功跳转到知识库页面，侧边栏、文件树、搜索栏、内容区全部正常
3. **AI 助理页面** — 成功跳转，dashboard、统计卡片、图表、数据表格全部正常渲染
4. **零运行时错误** — Console 无任何 page error

构建结果：58 modules, 5.72s, JS 216KB (gzip 70KB), CSS 12.7KB (gzip 3.1KB)

## 教训
- **变量名一致性**：import 名和使用名必须完全一致，特别是在 store 初始化中使用对象简写语法时
- **白屏排查**：应第一时间用无头浏览器抓取 console 错误，而不是猜测 CSS/路由问题
- **ErrorBoundary**：应提供 fallback UI 显示错误信息，而非静默白屏
