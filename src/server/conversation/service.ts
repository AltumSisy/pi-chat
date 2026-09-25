import { SessionManager, ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ConversationRecord, ManagerSession } from "./types.ts";
import type { GlobalConfig } from "@server/config";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ConversationReposity } from "./repository.ts";
import { createRuntime } from "./runtime.ts";
import { EventChannel } from "@server/conversation/channel.ts";
import type { TextContent, ImageContent } from "@earendil-works/pi-ai";
import type { ConversationSnapshot, RuntimeStatus } from "@shared/types.ts";
import { isImagePart, resultText } from "./helpr.ts";
import { existsSync } from "node:fs";
import { title } from "node:process";

export class ConversationService {
  private globalConfig: GlobalConfig;
  private conversationReposity: ConversationReposity;
  private modelRuntime: ModelRuntime;
  private readonly channels = new Map<string, EventChannel>();
  private readonly sessionManager = new Map<string, ManagerSession>();

  constructor(
    globalCongif: GlobalConfig,
    conversationReposity: ConversationReposity,
    modelRuntime: ModelRuntime,
  ) {
    this.globalConfig = globalCongif;
    this.conversationReposity = conversationReposity;
    this.modelRuntime = modelRuntime;
  }

  async createConversation(): Promise<ManagerSession> {
    const conversationId = randomUUID();
    const conversationWorksapceDir = join(
      this.globalConfig.workspacesDir,
      conversationId,
    );

    const sessionManager = SessionManager.create(
      conversationWorksapceDir,
      this.globalConfig.sessionsDir,
      { id: conversationId },
    );

    const currentDate = new Date().toDateString();

    const conversationRecord: ConversationRecord = {
      id: conversationId,
      title: `New Conversation`,
      workspaceDir: conversationWorksapceDir,
      sessionId: sessionManager.getSessionId(),
      sessionFile: sessionManager.getSessionFile()!,
      createdAt: currentDate,
      updatedAt: currentDate,
    };

    await this.conversationReposity.save(conversationRecord);

    return this.createManagerSession(conversationRecord, sessionManager);
  }

  async send(conversationId: string, userInput: string) {
    const cleanedUserInput = userInput.trim();
    if (!cleanedUserInput || cleanedUserInput.length === 0)
      throw new Error("user input is empty");
    const managedSession = await this.ensureManagedSession(conversationId);
    managedSession.runtime.session.prompt(cleanedUserInput);
  }
  //glue with pi
  private async createManagerSession(
    conversationRecord: ConversationRecord,
    sessionManager: SessionManager,
  ): Promise<ManagerSession> {
    const runtime = await createRuntime({
      conversationRecord,
      globalConfig: this.globalConfig,
      modelRuntime: this.modelRuntime,
      sessionManager,
    });

    const managerSession: ManagerSession = {
      id: conversationRecord.id,
      runtime: runtime,
      channel: this.getEventChannel(conversationRecord.id),
      status: runtime.session.isStreaming ? "running" : "ready",
      diagnostics: runtime.diagnostics.map((item) => item.message),
    };
    this.sessionManager.set(managerSession.id, managerSession);
    this.bind(managerSession);
    return managerSession;
  }

  public async snapshot(id: string): Promise<ConversationSnapshot> {
    const restoredConversationRecord = await this.conversationReposity.get(id);
    if (!restoredConversationRecord)
      throw new Error(`conversationRecord with ${id} is not found `);
    const managedSession = await this.ensureManagedSession(id);
    const session = managedSession.runtime.session;
    const channel = managedSession.channel;
    return {
      conversationSummary: this.summary(
        restoredConversationRecord,
        managedSession.status,
      ),
      messageList: [],
      model: {
        provider: session.agent.state.model.provider,
        id: session.agent.state.model.id,
      },
      thinkingLevel: session.agent.state.thinkingLevel,
      availableThinkingLevels: session.getAvailableThinkingLevels(),
      status: managedSession.status,
      error: managedSession.error,
      stream: { id: channel.streamId, seqId: channel.lastId() },
      diagnostics: managedSession.diagnostics,
    };
  }

  private summary(
    conversationRecord: ConversationRecord,
    runtimeStatus: RuntimeStatus,
  ) {
    return {
      id: conversationRecord.id,
      title: conversationRecord.title,
      createAt: conversationRecord.createdAt,
      updateAt: conversationRecord.updatedAt,
      workspaceDir: conversationRecord.workspaceDir,
      status: runtimeStatus,
    };
  }

  public getEventChannel(conversationId: string): EventChannel {
    let channel = this.channels.get(conversationId);
    if (!channel) {
      channel = new EventChannel();
    }
    this.channels.set(conversationId, channel);
    return channel;
  }

