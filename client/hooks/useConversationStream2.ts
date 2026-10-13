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
  const [historyMessageList, setHistoryMessageList] = useState<
    MessageListItem[]
  >([]);
  const esRef = useRef<EventSource | null>(null);

  const messageItems = [
    ...historyMessageList,
    ...(messageState.conversationId === conversationId
      ? messageState.items
      : []),
  ];
  useEffect(() => {
    if (!conversationId) return;

    // 先关掉旧的，防止 StrictMode 双调用导致两个连接并存
    esRef.current?.close();
    async () => {
      const conversation = await getConversation(conversationId);
      setHistoryMessageList(conversation.messageList);

      const es = connectEvents(
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
      );

      esRef.current = es;
      return () => {
        es.close();
      };
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
