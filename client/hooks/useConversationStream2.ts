import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  ChatMessage,
  MessageListItem,
  RuntimeStatus,
} from "../../shared/types";
import {
  connectEvents,
  createConversation,
  getConversation,
  sendMessage,
} from "../api";
import { isBusyStatus } from "../lib/status";
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
        // 打开一个正在跑的会话时 loading 要跟上（快照里带着状态）
        setLoading(isBusyStatus(conversation.status));
      } catch (error) {
        if (cancelled) return;
        setErrorState({
          conversationId,
          message: (error as Error)?.message || "Failed to load history",
        });
      }

      if (cancelled) return;

      // ── 2. 连接 SSE：历史拉取失败也要连，否则收不到后续事件 ──
      // 不再用 onOpen 当发送门闸（第 4 个参数不传）：经 Vite dev proxy 时，
      // 下游响应头要等上游第一个 body 字节才被写出去，靠 onopen 触发发送会
      // 白等一个 keepalive 周期（实测 15s）。发送改到下面直接做，不依赖握手。
      source = connectEvents(
        conversationId,
        (event) => {
          // ── loading 跟的是「这一轮跑完没有」，不是 POST 有没有返回 ──
          if (event.type === "runtime.status") {
            const status = (event.payload as { status?: RuntimeStatus } | null)
              ?.status;
            if (status === "running") setLoading(true);
            if (status === "ready" || status === "error") setLoading(false);
          }
          if (
            event.type === "runntime_settled" ||
            event.type === "runntime_error"
          ) {
            setLoading(false);
          }

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
        undefined,
        after,
      );

      esRef.current = source;

      // ── 3. 有待发消息就立刻发，不等流握手 ──
      // 服务端按快照游标 after 做 replay（replay 先于 subscribe，且中间没有 await），
      // 所以即使 POST 先到、事件产生在订阅之前，也不会丢。
      const pending = pendingSend.current;
      if (pending && pending.conversationId === conversationId) {
        pendingSend.current = null;

        setMessageState((current) => ({
          conversationId,
          items: conversationReducer(
            current.conversationId === conversationId ? current.items : [],
            { type: "optimistic-user", message: pending.message },
          ),
        }));

        void send(conversationId, pending.text);
      }
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
      // 不在这里收起 loading：POST 返回只代表服务端受理了，
      // 真正结束以 SSE 的 runtime.status / runntime_settled 为准
    } catch (error) {
      setErrorState({
        conversationId,
        message: (error as Error)?.message || "unknown error",
      });
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