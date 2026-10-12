# 06 — AgentHarness 主组装组件

## 文件位置

`client/components/AgentHarness.tsx`

## 职责

把所有零件拼成完整聊天界面。这是整个应用的**唯一顶层组装点**——所有数据流、事件处理、布局编排都在这里。

## 页面布局

```
┌──────────────────────────────────────────┐
│  ✨ Pi Chat                    + 新会话   │  header (sticky)
├──────────────────────────────────────────┤
│                                          │
│  ┌─ 空状态 ──────────────────────────┐   │
│  │  ✨                                │   │
│  │  有什么我可以帮你？                 │   │  main (scroll)
│  │  输入问题，或从下面的建议开始…      │   │
│  │                                    │   │  ← items.length === 0
│  │  [建议1] [建议2] [建议3]            │   │
│  └────────────────────────────────────┘   │
│                                          │
│  ┌─ 消息列表 ────────────────────────┐   │
│  │  [用户气泡]                        │   │
│  │  [思考面板]                        │   │  ← items.length > 0
│  │  [工具卡片]                        │   │
│  │  [AI 回复]                         │   │
│  │  〈LoadingState〉                   │   │  ← loading === true
│  └────────────────────────────────────┘   │
│                                          │
│  [底部锚点]                               │  ← 滚动目标
│                                          │
├──────────────────────────────────────────┤
│  ┌────────────────────────────── [↑]─┐   │
│  │ 输入消息，按 Enter 发送…          │   │  composer (fixed)
│  └───────────────────────────────────┘   │
│  Enter 发送 · Shift + Enter 换行         │
└──────────────────────────────────────────┘
```

## 数据流

```ts
const { items, loading, error, send, newConversation } = useConversationStream();
```

AgentHarness 是 `useConversationStream` 的**唯一消费者**。Hook 返回的 6 个值分配到 UI 的 3 个区域：

| 值 | 去向 |
|-----|------|
| `items` | main → `items.map(item => <MessageItem item={item} />)` |
| `loading` | main → `{loading && <LoadingState />}` |
| `error` | main → `{error && <ErrorBanner />}` |
| `send` | composer → `PromptBar.onSend` |
| `send` | 空状态 → 建议 prompt 按钮 |
| `newConversation` | header → "新会话" 按钮 |

## 滚动策略

AgentHarness 维护两个 ref：

```ts
const bottomRef = useRef<HTMLDivElement>(null);   // 滚动目标锚点
const submittedRef = useRef(false);               // 标记"刚发送了消息"
```

### 场景 1：发送消息后 — smooth 滚动

```ts
useEffect(() => {
  if (!submittedRef.current || items.length === 0) return;
  submittedRef.current = false;
  requestAnimationFrame(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  });
}, [items.length]);
```

- 触发条件：`items.length` 变化 + `submittedRef.current === true`
- 滚动行为：`smooth`（动画过渡），用户能看到消息"滑入"
- 为什么用 `requestAnimationFrame`？React 的 `setState` 是异步批处理的，`useEffect` 触发时 DOM 可能还没更新。`requestAnimationFrame` 等到下一帧（DOM 已刷新）再滚动。

### 场景 2：流式输出中 — instant 滚动

```ts
useEffect(() => {
  if (!loading || isEmpty) return;
  requestAnimationFrame(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  });
}, [loading, items]);
```

- 触发条件：`loading === true` + `items` 任意变化（AI 每追加一个字都会触发）
- 滚动行为：`block: "end"`（无 `smooth`），**瞬间滚动**。如果每次追加都 smooth 滚动，用户会看到画面频繁抖动。

### 为什么两种场景分开处理？

`smooth` 适合"一次性的跳转"（用户发消息后滚到新消息位置），`instant` 适合"连续的跟滚"（AI 逐字输出时保持光标在视野内）。混用会导致闪烁或抖动。

## 空状态 vs 消息模式

```tsx
{isEmpty ? (
  <EmptyState onSend={handleSend} />
) : (
  <Messages items={items} loading={loading} bottomRef={bottomRef} />
)}
```

- **空状态** — 居中显示欢迎文案 + 3 个建议 prompt，点击直接发送
- **消息模式** — 消息列表 + LoadingState + 底部锚点

空状态的建议 prompt 是 `send()` 的快捷入口，用户不用打字就能开始对话。

## 错误处理

```tsx
{error && (
  <div className="bg-red-tint text-red text-xs" role="alert">
    {error}
  </div>
)}
```

- 来源：`connectEvents` 的 `onError` 回调 → `setError("连接断开，正在重连…")`
- 视觉：红色半透明背景 + 红色文字，`role="alert"` 让屏幕阅读器优先朗读
- 恢复：EventSource 自动重连成功后触发 `onOpen` → `setError("")` → 错误横幅消失

## Composer（底部输入区）

```tsx
<footer className="fixed bottom-0 ... bg-gradient-to-t from-page ...">
  <PromptBar onSend={handleSend} loading={loading} />
</footer>
```

- `fixed bottom-0` — 固定在视口底部，不随消息滚动
- `bg-gradient-to-t from-page via-page to-transparent` — 渐变遮罩，让上方的消息"淡入"输入区后面，而不是被生硬截断

## 与 Hook 的边界

AgentHarness 对 `useConversationStream` **完全信任**——它不做任何状态管理，只做 UI 编排。这种边界清晰的设计让两个模块可以独立修改：

- 改 Hook（比如从 EventSource 换成 WebSocket）→ 不影响 UI
- 改 UI（比如换成三栏布局）→ 不影响数据逻辑

## 可扩展点

1. **侧边栏会话列表** — 在 header 下加左侧面板，显示历史对话
2. **模型切换** — PromptBar 已有 `models` 和 `onModelChange` prop，后端 API 补充后即可接入
3. **复制消息** — MessageItem 里加复制按钮，调用 `navigator.clipboard.writeText()`
4. **消息操作** — 重新生成、编辑后重发，需要后端支持
5. **响应式布局** — 用 Tailwind 的 `max-sm:` 等断点调整小屏布局