import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ChatMessage, MessageListItem } from "../../shared/types";
import {
  connectEvents,
  createConversation,
  getConversation,
  sendMessage,
} from "../api";
import { conversationReducer } from "../state";

interface PendingSend {
  conversationId: string;
  text: string;
  message: ChatMessage;
}
export function useConversationStream2(conversationId?: string) {
  const navigate = useNavigate();
  const [messageState, setMessageState] = useState<{
    conversationId?: string;
    items: MessageListItem[];
  }>({ items: [] });
  const [loading, setLoading] = useState(false);
  const [errorState, setErrorState] = useState<{
    conversationId?: string;
    message: string;
  }>({ message: "" });
  const pendingSend = useRef<PendingSend | null>(null);
  const [historyState, setHistoryState] = useState<{
    conversationId?: string;
    items: MessageListItem[];
  }>({ items: [] });
  const esRef = useRef<EventSource | null>(null);

  const messageItems = [
    ...(historyState.conversationId === conversationId
      ? historyState.items
      : []),
    ...(messageState.conversationId === conversationId
      ? messageState.items
      : []),
  ];
  useEffect(() => {
    if (!conversationId) return;

    // 先关掉旧的，防止 StrictMode 双调用导致两个连接并存
    esRef.current?.close();
    esRef.current = null;

    let cancelled = false;
    let source: EventSource | null = null;

    (async () => {
      // ── 1. 历史会话：取出快照（历史消息 + 事件游标 seqId） ──
      let after = 0;
      try {
        const conversation = await getConversation(conversationId);
        if (cancelled) return;
        setHistoryState({
          conversationId,
          items: conversation.messageList,
        });
        // 只订阅快照之后的事件：历史里已有的内容不再重放，避免重复气泡
        after = conversation.stream?.seqId ?? 0;
      } catch (error) {
        if (cancelled) return;
        setErrorState({
          conversationId,
          message: (error as Error)?.message || "Failed to load history",
        });
      }

      if (cancelled) return;

      // ── 2. 连接 SSE：历史拉取失败也要连，否则收不到后续事件 ──
      source = connectEvents(
        conversationId,
        (event) => {
          setMessageState((current) => {
            return {
              conversationId,
              items: conversationReducer(
                current.conversationId === conversationId ? current.items : [],
                {
                  type: "event",
                  event,
                },
              ),
            };
          });
        },
        () => {
          setErrorState({
            conversationId,
            message: "Connection error",
          });
        },
        () => {
          //handle connection open event
          const pending = pendingSend.current;
          if (!pending || pending.conversationId != conversationId) return;
          pendingSend.current = null;

          setMessageState((current) => ({
            conversationId,
            items: conversationReducer(
              current.conversationId === conversationId ? current.items : [],
              { type: "optimistic-user", message: pending.message },
            ),
          }));

          send(conversationId, pending.text);
        },
        after,
      );

      esRef.current = source;
    })();

    return () => {
      cancelled = true;
      source?.close();
      if (esRef.current === source) esRef.current = null;
    };
  }, [conversationId]);

  async function send(convsersationId: string, text: string) {
    setLoading(true);
    setErrorState({
      conversationId,
      message: "",
    });
    try {
      await sendMessage(convsersationId, text);
    } catch (error) {
      setErrorState({
        conversationId,
        message: (error as Error)?.message || "unknown error",
      });
    } finally {
      setLoading(false);
    }
  }

  async function submit(value: string) {
    const text = value.trim();
    if (!text || loading) return;

    const message: ChatMessage = {
      id: "pending-" + Date.now(),
      role: "user",
      text,
      images: [],
      status: "pending",
    };

    //new conversation
    if (!conversationId) {
      setLoading(true);
      setErrorState({
        message: "",
      });
      try {
        const created = await createConversation();
        const conversationId = created.conversationSummary.id;
        pendingSend.current = {
          conversationId,
          text,
          message,
        };
        navigate(`/conversation/${conversationId}`);
      } catch (error) {
        setErrorState({
          message: (error as Error)?.message || "Unkown error",
        });
      } finally {
        setLoading(false);
      }
      return;
    }
    //continue conversation
    setMessageState((current) => ({
      conversationId,
      items: conversationReducer(
        current.conversationId === conversationId ? current.items : [],
        { type: "optimistic-user", message },
      ),
    }));
    await send(conversationId, text);
  }

  return {
    conversationId,
    messageItems,
    loading,
    error: errorState.message,
    send: submit,
  };
}
