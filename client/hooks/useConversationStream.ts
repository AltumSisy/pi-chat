import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, MessageListItem } from "../../shared/types";
import {
  connectEvents,
  createConversation as createConv,
  sendMessage as sendMsg,
} from "../api";
import { conversationReducer } from "../state";

export function useConversationStream(initialConversationId?: string) {
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [messageItems, setMessageListItem] = useState<MessageListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const esRef = useRef<EventSource | null>(null);
  const runIdRef = useRef(0);
  const lastSeqRef = useRef(0);
  const loadingRef = useRef(false);

  // 同步 loadingRef，避免 useCallback 循环依赖
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  // 卸载时关闭 EventSource
  useEffect(() => {
    return () => {
      esRef.current?.close();
    };
  }, []);

  const connect = useCallback(
    (id: string) => {
      esRef.current?.close();
      setError("");

      const es = connectEvents(
        id,
        (event) => {
          setMessageListItem((prev) =>
            conversationReducer(prev, { type: "event", event }),
          );
          lastSeqRef.current = Math.max(lastSeqRef.current, event.id);

          // 助手回复完成或运行时停转 → 结束 loading
          if (
            event.type === "message_completed" ||
            event.type === "runntime_settled"
          ) {
            loadingRef.current = false;
            setLoading(false);
          }
        },
        () => setError("连接断开，正在重连…"),
        () => setError(""),
        lastSeqRef.current,
      );
      esRef.current = es;
    },
    [],
  );

  // conversationId 确定后自动连接 SSE
  useEffect(() => {
    if (conversationId) connect(conversationId);
  }, [conversationId, connect]);

  const send = useCallback(
    async (text: string) => {
      const textTrimmed = text.trim();
      if (!textTrimmed || loadingRef.current) return;

      const runId = ++runIdRef.current;
      loadingRef.current = true;
      setLoading(true);

      const inputMessage: ChatMessage = {
        id: `pending-${runId}`,
        role: "user",
        text: textTrimmed,
        images: [],
        status: "pending",
      };

      try {
        let cid = conversationId;
        if (!cid) {
          const created = await createConv();
          cid = created.conversationSummary.id;
          lastSeqRef.current = created.stream.seqId;
          setConversationId(cid);
        }

        // 乐观更新：把用户消息立刻放到列表里
        setMessageListItem((prev) =>
          conversationReducer(prev, {
            type: "optimistic-user",
            message: inputMessage,
          }),
        );

        // 发送消息
        await sendMsg(cid, textTrimmed);

        // 重连 SSE，接收 AI 回复事件
        connect(cid);
      } catch (err) {
        if (runId === runIdRef.current) {
          loadingRef.current = false;
          setLoading(false);
          setError(err instanceof Error ? err.message : "发送失败");
        }
      }
    },
    [conversationId, connect],
  );

  const newConversation = useCallback(async () => {
    esRef.current?.close();
    setConversationId(undefined);
    setMessageListItem([]);
    setLoading(false);
    loadingRef.current = false;
    setError("");
    lastSeqRef.current = 0;

    const created = await createConv();
    setConversationId(created.conversationSummary.id);
    lastSeqRef.current = created.stream.seqId;
  }, []);

  return {
    conversationId,
    messageItems,
    loading,
    error,
    send,
    newConversation,
  };
}