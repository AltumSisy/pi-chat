# 08-history — 历史会话快照与渲染

> 前置阅读：[02-types.md](./02-types.md)、[06-service.md](./06-service.md)、[07-sse.md](./07-sse.md)
>
> 注：[06-service.md](./06-service.md) §5.3 与 §10 中「`messageList` 恒为 `[]`，待实现」的描述已过时，本文档描述的即为该 TODO 的实现。

---

## 1. 一句话定位

SSE 只推**增量**（`message_delta` / `tool_completed` …），它不负责"打开页面时已经发生过的内容"。这部分由**快照**补齐：

> 服务端把 pi 的 session 树（`SessionEntry[]`）翻译成前端渲染用的 `MessageListItem[]`，客户端再用快照里的 `stream.seqId` 作为 SSE 的 `after` 游标，把**历史**与**增量**拼成一条不重不漏的时间线。

```
        pi session 树            服务端翻译               HTTP 传输              客户端拼接
   ┌──────────────────┐   ┌───────────────────┐   ┌──────────────────┐   ┌────────────────────┐
   │ SessionEntry[]   │──▶│ MessageListItem[] │──▶│ Conversation     │──▶│ history + live     │
   │ getBranch()      │   │ ConversationView  │   │ Snapshot         │   │ 两个 state 数组拼接 │
   └──────────────────┘   │ Build             │   └──────────────────┘   └────────────────────┘
   pi-coding-agent        helpr.ts             service.ts → api.ts        useConversationStream2
```

四段职责：

| 段 | 位置 | 职责 | 不关心 |
|---|---|---|---|
| ① 取数 | `server/conversation/service.ts` `snapshot()` | 恢复 session、取当前分支、组装快照 JSON、给出事件游标 | 消息怎么翻译 |
| ② 翻译 | `server/conversation/helpr.ts` `ConversationViewBuild` | `SessionEntry[]` → `MessageListItem[]`（纯函数式转换） | HTTP、SSE、React |
| ③ 传输 | `client/api.ts` `getConversation()` | 一次 HTTP 调用 + 错误归一 | 消息结构、渲染 |
| ④ 拼接 | `client/hooks/useConversationStream2.ts` | 历史与增量合流、游标续传、乐观更新 | 事件翻译细节 |

---

## 2. 全景数据流

```
┌─ 服务端 ─────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  POST /api/conversation/:id                        routes/conversation.ts    │
│        │                                                                     │
│        ▼                                                                     │
│  service.snapshot(id)                              conversation/service.ts  │
│        │                                                                     │
│        ├─ ① conversationReposity.get(id)           磁盘 records/{id}.json    │
│        ├─ ② ensureManagedSession(id)               内存命中 / SessionManager.open
│        │        └─ createRuntime + bind()          冷启动时重建 runtime      │
│        ├─ ③ session.sessionManager.getBranch()     ← 当前分支 root→leaf      │
│        ├─ ④ new ConversationViewBuild(branch).build()
│        │        │                                                           │
│        │        │   entry.type === "message" 才处理                          │
│        │        ├─ role === "user"       → ChatMessage           (kind: message)  │
│        │        ├─ role === "assistant"  → ChatMessage + Thinking + Tool[]        │
│        │        └─ role === "toolResult" → 回填对应 Tool（按 toolCallId）          │
│        │                                                                     │
│        └─ ⑤ return { conversationSummary, messageList, ..., stream: { id, seqId } }
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                   │ application/json
                                   ▼
┌─ 客户端 ─────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  api.getConversation(id)                           client/api.ts             │
│        │                                                                     │
│        ▼                                                                     │
│  useConversationStream2(conversationId)            client/hooks/…2.ts        │
│        │                                                                     │
│        ├─ setHistoryState({ conversationId, items: snapshot.messageList })   │
│        ├─ after = snapshot.stream.seqId        ← 游标：历史不重放            │
│        ├─ connectEvents(id, …, after)          ← SSE 只收 seqId 之后的事件    │
│        └─ setMessageState(reducer(items, event))                            │
│                                                                              │
│  messageItems = [...historyState.items, ...messageState.items]  ← 拼接        │
│        │                                                                     │
│        ▼                                                                     │
│  <MessageItem item={…}/>  按 kind 分派：Thinking / tool / message            │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 第 1 段：服务端组装快照（`service.ts`）

```typescript
public async snapshot(id: string): Promise<ConversationSnapshot> {
  const restoredConversationRecord = await this.conversationReposity.get(id);
  if (!restoredConversationRecord)
    throw new Error(`conversationRecord with ${id} is not found `);
  const managedSession = await this.ensureManagedSession(id);   // ← 有副作用
  const session = managedSession.runtime.session;
  const channel = managedSession.channel;

  const branch = session.sessionManager.getBranch();            // ← 当前分支
  const builder = new ConversationViewBuild(branch);
  const messageList = builder.build();                          // ← 翻译

  return {
    conversationSummary: this.summary(restoredConversationRecord, managedSession.status),
    messageList: messageList,
    model: { provider: session.agent.state.model.provider, id: session.agent.state.model.id },
    thinkingLevel: session.agent.state.thinkingLevel,
    availableThinkingLevels: session.getAvailableThinkingLevels(),
    status: managedSession.status,
    error: managedSession.error,
    stream: { id: channel.streamId, seqId: channel.lastId() },   // ← 事件游标
    diagnostics: managedSession.diagnostics,
  };
}
```

### 3.1 为什么快照接口是 POST 而不是 GET

`snapshot()` **不是纯读**：它先调 `ensureManagedSession(id)`。服务重启后内存 Map 为空，这次调用会：

```
ensureManagedSession(id)
  ├─ 内存命中？ → 直接返回
  └─ 未命中 → SessionManager.open(sessionFile, …)   恢复历史
             → createRuntime(...)                   重建 AI 运行时
             → bind(managerSession)                 重新订阅事件、重新创建 EventChannel
