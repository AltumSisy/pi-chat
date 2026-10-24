import type {
  ConversationSnapshot,
  ConversationSummary,
  StreamEvent,
} from "../shared/types";

async function readResponse<T>(request: Promise<Response>): Promise<T> {
  const response = await request;
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(body.error ?? `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

/**
 * 创建会话
 * @returns
 */
export function createConversation(): Promise<ConversationSnapshot> {
  return readResponse(fetch("/api/conversation", { method: "POST" }));
}

/**
 * 发送消息
 * @param id
 * @param text
 * @returns
 */
export function sendMessage(id: string, text: string): Promise<unknown> {
  const form = new FormData();
  form.set("text", text);
  return readResponse(
    fetch(`/api/conversation/${encodeURIComponent(id)}/message`, {
      method: "POST",
      body: form,
    }),
  );
}
// 历史快照：服务端会顺带恢复 runtime session，所以用 POST（见 server/routes/conversation.ts）
export function getConversation(id: string): Promise<ConversationSnapshot> {
  return readResponse(
    fetch(`/api/conversation/${encodeURIComponent(id)}`, { method: "POST" }),
  );
}

/**
 *
 * 连接流
 * @param id
 * @param onEvent
 * @param onError
 * @param onOpen
 * @param after
 * @returns
 */
export function connectEvents(
  id: string,
  onEvent: (event: StreamEvent) => void,
  onError: () => void,
  onOpen?: () => void,
  after = 0,
): EventSource {
  const source = new EventSource(
    `/api/conversation/${encodeURIComponent(id)}/stream?after=${after}`,
  );
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as StreamEvent);
    } catch {
      onError();
    }
  };
  source.onerror = onError;
  source.onopen = () => onOpen?.();
  return source;
}

/**
 * 会话列表
 * @returns
 */
export function listConversation(): Promise<ConversationSummary[]> {
  return readResponse(fetch(`/api/conversation`));
}

/**
 * 会话删除
 * @param id
 * @returns
 */
export function deleteConversation(id: string): Promise<{ deleted: true }> {
  return readResponse(
    fetch("/api/conversation/" + encodeURIComponent(id), {
      method: "DELETE",
    }),
  );
}

/**
 * 重命名会话
 * @param id
 * @param title
 * @returns
 */
export function renameConversation(
  id: string,
  title: string,
): Promise<ConversationSummary> {
  return readResponse(
    fetch("/api/conversation/" + encodeURIComponent(id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }),
  );
}

/**
 * 终止对话
 * @param id
 * @returns
 */
export function abortConversation(id: string): Promise<{ aborted: true }> {
  return readResponse(
    fetch("/api/conversation/" + encodeURIComponent(id) + "/abort", {
      method: "POST",
    }),
  );
}
