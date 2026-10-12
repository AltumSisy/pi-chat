# 04 — UI 原始组件（Primitives）

## 文件位置

`client/components/primitives/`

## 职责

5 个独立的、可复用的 UI 组件。它们不关心业务逻辑，只负责视觉呈现。

## 组件一览

| 组件 | 文件 | 功能 |
|------|------|------|
| `LoadingState` | `LoadingState.tsx` | 加载动画：像素网格 + shimmer + 计时器 |
| `ThinkingState` | `ThinkingState.tsx` | 可折叠思考面板 |
| `ToolChips` | `ToolChips.tsx` | 工具调用卡片 |
| `PromptBar` | `PromptBar.tsx` | 消息输入框 |
| `StreamingText` | `StreamingText.tsx` | 流式文字 + 光标 |

---

## LoadingState — 加载动画

### 视觉结构

```
┌──┐
│▪▪▪│  Thinking…  3.2s
└──┘
 ↑      ↑          ↑
3×3    shimmer   等宽计时器
像素   文字
```

### 像素网格的 Chevron 波形

9 个像素排列成 3×3，每个像素的动画延迟按波形计算：

```text
索引   row  col  公式(col + |row-1|) × 90ms
 0     0    0    (0 + 1) × 90 = 90ms
 1     0    1    (1 + 1) × 90 = 180ms
 2     0    2    (2 + 1) × 90 = 270ms
 3     1    0    (0 + 0) × 90 = 0ms     ← 顶点，最先亮
 4     1    1    (1 + 0) × 90 = 90ms
 5     1    2    (2 + 0) × 90 = 180ms
 6     2    0    (0 + 1) × 90 = 90ms
 7     2    1    (1 + 1) × 90 = 180ms
 8     2    2    (2 + 1) × 90 = 270ms
```

中间行（row=1）的绝对值最小，动画最快，形成 **V 形扫过** 的视觉效果。

### 计时器

每 100ms 滴答一次（`setInterval(100)`），显示格式：
- `< 60s` → `"3.2s"`（一位小数）
- `>= 60s` → `"1m 15.3s"`

### shimmer 文字

一个从左到右扫过的线性渐变，通过 `background-clip: text` 裁到文字上。CSS：
```css
background-image: linear-gradient(90deg, gray 35%, black 50%, gray 65%);
background-size: 200% 100%;
-webkit-background-clip: text;
color: transparent;
animation: shimmer-text 1.4s linear infinite;
```

渐变本身比文字宽两倍（`200%`），动画让它平移，产生扫光效果。

---

## ThinkingState — 可折叠思考面板

### 视觉结构

```
✨ Thinking…                    ▼    ← 头部：图标 + shimmer/static 标签 + 箭头
│  用户想要一个 React 组件…          ← 内容：左侧竖线 + 文字
│  我应该先检查现有代码…
│  …
```

### 核心行为

- **思考中**（`working=true`）：自动展开，标签文字 shimmer，光标常亮
- **完成后**（`working=false`）：自动折叠，标签显示 `done` 文字
- **手动切换**：点击头部按钮展开/折叠

### `useEffect` 自动折叠

```ts
useEffect(() => {
  if (!working) setOpen(false);
}, [working]);
```

当 `working` 从 `true` 变成 `false` 时，自动调用 `setOpen(false)`。用户仍可手动点开查看。

### 内容区渲染

```ts
{children ?? (
  <div className="whitespace-pre-wrap">
    {text || "…"}
  </div>
)}
```

`children` 优先（允许父组件传入 Markdown 渲染），`text` 作为纯文本兜底。

---

## ToolChips — 工具调用卡片

### 视觉结构

```
┌──────────────────────────────────────┐
│ 📄 write_file  ✓ 写入成功        ▼   │  头部
├──────────────────────────────────────┤
│ 参数                                 │
│ { "path": "src/utils.ts", ... }     │  展开区
│                                      │
│ 输出                                 │
│ Wrote 42 lines to src/utils.ts      │
└──────────────────────────────────────┘
```

### 状态图标映射

| `tool.status` | 图标 | 颜色 | 动画 |
|---------------|------|------|------|
| `"running"` | `LoaderCircle` | `text-ink-2` | `animate-spin` |
| `"success"` | `CheckCircle2` | `text-green` | 无 |
| `"error"` | `XCircle` | `text-red` | 无 |

### 展开/折叠

- 头部按钮点击切换 `open` 状态
- 展开区显示：参数（`JSON.stringify(args, null, 2)`）+ 输出（`result`）+ 详情（`details`）
- `result` 和 `details` 只在有值时显示，避免空标签

---

## PromptBar — 消息输入框

### 视觉结构

```
┌──────────────────────────────────────┐
│ 输入消息，按 Enter 发送…          [↑] │
└──────────────────────────────────────┘
                    发送按钮：有内容亮，无内容灰
```

### 自适应高度

```ts
useLayoutEffect(() => {
  const el = textareaRef.current;
  if (!el) return;
  el.style.height = "auto";                          // 先重置
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`; // 再设新高度，上限 120px
}, [text]);
```

为什么用 `useLayoutEffect` 而不是 `useEffect`？

`useLayoutEffect` 在浏览器绘制前同步执行。如果内容变化导致高度需要调整，在绘制前改好，用户不会看到"闪烁"（先渲染旧高度再跳变）。

### 键盘处理

```ts
function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();  // 阻止默认换行
    handleSend();        // 发送
  }
  // Shift+Enter → 默认行为换行，不拦截
}
```

### 发送按钮

```ts
const canSend = trimmed.length > 0 && !loading;
```

三种视觉状态：
- **可发送**（`canSend=true`）：`bg-ink text-surface`（深色背景白色图标）
- **空内容**：`bg-line-strong text-ink-3`（灰色）
- **loading 中**：`disabled:cursor-not-allowed`

---

## StreamingText — 流式文字 + 光标

### 组件结构

```tsx
<p>
  {content}
  {streaming && <span className="stream-caret is-streaming" />}
</p>
```

### 光标样式（globals.css 预定义）

```css
.stream-caret {
  display: inline-block;
  width: 2px;
  height: 1.05em;
  background: var(--ink);
  animation: caret-blink 1s step-end infinite;  /* 默认闪烁 */
}

.stream-caret.is-streaming {
  animation: none;  /* 流式输出中常亮 */
}
```

- `streaming=true` → 光标常亮（表示"还有内容在路"）
- `streaming=false` → 光标消失（整个 span 不渲染）

### 为什么这么简单？

AgentHarness 脚手架里写的是：

```tsx
<p>{text}{!completed && <span className="stream-caret is-streaming" />}</p>
```

AI Chat 场景的"流式渲染"本质就是：**文字逐字追加 + 末尾光标**。逐字追加由 SSE `message_delta` 事件驱动，Reducer 往 `text` 后面拼字符串，React 自动重渲染——不需要组件自己实现"逐字动画"。`StreamingText` 组件只是负责**在末尾加一个光标**。