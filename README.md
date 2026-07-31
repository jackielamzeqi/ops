---
type: operations_readme
schema_version: 1
updated: 2026-07-31
status: active
project: Personal Ops PWA
---

# Personal Ops PWA

> 个人 AI 工作台 + GitHub 知识库入口 + 任务看板（渐进式 Web 应用）
>
> **源码真相**：`obsidian_vault/02_Operations/Workspaces/personal-ops/`（随 vault 一键 pull/push；公开站由 Actions 镜像到 `ops`）
**📋 完整需求与接手指引见 [`项目需求.md`](./项目需求.md)** —— 含产品定义、登录设计、技术架构、页面规格、Mock 边界、下一步开发路线。

## 当前版本：v2.2（2026-07-19）

**已实现（4 页）**
- ✅ GitHub 账号登录（Token / 可选 Device Flow）+ 白名单校验；未登录不可访问知识库
- ✅ 知识库（默认首页，映射真实目录结构；进入时复验 GitHub 会话）
- ✅ AI 工具：自动检测本机 Codex / Claude / Kimi / Cursor / OpenCode / Qoder，图表仅展示已检测工具
- ✅ Token 自动监测：本机 `npm run agent`（参考 [Javis603/token-monitor](https://github.com/Javis603/token-monitor)，引擎 tokscale；OpenCode 直接读本地 SQLite `~/.local/share/opencode/opencode.db`；Qoder 读 `~/.qoder/logs/sessions/**/segments/*.jsonl`）
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
npm run agent:start     # 一键启动本机监测（http://127.0.0.1:3847）
npm run agent:setup     # 登录 Mac 自动启动（每台电脑执行一次）
npm run agent:status    # 查看是否在线
npm run preview:setup   # ★ 本地验收页常驻（http://127.0.0.1:4173/ops/，登录自启）
npm run preview:status  # 验收页是否在线
npm run preview:rebuild # 改完源码后重新 build 并热重启验收页
npm run leaderboard     # 手动拉取并打印大模型榜单 JSON
npm run dev             # ★ 日常改代码请用这个（热更新，立刻看到效果）
npm run build           # 生产构建 → docs/
```

### 改完代码如何立刻看到效果？

| 场景 | 做法 |
|------|------|
| **日常开发** | `npm run dev` → 打开 http://localhost:5173/ops/ ，保存即热更新 |
| **本地验收（常驻）** | 固定打开 http://127.0.0.1:4173/ops/ ；首次 `npm run preview:setup` 或双击「安装验收自启.command」 |
| **验收页跟上最新构建** | `npm run preview:rebuild` |
| **更新线上 Pages** | `git push` **vault** `main` → Actions 镜像到 `ops` 并发布（约 1–2 分钟） |

不要边改源码边刷新 https://jackielamzeqi.github.io/ops/ —— 那是构建产物，未 push vault / 未构建前不会变。  
若 PWA 仍显示旧版：硬刷新（Cmd+Shift+R），或在开发者工具 → Application → Service Workers 里 Unregister 后再刷新。

### 换电脑（个人 ↔ 公司）

1. `git pull` **obsidian_vault**（唯一源码仓）
2. 双击 `启动监测.command`，或首次双击 `安装开机自启.command`
3. 首次双击 `安装验收自启.command`（固定验收地址 http://127.0.0.1:4173/ops/）
4. 打开 https://jackielamzeqi.github.io/ops/ 刷新即可  
无需改代码。Cursor / ChatGPT 等登录态按电脑各登一次（密钥不进 Git）。

## 在线地址

- GitHub Pages：https://jackielamzeqi.github.io/ops/
- 本地验收（常驻）：http://127.0.0.1:4173/ops/
- **源码仓**：https://github.com/jackielamzeqi/obsidian_vault（路径 `02_Operations/Workspaces/personal-ops/`）
- **发布壳**：https://github.com/jackielamzeqi/ops（由 vault Actions 自动镜像，勿日常手动维护）

### 自动发布

1. 在 vault 仓库 Settings → Secrets 配置 `PAGES_DEPLOY_TOKEN`（可写 `ops` + `travel`）
2. 改本目录后 `git push` vault `main`
3. 工作流 [Publish Workspaces Pages](../../../.github/workflows/publish-workspaces-pages.yml) 构建并镜像到 `ops`；`ops` 仓既有 Pages Deploy 继续发布  
   进度：https://github.com/jackielamzeqi/obsidian_vault/actions

## 技术栈

React 18 · TypeScript 5 · Vite 5 · React Router 6 · Zustand 4（persist）· vite-plugin-pwa · 手写 SVG 图表（无图表库）

## 目录

```
personal-ops/                 # vault 内工程；公开站镜像到 jackielamzeqi/ops
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

发布：改代码 → vault `git commit` → `git push`（Actions 镜像到 ops 并发布）。本地联调请用 `npm run dev`，不必每次手跑 build。

## 下一步（详见 `项目需求.md` 第 10 节）

1. **P0** 真实 GitHub OAuth 登录 + 白名单校验
2. **P0** 真实知识库数据对接（GitHub API 读取树/内容）
3. **P1** 任务看板页（`Task` 类型已定义）
4. **P1** AI 审批中心（`AIJob` 类型已定义）
5. **P2** 首页汇总视图
6. **P2** 数据真实化与移动端打磨
