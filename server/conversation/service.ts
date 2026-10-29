import {
  SessionManager,
  ModelRuntime,
  loadSkillsFromDir,
} from "@earendil-works/pi-coding-agent";
import type { ConversationRecord, ManagerSession } from "./types.ts";
import type { GlobalConfig } from "@server/config";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ConversationReposity } from "./repository.ts";
import { createRuntime } from "./runtime.ts";
import { EventChannel } from "./channel.ts";
import type { TextContent, ImageContent } from "@earendil-works/pi-ai";
import type {
  ConversationConfig,
  ConversationConfigUpdate,
  ConversationSnapshot,
  ConversationSummary,
  RuntimeStatus,
  SkillListResponse,
  SkillOption,
} from "@shared/types.ts";
import { hasSameStringItems } from "@server/utils";
import { ConversationViewBuild, isImagePart, resultText } from "./helpr.ts";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";


/** 新建会话时的占位标题，一旦有首条用户消息就会被替换 */
const DEFAULT_CONVERSATION_TITLE = "New Conversation";
const TITLE_MAX_LENGTH = 24;

/** 从首条用户输入里挤出一个短标题：取第一行非空内容并截断 */
function titleFromInput(userInput: string): string {
  const firstLine = userInput.split("\n").find((line) => line.trim()) ?? "";
  const cleaned = firstLine.replace(/\s+/g, " ").trim();
  if (!cleaned) return DEFAULT_CONVERSATION_TITLE;
  return cleaned.length <= TITLE_MAX_LENGTH
    ? cleaned
    : `${cleaned.slice(0, TITLE_MAX_LENGTH)}…`;
}

