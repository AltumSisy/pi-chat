# 09-skills — 技能（Skill）接入后端详设

> 前置阅读：[01-config.md](./01-config.md)、[04-runtime.md](./04-runtime.md)、[06-service.md](./06-service.md)
>
> 涉及文件：`server/config.ts`、`server/conversation/service.ts`、`server/conversation/runtime.ts`、`server/routes/skill.ts`、`server/routes/conversation.ts`、`shared/types.ts`

---

## 1. 一句话定位

把磁盘上的**技能目录**（`skillsDir`）变成会话的**能力注入**：用户勾选技能 → 落到 `ConversationRecord.selectedSkills` → 过滤 pi 的 skill 列表 → 写进 system prompt。

技能本身不执行任何代码，它只是「一段按需加载的说明」。真正起作用的是 prompt。

---

## 2. 全链路

```text
skillsDir/<skill>/SKILL.md
        │  loadSkillsFromDir({ dir, source: "project" })
        ▼
   Skill[] { name, description, disableModelInvocation, ... }
        │
        ├── GET /api/skills ─────────────► 前端候选列表 + warnings
        │
        ├── resolveSkills(names) ────────► 校验（未知名字直接报错）
        ▼
ConversationRecord.selectedSkills  ←── PATCH /config { skills }
        │                               POST /message  { skills }
        ▼
createRuntime({ selectedSkills })
        │
        └── createAgentSessionServices({
              noSkills: true,
              additionalSkillPaths: [skillsDir],
              skillsOverride: (base) => ({
                ...base,
                skills: base.skills.filter(s => selectedSkillsSet.has(s.name)),
              }),
            })
        ▼
        system prompt 里的 <available_skills>（仅 name + description）
        │
        ▼
   模型按需 read SKILL.md 拿全文（渐进式披露）
```

`skillsDir` 默认是 `${PI_CHAT_ROOT_DIR}/skill`，启动时由 `server/index.ts` 的 `ensureDir` 创建。

---

## 3. 技能发现与校验

`loadSkillsFromDir` 的规则（来自 pi-coding-agent）：

| 情况 | 行为 |
|---|---|
| 目录里有 `SKILL.md` | 视为技能根，**不再**往下递归 |
| 目录里没有 `SKILL.md`，但有 `.md` | 只加载根目录直接的 `.md`（需带合法 frontmatter） |
| 子目录里有 `SKILL.md` | 递归加载 |

frontmatter 约束：

| 字段 | 要求 | 不满足时 |
|---|---|---|
| `name` | 1–64 字符，小写字母/数字/连字符 | warning，不加载 |
| `description` | 必填，≤1024 字符 | **不加载** |
| `disable-model-invocation` | 可选，`true` 时不进 system prompt | 加载但模型看不见 |

**目录名不必等于 `name`**（pi 放宽了 Agents Skills 规范这条）。

校验失败**不会抛错**，只产出 `diagnostics`。所以我们把它透出成 `warnings`，否则用户只会看到「技能没出现」而没有任何线索：

```ts
// service.getAvailableSkills()
warnings: loadSkillsResult.diagnostics.map((d) =>
  d.path ? `${d.type}: ${d.message} (${d.path})` : `${d.type}: ${d.message}`,
)
```

---

## 4. HTTP 接口

### 4.1 `GET /api/skills`

`server/routes/skill.ts`，全局资源，与会话无关。

```json
{
  "skills": [
    { "name": "code-review", "description": "…", "disableModelInvocation": false }
  ],
  "warnings": ["warning: description is required (D:\\…\\SKILL.md)"]
}
```

`warnings` 与 `skills` 是互补的：坏掉的技能不出现在 `skills` 里，但原因在 `warnings` 里。

### 4.2 `GET /api/conversation/:id/config`

在原有 `model / models / thinkingLevel / availableThinkingLevels` 基础上新增：

