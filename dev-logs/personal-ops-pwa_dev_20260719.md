# Personal Ops PWA 开发记录

## 目标
根据用户提供的产品需求文档，开发一个 PWA（Progressive Web App），作为个人 AI 工作台 + GitHub 知识库入口 + 任务看板。

## 关键决策

### 技术栈选择
- **React 18 + TypeScript**：成熟的组件化方案，类型安全
- **Vite 5 + vite-plugin-pwa**：快速构建，内置 PWA 支持（manifest + service worker）
- **Zustand**：轻量级状态管理，支持持久化（localStorage）
- **React Router 6**：客户端路由
- **CSS 变量**：暗色主题，无额外 CSS 框架依赖

### 多端适配策略
- 手机（<768px）：底部导航（4项：首页/任务/知识库/AI）
- 平板（768-1024px）：侧边导航（4项）
- 桌面（>1024px）：侧边导航（6项：首页/任务/知识库/AI/审批中心/设置）

### 登录设计
- 模拟 GitHub OAuth 流程（实际部署需对接真实 OAuth）
- 个人设备：30 天登录保持
- 临时设备：8 小时登录保持
- 会话状态检查与自动过期

### 页面实现
1. **登录页**：Personal Ops 品牌 + GitHub 登录按钮 + 设备类型选择
2. **首页**：问候语 + 搜索框 + 4个统计卡片（今日任务/AI执行中/待审批/最近更新）+ 任务进度概览 + 最近更新列表
3. **任务看板**：4列看板（待办/进行中/已完成/阻塞），支持新建/移动/删除任务，任务详情模态框
4. **知识库**：文件树浏览 + 文件内容查看，支持搜索
5. **AI 执行**：6种任务类型（总结/拆解/调研/修改PRD/周报/自定义），待处理+历史记录
6. **审批中心**：diff 差异对比视图，三种审批操作（批准/修改后批准/驳回），驳回理由
7. **设置**：账号信息、设备信息、权限说明、PWA 安装、退出登录

### PWA 配置
- manifest.webmanifest：完整 PWA 元数据
- Service Worker：Workbox 自动生成，预缓存 12 个资源（223KB）
- 运行时缓存：GitHub API 和 raw.githubusercontent.com 的 NetworkFirst 策略
- 离线检测：useOnlineStatus hook
- 图标：SVG + PNG 占位

## 构建结果
- ✅ npm install：360 个包
- ✅ npm run build：59 个模块，5.33s 完成
- ✅ 构建产物：JS 212KB (gzip 66KB) + CSS 11.5KB (gzip 2.8KB)
- ✅ PWA Service Worker 生成成功
- ✅ 预览服务器启动成功（http://localhost:3000）

## 项目结构
```
personal-ops-pwa/
├── package.json
├── vite.config.ts          # Vite + PWA 配置
├── tsconfig.json
├── index.html              # HTML 入口
├── gen-icons.mjs           # 图标生成脚本
├── README.md
├── public/
│   ├── favicon.svg
│   └── icons/
│       ├── icon-192.svg
│       ├── icon-512.svg
│       ├── icon-192.png    # 占位
│       └── icon-512.png    # 占位
└── src/
    ├── main.tsx            # React 入口
    ├── App.tsx             # 路由 + 认证守卫
    ├── vite-env.d.ts
    ├── types/
    │   └── index.ts        # 全部类型定义
    ├── store/
    │   └── index.ts        # Zustand stores（auth + task + aiJob + kb）
    ├── hooks/
    │   └── useDevice.ts    # 设备检测 + 在线状态
    ├── utils/
    │   └── helpers.ts      # 格式化、颜色映射、diff 渲染
    ├── styles/
    │   └── global.css      # 全局样式（暗色主题 + 响应式）
    ├── components/
    │   └── Layout.tsx     # 侧边导航 + 底部导航布局
    └── pages/
        ├── LoginPage.tsx     # 登录页
        ├── HomePage.tsx      # 首页
        ├── TasksPage.tsx     # 任务看板
        ├── KnowledgePage.tsx # 知识库浏览
        ├── AIPage.tsx        # AI 执行
        ├── ApprovalPage.tsx  # 审批中心
        └── SettingsPage.tsx  # 设置
```

## 后续待实现
- GitHub OAuth 真实对接
- 后台服务（GitHub API 代理）
- 实时 GitHub 数据同步
- 离线编辑与冲突解决
- 指纹/Face ID/Passkey 登录
- 发布管理
- 多人协作
- 正式 PNG 图标（用 RealFaviconGenerator 生成）

## 运行方式
```bash
cd personal-ops-pwa
npm run dev      # 开发模式（http://localhost:5173）
npm run build    # 构建
npm run preview  # 预览（http://localhost:3000）
```
