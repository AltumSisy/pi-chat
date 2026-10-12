# 03-requirements — ConversationRepository 需求文档

> 版本：v1.0  
> 作者：产品  
> 受众：服务端开发  
> 前置阅读：[01-config.md](./01-config.md)、[02-types.md](./02-types.md)

---

## 1. 定位

`ConversationRepository` 是对话数据的**唯一访问入口**。上层（HTTP 路由、Service 层）不直接操作文件系统，所有对 `ConversationRecord` 的读写都必须通过它。

一句话职责：**把 `ConversationRecord` 存到 `records/{id}.json`，并提供增删改查。**

---

## 2. 数据结构

### 2.1 管理的实体

```typescript
interface ConversationRecord {
  id: string;          // 主键，同时是文件名
  title: string;
  workspaceDir: string;
  sessionId: string;
  sessionFile: string;
  createdAt: string;   // ISO 8601，创建时自动填入
  updatedAt: string;   // ISO 8601，每次 save / update 自动刷新
}
```

### 2.2 存储形式

一条 Record = 一个 JSON 文件，路径为 `{recordsDir}/{id}`（无后缀）。

```
~/.pi/agent/pi-chat/records/
├── 550e8400-e29b-41d4-a716-446655440000
├── 6ba7b810-9dad-11d1-80b4-00c04fd430c8
└── ...
```

### 2.3 为什么每个 Record 存成独立文件

| 对比维度 | 单文件数组 `records.json` | 每 Record 独立文件 ✅ |
| ---------- | -------------------------- | ---------------------- |
| 读一条 | 读全量 → 遍历 find | 读一个文件，O(1) |
| 写一条 | 读全量 → 改一项 → 写全量 | 只写一个文件 |
| 删一条 | 读全量 → filter → 写全量 | 只删一个文件 |
| 并发写两条 | 后写覆盖前写（数据丢失） | 互不影响 |

---

## 3. 对外接口（5 个方法）

### 3.1 `save(record)` — 创建 / 全量覆盖

```
入参：ConversationRecord（完整对象）
行为：
  1. 确保 recordsDir 目录存在（mkdir recursive，已存在则跳过）
  2. 将 record 序列化为 JSON（2 空格缩进，方便人工 debug）
  3. 写入 {recordsDir}/{record.id}
返回：无（void），写入失败则抛异常
幂等：对同一 id 重复调用 = 覆盖写
```

### 3.2 `get(id)` — 按 ID 读取

```
入参：conversationId: string
行为：
  1. 拼接路径 → readFile
  2. JSON.parse 还原为对象
返回：
  - 文件存在 → ConversationRecord
  - 文件不存在 / 解析失败 → null（不抛异常）
```

**为什么不存在返回 `null` 而不是抛异常**：调用方需要判断 404，`null` 比 `try-catch` 更轻量且语义更明确。

### 3.3 `update(id, partial)` — 部分更新

```
入参：
  - conversationId: string
  - updatedConversationRecord: Partial<ConversationRecord>（只传要改的字段）
行为：
  1. get(id) 读取现有记录
  2. 不存在 → throw Error（由上层 onError 统一处理）
  3. spread 合并：{ ...existing, ...partial, updatedAt: now }
  4. save(merged) 写回
返回：无
```

**为什么用 `Partial<T>` 而不是要求完整对象**：

| 方案 | 调用方负担 |
| ------ | ----------- |
| 要求完整对象 | 调用方必须先 get，再改字段，再传全量 |
| `Partial<T>` ✅ | 调用方只传 `{ title: "新标题" }` 即可 |

对比 Java 的实现成本：Java 需要 `if (update.title != null) record.setTitle(...)` 逐字段判空，或者用 MapStruct / Builder。TS 的 spread + Partial 两行搞定，是类型安全的"只改这一项"。

```
{ ...existing, ...partial, updatedAt: now }
       ↑            ↑              ↑
  全量兜底    增量覆盖（同名 key 后面赢）   强制刷新时间戳
```

### 3.4 `remove(id)` — 删除

```
入参：conversationRecordId: string
行为：rm 目标文件，force: true（文件不存在也不报错）
返回：无
幂等：删一个不存在的 id 不抛异常
```

### 3.5 `recordPath(id)` — 路径计算

```
入参：conversationId: string
返回：{recordsDir}/{conversationId} 的绝对路径
可见性：当前是 private，但设计上可暴露为 public 供其他模块使用
```

---

## 4. 依赖

```
ConversationRepository
  ├── GlobalConfig（注入）  → 决定 recordsDir 位置
  ├── ConversationRecord     → 入参 / 返回值的类型
  └── node:fs/promises       → mkdir, readFile, writeFile, rm
```

- **不依赖**：Hono、Express 等 HTTP 框架。它只认文件系统，可以在 CLI 脚本、测试、HTTP 层复用。
- **构造函数注入 `GlobalConfig`**：测试时传入临时目录，不影响真实数据。

---

## 5. 错误策略

| 场景 | 行为 | 原因 |
| ------ | ------ | ------ |
| `save` 写入失败（磁盘满、权限） | 抛异常，冒泡给调用方 | 调用方需要知道失败 |
| `get` 文件不存在 | 返回 `null` | 这是预期内的正常分支（查不存在的 id） |
| `get` 文件存在但 JSON 损坏 | 返回 `null` | 损坏 = 不可用，等同不存在 |
| `update` 记录不存在 | 抛 `Error` | 更新一个不存在的 id 是调用方的 bug |
| `remove` 文件不存在 | 静默成功（`force: true`） | 幂等设计，删一个已删的东西不算错 |

---

## 6. 版本规划

| 版本 | 内容 |
| ------ | ------ |
| v1.0 ✅ | save / get / update / remove / recordPath |
| v1.1 | list：遍历 records 目录，支持按 `updatedAt` 排序、分页 |
| v1.2 | 原子写入：先写临时文件再 rename，防止写入中途崩溃导致文件损坏 |
| v1.3 | 批量操作：`saveMany` / `removeMany` |