  private bind(managerSession: ManagerSession) {
    managerSession.unsubscribe?.();
    managerSession.runtime.session.subscribe((event) => {
      switch (event.type) {
        case "agent_start":
          this.setStatus(managerSession, "running");
          break;
        case "message_start":
          const message = event.message;
          if (message.role == "assistant") {
            managerSession.streamMessageId = randomUUID();
            managerSession.streamThinkingId = undefined;
            managerSession.channel.publish("message_started", {
              id: managerSession.streamMessageId,
            });
          } else if (message.role === "user") {
            const content: (TextContent | ImageContent)[] =
              typeof message.content === "string"
                ? [{ type: "text", text: message.content }]
                : message.content;
            const text = content
              .filter((part) => part.type === "text")
              .map((part) => part.text ?? "")
              .join("");
            const image = content.filter(isImagePart).map((part) => ({
              type: "image",
              data: part.data,
              MIMEType: part.mimeType,
            }));
            managerSession.channel.publish("message_add", {
              id: randomUUID(),
              role: "user",
              text: text,
              images: image,
            });
          }
          break;

        case "message_update":
          if (event.assistantMessageEvent.type === "thinking_start") {
            managerSession.streamThinkingId = randomUUID();
            managerSession.channel.publish("thinking_started", {
              id: managerSession.streamThinkingId,
            });
          }
          if (event.assistantMessageEvent.type === "thinking_delta") {
            managerSession.channel.publish("thinking_delta", {
              id: managerSession.streamThinkingId,
              text: event.assistantMessageEvent.delta,
            });
          }
          if (event.assistantMessageEvent.type === "thinking_end") {
            managerSession.channel.publish("thinking_completed", {
              id: managerSession.streamThinkingId,
              text: event.assistantMessageEvent.content,
              completed: true,
            });
          }
          if (event.assistantMessageEvent.type === "text_delta") {
            managerSession.channel.publish("message_delta", {
              id: managerSession.streamMessageId,
              text: event.assistantMessageEvent.delta,
            });
          }
          break;
        case "message_end":
          if (event.message.role === "assistant") {
            managerSession.channel.publish("message_completed", {
              id: managerSession.streamMessageId,
            });
            managerSession.streamMessageId = undefined;
          }
          break;
        case "tool_execution_start":
          managerSession.channel.publish("tool_started", {
            id: event.toolCallId,
            name: event.toolName,
            args: event.args,
          });
          break;
        case "tool_execution_update":
          managerSession.channel.publish("tool_updated", {
            id: event.toolCallId,
            name: event.toolName,
            args: event.args,
            status: "running",
            result: resultText(event.partialResult),
            details: event.partialResult,
          });
          break;
        case "tool_execution_end":
          managerSession.channel.publish("tool_completed", {
            id: event.toolCallId,
            name: event.toolName,
            status: event.isError ? "error" : "success",
            result: resultText(event.result), //event.result,
            isError: event.isError,
          });
          break;
        case "agent_end":
        case "turn_start":
          break;
        case "turn_end":
          break;
        case "agent_settled":
          managerSession.streamMessageId = undefined;
          managerSession.streamThinkingId = undefined;
          this.setStatus(managerSession, "ready");
          managerSession.channel.publish("runntime_settled", {});
          break;
        case "queue_update":
          break;
        case "compaction_start":
          break;
        case "entry_appended":
          break;
        case "session_info_changed":
          break;
        case "thinking_level_changed":
          break;
        case "compaction_end":
          break;
        case "auto_retry_start":
          break;
        case "auto_retry_end":
          break;
        case "summarization_retry_scheduled":
          break;
        case "summarization_retry_attempt_start":
          break;
        case "summarization_retry_finished":
          break;
        case "bash_execution_update":
          break;
        default:
          break;
      }
    });
  }

  private setStatus(managedSession: ManagerSession, status: RuntimeStatus) {
    managedSession.status = status;
    if (status !== "error") managedSession.error = undefined;
    managedSession.channel.publish("runtime.status", { status });
  }

  private async ensureManagedSession(conversationId: string) {
    let restoredSessionManaged = this.sessionManager.get(conversationId);
    if (restoredSessionManaged) return restoredSessionManaged;

    const conversationRecord =
      await this.conversationReposity.get(conversationId);
    if (!conversationRecord) throw new Error(`Conversation not found`);
    const restoredSessionFile = conversationRecord.sessionFile;
    let sessionManaged: SessionManager;
    if (existsSync(restoredSessionFile)) {
      sessionManaged = SessionManager.open(
        restoredSessionFile,
        this.globalConfig.sessionsDir,
        conversationRecord.workspaceDir,
      );
    } else {
      sessionManaged = SessionManager.create(
        conversationRecord.workspaceDir,
        this.globalConfig.sessionsDir,
        { id: conversationId },
      );
    }

    return this.createManagerSession(conversationRecord, sessionManaged);
  }
}
