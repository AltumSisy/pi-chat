import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";

export default function ThinkingState({
  working = true,
  text,
  active = "Thinking…",
  done,
  icon,
  children,
}: {
  /** 是否仍在思考（shimmer + 展开） */
  working?: boolean;
  /** 思考文本内容（纯文本，会被渲染在内容区） */
  text?: string;
  /** 思考中显示的标签文字 */
  active?: string;
  /** 思考完成后显示的标签文字，默认同 active */
  done?: string;
  /** 自定义头部图标，默认 ✨ Sparkles */
  icon?: ReactNode;
  /** 自定义内容区，优先级高于 text */
  children?: ReactNode;
}): ReactNode {
  const [open, setOpen] = useState(true);

  // 思考完成后自动折叠
  useEffect(() => {
    if (!working) setOpen(false);
  }, [working]);

  const label = done ?? active;

  return (
    <div className="mt-1">
      {/* ── 头部按钮 ── */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 min-h-[38px] px-2.5 text-ink-2
                   bg-transparent border-0 text-xs cursor-pointer
                   hover:text-ink transition-colors w-full"
      >
        {/* 图标 */}
        <span className="w-4 h-4 shrink-0 flex items-center justify-center">
          {icon ?? <Sparkles size={16} />}
        </span>

        {/* 标签：思考中 shimmer，完成后静态 */}
        {working ? (
          <span
            className="text-[13px] font-medium"
            style={{
              backgroundImage:
                "linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)",
              backgroundSize: "200% 100%",
              backgroundClip: "text",
              WebkitBackgroundClip: "text",
              color: "transparent",
              animation: "shimmer-text 1.4s linear infinite",
            }}
          >
            {active}
          </span>
        ) : (
          <span className="text-ink-2 text-[13px] font-medium">{label}</span>
        )}

        {/* 展开/折叠箭头 */}
        <span className="ml-auto">
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </span>
      </button>

      {/* ── 内容区：左侧竖线 + 文字 ── */}
      {open && (
        <div className="ml-[21px] pl-2.5 border-l-2 border-line
                        text-ink-2 text-xs leading-relaxed
                        animate-[fade-up_0.2s_ease-out]">
          {children ?? (
            <div className="whitespace-pre-wrap">
              {text || "…"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}