# Personal Ops PWA v2 — 白屏修复（最终）

## 日期
2026-07-19

## 问题
用户浏览器打开 http://localhost:3000 白屏，但 puppeteer（全新 Chrome 实例）能正常渲染。

## 根因
用户浏览器 localStorage 中存有旧版（v1）的 `personal-ops-auth` 数据，结构与新 v2 store 不兼容。main.tsx 的清理逻辑只检查了 `parsed?.state?.user`，但 v1 数据可能通过该检查却包含 v2 不兼容的字段，导致 store 初始化或 persist hydration 时出错。

## 修复方案
在 main.tsx 中增加 **APP_VERSION 版本检测机制**：
- 首次加载 v2 时，`STORED_VERSION` 为 `null` ≠ `'v2.0'`
- 自动清除所有旧版 localStorage key（auth/knowledge/ai/tasks/approvals）
- 写入新版本号 `personal-ops-version = 'v2.0'`
- 未来版本升级只需改 `APP_VERSION`，旧数据自动清除

同时保留结构校验逻辑作为二次防线。

## 验证结果
puppeteer 全流程验证（全新 Chrome user-data-dir）：
1. ✅ 登录页正常渲染
2. ✅ 点击登录 → 知识库页面（侧边栏 + 文件树 + 内容区）
3. ✅ 切换 AI 助理 → dashboard（统计卡片 + 折线图 + 环形图 + 数据表）
4. ✅ 切换设置 → 正常显示账号/设备/PWA 信息
5. ✅ Console: `[Init] Version changed: none → v2.0, clearing old storage`
6. ✅ 零运行时错误

## 用户操作
如果浏览器仍然白屏，需要手动操作：
1. F12 打开开发者工具
2. Application → Local Storage → http://localhost:3000
3. Clear All
4. 刷新页面
