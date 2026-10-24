# 07 — 侧边栏会话导航（SidebarNav）

## 文件位置

| 文件 | 职责 |
|------|------|
| `client/components/primitives/SidebarNav.tsx` | 侧边栏本体：工作区标识 / 新建会话 / 会话搜索与列表 / 折叠 |
| `client/components/primitives/GlideMenu.tsx` | 行间滑行高亮层（官方 Beautiful UI 原件移植） |
| `client/hooks/useConversationList.ts` | 会话列表数据源 + 改名/删除/终止 |
| `client/app/globals.css` | `.sidebar-*` 折叠规则（复用已有 foundation token） |

## 结构

```
展开 224px                          折叠 52px
┌───────────────────────┐          ┌────┐
│ ✨ Pi Chat        ⧉   │          │ ⧉  │  ← 工作区行淡出，只留折叠/展开按钮
├───────────────────────┤          ├────┤
│ ✎ 新建会话            │          │ ✎  │
├───────────────────────┤          ├────┤
│ ⌄ 会话          ⌕     │          │    │  ← 整块随 .sidebar-copy 淡出
│   会话 6fd181c        │          │    │
│   我的学习计划        │          │    │
│   …                   │          │    │
├───────────────────────┤          ├────┤
│ 运行中                │          │    │
│ [ 终止生成 ]          │          │    │
└───────────────────────┘          └────┘
```

## 组件边界：纯展示

`SidebarNav` 不做任何数据请求、不做路由跳转。数据进、回调出；唯一的交互件是
行内删除的**就地确认壳**（`ConfirmPopover`），但文案与动作仍由外部注入：

| prop | 类型 | 说明 |
|------|------|------|
| `workspace` | `{ key, name, monogram? }` | 工作区标识（本项目即品牌位 Pi Chat） |
| `menuActions` | `{ key, label, icon? }[]` | 工作区菜单动作 |
| `activeId` | `string \| null` | **用 id 匹配选中**，不是标题 |
| `recents` | `{ id, label, status? }[]` | 会话列表；`status` 生成行首状态点 |
| `recentsLoading` | `boolean` | 首次拉取时的骨架占位 |
| `collapsed` / `onCollapsedChange` | `boolean` / `(v) => void` | 受控折叠；不传则内部自管 |
| `onNewChat` / `onPick(id)` | `() => void` / `(id) => void` | 新建 / 切换会话 |
| `onRename(id, title)` / `onDelete(id)` | callback | 行悬停操作（改名 / 删除），`onDelete` 只在确认后触发 |
| `deleteConfirm(item)` | `(item) => ConfirmCopy \| undefined` | 删除前的就地确认文案（按行生成）；不传则用通用文案 |
| `onMenuAction(key)` | `(key) => void` | 工作区菜单动作回调 |
| `footer` | `ReactNode` | 底部插槽（当前会话状态 + 终止生成） |
| `className` | `string` | 透传样式 |

## 折叠机制

折叠不重排、不换组件，只切一个 `data-*` 属性 + 一组 CSS 变量：

```tsx
<aside data-sidebar-collapsed={isCollapsed} style={{
  width: isCollapsed ? 52 : 224,
  "--sidebar-copy-duration": "180ms",
  "--sidebar-copy-offset": "8px",
  "--sidebar-easing": "cubic-bezier(0.16,1,0.3,1)",
}}>
```

```css
.sidebar-row { width: 208px }                    /* 展开时行宽 */
.sidebar-copy { opacity: 1; transform: translateX(0) }
[data-sidebar-collapsed="true"] .sidebar-row { width: 36px }
[data-sidebar-collapsed="true"] .sidebar-copy {
  opacity: 0; transform: translateX(calc(var(--sidebar-copy-offset) * -1));
}
```

关键点：**收起时 `.sidebar-row` 从 208px 变 36px，图标始终固定在行首 8px 处**，
所以视觉上只有文案淡出右移，图标不会横向漂移。凡是"折叠后应该消失"的东西
（文案、计数、搜索框、底部插槽、行内操作按钮）都标 `sidebar-copy`
或 `sidebar-row-action`，由这两条规则统一处理。

折叠状态存在 `localStorage["pi-chat:sidebar-collapsed"]`；传了 `collapsed` prop 就改由外部控制。