```

也就是说，**一次"读历史"会顺带把会话运行时恢复起来**（这正是"打开历史会话还能继续对话"的原因）。有副作用的接口用 POST：

| 版本 | 写法 | 结果 |
|---|---|---|
| 修复前 | 路由 `post("/:id")` + 客户端 `fetch(url)`（默认 GET） | 404，快照永远取不到 |
| 修复前 | 路由 `ctx.json(conversationService.snapshot(id))`（漏 `await`） | 序列化 Promise → 返回 `{}` |
| 现在 | 客户端 `fetch(url, { method: "POST" })` + 路由 `await` | 正常 |

### 3.2 `getBranch()` 的语义

```typescript
// pi-coding-agent: SessionManager.getBranch(fromId?)
// 从 leafId 沿 parentId 回溯到根，然后 reverse
// → 返回 root → leaf（时间正序）的当前分支
```

三个要点：

| 要点 | 说明 |
|---|---|
| 是**分支**不是整棵树 | 从 current leaf 回溯的路径；切换/分叉出的其它分支不会出现 |
| 顺序是 root→leaf | 所以 `ConversationViewBuild` 里顺序 `push` 出来的就是时间正序，不需要再排序 |
| 元素不只是 message | `SessionEntry` 有 9 种类型，只有 `type === "message"` 会被翻译（见 §4.5） |

### 3.3 `stream.seqId` — 快照与 SSE 的接缝

`channel.lastId()` 返回**快照这一刻**已发布事件的最后一个序号（`EventChannel.sequenceId - 1`）。客户端拿它当 `after`：

```
        seqId 之前                     seqId 之后
  ├──────────────────────┼──────────────────────────▶ 事件序号
  已被快照覆盖的内容            还没发生、需要实时推的内容
  （不重放，避免重复气泡）        （after=N → 只推 id > N）
```

这是整个设计里最关键的一行：**它让"历史"和"实时"在同一条时间线上无缝衔接，不重不漏**（唯一的例外见 §8.1）。

---

## 4. 第 2 段：`SessionEntry` → `MessageListItem`（`helpr.ts`）

### 4.1 输入输出

```typescript
export class ConversationViewBuild {
  private readonly entries: SessionEntry[];                       // 入：session 分支
  private readonly messageItem: MessageListItem[] = [];           // 出：渲染列表
  private readonly toolsByCallId = new Map<string, MessageListToolItem>();  // 工具两阶段回填