| 字段 | 说明 |
|---|---|
| `activeSkillNames: string[]` | 当前会话已选中的技能 |
| `skills: SkillOption[]` | 候选技能（同 `GET /api/skills` 的 `skills`） |

把候选列表放进 config，前端只需**一次请求**就能画出技能选择器。

### 4.3 `PATCH /api/conversation/:id/config`

`ConversationConfigUpdate` 新增可选字段：

```json
{ "skills": ["code-review"] }
```

- 传 `[]` = 清空选择
- 不传 = 保持现状
- 未知技能名 → 报错（见第 6 节）

### 4.4 `POST /api/conversation/:id/message`

`FormData` 的 `skills` 字段是 JSON 数组字符串，**可选**：

| 请求 | 语义 |
|---|---|
| 无 `skills` 字段 | 沿用会话当前选择（不动） |
| `skills=[]` | 本轮清空技能 |
| `skills=["a","b"]` | 本轮切到这两个 |
| 非法 JSON / 非字符串数组 | 直接报错（不再静默吞掉） |

> 之所以强调「无字段 ≠ 空数组」：早期实现里缺失字段被解析成 `[]`，而 `ensureSkill(undefined)` 又返回 `[]`，两者叠加导致**每条不带 skills 的消息都会清空已选技能**。

---

## 5. 切换技能为什么会重建 runtime

`skillsOverride` 是在 `createAgentSessionServices()` 里被调用的**一次性闭包**，它把 `selectedSkillsSet` 捕获进去。resource loader 一旦构建完成，技能列表就固定了。所以切换技能只能：

```text
ensureManagedSession(id, newSkills)
  └─ 技能集合不同 && 不 busy
       ├─ 先 await 落盘 selectedSkills   ← 先写记录，避免重建成功但记录没写进去
       ├─ release(id, { dropChannel: false })   ← 释放 runtime，但保留 SSE channel
       └─ createManagerSession(record, sessionManager, newSkills)
```

两个关键点：

1. **复用同一个 `SessionManager`**：`release` 里只调 `session.dispose()`，没有关闭 SessionManager，所以新 runtime 从同一个 `.jsonl` 继续，历史不丢。
2. **model / thinkingLevel 会自动恢复**：`setModel` 会 `appendModelChange()`、`setThinkingLevel` 会 `appendThinkingLevelChange()`，`createAgentSession` 再从 `buildSessionContext()` 读回来。所以切技能不会把模型重置成默认值。

代价：每次切换会重建 services + 重新执行 extension factories（MCP adapter 会重连）。因此前端的技能选择**不走 debounce**。

---

## 6. `ensureSkill` / `resolveSkills` 的三种输入

```ts
private ensureSkill(skills?: string[]): string[] | undefined {
  if (!skills) return undefined;      // 未指定 → 调用方沿用现状
  return this.resolveSkills(skills);  // 显式指定 → 校验
}
```

| 输入 | 返回 | 含义 |
|---|---|---|
| `undefined` | `undefined` | 未指定，保持当前/持久化选择 |
| `[]` | `[]` | 显式清空 |
| `["code-review"]` | `["code-review"]` | 生效并去重 |
| `["nope"]` | **抛错** | `unknown skill(s): nope; available skills: code-review` |

选择抛错而不是静默过滤：静默过滤会让客户端拿到 `202` 却不知道技能没生效。

---

## 7. 冷启动：从记录恢复技能

`ensureManagedSession` 的冷启动分支必须把持久化的选择带进 runtime：

```ts
const recordSkills = conversationRecord.selectedSkills ?? [];
const activeSkills = selectedSkills ?? recordSkills;   // 请求里带了就以请求为准
if (selectedSkills && !hasSameStringItems(recordSkills, selectedSkills)) {
  await this.conversationReposity.update(conversationId, { selectedSkills });
}
return this.createManagerSession(conversationRecord, sessionManaged, activeSkills);
```

`?? []` 是给**升级前的老记录**兜底（那时 `ConversationRecord` 还没有 `selectedSkills` 字段）。