## 滑行高亮（GlideMenu）

```
pointer 在行 A → 高亮块 top/height 动画到 A
pointer 移到行 B → 同一个 span 平滑滑到 B（不是每个行各有一个背景）
```

`GlideMenu` 用 `getBoundingClientRect` 算出目标行相对容器的 `top/height`，
作用在一个绝对定位的 `<span>` 上，过渡 220ms。行元素只需带标记：

- 侧栏行：`data-row`（`rowSelector="[data-row]"`）
- 菜单行：`data-menu-row`（默认值）

焦点也会驱动高亮（`onFocusCapture`），键盘 Tab 时高亮跟着走。

## 数据接线（AgentHarness）

```
useConversationList(conversationId)          useConversationStream2(conversationId)
  ├─ summaries ──→ recents / activeLabel       ├─ messageItems ──→ MessageItem
  ├─ loading ────→ recentsLoading              ├─ loading ─────→ PromptBar / LoadingState
  ├─ error ──────→ 错误横幅                    ├─ error ───────→ 错误横幅
  ├─ refresh ────→ 发送后 / 轮询 / focus        └─ send ────────→ PromptBar.onSend
  ├─ rename / remove ─→ SidebarNav 行操作
  └─ abort ──────→ 侧栏底部「终止生成」
```

列表刷新时机：

| 时机 | 为什么 |
|------|--------|
| 首屏 + `conversationId` 变化 | 切会话时列表状态可能已变 |
| 发送消息后（POST 返回） | 服务端状态已变 `running`，状态点要跟上 |
| 有会话处于 `running/stopping/compacting` 时每 3s 轮询 | 列表状态是快照；跑到 `ready` 后轮询自动停 |
| `window` focus | 切回标签页对齐一次 |

## 关键设计决策

### 1. 用 id 匹配选中，不用标题

新建会话时标题是占位值 `New Conversation`，服务端会在首条用户消息到达时
按它起名（`ConversationService.ensureTitle`）；起名之前侧栏用
`会话 ${id.slice(0,6)}` 兜底。按标题匹配会把整列都点成 active，
所以 `activeId` 一律用 id。

### 2. 新建会话不立刻建记录

点「新建会话」只 `navigate("/")` 回到空状态，首次发送时才真正创建会话
（`useConversationStream2` 的懒创建路径）。否则每次点击都会在后端建
workspace 目录 + record + runtime，列表里很快堆满空的 `New Conversation`。

### 3. 乐观更新 + 失败回滚

改名/删除先改本地 state，失败时 `await refresh()` 拉服务端真实数据回滚，
最后再 `setError(原因)`。顺序很重要：`refresh()` 成功会清空 error，
先报错会被自己抹掉。

### 4. 并发请求只认最新

`requestIdRef` 递增计数，响应回来时若 id 不是最新就丢弃。轮询 + focus +
乐观回滚会并发发请求，慢的旧响应不能覆盖新数据（与 `useConversationStream2`
里的 `runIdRef` 同一套路）。

## 已知限制

1. 侧栏状态点最长有 3s 延迟：列表状态是服务端快照，靠发送后刷新 +
   3s 轮询兜。真实时应该让 SSE 的 `runtime.status` 回写 `useConversationList`。
2. 「终止生成」按钮的依据仍是侧栏列表里的 `status`（同上，最长 3s 延迟）；
   但 `loading`（header 徽标、输入框禁用、LoadingState）已经跟的是
   `runtime.status` / `runntime_settled`，与真实运行周期一致。
3. 删除确认是就地弹层（`ConfirmPopover`），不是模态：焦点默认落在「取消」，
   Esc / 外点关闭，删除进行中不响应关闭。宿主样式靠 `[data-confirm-open]`
   保持行内按钮可见（见 `globals.css` 的 `.sidebar-row-action:has(...)`）。
4. 窄屏（<768px）侧栏会挤内容，本期按桌面处理。
5. `createdAt/updatedAt` 的历史值是 `toDateString()`（天粒度），新写入的是
   ISO；服务端（`timestampOf`）与客户端（`timestampOf`）都按 `Date.parse`
   排序，所以新旧格式混用能正确排序，但**同一天内**的老记录仍可能并列。