  build(): MessageListItem[] {
    for (const entry of this.entries) this.processEntry(entry);
    return this.messageItem;
  }
}
```

> 注意类名是 `ConversationViewBuild`（动词 `Build`），文档里不要写成 `Builder`；文件名是 `helpr.ts`（少一个 `e`），和 `ConversationReposity` 一样是历史拼写。

### 4.2 分派：只认 `type === "message"`，再按 role 三路

```typescript
private processEntry(entry: SessionEntry) {
  if (entry.type != "message") return;              // 其余 8 种 entry 直接跳过
  const message = entry.message;

  if (message.role === "user")       this.addUserMessage(entry, message);
  if (message.role === "assistant")  this.addAssistantMessage(entry, message);
  if (message.role === "toolResult") this.updateToolResult(message);
}
```

| role | 输入（pi 侧） | 输出（前端侧） | 产出数量 |
|---|---|---|---|
| `user` | `content: string \| (TextContent \| ImageContent)[]` | `ChatMessage{ role:"user" }` | 1 个 `kind:"message"` |
| `assistant` | `content: (TextContent \| ThinkingContent \| ToolCall)[]`、`errorMessage?` | `ChatMessage` + `ThinkingBlock` + `ToolRun[]` | **1 + 1 + N** 个 item |
| `toolResult` | `toolCallId`、`content`、`details`、`isError` | 回填到已存在的 `ToolRun` | 0 个新 item（原地更新） |

### 4.3 `addUserMessage` — 单条消息

```typescript
const content = normalizeContent(message.content);   // string → [{type:"text",text}]
const chatMessage: ChatMessage = {
  id: entry.id,                                      // ← session entry 的 UUID
  role: "user",
  text: extractText(content),
  images: extractImage(content),
};
this.messageItem.push({ id: entry.id, kind: "message", message: chatMessage });
```

- `normalizeContent` 把 `content: string` 归一成数组，让两条路径（用户/助手）共用 `extract*` 工具函数。
- `extractText` 用 `join("")` 拼接多个 text part，不插入分隔符 —— 与实时流"delta 累加"的语义保持一致。

### 4.4 `addAssistantMessage` — 一条 entry 拆成三类 item

```
assistant entry
  ├── ① ChatMessage            (kind: "message")   text = 所有 text part 拼接
  │                                                 errorMessage → {...error}（见 §8.4）
  ├── ② ThinkingBlock          (kind: "Thinking")  text = 所有 thinking part 拼接
  │                                                 id = entry.id + ":thinking"
  │                                                 completed: true（历史即为已完成）
  └── ③ ToolRun × N            (kind: "tool")      id = part.id（= toolCallId）
                                                    status: "running"（占位，等 toolResult 回填）
                                                    ├─ toolsByCallId.set(part.id, item)
                                                    └─ push 进 messageItem
```

**为什么工具是"两阶段"**：pi 把工具调用写在 **assistant 消息的 content 里**（`ToolCall` part），而执行结果是一条**独立的 `toolResult` entry**。两者隔了若干轮事件，所以必须用 `toolsByCallId` 先建占位 item、后回填：

```
assistant entry  →  ToolCall{ id:"call_1", name:"read", arguments:{…} }
                       │
                       ├─ 建 ToolRun{ id:"call_1", name, args, status:"running" }
                       └─ toolsByCallId.set("call_1", item)   ← 指针存进 Map
                       …
toolResult entry →  ToolResultMessage{ toolCallId:"call_1", content, details, isError }
                       │
                       └─ 取出 Map 里的 item，替换 item.tool：
                            { id, name, args, status: isError ? "error" : "success",
                              result: extractText(content), details }
