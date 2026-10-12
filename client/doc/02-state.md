# 02 — 状态管理（Reducer）

## 文件位置

`client/state.ts`

## 职责

把零散的 SSE 事件流转换成有序的 UI 渲染列表。它是 SSE 和 React 之间的**纯函数转换层**。

```
SSE 事件 (流)                    MessageListItem[] (列表)
─────────────────────────────────────────────────────
thinking_started     ─┐
thinking_delta       ─┤        conversationReducer
thinking_completed   ─┤       ════════════════════
tool_started         ─┤  ──→  渲染列表
tool_completed       ─┤
message_delta        ─┤
message_completed    ─┘
```

## 核心类型

### `MessageListItem` — UI 渲染的统一单元

```ts
type MessageListItem =
  | { kind: "message"; message: ChatMessage }    // 用户/AI 消息
  | { kind: "Thinking"; thinking: ThinkingBlock } // 思考过程
  | { kind: "tool"; tool: ToolRun }              // 工具调用
```

三种 `kind` 对应三种 UI 组件：消息气泡、思考面板、工具卡片。`MessageItem` 组件根据 `kind` 做分发。

### `ConversationAction` — Reducer 的输入

```ts
type ConversationAction =
  | { type: "event"; event: StreamEvent }         // SSE 事件
  | { type: "optimistic-user"; message: ChatMessage } // 乐观更新
```

两种来源：SSE 推送的实时事件，和用户操作触发的乐观更新。

## 10 种 SSE 事件的处理逻辑

### `message_add` — 用户消息到达

SSE 回放（或实时推送）的用户消息。与乐观更新配合：如果已有一个 `status:"pending"` 的临时消息，替换成真实的。

### `message_started` — AI 开始回复

**不渲染任何东西。** 这是有意为之——空的消息气泡会让界面"闪一下"。等 `message_delta` 或 `thinking_started` 来再创建 UI。

### `message_delta` — AI 逐字回复

关键逻辑：先查列表中是否已有同 ID 消息。如果没有（兼容某些不先发 `started` 的后端实现），创建新的。如果有，在 `text` 后面拼接 `delta`。

```ts
text: current.message.text + delta
```

### `message_completed` — AI 回复完成

用最终完整消息替换流式消息。`status` 从 `"streaming"` 变为 `"streaming"` 以外的状态（由 payload 决定）。

### `thinking_started` — 思考开始

创建 `ThinkingBlock { id, text: "" }`。去重检查：如果已有同 ID 的思考块，不重复创建。

### `thinking_delta` — 思考文字追加

类比 `message_delta`，找到对应 `ThinkingBlock` 并追加 `text`。

### `thinking_completed` — 思考完成

标记 `completed: true`。UI 层检测到后自动折叠面板。

### `tool_started` — 工具调用开始

创建 `ToolRun { status: "running" }`。

### `tool_updated` / `tool_completed` — 工具状态更新

合并新字段到现有 `ToolRun`。`tool_completed` 时根据 `payload.status` 判断最终状态：
- `"error"` → `status: "error"`
- 其他 → `status: "success"`

`result` 和 `details` 只在有值时合并，避免覆盖已有数据为 `undefined`。

## 辅助函数设计

### `updateItem(items, id, updateFn)` — 不可变更新的标准模式

```ts
items.map(item => item.id === id ? updateFn(item) : item)
```

`map` 返回新数组，不修改旧数组。React 通过 `oldArray !== newArray` 判断重渲染。

### `addUserMessage(items, message)` — 乐观更新去重逻辑

1. 已存在同 ID → 不重复添加
2. 找到之前的 pending 消息（相同文本）→ 替换为真实消息
3. 都不匹配 → 追加到列表末尾

### `addOrUpdateTool` / `addOrUpdateMessage` — 新增或合并

先查是否存在，不存在则追加，存在则用展开运算符合并：

```ts
{ ...item.tool, ...tool }  // tool 的新字段覆盖旧字段
```

## 核心原则

1. **纯函数** — 相同输入永远相同输出，不依赖外部状态
2. **不可变** — 永远返回新数组/新对象，不修改参数
3. **幂等** — 重复处理同一个事件不会产生副作用（去重检查）
4. **安全解析** — `eventPayload` 防御性提取，`payload` 可能为非 object 类型