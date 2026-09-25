import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";
import type { GlobalConfig } from "@server/config";
import type { ConversationRecord } from "./types.ts";

const SYSTEM_PROMPT = `hi, this is a special agent`;

export interface RuntimeOptions {
  conversationRecord: ConversationRecord;
  globalConfig: GlobalConfig;
  modelRuntime: ModelRuntime;
  sessionManager: SessionManager;
}

export async function createRuntime(
  option: RuntimeOptions,
): Promise<AgentSessionRuntime> {
  const { conversationRecord, globalConfig, modelRuntime, sessionManager } =
    option;

  let runtimeSessionManager:SessionManager = sessionManager;
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
    sessionManager:runtimeSessionManager,
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
      sessionManager:runtimeSessionManager,
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
