# 07-sse — SSE 样板代码抽取

> 前置阅读：[04-runtime.md](./04-runtime.md)、[06-service.md](./06-service.md)

---

## 1. 动机：路由里的样板代码太多了

原 `/stream` 路由有 **45 行**，但真正属于业务逻辑的只有 **3 行**：

```typescript
// ★ 业务逻辑 — 只有这 3 行
const channel = conversationService.getEventChannel(conversationId);
const after = parseAfter(...);
return sseResponse(channel, after);

// ─── 以下 40+ 行全是 SSE 协议的固定样板 ───
const encoder = new TextEncoder();
const body = new ReadableStream<Uint8Array>({
    start: (controller) => {
        const send = (event) => { controller.enqueue(encoder.encode(...)); };
        channel.replay(after);
        channel.subscribe(send);
        setInterval(() => { controller.enqueue(encoder.encode(":keepalive\n\n")); }, 15000);
    },
    cancel: () => { unsubscribe?.(); clearInterval(heartBeat); },
});
return new Response(body, { headers: { ... } });
```

**解决方法**：把样板代码抽成 `sse.ts`，路由只写业务逻辑。

---

## 2. 文件位置

```
src/server/sse.ts          ← 新增的工具模块
src/server/routes/conversation.ts ← 改造后引用它
```

---

## 3. 对外 API

```typescript
// 解析 after 查询参数
function parseAfter(afterQuery: string | undefined, channel: EventChannel): number;

// 构建 SSE Response
function sseResponse(channel: EventChannel, after: number): Response;
```

---

## 4. `parseAfter` — 解析"从哪里开始播"

```typescript
export function parseAfter(
  afterQuery: string | undefined,
  channel: EventChannel,
): number {
  const raw = afterQuery ?? "0";
  if (raw === "latest") {
    return channel.lastId();          // 只收新事件，不重放历史
  }
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}
```

| 入参 | 返回 | 含义 |
|---|---|---|
| `undefined` / `""` | `0` | 从第 1 个事件开始全量重放 |
| `"latest"` | `channel.lastId()` | 跳过历史，只收新事件 |
| `"42"` | `42` | 从第 43 号事件起补发（只发 `id > 42` 的） |
| `"-1"` / `"abc"` | `0`（安全兜底） | 非法值退回全量重放 |

### 安全兜底

`Number.isSafeInteger(after) && after >= 0` 确保不会因为前端传了 `NaN`、`Infinity`、负数导致 runtime 异常。兜底策略是退回全量重放（`after=0`），而不是报错——宁可多发几个事件也不让重连失败。

---

## 5. `sseResponse` — 构建 SSE 响应

### 5.1 签名

```typescript
function sseResponse(channel: EventChannel, after: number): Response
```

- **入参**：EventChannel + 起始序号
- **返回**：标准 `Response` 对象（`Content-Type: text/event-stream`），可直接从 Hono 路由 `return`
- **不依赖 Hono**：纯 Web 标准 API，可以在任何框架中复用

### 5.2 内部做了什么

```
sseResponse(channel, after)
  │
  ├── new ReadableStream<Uint8Array>
  │     │
  │     ├── start(controller)
  │     │     ├── define send(event) → encode("data:{json}\n\n")
  │     │     ├── replay 历史事件（重连补发）
  │     │     ├── subscribe 新事件（实时推送）
  │     │     └── setInterval → keepalive 心跳（防超时）
  │     │
  │     └── cancel()
  │           ├── unsubscribe() 取消订阅
  │           └── clearInterval() 停止心跳
  │
  └── new Response(body, { headers })
        ├── Content-Type: text/event-stream
        ├── Cache-Control: no-cache,no-transform
        ├── Connection: keep-alive
        └── X-Accel-Buffering: no
```

### 5.3 五个样板细节逐一说明

#### ① `TextEncoder` + SSE 格式

```typescript
const send = (event: StreamEvent) => {
  controller.enqueue(
    encoder.encode(`data:${JSON.stringify(event)}\n\n`),
  );
};
```

SSE 协议要求每条消息以 `data:` 开头、`\n\n`（空行）结尾。`TextEncoder` 把字符串转成 `Uint8Array`，因为 `ReadableStream` 的泛型是 `<Uint8Array>`。

Java 类比：`"data:...\n\n".getBytes(StandardCharsets.UTF_8)`

#### ② `replay` — 断线重连

```typescript
const { events } = channel.replay(after);
for (const event of events) {
  send(event);
}
```

前端断开后重新连接时，带上 `?after=上次收到的最后一个id`，后端把所有 `id > after` 的事件补发一遍。前端基于 `event.id` 去重。

#### ③ `subscribe` — 实时推送

```typescript
unsubscribe = channel.subscribe(send);
```

`subscribe` 返回一个 `() => void` 的取消函数。赋值给外部变量 `unsubscribe`，供 `cancel` 时调用。

Java 类比：`Disposable subscription = observable.subscribe(send)`

#### ④ `setInterval` — 心跳

```typescript
heartBeat = setInterval(() => {
  controller.enqueue(encoder.encode(":keepalive\n\n"));
}, 15_000);
```

