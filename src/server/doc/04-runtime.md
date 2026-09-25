# 04-runtime — createAgentSessionRuntime 胶水层

> 前置阅读：[03-requirements.md](./03-requirements.md)

---

## 1. 一句话定位

`runtime.ts` 是一个**胶水层**：把本项目的 `GlobalConfig` + `ConversationRecord` + `ModelRuntime` 翻译成 pi-coding-agent 库需要的 `CreateAgentSessionRuntimeFactory`，然后交给库的 `createAgentSessionRuntime()` 启动 Agent 运行时。

---

## 2. 调用链路

```
createAgentSessionRuntime(factory, options)     ← 库提供
       │                      │
       │                      └── options: { cwd, agentDir, sessionManager }
       │                             库用这些参数调你的 factory
       │
       └── factory: CreateAgentSessionRuntimeFactory  ← 你实现
                │
                ├── createAgentSessionServices  ──→  services + diagnostics
                │
                └── createAgentSessionFromServices ──→  session + extensionsResult
                │
                └── return { ...spread, services, diagnostics }
                         └── 拼成 CreateAgentSessionRuntimeResult
```

---

## 3. 类型继承链

```typescript
// 父类型（来自 sdk.d.ts）
interface CreateAgentSessionResult {
    session: AgentSession;                   // ← createAgentSessionFromServices 提供
    extensionsResult: LoadExtensionsResult;  // ← createAgentSessionFromServices 提供
    modelFallbackMessage?: string;
}

// 子类型（来自 agent-session-runtime.d.ts）
interface CreateAgentSessionRuntimeResult extends CreateAgentSessionResult {
    services: AgentSessionServices;                  // ← createAgentSessionServices 提供
    diagnostics: AgentSessionRuntimeDiagnostic[];    // ← createAgentSessionServices 提供
}
```

---

## 4. 三层职责

| 层 | 谁提供 | 干什么 |
| ---- | -------- | -------- |
| `createAgentSessionRuntime` | 库 | 拿你的 factory，启动并管理 AgentSession 生命周期 |
| `CreateAgentSessionRuntimeFactory` | 库定义 type，你实现 | 把 cwd/config 翻译成 AgentSession |
| `createAgentSessionServices` + `createAgentSessionFromServices` | 库提供，你调用 | 分别产出返回值所需的两组字段 |

---

## 5. 为什么需要两个库函数而不是一个

`CreateAgentSessionRuntimeResult` 需要 4 个必须字段，但没有一个库函数能一次返回全部：

| 必须字段 | 来源 |
| ---------- | ------ |
| `session` | `createAgentSessionFromServices` 的返回值 |
| `extensionsResult` | `createAgentSessionFromServices` 的返回值 |
| `services` | `createAgentSessionServices` 的返回值 |
| `diagnostics` | `createAgentSessionServices` 的返回值里 `services.diagnostics` |

两个函数各管一半，你的 factory 负责把它们拼在一起 return。

---

## 6. 四种"实现"形式速查

| 库的代码 | 你需要做什么 | 本例 |
| --------- | ------------- | ------ |
| `type X = (a: A) => B` | 写一个函数赋值 | `CreateAgentSessionRuntimeFactory` |
| `interface X { ... }` | 创建满足形状的对象 | `GlobalConfig`、`ConversationRecord` |
| `abstract class X` | `class Y extends X` 实现抽象方法 | 本项目未使用 |
| `function f(cb: (x) => y)` | 调用 `f` 时传一个函数 | `createAgentSessionRuntime(factory, ...)` |
| `class X`（非 abstract） | 直接用 `new X()`，不需要实现 | `SessionManager.create(...)` |
