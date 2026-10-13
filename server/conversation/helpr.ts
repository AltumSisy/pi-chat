import type {
  TextContent,
  ThinkingContent,
  ImageContent,
  ToolCall,
} from "@earendil-works/pi-ai";

import type { AgentToolResult } from "@earendil-works/pi-agent-core";

import type {
  SessionEntry,
  SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";
import type {
  MessageListToolItem,
  ChatImage,
  ChatMessage,
  MessageListItem,
  ToolRun,
  ThinkingBlock,
} from "@shared/types.ts";

type SessionMessage = SessionMessageEntry["message"];
type ConversationMessage = Extract<
  SessionMessage,
  { role: "user" | "assistant" }
>;
type AgentToolResultMessage = Extract<SessionMessage, { role: "toolResult" }>;

type ContentPart = TextContent | ThinkingContent | ImageContent | ToolCall;

export function isImagePart(part: ContentPart): part is ImageContent {
  return part.type === "image" && Boolean(part.data) && Boolean(part.mimeType);
}
export function isToolPart(part: ContentPart): part is ToolCall {
  return part.type === "toolCall" && Boolean(part.id) && Boolean(part.name);
}

export function isTextPart(
  part: TextContent | ImageContent,
): part is TextContent {
  return part.type === "text";
}

export function isAssistTextPart(
  part: TextContent | ThinkingContent | ToolCall,
): part is TextContent {
  return part.type === "text";
}
export function resultText(result?: AgentToolResult<any> | undefined): string {
  const content = result?.content;
  return (
    content
      ?.filter(isTextPart)
      .map((item) => item.text)
      .join("\n") ?? ""
  );
}

function normalizeContent(content: string | ContentPart[]): ContentPart[] {
  if (typeof content === "string") {
    return [
      {
        type: "text",
        text: content,
      },
    ];
  }
  return content;
}

export class ConversationViewBuild {
  private readonly entries: SessionEntry[];
  private readonly messageItem: MessageListItem[] = [];
  private readonly toolsByCallId = new Map<string, MessageListToolItem>();
  constructor(entries: SessionEntry[]) {
    this.entries = entries;
  }

  build(): MessageListItem[] {
    for (const entry of this.entries) {
      this.processEntry(entry);
    }
    return this.messageItem;
  }

  private processEntry(entry: SessionEntry) {
    if (entry.type != "message") return;

    const message = entry.message;

    if (message.role === "user") {
      this.addUserMessage(entry, message);
    }

    if (message.role === "assistant") {
      this.addAssistantMessage(entry, message);
    }

    if (message.role === "toolResult") {
      this.updateToolResult(message);
    }
  }

  private addUserMessage(
    entry: SessionMessageEntry,
    message: Extract<ConversationMessage, { role: "user" }>,
  ) {
    const content = normalizeContent(message.content);
    const chatMessage: ChatMessage = {
      id: entry.id,
      role: "user",
      text: extractText(content),
      images: extractImage(content),
    };

    this.messageItem.push({
      id: entry.id,
      kind: "message",
      message: chatMessage,
    });
  }

  private addAssistantMessage(
    entry: SessionMessageEntry,
    message: Extract<ConversationMessage, { role: "assistant" }>,
  ) {
    // const content = message.content.filter(isAssistTextPart);
    const content = normalizeContent(message.content);

    //assistant message
    const assistantChatMessage: ChatMessage = {
      id: entry.id,
      role: "assistant",
      text: extractText(content),
      images: extractImage(content),
      ...(message.errorMessage ? { error: message.errorMessage } : {}),
    };
    this.messageItem.push({
      id: entry.id,
      kind: "message",
      message: assistantChatMessage,
    });

    //thinking
    const thinkingBlockMessage: ThinkingBlock = {
      id: entry.id + ":thinking",
      text: extractThinking(content),
    };
    this.messageItem.push({
      id: entry.id + ":thinking",
      kind: "Thinking",
      thinking: thinkingBlockMessage,
    });

    //tool
    /**
     * tool call (start)
     * tool call (end+result)
     */
    content.filter(isToolPart).map((part) => {
      const tool: ToolRun = {
        id: part.id,
        name: part.name,
        args: part.arguments ?? {},
        status: "running",
      };
      const messageTool: MessageListToolItem = {
        id: tool.id,
        kind: "tool",
        tool: tool,
      };
      this.toolsByCallId.set(part.id, messageTool);
      this.messageItem.push(messageTool);
    });
  }

  private updateToolResult(message: AgentToolResultMessage) {
    const toolCallId = message.toolCallId;
    if (!toolCallId) return;
    const item = this.toolsByCallId.get(toolCallId);
    if (!item) return;
    const tool:ToolRun = {
      id:item.id,
      name:item.tool.name,
      args:item.tool.args,
      status:message.isError? "error":"success",
      result:extractText(message.content),
      details:message.details
    };
    item.tool = tool;
  }
}

function extractText(content: ContentPart[]): string {
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}

function extractThinking(content: ContentPart[]): string {
  return content
    .filter((part) => part.type === "thinking")
    .map((part) => (part.thinking ? part.thinking : ""))
    .join("");
}

function extractImage(content: ContentPart[]): ChatImage[] {
  return content.filter(isImagePart).map((part) => ({
    type: "image",
    mimeType: part.mimeType,
    data: part.data,
  }));
}
