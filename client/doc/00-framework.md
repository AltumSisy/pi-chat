# 00 — 前端 AI Chat 架构总览

## 分层架构

```
┌─────────────────────────────────────────────────┐
│                    UI 层                         │
│  AgentHarness (组装)                             │
│  ├─ PromptBar      (用户输入)                    │
│  ├─ MessageItem    (消息分发器)                  │
│  │   ├─ ThinkingState  (思考面板)                │
│  │   ├─ ToolChips      (工具卡片)                │
│  │   ├─ Markdown       (AI 回复渲染)             │
│  │   └─ LoadingState   (加载动画)                │
│  └─ StreamingText (流式光标)                     │
├─────────────────────────────────────────────────┤
│                  Hook 层                         │
│  useConversationStream                          │
│  ├─ 持有 conversationId + items 状态             │
│  ├─ 管理 EventSource 生命周期                    │
│  └─ 协调 API 调用 → Reducer → UI 更新           │
├─────────────────────────────────────────────────┤
│                 逻辑层                           │
│  conversationReducer (state.ts)                 │
│  ├─ 纯函数，接收旧列表 + Action，返回新列表       │
│  ├─ 处理 10 种 SSE 事件类型                      │
│  └─ 支持乐观更新 (optimistic-user)               │
├─────────────────────────────────────────────────┤
│                  API 层                          │
│  api.ts                                         │
│  ├─ createConversation() → POST /api/conversation│
│  ├─ sendMessage()        → POST .../message     │
│  └─ connectEvents()      → EventSource SSE      │
├─────────────────────────────────────────────────┤
│                 类型层                           │
│  shared/types.ts                                │
│  StreamEvent, ChatMessage, MessageListItem, ...  │
└─────────────────────────────────────────────────┘
```

## 数据流

```
用户输入 "hi"
  │
  ▼
PromptBar.onSend ──→ AgentHarness.handleSend ──→ hook.send("hi")
                                                      │
  ┌───────────────────────────────────────────────────┘
  │
  ▼
  1. 乐观更新: ChatMessage(status:"pending")
     └─→ conversationReducer ──→ items 添加用户气泡
  │
  2. (首次) POST /api/conversation → 拿到 conversationId
  │
  3. POST /api/conversation/:id/message
     └─→ 后端开始运行 Agent
  │
  4. connectEvents(id) → EventSource
     └─→ GET /api/conversation/:id/stream?after=N
  │
  ▼
  SSE 事件流 ──→ onEvent 回调 ──→ conversationReducer ──→ setItems
                                                                  │
  ┌───────────────────────────────────────────────────────────────┘
  │
  ▼
  items 变化 → AgentHarness 重新渲染
  └─→ items.map(item → <MessageItem item={item} />)
        │
        ├─ kind:"Thinking" → ThinkingState (可折叠思考)
        ├─ kind:"tool"     → ToolChips (工具调用)
        └─ kind:"message"  → role:"user"     → 右对齐灰气泡
                           → role:"assistant" → Markdown 渲染
```

## 三个核心设计决策

### 1. EventSource 而不是 fetch SSE

`EventSource` 是浏览器原生 SSE 客户端，自动处理重连、自动解析 `data:` 行。
代价是不支持 POST 和自定义 header，但我们的 SSE 接口是 GET，完全匹配。

### 2. Reducer 模式而不是直接 setState

SSE 事件流是"追加式"的——新事件要合并到现有列表，不是替换。
用 reducer 把"如何合并"的逻辑集中在一个纯函数里，易测试易维护。

### 3. 乐观更新

用户点发送后，不等后端确认就把消息画到屏幕上。
后端 SSE 回放时自动替换 pending 消息为真实消息。
用户感知：零延迟。

## 文件索引

| 文件 | 章节 | 职责 |
|------|------|------|
| `api.ts` | [01-api.md](./01-api.md) | HTTP + SSE 封装 |
| `state.ts` | [02-state.md](./02-state.md) | Reducer 状态机 |
| `hooks/useConversationStream.ts` | [03-hook.md](./03-hook.md) | React Hook 串联 |
| `components/primitives/*` | [04-primitives.md](./04-primitives.md) | 5 个原始 UI 组件 |
| `components/Markdown.tsx` + `MessageItem.tsx` | [05-markdown-message.md](./05-markdown-message.md) | 消息渲染 |
| `components/AgentHarness.tsx` | [06-agent-harness.md](./06-agent-harness.md) | 主组装组件 |