```

`updateToolResult` 的两个防御：

```typescript
const toolCallId = message.toolCallId;
if (!toolCallId) return;                  // 没有 id 无法匹配
const item = this.toolsByCallId.get(toolCallId);
if (!item) return;                        // 找不到占位 → 静默丢弃（分支切割/压缩后可能出现）
```

### 4.5 id 约定与忽略清单

| 产出 | id | 与实时流一致？ |
|---|---|---|
| 用户消息 | `entry.id`（session entry UUID） | ✗ 实时是 `randomUUID()` |
| 助手消息 | `entry.id` | ✗ 实时是 `streamMessageId` |
| 思考块 | `entry.id + ":thinking"` | ✗ 实时是 `streamThinkingId` |
| 工具 | `part.id`（即 `toolCallId`） | ✓ **两边同 id**（→ §8.2 的重复 chip 问题） |

被忽略的 entry 类型（`entry.type != "message"` 全部跳过）：

| entry.type | 内容 | 为什么可以跳过 |
|---|---|---|
| `thinking_level_change` | 思考等级变更 | 快照另有 `thinkingLevel` 字段（取运行时当前值） |
| `model_change` | 模型切换 | 快照另有 `model` 字段 |
| `compaction` / `branch_summary` | 压缩/分支摘要 | 属于 pi 上下文管理，当前 UI 不展示 |
| `custom` | 扩展私有数据 | 不参与 UI |
| `custom_message` | 扩展注入的消息（**参与 LLM 上下文**） | ⚠️ 历史里不显示，与实时流可能不一致（见 §8.10） |
| `label` / `session_info` | 书签、会话名 | 不属于消息列表 |

### 4.6 辅助函数

| 函数 | 作用 | 备注 |
|---|---|---|
| `normalizeContent(content)` | `string` → `[{type:"text"}]` | 只对 user 有意义 |
| `extractText(content)` | 过滤 `type === "text"`，`join("")` | 连续拼接，无分隔符 |
| `extractThinking(content)` | 过滤 `type === "thinking"`，取 `.thinking` | 注意字段名是 `thinking` 不是 `text` |
| `extractImage(content)` | 过滤 `isImagePart`，输出 `{ type, mimeType, data }` | 与 `ChatImage` 类型一致 |
| `isImagePart(part)` | `type === "image" && data && mimeType` | 三重判断，缺一不可 |
| `isToolPart(part)` | `type === "toolCall" && id && name` | 用于挑出工具调用 |
| `resultText(result)` | `AgentToolResult → string` | **只有 SSE 实时路径用**，历史路径用 `extractText(message.content)` |

---

## 5. 第 3 段：客户端快照 API（`api.ts`）

```typescript
// 历史快照：服务端会顺带恢复 runtime session，所以用 POST（见 server/routes/conversation.ts）
export function getConversation(id: string): Promise<ConversationSnapshot> {
  return readResponse(
    fetch(`/api/conversation/${encodeURIComponent(id)}`, { method: "POST" }),
  );
}
```

| 细节 | 说明 |
|---|---|
| `method: "POST"` | 与路由 `conversationApp.post("/:id")` 对齐（修复前是 GET → 404） |
| `encodeURIComponent(id)` | 防止特殊字符破坏 URL |
| `readResponse` | `!response.ok` → 读 `{ error }` → 否则 `status + statusText`，统一成 `Error.message` |
| 返回类型 | `ConversationSnapshot`，编译期契约，运行时不做校验 |
| 与 `createConversation` 的关系 | 两个接口返回**同一个** `ConversationSnapshot`（新建后立刻打一拍快照），所以 hook 里两者可互换使用 |

调用方在 hook 里所做的唯一事情，是把它拆成"消息"和"游标"两半（见下）。

---

## 6. 第 4 段：历史提取与显示（`useConversationStream2.ts`）

### 6.1 两个 state：历史与实时分开存

```typescript
const [historyState, setHistoryState] = useState<{ conversationId?: string; items: MessageListItem[] }>({ items: [] });
const [messageState, setMessageState] = useState<{ conversationId?: string; items: MessageListItem[] }>({ items: [] });

