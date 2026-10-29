import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { ensureDir, getGlobalConfig } from "./config.ts";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { ConversationService } from "./conversation/service.ts";
import { ConversationReposity } from "./conversation/repository.ts";
import { writeFile } from "fs/promises";

const globalConfig = getGlobalConfig();
await ensureDir([globalConfig.rootDir, globalConfig.skillsDir]);
await writeFile(
  globalConfig.mcpConfigPath,
  JSON.stringify({ mcpServers: {} }, null, 2),
  {
    flag: "wx",
  },
).catch((error: NodeJS.ErrnoException) => {
  if (error.code !== "EEXIST") throw error;
});
const modelRuntime = await ModelRuntime.create();
const conversationReposity = new ConversationReposity(globalConfig);
const service = new ConversationService(
  globalConfig,
  conversationReposity,
  modelRuntime,
);
const app = createApp(service);
const host = process.env.PI_CHAT_HOST ?? "127.0.0.1";
const port = Number(process.env.PI_CHAT_PORT ?? 4328);
const server = serve(
  {
    fetch: app.fetch,
    hostname: host,
    port,
  },
  (info) => {
    process.stdout.write(
      `Pi Chat API listening on http://${host}:${info.port}\n`,
    );
  },
);

let closing = false;

/**
 * 进程生命周期诊断。
 * 服务“跑一会儿自己退出”时，看日志最后几行即可区分原因：
 *   信号（SIGINT/SIGTERM）/ 未捕获异常 / 事件循环耗尽 / 依赖主动 process.exit
 */
function logLifecycle(message: string) {
  process.stderr.write(`[lifecycle] ${message}\n`);
}

const originalExit = process.exit.bind(process);
process.exit = ((code?: number) => {
  logLifecycle(
    `process.exit(${code ?? 0})${code ? `\n${new Error("exit trace").stack ?? ""}` : ""}`,
  );
  return originalExit(code as number);
}) as typeof process.exit;

process.on("beforeExit", (code) => {
  logLifecycle(`事件循环已空（无活跃句柄），进程即将退出 code=${code}`);
});

process.on("unhandledRejection", (reason) => {
  logLifecycle(
    `unhandledRejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`,
  );
  if (process.env.NODE_ENV === "production") originalExit(1);
});

process.on("uncaughtException", (error) => {
  logLifecycle(`uncaughtException: ${error.stack ?? error.message}`);
  if (process.env.NODE_ENV === "production") originalExit(1);
});

async function shutdown() {
  if (closing) return;
  closing = true;
  logLifecycle("开始关闭 HTTP 服务…");
  server.close(() => process.exit(0));
}

function handleShutdown(signal: string) {
  logLifecycle(`捕获退出信号 ${signal}`);
  shutdown().catch((error) => {
    process.stderr.write(
      `Shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));
