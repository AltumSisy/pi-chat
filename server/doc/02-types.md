# types.ts 详设

## 文件位置

```
src/shared/types.ts
```

放在 `shared/` 而非 `server/`，因为前端（React hooks、state、mock）也需要这些类型。

> 类比 Java：相当于一个 `common` 模块，被 web 和 server 两个模块共同依赖。

---

## 类型清单（共 11 个）

### 按使用场景分层

```
┌─ 基础数据类型 ──────────────────────────────┐
│ ChatImage, ChatMessage, ToolRun, ThinkingBlock │
└──────────────────────────────────────────────┘
        │
        ▼
┌─ 消息列表聚合（UI 渲染用）──────────────────┐
│ MessageListToolItem, MessageListItem           │
└──────────────────────────────────────────────┘
        │
        ▼
┌─ SSE 流事件 ────────────────────────────────┐
│ RuntimeStatus, EventType, StreamEvent<T>       │
└──────────────────────────────────────────────┘
        │
        ▼
┌─ 存储 / API 契约 ───────────────────────────┐
│ ConversationSummary, ConversationSnapshot,     │
│ CreateConversationResponse                     │
└──────────────────────────────────────────────┘
```

---

## 逐一定义

### 1. `RuntimeStatus` — agent 运行时状态

```typescript
type RuntimeStatus = "ready" | "running" | "stopping" | "compacting" | "error" | "cold";
```

| 值 | 含义 |
|----|------|
| `cold` | 刚创建，还没启动 |
| `running` | 正在执行（调用模型 / 工具） |
| `ready` | 空闲，等待用户输入 |
| `stopping` | 用户点了停止，正在收尾 |
| `compacting` | 正在压缩上下文 |
| `error` | 出错了 |

UI 根据这个值决定展示 loading 还是输入框。

---

### 2. `ChatImage` — 消息中的图片

```typescript
interface ChatImage {
    type: "image";
    mimeType: string;   // "image/png" | "image/jpeg" | ...
    data: string;        // base64
}
```

---

### 3. `ChatMessage` — 一条消息

```typescript
interface ChatMessage {
    id: string;
    role: "user" | "assistant";
    text: string;
    images: ChatImage[];
    streaming?: boolean;   // 正在流式输出中
    pending?: boolean;     // 等待发送
    error?: string;        // 发送失败的原因
}
```

- `streaming` 和 `pending` 是**瞬态字段**，存在 sessions JSONL 里用于恢复 UI 状态，但写入 records 快照时不会保留

---

### 4. `ToolRun` — 一次工具调用

```typescript
interface ToolRun {
    id: string;
    name: string;                    // "read" | "write" | "bash" | ...
    args: Record<string, unknown>;   // 调用参数
    status: "running" | "success" | "error";
    result?: string;                 // 工具返回结果
    details?: unknown;               // 结构化详情
}
```

---

### 5. `ThinkingBlock` — 一次思考过程

```typescript
interface ThinkingBlock {
    id: string;
    text: string;
    completed?: boolean;   // 思考是否已结束
}
```

---

### 6. `MessageListToolItem` — 消息列表中的工具项

```typescript
type MessageListToolItem = {
    kind: "tool";
    id: string;
    tool: ToolRun;
    seqId?: number;
};
```

`kind: "tool"` 是**可辨识联合**的 tag，类似 Java 里 `instanceof` 检查，TS 靠它收窄类型。

---

### 7. `MessageListItem` — 消息列表的一项

```typescript
type MessageListItem =
    | { kind: "message";  id: string; message: ChatMessage;   seqId?: number }
    | { kind: "thinking"; id: string; thinking: ThinkingBlock; seqId?: number }
    | MessageListToolItem;
```

三种形态的联合类型。前端渲染时：

```typescript
function renderItem(item: MessageListItem) {
    switch (item.kind) {
        case "message":  return <MessageBubble message={item.message} />;
        case "thinking": return <ThinkingPanel thinking={item.thinking} />;
        case "tool":     return <ToolCard tool={item.tool} />;
    }
}
```

类比 Java 的 sealed class：

```java
sealed interface MessageListItem permits MessageItem, ThinkingItem, ToolItem {
    String getId();
}
```

---

### 8. `EventType` — SSE 事件类型

```typescript
type EventType =
    // 运行时
    "runtime.status" | "runtime.error" | "runtime.settled" |
    // 消息
    "message.delta" | "message.started" | "message.added" | "message.completed" |
    // 思考
    "thinking.started" | "thinking.delta" | "thinking.completed" |
    // 工具
    "tool.started" | "tool.updated" | "tool.completed";
```

这是 SSE 流里每个事件的 `type` 字段，对应 sessions JSONL 里 `"type":"message"` 的实际值。

---

### 9. `StreamEvent<T>` — 一个 SSE 事件

```typescript
interface StreamEvent<T = unknown> {
    id: number;          // 事件序号（递增）
    streamId: string;    // 所属会话流 ID
    type: EventType;     // 事件类型
    payload: T;          // 根据 type 不同而不同
}
```

这就是 sessions JSONL 里**每一行**的格式。`id` 用于断线重连时告诉服务端"我从第 N 个事件之后开始要"。

---

### 10. `ConversationSummary` — 对话列表项

```typescript
interface ConversationSummary {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    workspaceDir: string;   // workspaces/{id} 的路径
    parentId?: string;       // 分支对话的父 ID
    status: RuntimeStatus;
}
```

存在 `records/{id}.json` 中 `ConversationSnapshot.conversation` 字段里。列表页只需要这个摘要，不用加载完整的 messageList。

---

### 11. `ConversationSnapshot` — 对话完整快照

```typescript
interface ConversationSnapshot {
    conversation: ConversationSummary;
    messageList: MessageListItem[];    // 全部消息、思考、工具的聚合
    model: { provider: string; id: string };
    thinkingLevel: ThinkingLevel;       // 来自 @earendil-works/pi-agent-core
    availableThinkingLevels: ThinkingLevel[];
    status: RuntimeStatus;
    error?: string;
    stream: { id: string; lastEventId: number };  // 恢复连线用的流信息
    diagnostics: string[];
}
```

这就是 `records/{id}.json` 的**完整内容**。

---

### 12. `CreateConversationResponse` — 创建对话的返回值

```typescript
interface CreateConversationResponse {
    conversation: { id: string };
    model: { provider: string; id: string };
    thinkingLevel: ThinkingLevel;
    stream: { id: string; lastEventId: number };
    diagnostics: string[];
}
```

比 `ConversationSnapshot` 更轻，因为刚创建时没有 messageList。

---

## 类型对接存储

```
records/{id}.json
  └── ConversationSnapshot
        ├── conversation: ConversationSummary
        └── messageList: MessageListItem[]
                              ├── kind:"message"  → ChatMessage
                              ├── kind:"thinking" → ThinkingBlock
                              └── kind:"tool"     → ToolRun

sessions/{ts}_{id}.jsonl    （每行一个）
  └── StreamEvent<...>
        └── type: EventType

SSE 推送（前端接收）
  └── StreamEvent<...>
```

---

## 依赖

| 类型 | 依赖 |
|------|------|
| `RuntimeStatus` | 无 |
| `EventType` | 无 |
| `ThinkingLevel` | `@earendil-works/pi-agent-core`（import type，不产生运行时代码） |
| 其余全部 | 仅依赖上面的基础类型 |