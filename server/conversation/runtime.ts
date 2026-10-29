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
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import type { GlobalConfig } from "@server/config";
import type { ConversationRecord } from "./types.ts";
import { Type } from "@earendil-works/pi-ai";

const SYSTEM_PROMPT = `hi, this is miki's person agent`;

export interface RuntimeOptions {
  conversationRecord: ConversationRecord;
  globalConfig: GlobalConfig;
  modelRuntime: ModelRuntime;
  sessionManager: SessionManager;
  selectedSkills?: string[];
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
  const {
    conversationRecord,
    globalConfig,
    modelRuntime,
    sessionManager,
    selectedSkills = [],
  } = option;
  const selectedSkillsSet = new Set(selectedSkills);
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
        extensionFactories: [
          async (pi) => {
            const packageName = "pi-mcp-adapter";
            const { createMcpAdapter } = (await import(packageName)) as {
              createMcpAdapter(options: {
                configPath: string;
              }): ExtensionFactory;
            };
            await createMcpAdapter({ configPath: globalConfig.mcpConfigPath })(
              pi,
            );
          },
        ],
        noSkills:true,
        additionalSkillPaths:[globalConfig.skillsDir],
        skillsOverride:(base)=>{
          return{
            ...base,
            skills: base.skills.filter((skill)=> selectedSkillsSet.has(skill.name))
          }
        }
      },
    });
    const agentSession = await createAgentSessionFromServices({
      services,
      sessionManager: runtimeSessionManager,
      customTools: [utcTimeTool],
    });

    await agentSession.session.bindExtensions({});
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
