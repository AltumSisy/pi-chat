# 03 — useConversationStream Hook

## 文件位置

`client/hooks/useConversationStream.ts`

## 职责

把 API 层和 Reducer 串成一个可用的 React Hook。它是整个应用的**数据中枢**——所有状态变更都经过这里。

```
     API 层                Reducer               React State
  ───────────          ──────────────          ──────────────
  createConversation ─┐
  sendMessage ────────┤                    ┌─→ conversationId
  connectEvents ──────┤─→ onEvent ──→ reducer ─→ items
                      │                    └─→ loading / error
  optimistic-user ────┘
```

## 接口设计

```ts
function useConversationStream(initialConversationId?: string): {
  conversationId: string | undefined
  items: MessageListItem[]
  loading: boolean
  error: string
  send: (text: string) => Promise<void>
  newConversation: () => Promise<void>
}
```

### 参数

`initialConversationId` — 可选的初始会话 ID。传了就直接连 SSE；不传则首次 `send()` 时自动创建。

### 返回值

| 字段 | 类型 | 说明 |
|------|------|------|
| `conversationId` | `string \| undefined` | 当前会话 ID，`undefined` 表示尚未创建 |
| `items` | `MessageListItem[]` | 当前会话的消息/思考/工具列表 |
| `loading` | `boolean` | 正在等待 AI 回复 |
| `error` | `string` | 连接错误信息，空串表示正常 |
| `send` | `(text: string) => Promise<void>` | 发送用户消息 |
| `newConversation` | `() => Promise<void>` | 开始新会话（关闭旧连接 + 创建新会话） |

## 核心流程

### 1. `send(text)` — 发送消息

```text
send("hi")
  │
  ├─ 1. 防重入检查 (loadingRef.current)
  │
  ├─ 2. 首条消息 → POST /api/conversation 创建会话
  │     └─→ 更新 conversationId + lastSeqRef
  │
  ├─ 3. 乐观更新
  │     └─→ reducer({ type: "optimistic-user", message })
  │     └─→ items 出现一个 status:"pending" 的用户气泡
  │
  ├─ 4. POST /api/conversation/:id/message
  │     └─→ 后端开始执行 Agent
  │
  └─ 5. connect(id)
        └─→ EventSource 连接 → 事件流 → reducer → items 更新
```

### 2. `connect(id)` — 建立 SSE 连接

```text
connect(id)
  │
  ├─ 关闭旧 EventSource (esRef.current?.close())
  │
  ├─ 创建新 EventSource
  │     └─→ URL: /api/conversation/:id/stream?after={lastSeq}
  │
  ├─ onEvent 回调:
  │     ├─→ reducer({ type: "event", event })
  │     ├─→ 更新 lastSeqRef (追踪最新事件序号)
  │     └─→ 检测 message_completed / runntime_settled → setLoading(false)
  │
  ├─ onError 回调:
  │     └─→ setError("连接断开，正在重连…")
  │     └─→ EventSource 自动重连，无需手动处理
  │
  └─ onOpen 回调:
        └─→ setError("")  // 清除错误
```

### 3. `newConversation()` — 开始新会话

```text
newConversation()
  │
  ├─ 关闭旧 EventSource
  ├─ 重置所有状态 (conversationId, items, loading, error, lastSeq)
  ├─ POST /api/conversation 创建新会话
  ├─ 设置 conversationId + lastSeqRef
  └─ connect(id) → 开始接收 SSE 事件
```

## 关键设计决策

### `loadingRef` — 绕过 useCallback 循环依赖

**问题：** `send` 需要检查 `loading` 状态防止重复发送，但 `send` 用 `useCallback` 包裹。如果依赖 `loading` state，每次 loading 变化都会重建 `send`。

**解法：** 用一个 `loadingRef` 镜像 `loading` state，`send` 读 `loadingRef.current` 而不是 `loading` state。`loadingRef` 是 `useRef`，引用稳定，不作为 `useCallback` 的依赖。

```ts
const loadingRef = useRef(false);
useEffect(() => { loadingRef.current = loading; }, [loading]);
// send 里用 loadingRef.current，不依赖 loading
```

### `runIdRef` — 防竞态

用户快速连发两条消息时，第二条的响应可能先到。`runIdRef` 是一个递增计数器，每次 `send` 时自增。收到错误时检查 `runId === runIdRef.current`——只有最新一次发送的错误才需要显示。

### `lastSeqRef` — 重连断点

记录已收到事件的最大 `id`。重连时传给 `after` 参数，让后端跳过已处理的事件，避免重复渲染。

## 数据流时序图

```
时间 →

send("hi")
  │
  ├─ items: [用户气泡(pending)]
  ├─ loading: true
  │
  ├─ POST message ──────────────┐
  ├─ connect() ──────────────┐  │
  │                           │  │
  ▼                           ▼  ▼
EventSource 连上        后端收到消息
  │                           │
  ├─ message_add ───── 从 SSE 回放 ──→ items: [用户气泡(真实)]
  ├─ thinking_started   ──→ items: [..., 思考块]
  ├─ thinking_delta     ──→ 思考块文字追加
  ├─ thinking_completed ──→ 思考块完成标记
  ├─ message_delta      ──→ items: [..., AI气泡(流式)]
  ├─ message_delta      ──→ AI气泡文字追加
  ├─ message_completed  ──→ items: [..., AI气泡(完成)]
  │                           │
  │                     loading: false
  ▼
继续监听后续事件…
```

## React 生命周期

```
组件挂载
  ├─→ 初始化 state (conversationId, items, loading, error)
  ├─→ 注册 cleanup: esRef.current?.close()
  │
  ├─→ 如果 initialConversationId 存在 → connect(id)
  │
  │  [用户交互…]
  │
  └─→ 组件卸载
        └─→ esRef.current?.close()  // 断掉 SSE 连接
```