# pi-chat

基于 pi-coding-agent 的 AI 编程助手聊天界面。

**后端**：Hono + SSE（Server-Sent Events） + pi-coding-agent
**前端**：Vite + React 19 + Tailwind CSS v4 + Beautiful UI 组件库

**功能**：流式对话、思考 / 工具调用展示、会话管理、会话级模型与推理强度切换。

---

## 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 配置（可选）
#    在根目录建 .env 指定数据目录，不建就用默认值
#    PI_CHAT_ROOT_DIR=D:/code/pi-chat-work

# 3. 启动（同时启动后端和前端）
pnpm dev
```

- 后端：`http://127.0.0.1:4328`
- 前端：`http://127.0.0.1:5173`（Vite 代理 `/api` 到后端）

### 常用脚本

| 命令 | 作用 |
|------|------|
| `pnpm dev` | 同时起后端 + 前端 |
| `pnpm web:dev` / `pnpm server:dev` | 只起其中一个；后端是 `tsx --watch`，改 `server/**` 会自动重启 |
| `pnpm dev:debug` | 后端带 `--inspect=9229` |
| `pnpm build` / `pnpm preview` | 构建 / 预览构建产物 |
| `pnpm lint` | oxlint |

---

## 项目结构

```
pi-chat/
├── index.html                     # Vite 入口 HTML（主题初始化脚本）
├── vite.config.ts                 # Vite 配置（Tailwind v4 + /api 代理）
├── package.json
├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
│
├── client/                        # ── 前端 ──
│   ├── main.tsx                   # 入口（字体 + globals.css + 路由）
│   ├── api.ts                     # 后端接口封装（含 EventSource 连接）
│   ├── state.ts                   # ★ conversationReducer：事件 → 消息列表
│   ├── app/
│   │   ├── App.tsx                # 根组件 → AgentHarness
│   │   └── globals.css            # 完整设计系统（:root/.dark/@theme/keyframes）
│   ├── components/
│   │   ├── AgentHarness.tsx       # ★ 核心：侧栏 + 消息区 + 输入区
│   │   ├── MessageItem.tsx        # 消息 / 思考 / 工具 三种条目
│   │   ├── Markdown.tsx           # Markdown 渲染（react-markdown + gfm）
│   │   └── primitives/
│   │       ├── SidebarNav.tsx     # 侧栏（可折叠 / 搜索 / 改名 / 删除）
│   │       ├── ConfirmPopover.tsx # 就地确认弹层（替代 window.confirm）
│   │       ├── ModelConfigPill.tsx # 模型 / 推理强度胶囊 + 向上浮层
│   │       ├── GlideMenu.tsx      # 行间“滑行”高亮层
│   │       ├── PromptBar.tsx      # 输入框（自适应高度 / Enter 发送 / 右侧操作插槽）
│   │       ├── ThinkingState.tsx  # 思考面板（可折叠）
│   │       ├── ToolChips.tsx      # 工具调用卡片
│   │       ├── LoadingState.tsx   # 加载动画（像素网格 + 计时器）
│   │       └── StreamingText.tsx  # 流式文本 + 光标（目前未被引用，保留）
│   ├── hooks/
│   │   ├── useConversationStream2.ts  # ★ 当前在用：快照 + SSE + 乐观更新
│   │   ├── useConversationConfig.ts   # ★ 会话级模型 / 推理强度配置
│   │   ├── useConversationList.ts     # 会话列表（轮询 / 改名 / 删除 / 终止）
│   │   └── useConversationStream.ts   # 旧版（fetch 流式解析），保留参考
│   ├── lib/
│   │   ├── status.ts              # 运行状态判定与文案
│   │   └── utils.ts               # cn()（clsx + tailwind-merge）
│   └── doc/                       # 前端设计文档 00~07
│
├── server/                        # ── 后端 ──
│   ├── index.ts                   # 入口（启动 + 生命周期诊断）
│   ├── app.ts                     # Hono 应用（pino 日志 + 路由挂载）
│   ├── config.ts                  # 全局配置（目录结构 / 路径校验）
│   ├── sse.ts                     # SSE 响应封装（replay + subscribe + keepalive）
│   ├── error.ts / utils.ts
│   ├── routes/
│   │   ├── conversation.ts        # 对话路由（CRUD + abort + SSE）
│   │   └── system.ts              # 健康检查
│   ├── conversation/
│   │   ├── service.ts             # ★ 编排层（repository + runtime + channel）
│   │   ├── channel.ts             # EventChannel（内存级 pub/sub + replay）
│   │   ├── repository.ts          # 持久化（JSON 文件 CRUD）
│   │   ├── runtime.ts             # 胶水层（适配 pi-coding-agent）
│   │   ├── helpr.ts               # 历史分支 → MessageListItem 视图构建
│   │   └── types.ts               # ConversationRecord / ManagerSession
│   └── doc/                       # 后端文档 01~08
│
├── shared/
│   └── types.ts                   # 前后端共享类型
│
├── bug-record/                    # 排查记录（每个问题一个目录 + record.md）
└── public/
    ├── favicon.svg
    └── icons.svg
```

