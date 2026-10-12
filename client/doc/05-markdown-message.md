# 05 — Markdown 渲染 + MessageItem 分发器

## 文件位置

- `client/components/Markdown.tsx`
- `client/components/MessageItem.tsx`

## 职责

这两个组件负责把 `MessageListItem[]` 列表转换成实际的 DOM 结构。`MessageItem` 是**分发器**（switch on `kind`），`Markdown` 是**内容渲染器**（把 Markdown 字符串变成带样式的 HTML）。

---

## Markdown — AI 回复的渲染器

### 为什么需要自定义渲染？

`react-markdown` 默认输出的 HTML 没有样式类名。我们需要给每个元素加上 Tailwind 类，让它融入 beautiful-ui 设计系统。

### 核心机制：`components` 属性

`react-markdown` 的 `components` 属性允许覆盖每个 HTML 元素的渲染函数：

```tsx
<ReactMarkdown
  components={{
    code: ({ className, children }) => /* 自定义渲染 */,
    table: ({ children }) => /* 自定义渲染 */,
    // ...
  }}
>
  {content}
</ReactMarkdown>
```

### 代码块 vs 行内代码

同一个 `<code>` 标签，通过 `className` 区分：

- 有 `className`（如 `"language-ts"`）→ 围栏代码块 → 深色背景 + 语言标签
- 无 `className` → 行内代码 → 浅灰底 + 等宽字体

```tsx
code: ({ className, children }) =>
  className ? (
    // 代码块：深色容器
    <div className="bg-[#1d1d1f] ...">
      <div className="...">{className.replace("language-", "")}</div>
      <pre><code className={className}>{children}</code></pre>
    </div>
  ) : (
    // 行内：浅灰背景
    <code className="bg-field ...">{children}</code>
  )
```

### 表格 —— 横向滚动

AI 可能输出宽表格，超出聊天区宽度。解决方案：外层包一个 `overflow-x-auto` 的容器：

```tsx
table: ({ children }) => (
  <div className="max-w-full overflow-x-auto my-2.5">
    <table className="min-w-[520px]">{children}</table>
  </div>
)
```

`min-w-[520px]` 保证小表格不会被压扁，大表格触发横向滚动。

### 引用 —— 左侧竖线

```tsx
blockquote: ({ children }) => (
  <blockquote className="border-l-2 border-line-strong my-2.5 pl-2.5 text-ink-2">
    {children}
  </blockquote>
)
```

### remark-gfm

`remarkGfm` 是 remark 插件，让 react-markdown 支持 GFM（GitHub Flavored Markdown）扩展语法：表格、删除线、任务列表、自动链接。

---

## MessageItem — 消息行分发器

### 分发逻辑

```tsx
export function MessageItem({ item }: { item: MessageListItem }) {
  if (item.kind === "Thinking") return <ThinkingState ... />;
  if (item.kind === "tool")     return <ToolChips ... />;
  // kind === "message"
  const isUser = item.message.role === "user";
  return isUser ? <UserBubble /> : <AssistantBubble />;
}
```

### 用户气泡

```
                                    ┌──────────────────┐
                                    │ 帮我写一个组件    │
                                    └──────────────────┘
                                        发送中…
```

布局特点：
- `flex justify-end` — 右对齐
- `max-w-[78%]` — 不占满宽，与 AI 消息有视觉区分
- 气泡：`rounded-[12px_5px_12px_12px] bg-inset` — 不对称圆角 + 灰色背景
- 内容：纯文本，`whitespace-pre-wrap` 保留换行
- 状态：`status:"pending"` 显示"发送中…"，`status:"error"` 显示"发送失败"

### AI 气泡

```
┌──────────────────────────────────────────────────────┐
│ ## 这是AI的回复                                      │
│                                                      │
│ 这是带 **Markdown** 的段落                           │
│ - 列表项 1                                           │
│ - 列表项 2                                           │
└──────────────────────────────────────────────────────┘
```

布局特点：
- `flex justify-start` — 左对齐
- `max-w-full` — 占满可用宽度
- 无背景色，透明融入页面
- 内容：Markdown 渲染（代码块、表格、标题等）

### 为什么两种消息样式不同？

- **用户消息** — 有背景色 + 右对齐 → 视觉上像"聊天"，容易区分自己说的话
- **AI 消息** — 无背景 + 左对齐 → AI 回复可能很长（代码块、表格等），有背景会导致视觉上"太沉"

### 状态指示

`ChatMessage.status` 是 `"pending" | "streaming" | "error"` 的联合类型：

| status | 显示 | 含义 |
|--------|------|------|
| `"pending"` | "发送中…" | 乐观更新后，后端尚未确认 |
| `"streaming"` | 光标闪烁 | AI 正在逐字输出 |
| `"error"` | "发送失败" | 消息发送或 AI 回复出错 |