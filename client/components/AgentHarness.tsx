import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronRight, Plus, Sparkles } from "lucide-react";
import { createConversation, listConversaiton } from "../api";
import { MessageItem } from "./MessageItem";
import LoadingState from "./primitives/LoadingState";
import PromptBar from "./primitives/PromptBar";
import { useConversationStream2 } from "../hooks/useConversationStream2";
import type { ConversationSummary } from "../../shared/types";

/** 空状态时展示的建议 prompt */
const suggestedPrompts = [
  "帮我制定本周的学习计划",
  "解释一个复杂的技术概念",
  "帮我整理一份项目方案",
];

export default function AgentHarness(): ReactNode {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const { messageItems, loading, error, send } =
    useConversationStream2(conversationId);
  const [conversationSummarys, setConversationSummarys] =
    useState<ConversationSummary[]>();
  const bottomRef = useRef<HTMLDivElement>(null);
  const submittedRef = useRef(false);

  const isEmpty = messageItems.length === 0;

  // ── 发送消息后 smooth 滚到底 ──
  useEffect(() => {
    async () => {
      const conversationSummarys = await listConversaiton();
      setConversationSummarys(conversationSummarys);
    };
  }, []);
  useEffect(() => {
    if (!submittedRef.current || messageItems.length === 0) return;
    submittedRef.current = false;
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
  }, [messageItems.length]);

  // ── 流式输出中 instant 跟滚 ──
  useEffect(() => {
    if (!loading || isEmpty) return;
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ block: "end" });
    });
  }, [loading, messageItems]);

  function handleSend(text: string) {
    submittedRef.current = true;
    void send(text);
  }

  async function handleNewConversation() {
    const created = await createConversation();
    navigate("/conversation/" + created.conversationSummary.id);
  }

  return (
    <div className="flex flex-col h-screen bg-page">
      {/* ════════════════════════════════════════════
          Header
          ════════════════════════════════════════════ */}
      <header
        className="h-16 border-b border-line flex items-center justify-between px-6
                   sticky top-0 bg-surface/94 backdrop-blur-sm z-10"
      >
        <div className="flex items-center gap-3">
          {/* 品牌图标 */}
          <div className="w-7 h-7 rounded-md bg-ink text-surface grid place-items-center">
            <Sparkles size={14} />
          </div>
          <span className="text-[17px] font-semibold tracking-[-0.02em] text-ink">
            Pi Chat
          </span>
        </div>

        {/* 新会话按钮 */}
        <button
          onClick={handleNewConversation}
          className="flex items-center gap-1.5 px-3 py-2 rounded-md
                     bg-ink text-surface text-xs font-medium
                     border-0 cursor-pointer transition-opacity
                     hover:opacity-90"
        >
          <Plus size={14} />
          新会话
        </button>
      </header>

      {/* ════════════════════════════════════════════
          Main — 消息区
          ════════════════════════════════════════════ */}
      <main className="flex-1 overflow-y-auto">
        {isEmpty ? (
          /* ── 空状态 ── */
          <div className="min-h-full flex items-center justify-center">
            <div className="w-full max-w-[560px] text-center -mt-20 px-6">
              {/* 图标 */}
              <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-inset grid place-items-center">
                <Sparkles size={22} className="text-ink" />
              </div>

              <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-ink mb-2">
                有什么我可以帮你？
              </h1>
              <p className="text-ink-3 text-[13px] mb-5">
                输入问题，或从下面的建议开始一段新对话。
              </p>

              {/* 建议 Prompt */}
              <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-1">
                {suggestedPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => handleSend(prompt)}
                    className="min-h-[58px] flex items-center justify-between gap-2
                               p-[10px_11px] border border-line rounded-control
                               bg-surface text-ink-2 text-xs text-left
                               hover:border-line-strong hover:bg-hover
                               hover:text-ink transition-colors cursor-pointer"
                  >
                    {prompt}
                    <ChevronRight size={15} className="shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* ── 消息列表 ── */
          <div className="max-w-[960px] mx-auto px-6 py-8 pb-36">
            {messageItems.map((item) => (
              <MessageItem key={item.id} item={item} />
            ))}

            {/* 加载指示器 */}
            {loading && <LoadingState label="正在生成" />}

            {/* 底部锚点（滚动目标） */}
            <div ref={bottomRef} className="h-[110px]" aria-hidden />
          </div>
        )}

        {/* ── 错误提示 ── */}
        {error && (
          <div className="max-w-[960px] mx-auto px-6 mb-2">
            <div
              className="w-fit max-w-full px-2.5 py-1.5 rounded-md
                         bg-red-tint text-red text-xs"
              role="alert"
            >
              {error}
            </div>
          </div>
        )}
      </main>

      {/* ════════════════════════════════════════════
          Composer — 底部固定输入区
          ════════════════════════════════════════════ */}
      <footer
        className="fixed bottom-0 left-0 right-0 p-3 px-6 pb-4
                   bg-gradient-to-t from-page via-page to-transparent"
      >
        <div className="max-w-[960px] mx-auto">
          <PromptBar
            onSend={handleSend}
            loading={loading}
            placeholder="输入消息，按 Enter 发送…"
          />
          <div className="mt-1.5 text-ink-3 text-[10px] flex justify-between">
            <span>Enter 发送 · Shift + Enter 换行</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
