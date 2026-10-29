export type RuntimeStatus =
  | "ready"
  | "running"
  | "stopping"
  | "error"
  | "cold"
  | "compacting";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
export type { ThinkingLevel };

export type EventType =
  | "runtime.status"
  | "runntime_settled"
  | "runntime_error"
  | "thinking_started"
  | "thinking_delta"
  | "thinking_completed"
  | "message_started"
  | "message_delta"
  | "message_add"
  | "message_completed"
  | "tool_started"
  | "tool_updated"
  | "tool_completed";

export interface StreamEvent<T = unknown> {
  id: number;
  streamId: string;
  type: EventType;
  payload: T;
}

export interface ChatImage {
  type: "image";
  mimeType: string;
  data: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  images: ChatImage[];
  status?: "pending" | "streaming" | "error";
}

export interface ToolRun {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "success" | "error";
  result?: string;
  details?: unknown;
}

export interface ThinkingBlock {
  id: string;
  text: string;
  completed?: boolean;
}

export type MessageListToolItem = {
  id: string;
  kind: "tool";
  tool: ToolRun;
  seqId?: number;
};

export type MessageListItem =
  | { id: string; kind: "message"; message: ChatMessage; seqId?: number }
  | { id: string; kind: "Thinking"; thinking: ThinkingBlock; seqId?: number }
  | MessageListToolItem;

export interface ConversationSummary {
  id: string;
  title: string;
  createAt: string;
  updateAt: string;
  workspaceDir: string;
  parentId?: string;
  status: RuntimeStatus;
}

export interface ConversationSnapshot {
  conversationSummary: ConversationSummary;
  activeSkillNames: string[];
  messageList: MessageListItem[];
  model: { provider: string; id: string };
  thinkingLevel: ThinkingLevel;
  availableThinkingLevels: ThinkingLevel[];
  status: RuntimeStatus;
  error?: string;
  stream: { id: string; seqId: number };
  diagnostics: string[];
}

export interface CreateConversationResponse {
  conversation: { id: string };
  model: { provider: string; id: string };
  thinkingLevel: ThinkingLevel;
  stream: { id: string; seqId: number };
  diagnostics: string[];
}

export interface ModelOption {
  provider: string;
  id: string;
  name: string;
  contextWindow: number;
  reasoning: boolean;
  imageInput: boolean;
}

export interface SkillOption {
  name: string;
  description: string;
  /** true 表示该技能不会写进 system prompt，只能由用户显式指定 */
  disableModelInvocation: boolean;
}

/** GET /api/skills 的返回：可用技能 + 加载过程中的告警 */
export interface SkillListResponse {
  skills: SkillOption[];
  warnings: string[];
}

export interface RepositoryInfo {
  branch: string;
  commit: string;
}

export interface BootstrapData {
  models: ModelOption[];
  repository?: RepositoryInfo;
}

export interface ConversationConfig {
  model: { provider: string; id: string };
  models: ModelOption[];
  thinkingLevel: ThinkingLevel;
  availableThinkingLevels: ThinkingLevel[];
  /** 当前会话已选中的技能名 */
  activeSkillNames: string[];
  /** 可供选择的技能 */
  skills: SkillOption[];
}

export interface ConversationConfigUpdate {
  model?: {
    provider: string;
    id: string;
  };
  thinkingLevel?: ThinkingLevel;
  /** 覆盖当前会话的技能选择；传 [] 表示清空 */
  skills?: string[];
}
