---
type: operations_readme
schema_version: 1
updated: 2026-07-26
status: active
project: Personal Ops PWA
---

# Personal Ops PWA

> 个人 AI 工作台 + GitHub 知识库入口 + 任务看板（渐进式 Web 应用）

**📋 完整需求与接手指引见 [`项目需求.md`](./项目需求.md)** —— 含产品定义、登录设计、技术架构、页面规格、Mock 边界、下一步开发路线。

## 当前版本：v2.2（2026-07-19）

**已实现（4 页）**
- ✅ GitHub 账号登录（Token / 可选 Device Flow）+ 白名单校验；未登录不可访问知识库
- ✅ 知识库（默认首页，映射真实目录结构；进入时复验 GitHub 会话）
- ✅ AI 工具：自动检测本机 Codex / Claude / Kimi / Cursor，图表仅展示已检测工具
- ✅ Token 自动监测：本机 `npm run agent`（参考 [Javis603/token-monitor](https://github.com/Javis603/token-monitor)，引擎 tokscale）
- ✅ 大模型最新榜单：日更拉取 Artificial Analysis + Arena（发布日期 / 上下文 / 价格 / 智力 / 科学 / 代码）
- ✅ 工作环境切换 + 计费人民币 ￥（已移除「使用天数」指标）
- ✅ 设置 / 响应式 / PWA / ErrorBoundary

**仍是 Mock / 局限**
- ⚠️ 知识库正文仍为本地模拟
- ⚠️ Cursor 用量需先 `npx tokscale cursor login && npx tokscale cursor sync --json`
- ⚠️ 在线 Pages 需本机同时运行 `npm run agent` 才能拉到监测数据
- ⚠️ 任务看板 / AI 审批页未实现

## 快速开始

```bash
npm install
npm run agent:start  # 一键启动本机监测（http://127.0.0.1:3847）
npm run agent:setup  # 登录 Mac 自动启动（每台电脑执行一次）
npm run agent:status # 查看是否在线
npm run leaderboard  # 手动拉取并打印大模型榜单 JSON
npm run dev          # 开发服务器
npm run build        # 生产构建 → docs/（GitHub Pages）
npm run preview      # 预览构建产物 (http://localhost:3000)
```

### 换电脑（个人 ↔ 公司）

1. `git pull` 同步本仓库（路径可以不同）
2. 双击 `启动监测.command`，或首次双击 `安装开机自启.command`
3. 打开 https://jackielamzeqi.github.io/ops/ 刷新即可  
无需改代码。Cursor / ChatGPT 等登录态按电脑各登一次（密钥不进 Git）。

## 在线地址

- GitHub Pages：https://jackielamzeqi.github.io/ops/
- 发布仓库：https://github.com/jackielamzeqi/ops（本目录即该仓库工作树）
- Pages 源：`main` 分支 `/docs`

## 技术栈

React 18 · TypeScript 5 · Vite 5 · React Router 6 · Zustand 4（persist）· vite-plugin-pwa · 手写 SVG 图表（无图表库）

## 目录

```
personal-ops/                 # = jackielamzeqi/ops 单仓库
├── 项目需求.md               # ★ 完整需求 + 接手指引（必读）
├── README.md
├── src/                      # 应用源码
├── data/                     # 本机/快照数据
├── assets/                   # 静态资源（Vite publicDir）
├── docs/                     # 构建产物 → GitHub Pages
├── scripts/                  # token-agent 等本机脚本
├── package.json
├── vite.config.ts
└── index.html
```

发布：`npm run build` → `git add docs && git commit && git push`（无需再维护 `GitHub/ops` 镜像目录）。

## 下一步（详见 `项目需求.md` 第 10 节）

1. **P0** 真实 GitHub OAuth 登录 + 白名单校验
2. **P0** 真实知识库数据对接（GitHub API 读取树/内容）
3. **P1** 任务看板页（`Task` 类型已定义）
4. **P1** AI 审批中心（`AIJob` 类型已定义）
5. **P2** 首页汇总视图
6. **P2** 数据真实化与移动端打磨