**为什么需要心跳**：nginx / AWS ALB / 各种代理默认 60s 无数据就断开连接。每 15s 发一个注释行（以 `:` 开头），浏览器忽略它，但 TCP 连接保持活跃。

#### ⑤ `cancel` — 清理

```typescript
cancel: () => {
  unsubscribe?.();           // 移除 listener
  if (heartBeat) {
    clearInterval(heartBeat); // 停止心跳
  }
},
```

`?.()` 是可选链调用——如果 `unsubscribe` 是 `undefined`（连接断开前 `start` 还没执行完），静默跳过。

`cancel` 触发时机：
- 浏览器关闭 / 刷新页面
- 前端调用 `EventSource.close()`
- `ReadableStream.cancel()` 被调用

---

## 6. 改造前 vs 改造后

### 改造前（45 行）

```typescript
conversationApp.post("/:conversationId/stream", (ctx) => {
    const { conversationId } = ctx.req.param();
    const afterQuery = ctx.req.query("after") ?? "0";
    const after =
      afterQuery === "latest"
        ? conversationService.getEventChannel(conversationId).lastId()
        : Number(afterQuery);
    let unsubscribe: () => void;
    let heartBeat: ReturnType<typeof setInterval> | undefined;
    const safteAfter = Number.isSafeInteger(after) && after >= 0 ? after : 0;
    const channel = conversationService.getEventChannel(conversationId);
    const encoder = new TextEncoder();

    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const send = (event: StreamEvent) => {
          controller.enqueue(
            encoder.encode(`data:${JSON.stringify(event)}\n\n`),
          );
        };
        const { events } = channel.replay(safteAfter);
        for (const event of events) { send(event); }
        unsubscribe = channel.subscribe(send);
        heartBeat = setInterval(() => {
          controller.enqueue(encoder.encode(":keepalive\n\n"));
        }, 15000);
      },
      cancel: () => {
        unsubscribe?.();
        if (heartBeat) { clearInterval(heartBeat); }
      },
    });
    return new Response(body, {
      headers: {
        "Cache-Control": "no-cache,no-transform",
        "Content-Type": "text/event-stream",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
});
```

### 改造后（6 行）

```typescript
conversationApp.post("/:conversationId/stream", (ctx) => {
    const { conversationId } = ctx.req.param();
    const channel = conversationService.getEventChannel(conversationId);
    const after = parseAfter(ctx.req.query("after"), channel);
    return sseResponse(channel, after);
});
```

**减少 39 行**。路由层只表达"从哪个对话、从第几个事件开始推流"，不管 SSE 协议细节。

---

## 7. 依赖关系

```
sse.ts
  ├── EventChannel（from ./conversation/channel.ts）→ replay / subscribe / lastId
  └── StreamEvent（from ../shared/types.ts）        → JSON.stringify 的类型
```

- **不依赖**：Hono、Express、任何 HTTP 框架
- **不依赖**：ConversationService、路由层
- **纯函数**：`sseResponse` 对给定输入产生确定的输出，无副作用

---

## 8. 前后端 SSE 交互全景

```
浏览器                                后端
  │                                     │
  │ POST /:id/stream?after=42           │
  │────────────────────────────────────→│
  │                                     │ parseAfter("42", channel) → 42
  │                                     │ sseResponse(channel, 42)
  │                                     │
  │←─ data:{"id":43,"type":"message_delta",...}\n\n
  │←─ data:{"id":44,"type":"message_delta",...}\n\n   ← replay 补发 43~current
  │←─ data:{"id":45,"type":"tool_started",...}\n\n
  │←─ :keepalive\n\n                                  ← 15s 心跳
  │←─ data:{"id":46,"type":"message_delta",...}\n\n   ← 实时推送
  │                                     │
  │ 刷新页面（断开）                      │
  │────────────────── ─ ─ ─ ─ ─ ─ ─ ─ ─│ cancel() → unsubscribe + clearInterval
  │                                     │
  │ POST /:id/stream?after=46           │ ← 重连
  │←─ data:{"id":47,...}                │ ← 只补发 46 之后的
```

---

## 9. 测试

`sseResponse` 和 `parseAfter` 都是纯函数，可以直接在单元测试中验证：

```typescript
// 伪代码 — 测试 parseAfter
const channel = new EventChannel();
channel.publish("runtime.status", {}); // id=1
channel.publish("runtime.status", {}); // id=2

assert.equal(parseAfter(undefined, channel), 0);
assert.equal(parseAfter("latest", channel), 2);   // lastId
assert.equal(parseAfter("1", channel), 1);
assert.equal(parseAfter("-1", channel), 0);       // 安全兜底
assert.equal(parseAfter("abc", channel), 0);      // 安全兜底
```

`sseResponse` 返回的 `Response` 可以用 `response.body.getReader().read()` 验证流中推送的事件内容。

---

## 10. 后续扩展方向

| 扩展 | 说明 |
|---|---|
| 可配置心跳间隔 | `sseResponse(channel, after, { heartbeatMs: 30_000 })` |
| 自定义事件过滤器 | `sseResponse(channel, after, { filter: (e) => e.type !== "message_delta" })` |
| 支持多个 channel 合并推送 | 前端同时订阅多个对话的 stream |
| 背压控制 | 当客户端处理不过来时，`controller.desiredSize` 判断是否需要暂停推送 |