const messageItems = [
  ...(historyState.conversationId === conversationId ? historyState.items : []),
  ...(messageState.conversationId === conversationId ? messageState.items : []),
];
```

| 设计 | 原因 |
|---|---|
| 两个数组而不是一个 | 历史是"一次性整体替换"，实时是"逐事件追加"；两者更新频率完全不同 |
| 各带 `conversationId` | 切换会话时，旧会话的 state 还在 React 里，用 `conversationId` 判断即可丢弃，**不需要手动清空**（避免闪烁） |
| `messageItems` 每次渲染现算 | 历史/实时都不改对方，拼接成本 O(n)，换来逻辑简单 |

代价：两个数组之间**没有任何去重/合并逻辑** —— 这是 §8.2 工具重复 chip 的根因。

### 6.2 时序：快照 → 游标 → SSE

```
conversationId 变化 / 组件挂载
  │
  ├─ ① esRef.current?.close(); esRef.current = null
  │      防止 StrictMode 双调用 / 快速切换会话时两个连接并存
  │
  ├─ ② await getConversation(conversationId)
  │      ├─ 成功 → setHistoryState({ conversationId, items: snapshot.messageList })
  │      └─ 失败 → setErrorState({ conversationId, message })   ← 注意：不中断流程
  │
  ├─ ③ after = snapshot.stream?.seqId ?? 0                       ← 历史已覆盖的部分不订阅
  │      （拉取失败时 after 保持 0 → SSE 从头 replay，历史靠事件重建）
  │
  └─ ④ source = connectEvents(id, onEvent, onError, onOpen, after)
         ├─ EventSource(`/api/conversation/:id/stream?after=N`)
         ├─ onmessage → setMessageState(reducer(仅实时 items, event))     ← 只喂实时数组
         └─ onopen    → 若 pendingSend 匹配 → 乐观插入用户气泡 + send()
```

### 6.3 三个容易忽略的细节

#### a) 快照失败也照连 SSE

```typescript
} catch (error) {
  if (cancelled) return;
  setErrorState({ conversationId, message: (error as Error)?.message || "Failed to load history" });
}
if (cancelled) return;
source = connectEvents(…);        // ← 不在 catch 里 return，继续连接
```

否则快照挂了就等于整个会话不可用。此时 `after = 0`，EventChannel 会 `replay` 全部历史事件，消息列表仍可由 reducer 从事件重建（只是多一次重放）。

#### b) 游标的作用是「避免重复气泡」

```typescript
// 只订阅快照之后的事件：历史里已有的内容不再重放，避免重复气泡
after = conversation.stream?.seqId ?? 0;
```

如果没有这一步（`after = 0`），用户消息会同时出现在 `historyState` 和 `messageState` 里 → 每条历史消息都渲染两遍。这也是 `bug-record/web-输出重复问题` 一类问题的同类根因。

#### c) 乐观更新的插入点在 `onopen`，不在 `submit`

```typescript
// submit() 里只记录待发内容，不插入气泡：
pendingSend.current = { conversationId, text, message };
navigate(`/conversation/${conversationId}`);

// 等 SSE 连接真正建立（onOpen）后才插入 + 发送：
setMessageState(… reducer(…, { type: "optimistic-user", message: pending.message }));
send(conversationId, pending.text);
```

先建连、后发送，保证 `message_add` 等实时事件不会有"连接还没建立就发布"的丢失窗口。reducer 里 `addUserMessage` 再按 `text` 匹配，把 `pending-xxx` 的乐观气泡替换成服务端真实消息。

### 6.4 渲染：列表交给 `MessageItem` 按 `kind` 分派

```typescript
if (item.kind === "Thinking") → <ThinkingState working={!item.thinking.completed} text={item.thinking.text} … />
if (item.kind === "tool")     → <ToolChips tool={item.tool} />
否则                          → <article> 用户 = 纯文本气泡（右对齐）/ 助手 = <Markdown/>（左对齐）
                                message.status === "pending" → 「发送中…」
                                message.status === "error"   → 「发送失败」