---

## 架构分层

| 层 | 位置 | 职责 |
|----|------|------|
| 界面层 | `client/components/AgentHarness.tsx` | 布局；把 hooks 的数据接到组件 |
| 状态层 | `client/hooks/*`、`client/state.ts` | 快照 + SSE → 消息列表；会话列表轮询；配置读写 |
| HTTP 层 | `server/routes/conversation.ts` | 取参数 → 调 service → 组响应 |
| 编排层 | `server/conversation/service.ts` | 编排 repository / runtime / channel |
| 底座 | `runtime.ts` / `repository.ts` / `channel.ts` | AI 胶水 / 持久化 / 事件 pub-sub |

```
发送：浏览器 ──POST /:id/message──▶ routes ──▶ service ──▶ runtime ──▶ pi session
                                                                          │
回传：浏览器 ◀──SSE /:id/stream──── channel ◀── service.bind() ◀── session.subscribe()
```

---

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/conversation` | 创建新对话 → `ConversationSnapshot` |
| `GET` | `/api/conversation` | 会话列表 → `ConversationSummary[]` |
| `POST` | `/api/conversation/:id` | 取快照（顺带恢复 runtime）→ `ConversationSnapshot` |
| `PATCH` | `/api/conversation/:id` | 改名（`{ title }`） |
| `DELETE` | `/api/conversation/:id` | 删除（记录 + session 文件 + workspace） |
| `POST` | `/api/conversation/:id/abort` | 终止生成 → `{ aborted: true }` |
| `POST` | `/api/conversation/:id/message` | 发送消息（`FormData { text }`）→ `202` |
| `GET` | `/api/conversation/:id/stream?after=N` | SSE 事件流（`after` = 事件游标，`after` 落后则补发） |
| `GET` | `/api/conversation/:id/config` | 获取模型 / 推理强度配置 → `ConversationConfig` |
| `PATCH` | `/api/conversation/:id/config` | 更新配置（`{ model?, thinkingLevel? }`）→ `ConversationConfig` |
| `GET` | `/api/system/health` | 健康检查 → `{ status: "ok" }` |

### SSE 事件类型

| 事件类型 | 含义 | 前端组件 |
|----------|------|----------|
| `thinking_started` | 开始思考 | `ThinkingState` |
| `thinking_delta` | 思考内容追加 | `ThinkingState` |
| `thinking_completed` | 思考完成 | `ThinkingState`（自动折叠） |
| `message_started` | 开始输出 | 等首个 delta 再建气泡 |
| `message_delta` | 输出内容追加 | 助手气泡流式追加 |
| `message_completed` | 输出完成 | 气泡标记完成 |
| `message_add` | 新消息（用户/助手） | 用户气泡（按 text 去重） |
| `tool_started` | 工具调用开始 | `ToolChips` |
| `tool_updated` | 工具调用更新 | `ToolChips` |
| `tool_completed` | 工具调用完成 | `ToolChips`（标记成功/失败） |
| `runtime.status` | 运行时状态变化 | header 徽标 / 侧栏状态点 / loading |
| `runntime_error` | 运行出错 | 停止 loading + 错误横幅 |
| `runntime_settled` | 本轮跑完、进入空闲 | 停止 loading |

> 注：`runntime_settled` / `runntime_error` 里的 `runntime` 是**代码里既有的拼写**
> （见 `shared/types.ts`）；这里按实际事件名写，想改成 `runtime_*` 需要前后端一起迁移。

### SSE 首帧：别省那一行注释帧

`sseResponse` 在连接建立时会**立刻**写一帧 `:connected`（SSE 注释，浏览器忽略）。这不是装饰：

`http-proxy` 类代理（含 Vite dev proxy）拿到上游响应后只 `setHeader` + `pipe`，
而 Node 要等第一次 `res.write()` 才把响应头发出去。如果 body 静默（新会话没有可 replay 的事件），
客户端要等到 15s 的 keepalive 才能拿到响应头，`EventSource` 的 `onopen` 就一直不触发 ——
而发送又挂在 `onopen` 上，于是首条消息白等一个 keepalive 周期。

排查过程见 `bug-record/首次发送延迟-SSE被代理缓冲/record.md`。

---

## 模型与推理强度配置

每个会话可以独立选择模型和推理强度（thinking level），入口在输入框发送按钮左侧的胶囊按钮。

### 交互

- 胶囊显示 `模型 id + 当前档位`，例如 `deepseek-v4.1-flash High`
- 点击向上弹出浮层：
  - 模型候选列表（当前项高亮 + Check）
  - 推理强度滑块：档位来自服务端 `availableThinkingLevels`，左侧深色填充、右侧浅灰轨迹
- 切换模型后，服务端会按新模型能力收敛 thinking level，响应同步回 UI
- 流式输出期间禁用配置修改（服务端 `updateConfig` 会拒绝 busy 会话）

### 状态同步与持久化

配置由 `client/hooks/useConversationConfig.ts` 管理：

1. 进入会话时 `GET /api/conversation/:id/config`
2. 修改先乐观更新 UI，再 PATCH：
   - 模型切换：立即提交 `{ model }`
   - 滑块：连续拖动合并 180ms 后提交 `{ thinkingLevel }`
   - PATCH 串行执行，避免连续修改互相覆盖
3. PATCH 返回完整 `ConversationConfig`；期间若又有新改动，丢弃旧响应
4. 保存失败时回滚到服务端最后一次确认的配置，并在输入区 / 浮层显示错误
5. 发送消息前 `await flushConfig()`，确保本轮 prompt 使用最新的模型 / thinkingLevel

配置是会话级的：新会话在第一条消息创建 `conversationId` 后才会出现胶囊。

### 模型来源

- 模型定义：`~/.pi/agent/models.json`
- 可用性：只有已配置凭证的 provider 的模型才会出现在列表（凭证来自 `auth.json` 或 `models.json` 里的 `apiKey`）
- `GET /config` 会执行 `modelRuntime.refresh({ allowNetwork: false })` 重新读取本地模型目录，
  因此新增模型不需要重启服务；新增 provider 仍需先配置认证

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

配合 `prefers-reduced-motion` 全局降级；主题切换时会短暂挂 `.theme-switching` 关掉过渡。

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
PromptBar.onSend(text) → AgentHarness.handleSend(text)
  │
  ├── await flushConfig()：先提交待落盘的模型 / 推理强度改动
  │
  ▼
useConversationStream2.submit(text)
  │
  ├── 还没有 conversationId？先 POST /api/conversation 创建，再导航过去
  │     （新建会话不立刻建记录，避免列表堆一堆空会话）
  │
  ├── 乐观更新：把用户气泡先塞进列表（status: "pending"）
  │
  ├── POST /api/conversation/:id/message    FormData { text } → 202
  │
  └── EventSource /api/conversation/:id/stream?after=<快照游标>
        │
        ▼
      api.ts connectEvents → JSON.parse(message.data)
        │
        ▼
      state.ts conversationReducer(items, { type: "event", event })
        ├── message_add    → 用户气泡（按 text 去重，替换乐观气泡）
        ├── thinking_*     → ThinkingState
        ├── message_*      → 助手气泡（流式追加）
        └── tool_*         → ToolChips
        │
        ▼
      AgentHarness 渲染 MessageItem 列表
```