### 同一分支里的两个历史 bug（已修）

**A. `sessionFile` 幽灵路径 → 冷启动丢历史**

`SessionManager` 的 `.jsonl` 是懒创建的，`createConversation` 写进记录的是一条**磁盘上还不存在**的路径。冷启动时 `existsSync(record.sessionFile)` 为 false → 新建一个 SessionManager（**新文件名**）→ 但没把新路径写回记录。于是每重启一次就多一个文件，真实历史留在没人引用的旧文件里，表现为「重启后消息全丢」。

修法：新建后把 `sessionId` / `sessionFile` 写回记录。详见 `bug-record/冷启动丢历史-sessionFile幽灵路径/record.md`。

**B. `release()` 误删会话记录**

`release()` 原本会 `conversationReposity.delete(id)`。切技能时它是「先删记录再 `update`」，必然抛 `not conversationRecord`，而且会话会从列表里消失。现在记录只由 `delete()` 删除，`release()` 只释放内存。

---

## 8. `hasSameStringItems`

`server/utils.ts`，用来判断「技能选择是否真的变了」：

```ts
export function hasSameStringItems(left, right): boolean {
  if (left === right) return true;
  const leftSet = new Set(left ?? []);
  const rightSet = new Set(right ?? []);
  if (leftSet.size !== rightSet.size) return false;
  for (const item of leftSet) if (!rightSet.has(item)) return false;
  return true;
}
```

技能名在同一份列表里唯一，所以按**集合语义**比较：忽略顺序、忽略重复。`undefined | null` 兜底成空数组，这样没有 `selectedSkills` 的老记录也能安全比较（否则 `[...selectedSkills]` 会直接抛）。

---

## 9. 状态机一览

| 触发 | 条件 | 结果 |
|---|---|---|
| `POST /message` 首条（无会话） | — | 建会话（skills 为空），技能只能之后选 |
| `POST /message` 带新 skills | 不 busy | 重建 runtime → 发消息 |
| `POST /message` 带新 skills | busy | 抛错（`session目前是busy状态…`） |
| `POST /message` 不带 skills | — | 沿用当前选择，直接发消息 |
| `PATCH /config { skills }` | 不 busy | 重建 runtime → 返回新 config |
| 冷启动 | 记录里有 skills | 带进 runtime |
| 冷启动 | 老记录无该字段 | 视为 `[]` |

---

## 10. 已知限制

| 限制 | 说明 |
|---|---|
| 空状态不能选技能 | 技能是会话级配置，`/config` 需要 conversationId。要支持得给 `POST /api/conversation` 加 `skills` 入参 |
| `disable-model-invocation` 技能用不了 | 它们不进 system prompt，而 pi-chat 没有 `/skill:name` 命令通道 |
| 每次调用都同步扫盘 | `getAvailableSkills()` 每次都 `loadSkillsFromDir`（同步 fs）。技能目录变化不频繁，可按 mtime 缓存 |
| 切换技能未串行化 | `ensureManagedSession` 不是 per-conversation 互斥的：并发两个请求可能都走冷启动分支，用同一个 SessionManager 建出两个 runtime |
| 切换代价偏高 | 重建 services + extension factories（MCP 会重连） |

---

## 11. 自测清单

```bash
# 候选 + 告警
curl -s http://127.0.0.1:4328/api/skills

# 选中
curl -s -X PATCH http://127.0.0.1:4328/api/conversation/<id>/config \
  -H 'content-type: application/json' -d '{"skills":["code-review"]}'

# 未知名字应报错
curl -s -X PATCH http://127.0.0.1:4328/api/conversation/<id>/config \
  -H 'content-type: application/json' -d '{"skills":["nope"]}'

# 发消息不带 skills，选择应保留
curl -s -X POST http://127.0.0.1:4328/api/conversation/<id>/message -F 'text=hi'

# 冷启动后选择与历史都应保留
# （重启服务 → POST /api/conversation/<id> 看 activeSkillNames + messageList）
```