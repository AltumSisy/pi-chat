import type {
  ChatMessage,
  MessageListItem,
  StreamEvent,
  ThinkingBlock,
  ToolRun,
} from "../shared/types";

export type ConversationAction =
  | { type: "event"; event: StreamEvent }
  | { type: "optimistic-user"; message: ChatMessage };

type EventPayload = Record<string, unknown>;

function eventPayload(event: StreamEvent): EventPayload {
  return event.payload && typeof event.payload === "object"
    ? (event.payload as EventPayload)
    : {};
}

function updateItem(
  items: MessageListItem[],
  id: string,
  update: (item: MessageListItem) => MessageListItem,
): MessageListItem[] {
  return items.map((item) => (item.id === id ? update(item) : item));
}

function addUserMessage(
  items: MessageListItem[],
  message: ChatMessage,
): MessageListItem[] {
  // 去重：已存在就不加
  if (items.some((item) => item.kind === "message" && item.id === message.id))
    return items;

  // 乐观更新：找到之前放的 pending 消息，替换成真实的
  const pendingIndex = items.findIndex(
    (item) =>
      item.kind === "message" &&
      item.message.role === "user" &&
      item.message.status === "pending" &&
      item.message.text === message.text,
  );
  if (pendingIndex < 0)
    return [...items, { kind: "message", id: message.id, message }];

  return items.map((item, index) =>
    index === pendingIndex
      ? {
          kind: "message",
          id: message.id,
          message: { ...message, status: "streaming" },
        }
      : item,
  );
}

function addOrUpdateTool(
  items: MessageListItem[],
  tool: ToolRun,
): MessageListItem[] {
  const exists = items.some(
    (item) => item.kind === "tool" && item.id === tool.id,
  );
  if (!exists) return [...items, { kind: "tool", id: tool.id, tool }];
  return updateItem(items, tool.id, (item) =>
    item.kind === "tool" ? { ...item, tool: { ...item.tool, ...tool } } : item,
  );
}

function addOrUpdateMessage(
  items: MessageListItem[],
  message: ChatMessage,
): MessageListItem[] {
  const index = items.findIndex(
    (item) => item.kind === "message" && item.id === message.id,
  );
  if (index < 0)
    return [...items, { kind: "message", id: message.id, message }];

  return items.map((item, itemIndex) =>
    itemIndex === index ? { kind: "message", id: message.id, message } : item,
  );
}

export function conversationReducer(
  items: MessageListItem[],
  action: ConversationAction,
): MessageListItem[] {
  // ── 乐观更新：用户刚发的消息 ──
  if (action.type === "optimistic-user")
    return addUserMessage(items, action.message);

  const payload = eventPayload(action.event);
  const id = typeof payload.id === "string" ? payload.id : "";

  switch (action.event.type) {
    // ── 用户消息（来自 SSE 回放） ──
    case "message_add":
      // SAFETY: message_add payload is a ChatMessage per server contract
      return addUserMessage(items, payload as unknown as ChatMessage);

    // ── AI 回复开始（不渲染空气泡，等 thinking 或 delta 来） ──
    case "message_started":
      return items;

    // ── AI 回复逐字到达 ──
    case "message_delta": {
      if (!id) return items;
      const existing = items.find(
        (current) => current.kind === "message" && current.id === id,
      );
      const delta = String(payload.delta ?? "");
      if (!existing) {
        return addOrUpdateMessage(items, {
          id,
          role: "assistant",
          text: delta,
          images: [],
          status: "streaming",
        });
      }
      return updateItem(items, id, (current) =>
        current.kind === "message"
          ? {
              ...current,
              message: {
                ...current.message,
                text: current.message.text + delta,
                status: "streaming",
              },
            }
          : current,
      );
    }

    // ── AI 回复完成 ──
    case "message_completed": {
      const message = payload.message as ChatMessage | undefined;
      if (!message) return items;
      return addOrUpdateMessage(items, message);
    }

    // ── 思考开始 ──
    case "thinking_started": {
      if (
        !id ||
        items.some((item) => item.kind === "Thinking" && item.id === id)
      )
        return items;
      const thinking: ThinkingBlock = { id, text: "" };
      return [...items, { kind: "Thinking", id, thinking }];
    }

    // ── 思考文字追加 ──
    case "thinking_delta":
      return updateItem(items, id, (item) =>
        item.kind === "Thinking"
          ? {
              ...item,
              thinking: {
                ...item.thinking,
                text: item.thinking.text + String(payload.delta ?? ""),
              },
            }
          : item,
      );

    // ── 思考完成 ──
    case "thinking_completed":
      return updateItem(items, id, (item) =>
        item.kind === "Thinking"
          ? {
              ...item,
              thinking: { ...item.thinking, completed: true },
            }
          : item,
      );

    // ── 工具调用开始 ──
    case "tool_started":
      return addOrUpdateTool(items, {
        id,
        name: String(payload.name ?? "tool"),
        args: (payload.args ?? {}) as Record<string, unknown>,
        status: "running",
      });

    // ── 工具调用更新 / 完成 ──
    case "tool_updated":
    case "tool_completed":
      return addOrUpdateTool(items, {
        id,
        name: String(payload.name ?? "tool"),
        args: (payload.args ?? {}) as Record<string, unknown>,
        status:
          action.event.type === "tool_completed"
            ? payload.status === "error"
              ? "error"
              : "success"
            : "running",
        ...(typeof payload.result === "string"
          ? { result: payload.result }
          : {}),
        ...(payload.details !== undefined ? { details: payload.details } : {}),
      });

    default:
      return items;
  }
}