### 连接与重连

- 每个会话只连**一条** SSE：进入会话先 `POST /:id` 取快照（拿到历史 + `stream.seqId`），
  再用 `after=seqId` 连流，只订阅快照之后的事件 —— 历史不重放，避免重复气泡。
- 服务端 `EventChannel` 保留事件序列：断线重连（含 React StrictMode 双挂载）按 `after` 补发，不丢事件。
- **发送不依赖 `onopen`**：连上流就直接 POST；期间产生的事件靠 `after` replay 兜底。
- `loading` 跟的是「这一轮跑完没有」，由 `runtime.status` 与 `runntime_settled` 驱动，
  不是 POST 有没有返回。
- 会话列表（`useConversationList`）是另一个数据源：发送后刷新、有会话 `running` 时每 3s 轮询、
  窗口 focus 时对齐一次。

---

## 对话生命周期

```
POST /api/conversation       → 创建对话 → 生成 UUID
  │                                          ├── 创建工作目录
  │                                          ├── 创建 SessionManager
  │                                          ├── 持久化 ConversationRecord
  │                                          └── 创建 ManagerSession（含 runtime + channel）
  │
POST /:id/message             → 发送消息 → session.prompt(userInput)
  │                                          └── bind() 把 session 事件转发到 channel
  │
GET /:id/stream               → SSE 流 → replay 历史 + subscribe 实时
  │
POST /:id                     → 获取完整快照（历史消息 + 游标 + 状态）
```

---

## 相关文档

| 位置 | 内容 |
|------|------|
| `client/doc/00~07` | 前端：框架 / API / 状态 / hooks / primitives / Markdown / AgentHarness / SidebarNav |
| `server/doc/01~08` | 后端：配置 / 类型 / 需求 / runtime / 胶水 / service / SSE / 历史 |
| `bug-record/` | 排查记录：每个问题一个目录，含 `record.md`（现象 → 根因 → 修复 → 验证） |

---

## 许可

MIT