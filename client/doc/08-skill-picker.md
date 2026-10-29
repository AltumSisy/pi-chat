# 08-skill-picker — 技能选择器（SkillPicker）

> 前置阅读：[01-api.md](./01-api.md)、[04-primitives.md](./04-primitives.md)、[06-agent-harness.md](./06-agent-harness.md)
>
> 后端契约见 [server/doc/09-skills.md](../../server/doc/09-skills.md)
>
> 涉及文件：`client/components/primitives/SkillPicker.tsx`、`client/hooks/useConversationConfig.ts`、`client/api.ts`、`client/components/AgentHarness.tsx`

---

## 1. 一句话定位

`PromptBar` 里的一个**多选下拉**：搜索 + 勾选技能，选中结果落到会话配置（`activeSkillNames`），下一次对话的 system prompt 就会带上这些技能。

位置：model 胶囊的**左边**。

```text
┌──────────────────────────────────────────────┐
│ 输入消息，按 Enter 发送…        [⚡ 技能 (1)] [deepseek… High] [↑] │
└──────────────────────────────────────────────┘
                                    ↑              ↑
                            SkillPicker     ModelConfigPill
```

---

## 2. 组件结构

```text
SkillPicker
├── Trigger Button        ⚡ 技能 (N) + 箭头 / spinner
└── Dropdown (portal → body, 向上弹)
    ├── Search Input      搜索 name / description，自动聚焦，× 清空
    ├── Scrollable List   role="listbox" aria-multiselectable
    │   └── Option Item   role="option" aria-selected
    │       ├── Checkbox   15px 圆角，选中 bg-accent + 白勾
    │       ├── Title      skill.name（+「仅手动」标签）
    │       └── Description 灰色，line-clamp-2
    ├── Warnings          SKILL.md 校验失败的原因（有才显示）
    └── Action Bar        已选 N 个 / 清空 / 完成
```

### Props

```ts
type SkillPickerProps = {
  active: string[];              // 已选中的技能名
  available: SkillOption[];      // 配置里带的候选
  disabled?: boolean;            // 流式输出中（服务端拒绝重建 runtime）
  saving?: boolean;              // PATCH 进行中
  error?: string;                // PATCH 失败信息
  onChange: (skills: string[]) => void;
};
```

组件本身**不持有选中状态**——选中集合始终来自 `active`，唯一来源是 `useConversationConfig` 的 `config.activeSkillNames`。组件内部只持有 UI 状态（`open` / `query` / `skills` / `warnings` / `placement`）。

---

## 3. 与 `ModelConfigPill` 的交互一致性

两者共用同一套「向上弹层」的约定，避免两个胶囊行为不一致：

| 约定 | 实现 |
|---|---|
| 定位 | `placeAbove()`：右对齐触发器，水平夹在视口内，向上展开 |
| 不闪 | 先 `visibility: hidden` 渲染，`useLayoutEffect` 量完再显示 |
| 跟随 | `resize` + `scroll`（**捕获阶段**，输入框/侧栏内部滚动也能收到） |
| 外点 / Esc | `pointerdown` 监听 + Esc 关闭；Esc 后焦点回到触发器 |
| portal | 弹到 `body`，不受 `overflow: hidden` 裁剪 |
| 动画 | `pop-in 160ms`，`transformOrigin: bottom right` |
| 流式输出 | `disabled`，服务端此时会拒绝改配置 |

---

## 4. 交互细节

### 4.1 搜索

- 按 `name` + `description` 双向过滤，大小写不敏感
- 打开面板时重置搜索词并**自动聚焦搜索框**（打开即可打字）
- 无匹配时显示「没有匹配「xxx」的技能。」

### 4.2 键盘

| 按键 | 行为 |
|---|---|
| `↓` | 搜索框 → 列表第一项；列表内下移 |
| `↑` | 列表内上移；已在第一项 → 退回搜索框 |
| `Enter` / `Space` | 由 `<button role="option">` 原生触发 `onClick` → 切换勾选 |
| `Esc` | 关闭并归还焦点 |
| `Tab` | 拦截（面板 portal 到 body 末尾，不拦会跳到页首） |

### 4.3 视觉态

| 状态 | 表现 |
|---|---|
| 行 hover | `bg-hover` |
| 行选中 | 底色 `bg-accent-tint`，标题 `text-accent-ink` |
| 复选框选中 | `border-accent bg-accent` + 白色 `Check`（`strokeWidth=3`） |
| 触发器有选中 | 闪电图标 `text-accent-ink`、边框 `border-line-strong` |
| 触发器展开 | `bg-hover` + `shadow-hairline` |

---

## 5. 数据流

