export type RuntimeStatus = "ready" | "running" | "stopping" | "error" | "cold";
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
  status: "pending" | "streaming" | "error";
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
  messageList: MessageListItem[];
  model: { provider: string; id: string };
  thinkingLevel: ThinkingLevel;
  availableThinkingLevels: ThinkingLevel[];
  status:RuntimeStatus;
  error?:string;
  stream:{id:string;seqId:number};
  diagnostics:string[];
}

export interface CreateConversationResponse{
  conversation:{id:string};
  model:{provider:string;id:string};
  thinkingLevel:ThinkingLevel;
  stream:{id:string;seqId:number};
  diagnostics:string[]
}