```

历史与实时共用同一套渲染，所以**两侧字段是否一致直接决定渲染是否一致** —— 这正是下一节的主题。

---

## 7. 历史 vs 实时：差异对照表

这是本文档最实用的一张表：同一个消息，走两条路进来，字段并不完全一样。

| 维度 | 历史（快照 → `historyState.items`） | 实时（SSE → reducer → `messageState.items`） |
|---|---|---|
| 生成者 | `ConversationViewBuild`（`helpr.ts`） | `service.bind()` 发事件 + `conversationReducer`（`state.ts`） |
| 用户消息 id | `entry.id` | `randomUUID()`（bind 现场生成） |
| 助手消息 id | `entry.id` | `streamMessageId`（`randomUUID()`） |
| 思考块 id | `entry.id + ":thinking"` | `streamThinkingId`（`randomUUID()`） |
| 工具 id | `part.id` | `event.toolCallId`（**同一个值**） |
| item 顺序（助手一轮） | `[消息, 思考, 工具…]`（每个 entry 固定三连） | 事件到达顺序：思考 → 文本 → 工具 |
| `message.status` | 不设置 | 乐观更新为 `"pending"`，delta 后为 `"streaming"` |
| `thinking.completed` | 恒为 `true`（`helpr.ts:149`） | 收到 `thinking_completed` 才置 `true` |
| 图片字段名 | `mimeType`（符合 `ChatImage`） | `MIMEType`（`service.ts:175`，**拼写不一致**） |
| 助手错误信息 | 多一个未声明的 `error` 字段 | 无（reducer 不认这个字段） |
| 错误气泡能否显示 | 不能（前端读 `status === "error"`） | 也不能（`message_completed` 缺消息体，见 §8.3） |
| 刷新/重开页面 | 有（来自磁盘 session） | 丢失（内存事件不清空但连接会重建，靠 history 兜底） |

结论：**同一份数据，两条路径的 id 体系不同、状态语义不同、部分字段名不同**。列表拼接（`concat`）因此只能"看起来对"，一旦同一内容同时出现在两侧（工具）就会重复。

---

## 8. 已知缺口与 TODO

按影响排序，均可在上表找到出处。

### 8.1 刷新页面会丢掉"正在输出"的内容（时序缺口）

pi 的持久化时机是 `message_end`（SDK 注释：*"Session persistence is handled internally (saves messages on message_end)"*），所以**流式输出中的助手消息还不在 session 分支里**。于是：

```
T0 用户发送 → T1 助手开始流式输出（已发布 message_delta × 200）→ T2 用户刷新页面
T2 取快照：branch 里只有 user entry，没有进行中的 assistant
T2 连 SSE：after = seqId(T2) → 那 200 个 delta 全部被跳过
结果：气泡里只剩刷新之后新产生的 delta，前半段文本丢失
```

缓解方向：快照里附带 `managedSession.streamMessageId/streamThinkingId` 与已累积文本；或客户端在快照中检测到 `status === "running"` 时用 `after = 0`，让 reducer 从事件重放重建（用 id 去重避免与历史重复）。

### 8.2 工具 chip 重复（`bug-record/工具双重问题`）

工具 id 两侧同为 `toolCallId`，但 `messageItems` 只是 `concat`，reducer 又只在**实时数组**里查重：

```
刷新时某工具正在执行：
  历史：assistant entry 已落盘 → 含 ToolRun{ id:"call_1", status:"running" }
  实时：tool_updated / tool_completed 在 after 之后 → reducer 找不到 call_1（不在实时数组）
        → 追加一个新 chip
结果：同一个工具出现两个 chip（一个 running、一个 success）
```

缓解方向：合并时按 `(kind, id)` 去重（实时覆盖历史），或把 reducer 的输入改成"历史 + 实时"的单一数组。

### 8.3 `message_completed` 是空操作

```typescript
// 服务端（service.ts:216）
managerSession.channel.publish("message_completed", { id: managerSession.streamMessageId });

// 客户端（state.ts）
case "message_completed": {
  const message = payload.message as ChatMessage | undefined;
  if (!message) return items;          // ← payload 里只有 id，永远走这里
  …
}
```

契约不对齐：服务端只发 `id`，reducer 读的是 `payload.message`。所以助手气泡的 `status` 永远停在 `"streaming"`（当前 UI 不据此显示任何东西，所以只是隐性不一致）。两侧取其一改：服务端带上完整消息，或 reducer 按 `id` 把 `status` 置为完成值。

### 8.4 历史助手消息的错误字段接不上

```typescript
// helpr.ts：ChatMessage 类型里没有 error 字段，运行时却会多出来
...(message.errorMessage ? { error: message.errorMessage } : {})

