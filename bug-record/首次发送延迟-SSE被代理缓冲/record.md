# 首次发送要等 15s 才开始输出

现象：空状态第一次发消息（`onSend={handleSend}` → 新建会话 → `connectEvents`），超过 15s 才开始输出；
已有会话里再发消息则正常（只剩模型首字延迟）。

## 根因

`sseResponse` 的 body 静默时，响应头出不了 Vite dev proxy：

1. `server/sse.ts` 的 `start()` 里只做 replay，新会话 channel 里没有可 replay 的事件 →
   这条连接的第一个 body 字节是 15s 后的 `:keepalive`。
2. `@hono/node-server` 自己会 `flushHeaders()`（`dist/index.cjs:876/905`），直连时响应头 3ms 就到。
3. 但 Vite proxy 收到上游响应后只 `writeHeaders()`（对下游 `res.setHeader`，仅入队）+
   `proxyRes.pipe(res)`（`vite/dist/node/chunks/node.js:18773`，data 驱动），**全程没有 `flushHeaders()`**；
   Node 的 `ServerResponse` 要等第一次 `res.write()` 才把响应头发出去。
4. `client/hooks/useConversationStream2.ts` 把「发消息」放在 `connectEvents` 的 `onOpen` 回调里，
   于是 `onopen` 要等到 15s 的 keepalive 才触发 → 消息才发出去 → 再叠加模型 TTFT。

字节级对照（同一个空 channel，raw socket 计时）：

```text
直连 api :4328
     3ms  + 202B  "HTTP/1.1 200 OK\r\ncache-control: no-cache,no-transform\r\nconnectio…"
 15016ms  +  17B  "c\r\n:keepalive\n\n\r\n"

经 Vite proxy :5173
 15016ms  + 233B  "HTTP/1.1 200 OK\r\nVary: Origin\r\ncache-control: no-cache,no-transf…"
```

proxy 那 233B = 响应头 + keepalive 帧同一个 TCP 段，说明头一直攥在手里等第一个 body 字节。
换一个有 replay 事件的 channel，响应头 5ms 就到 —— 所以只有「新会话第一条消息」会踩中。

## 修复

- `server/sse.ts`：`start()` 里 replay 之前先冲一帧注释
  `controller.enqueue(encoder.encode(":connected\n\n"));`
  保证第一个 body 字节立刻产生，任何代理都会马上转发响应头。
- `client/hooks/useConversationStream2.ts`：不再用 `onOpen` 当发送门闸（第 4 个参数不传），
  连上流后立刻「乐观气泡 + POST」。不会丢事件：服务端按快照游标 `after` replay，
  且 replay 先于 subscribe、中间没有 await。

## 验证（真机 UI，headless Chrome 经 Vite proxy，空状态点发送）

| 时刻 | 事件 |
| --- | --- |
| 951ms | `es:create` + POST `/message` 直接发出（不再等握手） |
| 960ms | `es:onopen`（修前 15091ms）+ 乐观用户气泡可见 |
| 1061ms | `message_add` 到达，气泡按 text 去重替换 |
| 3523ms | 模型首个 `thinking_delta` |
| 3630ms | 答案气泡可见 |

点击 → 可见输出：**2679ms**（纯模型 TTFT），StrictMode 双挂载下只有 1 个 SSE 连接、1 次 POST。

## 遗留

- 模型 TTFT 1~4s 波动（dashscope 中转 `token-plan.cn-beijing.maas.aliyuncs.com` +
  `deepseek-v4.1-flash` reasoning），属 provider 侧，代码消不掉。
- `oxlint` 的 `react-hooks/exhaustive-deps` warning（该文件 effect 内调 `send`）是改动前就有的，
  没在本次修：`send` 每次 render 重建，加进 deps 会让 effect 每帧重跑、反复重连 SSE。
- 相关小隐患（未动）：`EventChannel.events` 只增不减。