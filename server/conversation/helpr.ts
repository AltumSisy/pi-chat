import type {
  TextContent,
  ThinkingContent,
  ImageContent,
} from "@earendil-works/pi-ai";

import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type {
  SessionEntry,
  SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";
import type { ChatMessage, MessageListItem } from "@shared/types.ts";

type SessionMessage = SessionMessageEntry["message"];
type ConversationMessage = Extract<
  SessionMessage,
  { role: "user" | "assistant" }
>;
type AgentToolResultMessage = Extract<SessionEntry, { role: "toolResult" }>;

type ContentPart = TextContent | ThinkingContent | ImageContent;

export function isImagePart(part: ContentPart): part is ImageContent {
  return part.type === "image" && Boolean(part.data) && Boolean(part.mimeType);
}

export function isTextPart(
  part: TextContent | ImageContent,
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
  constructor(entries: SessionEntry[]) {
    this.entries = entries;
  }

  build(): MessageListItem[] {
    for (const entry of this.entries) {
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
    const content = message.content;
    const chatMessage: ChatMessage = {
      id: entry.id,
      role:"user",
      
    };
  }

  private addAssistantMessage(
    entry: SessionMessageEntry,
    message: Extract<ConversationMessage, { role: "assistant" }>,
  ) {}

  private updateToolResult(message: AgentToolResultMessage) {}
}
