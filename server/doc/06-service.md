# 06-service — ConversationService 编排层

> 前置阅读：[01-config.md](./01-config.md)、[02-types.md](./02-types.md)、[03-requirements.md](./03-requirements.md)、[04-runtime.md](./04-runtime.md)、[05-glue.md](./05-glue.md)

---

## 1. 一句话定位

`ConversationService` 是**核心编排层**。它不直接操作文件系统、不直接调用 AI 模型、不直接处理 HTTP 请求。它的唯一职责是：**把 `repository`（持久化）、`runtime`（AI 引擎）、`channel`（事件推送）三个独立模块编排成一个完整的对话生命周期**。

---

## 2. 分层全景

```
┌──────────────────────────────────────────────────────┐
│  routes/conversation.ts  (HTTP 层)                    │
│  职责：提取参数 → 调用 service → 构造 HTTP Response   │
│  不关心：AI 模型细节、文件路径、事件机制               │
├──────────────────────────────────────────────────────┤
│  service.ts  (编排层)                        ← 本文档  │
│  职责：编排 repository / runtime / channel            │
│  不关心：HTTP 协议细节                                │
├──────────────┬──────────────┬────────────────────────┤
│  runtime.ts  │ repository.ts│  channel.ts             │
│  (AI 胶水)   │  (持久化)     │  (事件 pub/sub)         │
│  适配 pi-    │  JSON 文件    │  内存级 SSE 事件通道     │
│  coding-     │  CRUD         │  支持断线 replay        │
│  agent       │               │                        │
└──────────────┴──────────────┴────────────────────────┘
```

### 每一层的"不关心"清单

| 层 | 不关心 |
|---|---|
| routes | 文件路径、SessionManager 生命周期、事件翻译 |
| service | HTTP 状态码、请求体格式、SSE 协议细节 |
| repository | AI 事件、会话状态、HTTP 协议 |
| runtime | 文件路径配置、事件 pub/sub、HTTP |
| channel | AI 模型、持久化、业务逻辑 |

---

## 3. 内部状态：三个 Map

```typescript
export class ConversationService {
    private globalConfig: GlobalConfig;
    private conversationReposity: ConversationReposity;
    private modelRuntime: ModelRuntime;

    // 内存级"数据库"——三个 Map 按 conversationId 索引
    private readonly channels = new Map<string, EventChannel>();
    private readonly sessionManager = new Map<string, ManagerSession>();
}
```

| Map | Key | Value | 用途 |
|---|---|---|---|
| `channels` | conversationId | EventChannel | 每个对话独立的事件通道，SSE 路由直接取它 |
| `sessionManager` | conversationId | ManagerSession | 对话运行时状态的完整快照 |

### 为什么用 Map 而不是单例

- 一个进程中可能同时存在多个活跃对话
- 每个对话有独立的 EventChannel（streamId 不同，事件序号独立）
- 每个对话有独立的 ManagerSession（runtime、status、diagnostics 不同）
- 服务重启后两个 Map 自动清空，由 `ensureManagedSession` 懒恢复

---

## 4. 对外方法（4 个 public + 2 个核心 private）

### 4.1 Public API

| 方法 | 调用方 | 功能 |
|---|---|---|
| `createConversation()` | routes（POST /api/conversation） | 创建新对话，返回 ManagerSession |
| `send(id, input)` | routes（POST /:id/message） | 向 AI 发送用户消息 |
| `snapshot(id)` | routes（POST /:id） | 返回对话完整快照 JSON |
| `getEventChannel(id)` | routes（POST /:id/stream） | 获取对话的 EventChannel 用于 SSE 流 |

---

### 4.2 Private 方法（编排核心）

| 方法 | 调用方 | 功能 |
|---|---|---|
| `createManagerSession()` | createConversation / ensureManagedSession | 组装 ManagerSession + bind |
| `ensureManagedSession()` | send / snapshot | 内存命中 → 返回；未命中 → 磁盘恢复 |
| `bind()` | createManagerSession | 订阅 runtime 事件，翻译成 SSE 事件 |
| `summary()` | snapshot | 从 ConversationRecord + status 构造摘要 |
| `setStatus()` | bind | 更新 runtimeStatus 并推送事件 |

---

## 5. 逐方法详解

### 5.1 `createConversation()` — 创建对话全流程

