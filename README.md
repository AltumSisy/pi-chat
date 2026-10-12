# pi-chat

基于 pi-coding-agent 的 AI 编程助手聊天界面。

**后端**：Hono + SSE（Server-Sent Events） + pi-coding-agent
**前端**：Vite + React 19 + Tailwind CSS v4 + Beautiful UI 组件库

---

## 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 配置环境
cp .env.example .env   # 编辑 PI_CHAT_ROOT_DIR 指向工作目录

# 3. 启动（同时启动后端和前端）
pnpm dev
```

- 后端：`http://127.0.0.1:4328`
- 前端：`http://localhost:5173`（Vite 代理 `/api` 到后端）

---

## 项目结构

```
pi-chat/
├── index.html                     # Vite 入口 HTML（主题初始化脚本）
├── vite.config.ts                 # Vite 配置（Tailwind v4 + API 代理）
├── package.json
├── tsconfig.json
├── tsconfig.app.json              # 前端 TS 配置
├── tsconfig.node.json             # 后端 TS 配置（含路径别名）
│
├── src/
│   ├── main.tsx                   # 前端入口（加载字体 + CSS + 渲染 App）
│   │
│   ├── app/
│   │   ├── App.tsx                # 根组件 → AgentHarness
│   │   └── globals.css            # 完整设计系统（:root/.dark/@theme/keyframes）
│   │
│   ├── components/
│   │   ├── AgentHarness.tsx       # ★ 核心：SSE 流式对话界面
│   │   └── primitives/
│   │       ├── StreamingText.tsx   # 流式文本（逐字出现 + 闪烁光标）
│   │       ├── ThinkingState.tsx   # 思考追踪（可展开/折叠步骤列表）
│   │       ├── ToolChips.tsx       # 工具调用（展开详情 + diff 预览）
│   │       ├── PromptBar.tsx       # 输入框（附件/模型选择/发送）
│   │       └── LoadingState.tsx    # 加载动画（像素网格 + 计时器）
│   │
│   ├── shared/
│   │   └── types.ts               # 前后端共享类型定义
│   │
│   ├── server/
│   │   ├── index.ts               # 后端入口（启动 Hono 服务器）
│   │   ├── app.ts                 # Hono 应用创建（中间件 + 路由挂载）
│   │   ├── config.ts              # 全局配置（目录结构）
│   │   ├── sse.ts                 # SSE 样板代码封装
│   │   ├── error.ts               # 错误处理
│   │   ├── on.ts                  # 事件映射
│   │   ├── routes/
│   │   │   ├── index.ts
│   │   │   ├── conversation.ts    # 对话路由（CRUD + SSE 流）
│   │   │   └── system.ts          # 系统路由（健康检查）
│   │   └── conversation/
│   │       ├── types.ts           # 对话类型（ConversationRecord/ManagerSession）
│   │       ├── channel.ts         # EventChannel（内存级 pub/sub + replay）
│   │       ├── repository.ts      # 持久化（JSON 文件 CRUD）
│   │       ├── service.ts         # ★ 编排层（repository + runtime + channel）
│   │       └── runtime.ts         # 胶水层（适配 pi-coding-agent）
│   │
│   └── lib/
│       └── utils.ts               # cn() 工具函数
│
└── public/
    └── favicon.svg
```

---

## 架构分层

```
┌─────────────────────────────────────────┐
│  AgentHarness.tsx  (前端界面层)         │
│  - 发送消息                              │
│  - fetch+ReadableStream 解析 SSE         │
│  - 事件 → 组件映射                       │
├─────────────────────────────────────────┤
│  routes/conversation.ts  (HTTP 层)      │
│  - 提取参数 → 调用 service → 构造响应     │
├─────────────────────────────────────────┤
│  service.ts  (编排层)                    │
│  - 编排 repository / runtime / channel   │
├──────────┬──────────────┬───────────────┤
│ runtime  │ repository   │ channel       │
│ (AI胶水) │ (持久化)      │ (事件pub/sub) │
└──────────┴──────────────┴───────────────┘
```