```text
用户点某一行
  │
  ▼
onChange(nextNames)                 ← SkillPicker 只回报「新的名字数组」
  │
  ▼
useConversationConfig.setSkills()
  ├─ 乐观更新 config.activeSkillNames     ← UI 立刻变化
  ├─ 合并 pending 里的其它改动（如 thinkingLevel）
  └─ schedule(targetId, {skills}, immediate = true)
       └─ PATCH /api/conversation/:id/config
            ├─ 成功：用服务端返回的 config 覆盖（含净化后的 activeSkillNames）
            └─ 失败：回滚到 serverConfigRef（上一次确认值）+ 显示 error
```

### 为什么技能不走 debounce

`useConversationConfig` 里思考强度有 180ms 合并窗口（拖滑块会连发多次）。技能不同：

- 服务端每切一次都要**重建整个 runtime**（重新执行 extension factories，MCP 会重连）
- 连续勾选多个技能时，每次勾选都是一次点击，合并意义不大，但重建成本很高

所以 `setSkills` 用 `immediate = true` 直接入队（串行链 `chainRef` 仍保证不并发）。

### 为什么打开面板要重新拉 `/api/skills`

`config.skills` 只在加载会话配置时取一次。往 `skillsDir` 里新加技能后，不刷新会话就看不到。所以打开面板时调一次 `listSkills()`：

```ts
function openPanel() {
  setQuery("");
  setOpen(true);
  setRefreshing(true);
  const ticket = ++fetchTicketRef.current;
  void listSkills()
    .then((result) => { /* 只有 ticket 最新才采纳 */ })
    .catch(() => { setSkills(available); setWarnings([]); });  // 失败退回配置里的候选
}
```

拉取失败不影响选择：退回 `config.skills`。

> 这段刻意放在事件回调里而不是 `useEffect` 里 —— 否则 `setRefreshing(true)` 属于 effect 内同步 setState，会触发 `react(set-state-in-effect)` 警告和额外渲染。

---

## 6. API 层

```ts
// 候选 + 告警
listSkills(): Promise<SkillListResponse>          // GET /api/skills

// 发送消息时才需要显式指定技能
sendMessage(id, text, skills?): Promise<unknown>  // 有 skills 才写 FormData 字段
```

`sendMessage` 的第三个参数**默认不传**：不传 = 服务端沿用会话当前选择。只有「本轮临时用别的技能」才需要带。

---

## 7. AgentHarness 里的接线

```tsx
actions={
  config ? (
    <div className="flex items-center gap-1.5">
      <SkillPicker
        active={config.activeSkillNames}
        available={config.skills}
        disabled={loading}
        saving={configSaving}
        error={configError}
        onChange={setSkills}
      />
      <ModelConfigPill … />
    </div>
  ) : conversationId && configLoading ? (
    <span className="block h-8 w-[148px] animate-pulse rounded-full bg-inset" />
  ) : undefined
}
```

三个条件要一起看：

| 条件 | 渲染 |
|---|---|
| `config` 已加载 | 两个胶囊 |
| 有 conversationId 且正在加载 | 骨架占位 |
| 没有 conversationId（首页空状态） | **什么都不渲染** |

最后一条是有意的：技能是**会话级**配置，空状态还没有 conversationId，`/config` 无从请求。用户发第一条消息建出会话后，胶囊才出现。

---

## 8. 常见问题排查

| 现象 | 原因 |
|---|---|
| 页面上没有技能胶囊 | ① 在首页空状态（正常）② `AgentHarness.tsx` 里没渲染 `<SkillPicker/>` ③ `config.activeSkillNames` / `config.skills` 后端没返回 |
| 胶囊在但列表为空 | `skillsDir` 里没有合法技能；打开面板后会显示「没有可用技能…」 |
| 列表里少了某个技能 | 看面板底部 `warnings`（多半是 `description is required`） |
| 勾选后立刻弹回 | PATCH 失败（如会话正在流式输出）→ 回滚 + 顶部红条显示错误 |
| 勾选后模型没按技能做 | 检查 `/config` 的 `activeSkillNames` 是否真的变了；`disable-model-invocation` 的技能不进 prompt |

---

## 9. 可扩展点

1. **空状态预选**：给 `POST /api/conversation` 加 `skills` 入参，首页就能先选技能（当前不支持）
2. **技能详情预览**：后端 `SkillOption` 已有 `name/description/disableModelInvocation`，可再补 `filePath`，面板里加「查看 SKILL.md」
3. **收藏 / 最近使用**：技能数量变多后，按最近使用排序或置顶
4. **`/skill:name` 命令**：面板里插入 `/skill:xxx` 到输入框，让 `disable-model-invocation` 的技能也能用