```
createConversation()
  │
  ├── ① randomUUID() → conversationId
  │      ↓
  ├── ② SessionManager.create(workspaceDir, sessionsDir, {id})
  │      让 pi-coding-agent 初始化会话文件
  │      ↓
  ├── ③ 构造 ConversationRecord
  │     { id, title, workspaceDir, sessionId, sessionFile, createdAt, updatedAt }
  │      ↓
  ├── ④ repository.save(record)
  │     持久化到 records/{id}.json
  │      ↓
  └── ⑤ createManagerSession(record, sessionManager)
         │
         ├── runtime.ts → createRuntime() → AgentSessionRuntime
         ├── getEventChannel(id) → EventChannel（新建或复用）
         ├── 拼出 ManagerSession { id, runtime, channel, status, diagnostics }
         ├── sessionManager.set(id, managerSession)    → 存入内存
         └── bind(managerSession) → 订阅运行时事件
```

**返回值**：`ManagerSession`（给 route 层拿去调 `snapshot` 构造创建响应）。

**为什么先 save 再 createManagerSession**：如果 createRuntime 抛异常（比如 AI 模型不可用），record 已经持久化了，下次请求可以通过 `ensureManagedSession` 自动恢复——不会造成"会话创建了但没记录"或"有记录但会话断了"的不一致。

---

### 5.2 `send(conversationId, userInput)` — 发送消息

```typescript
async send(conversationId: string, userInput: string) {
    // ① 校验
    const cleaned = userInput.trim();
    if (!cleaned) throw new Error("user input is empty");

    // ② 拿到 session（内存 → 磁盘恢复）
    const managedSession = await this.ensureManagedSession(conversationId);

    // ③ 喂给 AI
    managedSession.runtime.session.prompt(cleaned);
}
```

**极其简洁**——复杂的事情全在 `bind()` 的回调里自动处理：

- AI 开始思考 → 回调自动推送 `thinking_started`
- AI 逐字输出 → 回调自动推送 `message_delta`
- AI 调用工具 → 回调自动推送 `tool_started/updated/completed`
- AI 完成 → 回调自动推送 `runtime_settled`

调用 `send` 的代码**不需要**手动处理任何 SSE 事件推送。

---

### 5.3 `snapshot(id)` — 会话快照

```typescript
public async snapshot(id: string): Promise<ConversationSnapshot> {
    const record = await this.conversationReposity.get(id);   // 磁盘
    const managedSession = await this.ensureManagedSession(id); // 内存/恢复
    const session = managedSession.runtime.session;
    const channel = managedSession.channel;

    return {
        conversationSummary: this.summary(record, managedSession.status),
        messageList: [],                                       // TODO: 从 session 历史构造
        model: {
            provider: session.agent.state.model.provider,
            id: session.agent.state.model.id,
        },
        thinkingLevel: session.agent.state.thinkingLevel,
        availableThinkingLevels: session.getAvailableThinkingLevels(),
        status: managedSession.status,
        error: managedSession.error,
        stream: { id: channel.streamId, seqId: channel.lastId() },
        diagnostics: managedSession.diagnostics,
    };
}
```

### 数据来源对照

| ConversationSnapshot 字段 | 来源 | 位置 |
|---|---|---|
| conversationSummary | ConversationRecord + status | repository（磁盘）+ 内存 |
| messageList | 当前为空数组，待实现 | 应从 session 历史构造 MessageListItem[] |
| model | session.agent.state | runtime（内存） |
| thinkingLevel | session.agent.state | runtime（内存） |
| availableThinkingLevels | session.getAvailableThinkingLevels() | runtime（内存） |
| status | managedSession.status | 内存（bind 中实时更新） |
| error | managedSession.error | 内存（异常时设置） |
| stream.id | channel.streamId | channel（创建时生成 UUID） |
| stream.seqId | channel.lastId() | channel（每次 publish 递增） |
| diagnostics | managedSession.diagnostics | runtime（启动时收集） |

---

### 5.4 `getEventChannel(id)` — 获取事件通道

```typescript
public getEventChannel(conversationId: string): EventChannel {
    let channel = this.channels.get(conversationId);
    if (!channel) {
        channel = new EventChannel();  // 新建（独立 streamId）
    }
    this.channels.set(conversationId, channel);
    return channel;
}
```

这个方法是 SSE 路由的入口——路由通过它拿到 channel，然后：

```
POST /:conversationId/stream?after=N
  │
  ├── getEventChannel(conversationId)
  ├── channel.replay(N)     → 重放 N 之后的历史事件
  └── channel.subscribe()   → 订阅新事件，实时推送
```

EventChannel 返回后一直存活在 `this.channels` Map 中，即使 SSE 连接断开也不销毁——新连接可以 `replay` 恢复。

---

### 5.5 `ensureManagedSession(id)` — 懒恢复（热路径）

