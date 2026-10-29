# 冷启动丢历史：`conversationRecord.sessionFile` 是一条幽灵路径

## 现象

新建会话 → 重启服务 → 发一条消息（模型正常回复）→ 再重启服务 → 打开会话，**历史消息全空**。

实测同一会话：

```text
POST /api/conversation           → 消息 3 条（用户 ping + AI pong + …）
[重启服务]
POST /api/conversation/:id       → messageList: 0      ← 历史消失
```

用户视角是「聊过的会话重启后变空」，数据其实还在磁盘上，只是没人引用。

## 根因

1. `SessionManager` 的 `.jsonl` 是**懒创建**的。`createConversation()` 里
   `SessionManager.create(cwd, sessionsDir, { id })` 只是返回一个「未来会用的」路径，
   磁盘上没有文件 —— 但这条路径当场写进了 `conversationRecord.sessionFile`。
2. 冷启动 `ensureManagedSession()` 用 `existsSync(record.sessionFile)` 决定「恢复还是新建」。
   文件不存在 → 走 `SessionManager.create()` **再建一个**（文件名带时间戳前缀，所以是新名字）。
3. 这条新路径**没有写回记录**，`record.sessionFile` 仍然指向第 1 步的幽灵路径。
4. 消息其实写进了新文件，但下一次冷启动的 `existsSync` 还是 false → 又建第三个……

同一个会话 id 下的文件（实测）：

```text
sessions/2026-10-29T17-57-54-326Z_<id>.jsonl   ← 记录指向它，磁盘上永远不存在
sessions/2026-10-29T17-58-40-991Z_<id>.jsonl   ← 真实历史（ping/pong）在这里，没人引用
```

只要「建会话后没发消息就重启过」，就会掉进这个状态。
之后的每一轮消息都写在一个记录不再指向的文件里，重启即丢。

## 修复

`server/conversation/service.ts`，`ensureManagedSession()` 冷启动分支：
新建 `SessionManager` 后把 `sessionId` / `sessionFile` 写回记录。

```ts
} else {
  sessionManaged = SessionManager.create(
    conversationRecord.workspaceDir,
    this.globalConfig.sessionsDir,
    { id: conversationId },
  );
  // SessionManager 的 jsonl 是懒创建的：记录里的路径可能是「新建后还没发过消息」的幽灵路径。
  // 必须把新建出的真实路径写回记录，否则每次冷启动都会再建一个新文件，
  // 真实历史留在没人引用的旧文件里（表现为重启后消息全丢）。
  const createdSessionFile = sessionManaged.getSessionFile();
  if (createdSessionFile) {
    conversationRecord.sessionId = sessionManaged.getSessionId();
    conversationRecord.sessionFile = createdSessionFile;
    await this.conversationReposity.update(conversationId, {
      sessionId: conversationRecord.sessionId,
      sessionFile: conversationRecord.sessionFile,
    });
  }
}
```

## 验证

脚本按「幽灵路径」场景走完整链路（每步之间 kill 进程重启）：

| 步骤 | 修复前 | 修复后 |
| --- | --- | --- |
| 新建会话，记录里的 sessionFile 存在？ | `false`（幽灵） | `false`（幽灵） |
| 冷启动后记录的 sessionFile | **未变**（仍指向幽灵） | 更新为新建的真实路径 |
| 发消息后的快照 | messages: 3 | messages: 3 |
| 再次冷启动后的快照 | **messages: 0** | **messages: 3** |
| 技能选择 `activeSkillNames` | 丢失 | 保留 `["code-review"]` |

修复后 `record.sessionFile` 与磁盘文件一一对应，不再产生孤儿文件。

## 关联修复（同一次改动）

同一轮里还修了三个同一处的技能接入问题，都在这条冷启动分支附近：

1. `release()` 里误删 `conversationRecord` —— 切换技能时先删记录再 `update`，
   必然抛 `not conversationRecord`，且会话从列表里消失。现在记录只由 `delete()` 删除。
2. `ensureSkill(undefined)` 返回 `[]` 而不是「未指定」—— 客户端不发 `skills` 字段时，
   每发一条消息就把已选技能清空一次。现在 `undefined = 保持现状`。
3. `POST /message` 把缺失的 `skills` 解析成 `[]`（且吞掉 JSON 解析错误）——
   与上一条叠加会把技能静默清掉。现在缺失即 `undefined`，非法 JSON 直接报错。