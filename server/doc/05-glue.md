# 05-glue — 胶水层方法论

> 前置阅读：[04-runtime.md](./04-runtime.md)

---

## 1. 什么是胶水层

**胶水层 = 你的项目与第三方库之间的翻译 + 组装代码。** 它自己不做业务逻辑，只负责把"你的世界"适配成"库的世界"。

```
你的项目                          pi-coding-agent 库
┌──────────────┐                 ┌──────────────────────┐
│ GlobalConfig │──┐          ┌──→│ createAgentSessionRuntime │
│ Conversation │  │  runtime │   │                          │
│ ModelRuntime │──┼─────────→│   │   (库不知道你这些类型)     │
│   ...        │  │   .ts   │   │                          │
└──────────────┘  │  (胶水)  │   └──────────────────────┘
                  └──────────┘
```

类比 Java：Spring MVC 的 `DispatcherServlet` 就是胶水层——它不处理业务，只负责把 HTTP 请求翻译成 Controller 的方法调用。

| 胶水层做的事 | runtime.ts 中的例子 |
| ------------- | ------------------- |
| **翻译** | 把 `GlobalConfig` 拆成 `cwd`、`agentDir` 传给库 |
| **组装** | 调 `createAgentSessionServices` + `createAgentSessionFromServices`，拼成返回值 |
| **适配** | 库要 `SessionManager`，你用 `ConversationRecord` 里的字段去 `SessionManager.create(...)` |

---

## 2. 通用思路：六步法

以后对接任何第三方库，按这六步走就能搭出胶水层。不需要读库源码，`.d.ts` 文件就是完整地图。

### 第一步：找到入口函数

找到你要调用的库的"启动"函数，从它的参数反推。

```typescript
// 你要调这个 →
createAgentSessionRuntime(factory, options)
//                        ↑         ↑
//                    这是什么？   这是什么？
```

---

### 第二步：看参数类型，找到要实现的东西

```typescript
// 跳进第一个参数的类型定义 →
type CreateAgentSessionRuntimeFactory = (options: {
    cwd: string;
    agentDir: string;
    sessionManager: SessionManager;
}) => Promise<CreateAgentSessionRuntimeResult>;
//              ↑
//         返回值要求什么？继续跳 →
```

---

### 第三步：看返回值，逐字段追溯来源

返回值每个字段都不是凭空产生的，一定有个库函数返回它。

```typescript
interface CreateAgentSessionRuntimeResult extends CreateAgentSessionResult {
    services: AgentSessionServices;                // 从哪来？
    diagnostics: AgentSessionRuntimeDiagnostic[];  // 从哪来？
}
```

**方法**：在 `.d.ts` 文件中搜字段的**类型名**，找到返回该类型的函数。

```
我需要 AgentSessionServices
    ↓ 搜 "AgentSessionServices" 出现在哪里
    ↓ 找到 function createAgentSessionServices(...): AgentSessionServices ✅

我需要 AgentSession（来自父类型）
    ↓ 搜 "AgentSession" 出现在哪里
    ↓ 找到 function createAgentSessionFromServices(...): { session: AgentSession, ... } ✅
```

---

### 第四步：看这些函数的入参，从你的世界映射

```typescript
// 库函数签名
createAgentSessionServices(options: {
    cwd: string;           // ← 你的 conversationRecord.workspaceDir
    agentDir: string;      // ← getAgentDir()
    modelRuntime: ...;     // ← 外面传进来的 ModelRuntime
    ...
}): AgentSessionServices;
```

把库函数要的参数 → 从你的 `GlobalConfig` / `ConversationRecord` / 函数入参里拿出来。

---

### 第五步：拼起来 return

```typescript
return {
    ...agentSession,                   // ← 提供 session, extensionsResult
    services,                          // ← 提供 services
    diagnostics: services.diagnostics, // ← 提供 diagnostics
};
```

---

### 第六步：传给入口函数，完成

```typescript
createAgentSessionRuntime(factory, {
    cwd: conversationRecord.workspaceDir,
    agentDir: getAgentDir(),
    sessionManager: sessionManager,
});
```

---

## 3. 流程图

```
① 找到入口函数
   createAgentSessionRuntime(?, ?)
        │
② 看参数 type，找到要实现的东西
   CreateAgentSessionRuntimeFactory
        │
③ 看 type 的返回值
   CreateAgentSessionRuntimeResult
        │
④ 逐字段搜 "谁返回这个类型"
   AgentSessionServices → createAgentSessionServices
   AgentSession         → createAgentSessionFromServices
        │
⑤ 看这些函数的入参
   从 GlobalConfig / ConversationRecord 映射
        │
⑥ 拼 return + 传给入口函数
```

---

## 4. 四种"库要求你实现"的形式速查

| 库的代码 | 你需要做什么 | 本例 |
| --------- | ------------- | ------ |
| `type X = (a: A) => B` | 写一个函数赋值 | `CreateAgentSessionRuntimeFactory` |
| `interface X { ... }` | 创建满足形状的对象，或 `class implements X` | `GlobalConfig`、`ConversationRecord` |
| `abstract class X` | `class Y extends X` 实现抽象方法 | 本项目未使用 |
| `function f(callback: (x) => y)` | 调用 `f` 时传一个函数 | `createAgentSessionRuntime(factory, ...)` |
| `class X`（非 abstract） | 直接用 `new X()`，不需要实现 | `SessionManager.create(...)` |

---

## 5. 常见陷阱

| 陷阱 | 避免方法 |
| ------ | --------- |
| 只看 type 不看 extends | 追到父类型，父类型的字段也要满足 |
| 搜错关键字 | 在 `.d.ts` 中搜**类型名**（大写开头），而不是变量名 |
| 漏了可选字段 | `?` 标记的可选字段可以不提供，但建议看一下是否需要 |
| 以为要自己 new | 大部分库的返回值通过工厂函数产生，不需要你 `new` |
