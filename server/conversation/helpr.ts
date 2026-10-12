import type {
  TextContent,
  ThinkingContent,
  ImageContent,
} from "@earendil-works/pi-ai";

import type {AgentToolResult} from '@earendil-works/pi-agent-core';

type ContentPart = TextContent | ThinkingContent | ImageContent;

export function isImagePart(part: ContentPart): part is ImageContent {
  return part.type === "image" && Boolean(part.data) && Boolean(part.mimeType);
}

export function isTextPart(part: TextContent | ImageContent): part is TextContent {
  return part.type === "text";
}

export function resultText(
  result?:  AgentToolResult<any> | undefined,
): string {
  const content = result?.content;
  return (
    content
      ?.filter(isTextPart)
      .map((item) => item.text)
      .join("\n") ?? ""
  );
}
