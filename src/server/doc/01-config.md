# config.ts 详设

## 接口

```typescript
interface GlobalConfig {
    rootDir: string;
    recordsDir: string;
    sessionsDir: string;
    workspacesDir: string;
}
```

## 为什么是 4 个字段而不是 1~2 个？

三个子目录对应三种**不同读写模式**的数据，合并会导致：

| 维度 | records | sessions | workspaces |
|------|---------|----------|-------------|
| **格式** | 单个 JSON 文件 | JSONL（追加行） | 完整目录树 |
| **写模式** | 全量覆盖 | 尾部追加 | 任意文件操作 |
| **读模式** | 按 ID 随机读 | 按时间顺序读 | 全文件系统读 |
| **大小** | KB 级 | MB 级 | 可达 GB 级 |

- **只设 rootDir**：所有数据混在一起，清理/备份无法区分，UUID 命名的 record 文件和 workspace 目录冲突
- **只拆两个**：无论怎么两两合并，都会有一个目录里读写模式不一致（比如 records + sessions 放一起，遍历 records 时被 JSONL 文件干扰）

## `getGlobalConfig()`

```typescript
function getGlobalConfig(rootDir = process.env.PI_CHAT_ROOT_DIR): GlobalConfig
```

- 默认 `rootDir`：`join(getAgentDir(), 'pi-chat')`，即 `~/.pi/agent/pi-chat/`
- 可通过环境变量 `PI_CHAT_ROOT_DIR` 覆盖
- 返回的 4 个字段都是对 `rootDir` 的纯派生（`join(rootDir, 'xxx')`），不会产生不一致

## `ensureDir(paths: string[])`

并行建目录（`mkdir -p`），启动时一次性确保目录结构存在：

```typescript
await ensureDir([config.recordsDir, config.sessionsDir, config.workspacesDir]);
```

## `assertInside(parentDir, candidateDir)`

路径遍历防护，确保 `candidateDir` 解析后确实在 `parentDir` 内部：

```typescript
function assertInside(parentDir: string, candidateDir: string): string
```

- `resolve` 两个路径后，检查 `relative(parent, child)` 结果
- 拒绝：`''`（等于 parent）、`..` 开头（在 parent 外）、绝对路径
- 返回解析后的安全路径，方便调用方直接使用

这个函数之所以独立出来而不是内联，是因为三个子目录都可以作为 `parentDir` 参数传入，各自充当不同数据域的"沙箱边界"。