import type { ReactNode } from "react";
import type { MessageListItem } from "../../shared/types";
import { Markdown } from "./Markdown";
import ThinkingState from "./primitives/ThinkingState";
import ToolChips from "./primitives/ToolChips";

export function MessageItem({
  item,
}: {
  item: MessageListItem;
}): ReactNode {
  // ── 思考块 ──
  if (item.kind === "Thinking") {
    return (
      <ThinkingState
        working={!item.thinking.completed}
        text={item.thinking.text}
        active="Thinking…"
        done="Thought complete"
      />
    );
  }

  // ── 工具调用 ──
  if (item.kind === "tool") {
    return <ToolChips tool={item.tool} />;
  }

  // ── 用户 / AI 消息 ──
  const { message } = item;
  const isUser = message.role === "user";

  return (
    <article
      className={`flex items-start ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={
          isUser ? "max-w-[78%] flex flex-col items-end" : "max-w-full min-w-0"
        }
      >
        {/* 气泡 */}
        <div
          className={
            isUser
              ? "px-3 py-2 rounded-[12px_5px_12px_12px] bg-inset text-ink text-sm leading-relaxed"
              : "py-0.5 text-sm leading-relaxed"
          }
        >
          {/* SAFETY: assistant 消息可能包含 Markdown，user 消息显示纯文本 */}
          {isUser ? (
            <p className="whitespace-pre-wrap m-0">{message.text}</p>
          ) : (
            <Markdown content={message.text} />
          )}
        </div>

        {/* 状态指示（pending / error） */}
        {message.status === "pending" && (
          <span className="text-ink-3 text-[10px] mt-1">发送中…</span>
        )}
        {message.status === "error" && (
          <span className="text-red text-[10px] mt-1">发送失败</span>
        )}
      </div>
    </article>
  );
}