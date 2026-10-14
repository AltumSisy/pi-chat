import type {
  ConversationSnapshot,
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

export function createConversation(): Promise<ConversationSnapshot> {
  return readResponse(fetch("/api/conversation", { method: "POST" }));
}

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