```typescript
private async ensureManagedSession(conversationId: string) {
    // ① 热路径：内存命中，直接返回
    let cached = this.sessionManager.get(conversationId);
    if (cached) return cached;

    // ② 冷路径：从磁盘重建
    const record = await this.conversationReposity.get(conversationId);
    if (!record) throw new Error("Conversation not found");

    // ③ 判断 session 文件是否存在
    let sessionManager: SessionManager;
    if (existsSync(record.sessionFile)) {
        // session 文件存在 → 恢复已有会话（历史消息都在）
        sessionManager = SessionManager.open(
            record.sessionFile,
            this.globalConfig.sessionsDir,
            record.workspaceDir,
        );
    } else {
        // session 文件丢失 → 新建空会话
        sessionManager = SessionManager.create(
            record.workspaceDir,
            this.globalConfig.sessionsDir,
            { id: conversationId },
        );
    }

    // ④ 重新走 createManagerSession（重建 runtime + 重新 bind）
    return this.createManagerSession(record, sessionManager);
}
```

**这是服务重启后自动恢复的关键**：进程重启 → 两个 Map 清空 → 第一个请求进来 → 从磁盘恢复一切。

| 场景 | 行为 |
|---|---|
| 服务刚启动，内存无缓存 | 磁盘恢复 → 重建 runtime → 重新 bind |
| 服务运行中，内存有缓存 | 直接返回，零 IO |
| conversationId 不存在 | throw Error（由上层 onError 统一处理） |
| session 文件丢失（磁盘损坏/手动删除） | 新建空 session（record 还在，对话可继续） |

---

### 5.6 `bind(managerSession)` — 事件翻译核心

`bind` 是整个编排层最核心的方法。它订阅 pi-agent 的 `session.subscribe`，将底层事件一对一翻译成 SSE 事件。

```
pi-agent 内部事件                        SSE 事件（→ channel → 前端）
─────────────────────────────────────────────────────────────────────
agent_start                ───────→  runtime.status { status: "running" }

message_start (role: user) ───────→  message_add { id, role, text, images }
  │                                    ↑
  │ 解析 content 数组                   组装成 ChatMessage 格式
  │ 分离 text / image

message_start (role: assistant) ──→  message_started { id }
  │                                    ↑
  │ 新建 streamMessageId               前端用这个 id 定位消息气泡

message_update
  ├── thinking_start        ──→  thinking_started { id }
  ├── thinking_delta        ──→  thinking_delta { id, text }
  ├── thinking_end          ──→  thinking_completed { id, text, completed: true }
  └── text_delta            ──→  message_delta { id, text }

message_end (assistant)     ──→  message_completed { id }
  │                                    ↑
  │ 清空 streamMessageId              前端将气泡从 "streaming" 切到 "done"

tool_execution_start        ──→  tool_started { id, name, args }
tool_execution_update       ──→  tool_updated { id, name, status: "running", result }
tool_execution_end          ──→  tool_completed { id, name, status: "success"/"error" }

agent_settled               ──→  runtime_settled {}
                            ──→  runtime.status { status: "ready" }
```

### streamMessageId 和 streamThinkingId 的生命周期

```
message_start (assistant)  →  streamMessageId = randomUUID()
thinking_start             →  streamThinkingId = randomUUID()
    ...
    thinking_delta × N     →  都用同一个 streamThinkingId
    text_delta × N         →  都用同一个 streamMessageId
    ...
thinking_end               →  (streamThinkingId 不动，前端标记 completed)
message_end                →  streamMessageId = undefined
agent_settled              →  streamMessageId = undefined
                               streamThinkingId = undefined
```

`streamMessageId` 的作用：前端在 `message_started` 时拿到一个 id，后续所有 `message_delta` 都带同一个 id，前端就知道"把这段文本追加到那个气泡"。

### 被忽略的事件

以下事件当前 `switch-case` 中写了 `break` 但不做任何处理：

| 事件 | 为什么不处理 |
|---|---|
| `agent_end` | 用 `agent_settled` 替代，语义更准确 |
| `turn_start` / `turn_end` | 前端暂时不需要感知"回合"边界 |
| `queue_update` | 暂无排队功能 |
| `compaction_start/end` | 上下文压缩对用户透明 |
| `entry_appended` | 增量持久化由 repository 处理 |
| `session_info_changed` | 前端通过下次 snapshot 获取最新信息 |
| `thinking_level_changed` | 同上 |
| `auto_retry_*` | 自动重试对用户透明 |
| `summarization_retry_*` | 同上 |
| `bash_execution_update` | 当前无 bash 工具 |

---

### 5.7 `setStatus(managerSession, status)` — 状态更新

