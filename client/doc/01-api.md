# 01 — API 层

## 文件位置

`client/api.ts`

## 职责

把后端 HTTP 接口封装成 TypeScript 函数。上层代码不需要关心 `fetch`、`FormData`、错误处理等细节。

## 后端接口契约

| 方法 | 路径 | 作用 | 入参 | 出参 |
|------|------|------|------|------|
| `POST` | `/api/conversation` | 创建新会话 | 无 | `CreateConversationResponse` |
| `POST` | `/api/conversation/:id/message` | 发送用户消息 | `FormData { text }` | `{ accepts: true }` |
| `GET` | `/api/conversation/:id/stream?after=N` | SSE 事件流 | query `after` | `StreamEvent` 流 |

Vite 开发服务器把 `/api` 前缀的请求代理到 `http://127.0.0.1:4328`（后端），所以前端可以写相对路径 `/api/...`。

## 函数详解

### `readResponse<T>` — 通用响应处理

```ts
async function readResponse<T>(request: Promise<Response>): Promise<T>
```

**为什么需要它？** 每个接口调用后都要做三件事：检查 HTTP 状态码 → 解析 JSON → 处理错误。抽成泛型函数避免代码重复。

**错误处理逻辑：**
1. `response.ok` 为 false → 尝试从后端响应体读取 `error` 字段
2. 如果响应体不是 JSON（如 502 网关返回 HTML），`.catch(() => ({}))` 兜底
3. 都没有就用 HTTP 状态码文本（如 `"502 Bad Gateway"`）

**泛型 `<T>`** 让调用方指定返回类型，编译时检查，运行时不做验证（信任后端契约）。

### `createConversation()` — 创建会话

```ts
export function createConversation(): Promise<CreateConversationResponse>
```

直接 POST，不传 body。后端返回 `CreateConversationResponse`，包含：
- `conversation.id` — 新会话 ID
- `stream.id` + `stream.seqId` — 当前事件流状态
- `model` — 使用的模型信息
- `thinkingLevel` — 思考深度设置

调用方拿到 `id` 后用来调用 `sendMessage` 和 `connectEvents`。

### `sendMessage(id, text)` — 发送消息

```ts
export function sendMessage(id: string, text: string): Promise<unknown>
```

用 `FormData` 传递文本，因为后端用 `ctx.req.formData()` 解析。`encodeURIComponent` 防止特殊字符破坏 URL 结构。

返回 `unknown` 因为后端只返回 `{ accepts: true }`，上层不需要关心结构。

### `connectEvents(id, onEvent, onError, onOpen?, after?)` — SSE 连接

```ts
export function connectEvents(
  id: string,
  onEvent: (event: StreamEvent) => void,
  onError: () => void,
  onOpen?: () => void,
  after = 0,
): EventSource
```

**为什么选 EventSource 而不是 fetch + ReadableStream？**

| | EventSource | fetch ReadableStream |
|--|------------|---------------------|
| SSE 解析 | 浏览器自动做 | 手动处理 buffer + 分块 |
| 断线重连 | 内置自动重连 | 需要自己实现 |
| 取消方式 | `.close()` | `AbortController.abort()` |
| 支持 POST | ❌ | ✅ |
| 代码量 | ~15 行 | ~40 行 |

SSE 接口是 GET，`EventSource` 完全够用，代码更简洁。自动重连在网络不稳定时是优点。

**`after` 参数** — 告诉后端"从第 N 号事件之后开始给我发"。用于：
- 初次连接：`after=0`，从头开始
- 重连：`after=上次收到的最大事件ID`，跳过已处理的事件

**回调分离** — `onEvent`（正常）、`onError`（失败）、`onOpen`（连接建立），对应 `EventSource.onmessage`/`onerror`/`onopen`。`onError` 中解析 JSON 失败也会触发，因为 `EventSource` 对格式错误也走 onerror。

## 关键设计决策

1. **函数式 API，不是类** — 无状态，每次调用独立，适合 React 函数组件直接使用
2. **错误统一处理** — `readResponse` 保证所有接口的错误格式一致，上层只需 `try/catch`
3. **不隐藏 EventSource** — 返回 `EventSource` 对象而非包装对象，让 Hook 层可以直接 `.close()`