/** 历史记录是 toDateString()（天粒度），新记录是 ISO，两种都要能比较 */
function timestampOf(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

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

    await mkdir(conversationWorksapceDir, { recursive: true });

    const sessionManager = SessionManager.create(
      conversationWorksapceDir,
      this.globalConfig.sessionsDir,
      { id: conversationId },
    );

    const currentTimestamp = new Date().toISOString();

    const conversationRecord: ConversationRecord = {
      id: conversationId,
      title: DEFAULT_CONVERSATION_TITLE,
      workspaceDir: conversationWorksapceDir,
      sessionId: sessionManager.getSessionId(),
      sessionFile: sessionManager.getSessionFile()!,
      createdAt: currentTimestamp,
      updatedAt: currentTimestamp,
      selectedSkills: [],
    };

    await this.conversationReposity.save(conversationRecord);

    return this.createManagerSession(conversationRecord, sessionManager);
  }

  async send(conversationId: string, userInput: string, skills?: string[]) {
    const cleanedUserInput = userInput.trim();
    if (!cleanedUserInput || cleanedUserInput.length === 0)
      throw new Error("user input is empty");

    const ensureSkillsName = this.ensureSkill(skills);
    const managedSession = await this.ensureManagedSession(
      conversationId,
      ensureSkillsName,
    );
    // 首条消息顺便给会话起名（只改一次，之后就是用户自己的标题）
    await this.ensureTitle(conversationId, cleanedUserInput);
    managedSession.runtime.session.prompt(cleanedUserInput);
  }

  /**
   * 校验并使用显式传入的技能名。
   * 返回 undefined 表示「本次请求没有指定技能」，调用方应沿用当前/持久化的选择；
   * 返回数组（可能是空数组）表示调用方显式指定了选择。
   */
  private ensureSkill(skills?: string[]): string[] | undefined {
    if (!skills) return undefined;
    return this.resolveSkills(skills);
  }

  /** 校验技能名：未知名字直接报错，避免「选了但静默不生效」 */
  private resolveSkills(skills: string[]): string[] {
    const availableSkillsSet = new Set(
      this.getAvailableSkills().skills.map((skill) => skill.name),
    );
    const unknownSkills = skills.filter(
      (skill) => !availableSkillsSet.has(skill),
    );
    if (unknownSkills.length > 0)
      throw new Error(
        `unknown skill(s): ${unknownSkills.join(", ")}; available skills: ${[...availableSkillsSet].join(", ") || "(none)"}`,
      );
    return [...new Set(skills)];
  }
  //glue with pi
  private async createManagerSession(
    conversationRecord: ConversationRecord,
    sessionManager: SessionManager,
    selectedSkills: string[] = [],
  ): Promise<ManagerSession> {
    const runtime = await createRuntime({
      conversationRecord,
      globalConfig: this.globalConfig,
      modelRuntime: this.modelRuntime,
      sessionManager,
      selectedSkills,
    });

    const managerSession: ManagerSession = {
      id: conversationRecord.id,
      runtime: runtime,
      channel: this.getEventChannel(conversationRecord.id),
      status: runtime.session.isStreaming ? "running" : "ready",
      diagnostics: runtime.diagnostics.map((item) => item.message),
      activeSkillNames: [...selectedSkills],
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

    const branch = session.sessionManager.getBranch();
    const builder = new ConversationViewBuild(branch);
    const messageList = builder.build();
    return {
      conversationSummary: this.summary(
        restoredConversationRecord,
        managedSession.status,
      ),
      activeSkillNames: [...managedSession.activeSkillNames],
      messageList: messageList,
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

  /**
   *
   * 获取会话列表
   * @returns
   */
  async list(): Promise<ConversationSummary[]> {
    const conversationRecords = await this.conversationReposity.list();
    return conversationRecords
      .map((record) =>
        this.summary(
          record,
          this.sessionManager.get(record.id)?.status ?? "cold",
        ),
      )
      .sort((a, b) => timestampOf(b.updateAt) - timestampOf(a.updateAt));
  }

  /**
   *
   * 删除会话
   * @param conversationId
   * @returns
   */
  async delete(conversationId: string) {
    const conversationRecord =
      await this.conversationReposity.get(conversationId);
    if (!conversationRecord) return;

    const sessionManager = this.sessionManager.get(conversationId);
    if (sessionManager && this.isBusy(sessionManager)) {
      throw new Error(
        `can not delete conversation ${conversationId},it status is busy`,
      );
    }

    /**
     * records -> xx.json
     * session -> xx.jsonl
     * workspaces -> xx ->xx.
     */
    if (existsSync(conversationRecord.sessionFile)) {
      await rm(conversationRecord.sessionFile, { force: true });
    }
    await rm(conversationRecord.workspaceDir, { force: true, recursive: true });

    await this.conversationReposity.delete(conversationId);
    this.release(conversationId);
    this.sessionManager.delete(conversationId);
    this.channels.delete(conversationId);
  }

  /**
   *
   * 重命名
   * @param conversationId
   * @param title
   * @returns
   */
  public async rename(
    conversationId: string,
    title: string,
  ): Promise<ConversationSummary> {
    const cleanedTitle = title.trim();
    if (!cleanedTitle) throw Error(`title cannot be empty`);
    const newConversatioRecord = await this.conversationReposity.update(
      conversationId,
      {
        title: cleanedTitle,
      },
    );
    return this.summary(
      newConversatioRecord,
      this.sessionManager.get(conversationId)?.status ?? "cold",
    );
  }

  public async abort(conversationId: string) {
    const managedSession = await this.ensureManagedSession(conversationId);
    if (!this.isBusy(managedSession)) return;
    this.setStatus(managedSession, "stopping");
    managedSession.runtime.session.abort();
    this.setStatus(managedSession, "ready");
  }

  /** 会话还是默认标题时，用首条用户消息生成标题 */
  private async ensureTitle(conversationId: string, userInput: string) {
    const conversationRecord =
      await this.conversationReposity.get(conversationId);
    if (!conversationRecord) return;
    if (conversationRecord.title !== DEFAULT_CONVERSATION_TITLE) return;
    await this.conversationReposity.update(conversationId, {
      title: titleFromInput(userInput),
    });
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

  /**
   * 更新配置
   * @param conversationId
   * @param update
   * @returns
   */
  async updateConfig(
    conversationId: string,
    update: ConversationConfigUpdate,
  ): Promise<ConversationConfig> {
    // 技能选择变化会重建 runtime，交给 ensureManagedSession 处理（它自带 busy 检查）
    const selectedSkills = this.ensureSkill(update.skills);
    const managerSession = await this.ensureManagedSession(
      conversationId,
      selectedSkills,
    );
    if (this.isBusy(managerSession))
      throw new Error(
        `cannot update config for this conversation ${conversationId} because it is busy`,
      );
    const session = managerSession.runtime.session;

    // 先切模型：setModel 会按新模型的能力收敛 thinkingLevel
    if (update.model) {
      const target = update.model;
      const model = this.availableModels(managerSession).find(
        (item) => item.provider === target.provider && item.id === target.id,
      );
      if (!model) {
        throw new Error(
          `model ${target.provider}/ ${target.id} is not available`,
        );
      }
      await session.setModel(model);
    }

    // 再应用推理强度：必须相对（可能刚刚切换的）当前模型校验
    if (update.thinkingLevel) {
      if (!session.getAvailableThinkingLevels().includes(update.thinkingLevel))
        throw new Error(
          `Thinking level ${update.thinkingLevel} is not available`,
        );
      session.setThinkingLevel(update.thinkingLevel);
    }
    return this.getConfig(conversationId);
  }

  /**
   * 获取配置
   * @param conversationId
   * @returns
   */
  public async getConfig(conversationId: string): Promise<ConversationConfig> {
    const managerSession = await this.ensureManagedSession(conversationId);
    // models.json 只在进程启动 / 新建 session 时加载；这里刷新一次，
    // 新配置的模型无需重启服务即可出现在列表里。
    await this.modelRuntime.refresh({ allowNetwork: false });
    return this.config(managerSession);
  }

  private config(managerSession: ManagerSession): ConversationConfig {
    const sessionManager = managerSession.runtime.session;
    return {
      model: {
        provider: sessionManager.agent.state.model.provider,
        id: sessionManager.agent.state.model.id,
      },
      models: this.availableModels(managerSession).map((item) => {
        return {
          provider: item.provider,
          id: item.id,
          name: item.name,
          contextWindow: item.contextWindow,
          reasoning: item.reasoning,
          imageInput: item.input.includes("image"),
        };
      }),
      thinkingLevel: sessionManager.agent.state.thinkingLevel,
      availableThinkingLevels: sessionManager.getAvailableThinkingLevels(),
      activeSkillNames: [...managerSession.activeSkillNames],
      skills: this.getAvailableSkills().skills,
    };
  }

  private availableModels(managerSession: ManagerSession) {
    const scopedModels = managerSession.runtime.session.scopedModels;
    return scopedModels.length > 0
      ? scopedModels.map((item) => item.model)
      : this.modelRuntime.getAvailableSnapshot();
  }

  /** 读取 skillsDir 下的可用技能，并把加载告警一并带出去 */
  public getAvailableSkills(): SkillListResponse {
    const loadSkillsResult = loadSkillsFromDir({
      dir: this.globalConfig.skillsDir,
      source: "project",
    });
    const skills: SkillOption[] = loadSkillsResult.skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      disableModelInvocation: skill.disableModelInvocation,
    }));
    return {
      skills,
      warnings: loadSkillsResult.diagnostics.map((diagnostic) =>
        diagnostic.path
          ? `${diagnostic.type}: ${diagnostic.message} (${diagnostic.path})`
          : `${diagnostic.type}: ${diagnostic.message}`,
      ),
    };
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
              delta: event.assistantMessageEvent.delta,
            });
          }
          if (event.assistantMessageEvent.type === "thinking_end") {
            managerSession.channel.publish("thinking_completed", {
              id: managerSession.streamThinkingId,
              text: event.assistantMessageEvent.content,
              completed: true,
              /*  */
            });
          }
          if (event.assistantMessageEvent.type === "text_delta") {
            managerSession.channel.publish("message_delta", {
              id: managerSession.streamMessageId,
              delta: event.assistantMessageEvent.delta,
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

  private async ensureManagedSession(
    conversationId: string,
    selectedSkills?: string[],
  ) {
    let restoredSessionManaged = this.sessionManager.get(conversationId);
    //做好sessionManager skill的连贯性
    if (restoredSessionManaged) {
      if (
        !selectedSkills ||
        hasSameStringItems(
          restoredSessionManaged.activeSkillNames,
          selectedSkills,
        )
      ) {
        return restoredSessionManaged;
      }

      if (this.isBusy(restoredSessionManaged))
        throw new Error(
          `session目前是busy状态，cannot be update with new selected skills`,
        );
      //re-create sessionManaged
      const conversationRecord =
        await this.conversationReposity.get(conversationId);
      if (!conversationRecord)
        throw new Error(
          `conversationRecord with id ${conversationId} not found`,
        );
      // 先落盘再重建，避免重建成功但记录没写进去
      await this.conversationReposity.update(conversationId, {
        selectedSkills,
      });
      // sessionManaged & event channel 不能释放
      const sessionManager =
        restoredSessionManaged.runtime.session.sessionManager;
      this.release(conversationId, { dropChannel: false });
      return this.createManagerSession(
        conversationRecord,
        sessionManager,
        selectedSkills,
      );
    }

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
      // SessionManager 的 jsonl 是懒创建的：记录里的路径可能是「新建后还没发过消息」的幽灵路径。
      // 必须把新建出的真实路径写回记录，否则每次冷启动都会再建一个新文件，
      // 真实历史留在没人引用的旧文件里（表现为重启后消息全丢）。
      conversationRecord.sessionId = sessionManaged.getSessionId();
      conversationRecord.sessionFile = sessionManaged.getSessionFile()!;
      await this.conversationReposity.update(conversationId, {
        sessionId: conversationRecord.sessionId,
        sessionFile: conversationRecord.sessionFile,
      });
    }

    // 冷启动时必须把持久化的技能选择带进 runtime，否则重启后技能会丢
    const recordSkills = conversationRecord.selectedSkills ?? [];
    const activeSkills = selectedSkills ?? recordSkills;
    if (selectedSkills && !hasSameStringItems(recordSkills, selectedSkills)) {
      await this.conversationReposity.update(conversationId, { selectedSkills });
    }
    return this.createManagerSession(
      conversationRecord,
      sessionManaged,
      activeSkills,
    );
  }

  private isBusy(managerSession: ManagerSession): boolean {
    return (
      managerSession.runtime.session.agent.state.isStreaming ||
      managerSession.status === "running" ||
      managerSession.status === "stopping" ||
      managerSession.status === "compacting"
    );
  }

  /**
   * 释放内存里的 runtime / session，不动磁盘上的 conversationRecord。
   * 记录只由 delete() 负责删除，否则切换技能时会把会话记录一起删掉。
   */
  private release(
    conversationId: string,
    options: { dropChannel?: boolean } = {},
  ) {
    const managerSession = this.sessionManager.get(conversationId);
    if (!managerSession) return;
    managerSession.unsubscribe?.();
    managerSession.runtime.session.dispose();
    if (options.dropChannel ?? true) {
      this.channels.delete(conversationId);
    }
    this.sessionManager.delete(conversationId);
  }
}