```typescript
private setStatus(managedSession: ManagerSession, status: RuntimeStatus) {
    managedSession.status = status;
    if (status !== "error") managedSession.error = undefined;
    managedSession.channel.publish("runtime.status", { status });
}
```

| 状态 | 触发时机 | error 字段 |
|---|---|---|
| `running` | agent_start | 清空 |
| `ready` | agent_settled | 清空 |
| `error` | 异常发生时（TODO） | 保留错误信息 |

---

## 6. 数据流完整示例

以一个用户发送"帮我写一个 hello world"为例：

```
浏览器                              service                        pi-agent
  │                                     │                              │
  │ POST /:id/message  text="hello"     │                              │
  │────────────────────────────────────→│                              │
  │                                     │ ensureManagedSession(id)     │
  │                                     │ session.prompt("hello")      │
  │                                     │─────────────────────────────→│
  │                                     │                              │
  │ POST /:id/stream                    │                              │
  │────────────────────────────────────→│                              │
  │←─ SSE: runtime.status(running)      │← bind 回调: agent_start      │
  │←─ SSE: message_add(user)            │← bind 回调: message_start    │
  │←─ SSE: message_started(assistant)   │← bind 回调: message_start    │
  │←─ SSE: thinking_started             │← bind 回调: thinking_start   │
  │←─ SSE: thinking_delta × N           │← bind 回调: thinking_delta   │
  │←─ SSE: thinking_completed           │← bind 回调: thinking_end     │
  │←─ SSE: message_delta × N            │← bind 回调: text_delta       │
  │←─ SSE: tool_started("write")        │← bind 回调: tool_execution_  │
  │←─ SSE: tool_completed("write")      │← bind 回调: tool_execution_  │
  │←─ SSE: message_completed            │← bind 回调: message_end      │
  │←─ SSE: runtime.status(ready)        │← bind 回调: agent_settled    │
  │←─ SSE: runtime_settled              │← bind 回调: agent_settled    │
```

整个过程中，service 只需要 `send()` 一次。之后所有推送都是 `bind` 回调自动完成的。

---

## 7. 依赖关系

```
ConversationService
  ├── GlobalConfig（构造函数注入）
  ├── ConversationReposity（构造函数注入）
  ├── ModelRuntime（构造函数注入）
  ├── SessionManager（来自 @earendil-works/pi-coding-agent）
  ├── createRuntime()（来自 ./runtime.ts）
  ├── EventChannel（来自 ./channel.ts）
  ├── ConversationRecord / ManagerSession（来自 ./types.ts）
  └── ConversationSnapshot / RuntimeStatus（来自 @shared/types.ts）
```

- **不依赖**：Hono、Express 等 HTTP 框架。它只认接口，可以在 CLI 脚本、测试、HTTP 层复用。
- **构造函数注入 3 个依赖**：测试时可以传入 mock 的 GlobalConfig（临时目录）、mock 的 Repository、mock 的 ModelRuntime。

---

## 8. ManagerSession 结构

```typescript
interface ManagerSession {
    id: string;                          // = conversationRecord.id
    runtime: AgentSessionRuntime;        // 来自 runtime.ts 胶水层
    unsubscribe?: () => void;            // bind 返回的取消订阅函数
    channel: EventChannel;               // 该对话的独立事件通道
    streamMessageId?: string;            // 当前正在输出的消息 ID
    streamThinkingId?: string;           // 当前正在输出的思考块 ID
    status: RuntimeStatus;               // "ready" | "running" | ...
    error?: string;                      // 异常信息
    diagnostics: string[];               // runtime 启动诊断（扩展兼容性等）
}
```

---

## 9. 错误策略

| 场景 | 行为 |
|---|---|
| send 时 userInput 为空 | throw Error |
| ensureManagedSession 时 id 不存在 | throw Error |
| ensureManagedSession 时 session 文件丢失 | 新建空 session（不抛异常，对话可继续） |
| bind 回调中某个 listener 抛异常 | 自动从 Set 中移除该 listener，不影响其他订阅者 |
| createRuntime 失败（模型不可用等） | 异常冒泡给调用方 |

---

## 10. 当前限制 & TODO

| 项 | 说明 |
|---|---|
| `messageList` 为空数组 | snapshot 中的 messageList 恒为 `[]`，需要从 session 历史构造 MessageListItem[] |
| 错误处理不完整 | `setStatus("error", ...)` 没有被任何 catch 块调用 |
| 缺少 `stop()` | 用户无法中断正在运行的 Agent |
| `ConversationReposity` 拼写错误 | 类名少了一个 `i`，应为 `ConversationRepository` |
| 无超时机制 | Agent 长时间运行无自动中断 |
| 无并发限制 | 同一对话可能同时发送多条消息 |