---

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/conversation` | 创建新对话 → 返回 `ConversationSnapshot` |
| `POST` | `/api/conversation/:id` | 获取对话快照 |
| `POST` | `/api/conversation/:id/message` | 发送消息（`FormData { text }`） → `202` |
| `GET` | `/api/conversation/:id/stream?after=N` | SSE 事件流 |
| `GET` | `/api/system/health` | 健康检查 → `{ status: "ok" }` |

### SSE 事件类型

| 事件类型 | 含义 | 前端组件 |
|----------|------|----------|
| `thinking_started` | 开始思考 | `ThinkingState` |
| `thinking_delta` | 思考内容追加 | `ThinkingState` |
| `thinking_completed` | 思考完成 | `ThinkingState`（折叠） |
| `message_started` | 开始输出 | 新建消息气泡 |
| `message_delta` | 输出内容追加 | 气泡内文本流式更新 |
| `message_completed` | 输出完成 | 气泡标记为完成 |
| `message_add` | 新消息（用户/助手） | 用户气泡 |
| `tool_started` | 工具调用开始 | `ToolChips` |
| `tool_updated` | 工具调用更新 | `ToolChips` |
| `tool_completed` | 工具调用完成 | `ToolChips`（标记完成） |
| `runtime.status` | 运行时状态变化 | 右下角状态指示器 |
| `runntime_settled` | Agent 进入空闲 | 停止 loading |

---

## 设计系统

### 颜色

基于 OKLCH 的冷调中性色（blue-tinted neutrals），蓝调强调色，语义色（绿/橙/红）少而精。

| Token | 用途 |
|-------|------|
| `--page` | 页面背景（最外层） |
| `--canvas` | 画布背景 |
| `--surface` | 卡片/面板表面 |
| `--ink` / `--ink-2` / `--ink-3` | 文字层级（主/次/辅） |
| `--line` / `--line-strong` | 边框 |
| `--accent` / `--accent-tint` | 强调色及其淡色版 |
| `--green` / `--orange` / `--red` | 语义色 |

### 圆角

| 用途 | 值 |
|------|-----|
| Chip | `6px` |
| Control | `8px` |
| Card | `10px` |
| Window | `14px` |
| Pill | `999px` |

### 阴影

纯色 hairline 边框 + shadow-plugin 提供的平滑多层阴影：
- `shadow-hairline` — 最轻（分隔线级别）
- `shadow-btn` — 按钮
- `shadow-card` — 卡片
- `shadow-raised` — 浮层
- `shadow-overlay` — 弹出层

### 字体

- **正文**：Inter（`font-sans`）— 紧凑字距、表格数字
- **代码**：JetBrains Mono（`font-mono`）— 等宽、连字

### 动画

| 关键帧 | 用途 |
|--------|------|
| `fade-up` | 元素入场（8px 上升 + 淡入） |
| `fade-in` | 纯淡入 |
| `pop-in` | 弹出（0.95→1 缩放 + 淡入） |
| `shimmer-text` | 加载中文字闪光 |
| `pixel-on` | 像素网格加载器 |
| `caret-blink` | 流式光标闪烁 |
| `spin` | 旋转（思考步骤中的 spinner） |

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PI_CHAT_ROOT_DIR` | `~/.pi/agent/pi-chat` | 数据存储根目录 |
| `PI_CHAT_HOST` | `127.0.0.1` | 后端监听地址 |
| `PI_CHAT_PORT` | `4328` | 后端监听端口 |
| `LOG_LEVEL` | `info` | 日志级别 |
| `NODE_ENV` | — | `production` 时禁用 pino-pretty 美化 |

---

## 对话数据存储

```
{PI_CHAT_ROOT_DIR}/
├── records/
│   └── {uuid}.json         ← 对话元数据（ConversationRecord）
├── sessions/
│   └── {timestamp}_{uuid}.jsonl  ← 会话事件日志（StreamEvent 逐行）
└── workspaces/
    └── {uuid}/             ← 对话工作目录（AI 读写文件的沙箱）
```

---

## 前端数据流

```
用户输入文字
  │
  ▼
PromptBar.onSend(text)
  │
  ▼
AgentHarness.sendMessage(text)
  ├── POST /api/conversation/:id/message  FormData { text }
  │   └── 后端异步处理，立即返回 202
  │
  ├── abort 当前 SSE 连接
  └── 重连 SSE（after=lastEventId）
        │
        ▼
      fetch + ReadableStream 逐行解析
        │
        ▼
      StreamEvent → Block[] 状态更新
        │
        ▼
      renderBlock(block)
        ├── "user"     → 用户气泡
        ├── "thinking" → ThinkingState
        ├── "message"  → StreamingText + 光标
        └── "tool"     → ToolChips
```

### SSE 重连策略

每次发送消息后断开旧 SSE 连接，重连时带上 `?after=<lastEventId>`：
- 服务端 `replay(after)` 补发断线期间的事件
- 前端 `lastEventIdRef` 跟踪最后收到的事件 ID
- `runntime_settled` 事件到达后 `setSending(false)` 停止 loading

---

## 对话生命周期

```
POST /api/conversation       → 创建对话 → 生成 UUID
  │                                          ├── 创建工作目录
  │                                          ├── 创建 SessionManager
  │                                          ├── 持久化 ConversationRecord
  │                                          └── 创建 ManagerSession
  │
POST /:id/message             → 发送消息 → session.prompt(userInput)
  │                                          └── bind() 自动推送 SSE 事件
  │
GET /:id/stream               → SSE 流 → replay 历史 + subscribe 实时
  │
POST /:id/snapshot            → 获取完整快照
```

---

## 许可

MIT