// MessageItem.tsx：前端读的是另一个字段
{message.status === "error" && <span>发送失败</span>}
```

历史里的失败消息因此不会显示任何错误提示。要么在 `ChatMessage` 加 `error?: string` 并在渲染里读它，要么在翻译时写 `status: "error"`。

### 8.5 没有思考内容也会产出 Thinking item

`addAssistantMessage` 无条件 `push` Thinking item，`text` 为空时也照样进列表（实时路径是收到 `thinking_started` 才创建，不会凭空出现）。建议加 guard：

```typescript
const thinkingText = extractThinking(content);
if (thinkingText) { …push… }
```

（`bug-record/历史信息-thinking状态不正常` 记录的就是这类历史思考状态问题，`completed: true` 是当时补上的修复。）

### 8.6 历史顺序与实时顺序不同

历史按"每个 assistant entry = 消息 → 思考 → 工具"，实时按"思考 → 文本 → 工具"。同一会话在"实时看着"和"刷新后重看"时，思考块与文本气泡的上下位置会变化。

### 8.7 `MessageListItem.seqId` 声明了但从未赋值

`shared/types.ts` 为三种 item 都留了 `seqId?: number`，但 `ConversationViewBuild` 不碰它，也没有任何地方读过。它本可以是"历史与实时按游标合并"的钥匙。

### 8.8 图片字段名不一致且图片未渲染

| 位置 | 字段 |
|---|---|
| `shared/types.ts` `ChatImage` | `mimeType` |
| `helpr.ts` `extractImage`（历史） | `mimeType` ✓ |
| `service.ts:175`（实时） | `MIMEType` ✗ |

另外 `MessageItem.tsx` 只渲染 `message.text`，`ChatImage` 全程未被使用 —— 图片消息目前是"存得下、传得到、看不见"。

### 8.9 快照是全量 JSON

`messageList` 一次性返回整个分支（含每个工具的 `details`）。长会话 + 大工具输出时，这个响应体可能很大，且每次刷新都会重新传输全量历史。后续可考虑分页（`getBranch` 支持 `fromId`，可按需裁剪）或对 `details` 做截断。

### 8.10 其它小项

| 项 | 说明 |
|---|---|
| `custom_message` entry 不显示 | 它参与 LLM 上下文，扩展注入时历史与实时会不一致 |
| `kind: "Thinking"` 大小写 | 另外两个是 `"message"` / `"tool"`，只有它是大写开头 |
| 类名/文件名拼写 | `ConversationViewBuild`、`helpr.ts`、`ConversationReposity` 都是历史拼写，改名需全局搜索 |
| 冷路径成本 | 每次刷新都会 `ensureManagedSession` → 内存命中时开销很小；服务重启后的第一次会 `SessionManager.open + createRuntime + bind` |

---

## 9. 调试入口

```bash
# 取历史快照（注意是 POST）
curl.exe -X POST http://127.0.0.1:4328/api/conversation/<conversationId>

# 发送消息
curl.exe -X POST http://127.0.0.1:4328/api/conversation/<conversationId>/message \
  -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode 'text=hi'

# 订阅事件（after 取快照里的 stream.seqId，可复现"只收增量"的行为）
curl.exe -N "http://127.0.0.1:4328/api/conversation/<conversationId>/stream?after=<seqId>"
```

排查历史相关问题的顺序：

```
1. 快照对不对        → curl POST 看 messageList 的 kind 序列 / id / status / completed
2. 翻译对不对        → 对比同一条消息在快照里与实时事件里的字段（§7 对照表）
3. 拼接对不对        → 看 historyState.items 与 messageState.items 是否出现同一个 id（工具重复）
4. 游标对不对        → 快照 stream.seqId 是否等于当时 channel.lastId()；after 是否把它带上
```

---

## 10. 涉及文件清单

| 文件 | 角色 | 关键符号 |
|---|---|---|
| `server/conversation/service.ts` | 快照入口、游标来源 | `snapshot()`、`ensureManagedSession()`、`bind()` |
| `server/conversation/helpr.ts` | `SessionEntry` → `MessageListItem` 翻译 | `ConversationViewBuild`、`extractText/Thinking/Image`、`isToolPart` |
| `server/routes/conversation.ts` | HTTP 绑定（POST `/:id`） | `conversationApp.post("/:id")` |
| `shared/types.ts` | 两侧共用的契约 | `ConversationSnapshot`、`MessageListItem`、`ChatMessage`、`ChatImage`、`ThinkingBlock`、`ToolRun` |
| `client/api.ts` | 快照 API | `getConversation()`、`readResponse()` |
| `client/hooks/useConversationStream2.ts` | 历史/实时合流 | `historyState`、`messageState`、`after`、`pendingSend` |
| `client/state.ts` | 实时事件 → item | `conversationReducer`、`addUserMessage`、`addOrUpdateTool` |
| `client/components/MessageItem.tsx` | 渲染分派 | `kind: "Thinking"` / `"tool"` / `message` |