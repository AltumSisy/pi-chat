import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ArrowUp } from "lucide-react";

export default function PromptBar({
  placeholder = "输入消息，按 Enter 发送…",
  loading = false,
  onSend,
}: {
  placeholder?: string;
  /** 发送中时禁用输入 */
  loading?: boolean;
  onSend?: (text: string) => void;
}): ReactNode {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 自适应高度：根据内容自动撑开 textarea
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  const trimmed = text.trim();
  const canSend = trimmed.length > 0 && !loading;

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter 发送，Shift+Enter 换行
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleSend() {
    if (!canSend) return;
    onSend?.(trimmed);
    setText("");
  }

  return (
    <div
      className="flex items-end gap-2 p-[9px_10px_9px_13px]
                 bg-surface border border-line rounded-control
                 shadow-card transition-shadow
                 focus-within:border-line-strong focus-within:shadow-raised"
    >
      {/* ── 输入区 ── */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={1}
        disabled={loading}
        className="flex-1 resize-none border-0 outline-none p-[6px_0]
                   bg-transparent text-ink text-sm leading-relaxed
                   placeholder:text-ink-3
                   min-h-[32px] max-h-[120px]
                   disabled:opacity-50"
      />

      {/* ── 发送按钮 ── */}
      <button
        onClick={handleSend}
        disabled={!canSend}
        aria-label="发送"
        className="shrink-0 w-8 h-8 rounded-md grid place-items-center
                   border-0 cursor-pointer transition-colors
                   bg-ink text-surface
                   disabled:bg-line-strong disabled:cursor-not-allowed
                   disabled:text-ink-3"
      >
        <ArrowUp size={18} />
      </button>
    </div>
  );
}