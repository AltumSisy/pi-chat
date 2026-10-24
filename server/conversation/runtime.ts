import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  defineTool,
} from "@earendil-works/pi-coding-agent";
import type { GlobalConfig } from "@server/config";
import type { ConversationRecord } from "./types.ts";
import { Type } from "@earendil-works/pi-ai";

const SYSTEM_PROMPT = `hi, this is a special agent`;

export interface RuntimeOptions {
  conversationRecord: ConversationRecord;
  globalConfig: GlobalConfig;
  modelRuntime: ModelRuntime;
  sessionManager: SessionManager;
}

const utcTimeTool = defineTool({
  name: "utc_time",
  label: "utc_time",
  description: "return the current time",
  parameters: Type.Object({}),
  execute: async () => {
    return {
      content: [{ type: "text", text: new Date().toISOString() }],
      details: {},
    };
  },
});

export async function createRuntime(
  option: RuntimeOptions,
): Promise<AgentSessionRuntime> {
  const { conversationRecord, globalConfig, modelRuntime, sessionManager } =
    option;

  let runtimeSessionManager: SessionManager = sessionManager;
  if (!runtimeSessionManager) {
    runtimeSessionManager = SessionManager.create(
      conversationRecord.workspaceDir,
      globalConfig.sessionsDir,
      { id: conversationRecord.id },
    );
  }

  const factory: CreateAgentSessionRuntimeFactory = async ({
    cwd,
    agentDir,
    sessionManager: runtimeSessionManager,
  }) => {
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      modelRuntime,
      resourceLoaderOptions: {
        noExtensions: true,
        systemPromptOverride: () => SYSTEM_PROMPT,
      },
    });
    const agentSession = await createAgentSessionFromServices({
      services,
      sessionManager: runtimeSessionManager,
      customTools: [utcTimeTool],
    });
    return {
      ...agentSession,
      services,
      diagnostics: services.diagnostics,
    };
  };

  return createAgentSessionRuntime(factory, {
    cwd: conversationRecord.workspaceDir,
    agentDir: getAgentDir(),
    sessionManager: sessionManager,
  });
}
