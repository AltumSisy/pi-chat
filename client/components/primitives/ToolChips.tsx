import { useState, type ReactNode } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  LoaderCircle,
  XCircle,
} from "lucide-react";
import type { ToolRun } from "../../../shared/types";

export default function ToolChips({
  tool,
}: {
  tool: ToolRun;
}): ReactNode {
  const [open, setOpen] = useState(false);

  // 状态图标 + 颜色
  const statusConfig = {
    running: {
      icon: <LoaderCircle size={16} className="animate-spin text-ink-2" />,
      label: "运行中",
    },
    success: {
      icon: <CheckCircle2 size={16} className="text-green" />,
      label: "成功",
    },
    error: {
      icon: <XCircle size={16} className="text-red" />,
      label: "失败",
    },
  } as const;

  const config = statusConfig[tool.status];

  return (
    <div
      className="mt-1 border border-line rounded-control bg-surface overflow-hidden
                 animate-[fade-up_0.2s_ease-out]"
    >
      {/* ── 头部：工具名 + 摘要 + 状态 + 展开箭头 ── */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 min-h-[38px] px-2.5 w-full
                   bg-transparent border-0 text-left cursor-pointer
                   hover:bg-hover transition-colors focus:outline-none
                   focus-visible:shadow-[inset_0_0_0_1px_var(--line-strong)]"
      >
        <FileText size={16} className="text-ink-2 shrink-0" />
        <strong className="font-mono text-xs text-ink font-medium truncate">
          {tool.name}
        </strong>
        {tool.result && (
          <span className="text-ink-3 text-xs truncate flex-1 min-w-0">
            {tool.result}
          </span>
        )}
        <span
          className="flex items-center gap-1 text-xs shrink-0"
          title={config.label}
        >
          {config.icon}
        </span>
        {open ? <ChevronDown size={15} className="text-ink-3" /> : <ChevronRight size={15} className="text-ink-3" />}
      </button>

      {/* ── 展开详情 ── */}
      {open && (
        <div className="border-t border-line p-2.5 space-y-2.5">
          {/* 参数 */}
          <div>
            <label className="block text-ink-2 text-[11px] font-medium mb-1">
              参数
            </label>
            <pre className="bg-field rounded-control p-2 m-0 overflow-auto
                            font-mono text-[11px] leading-relaxed text-ink-2">
              {JSON.stringify(tool.args, null, 2)}
            </pre>
          </div>

          {/* 输出 */}
          {tool.result && (
            <div>
              <label className="block text-ink-2 text-[11px] font-medium mb-1">
                输出
              </label>
              <pre className="bg-field rounded-control p-2 m-0 overflow-auto
                              font-mono text-[11px] leading-relaxed text-ink-2">
                {tool.result}
              </pre>
            </div>
          )}

          {/* 详情 */}
          {tool.details !== undefined && (
            <div>
              <label className="block text-ink-2 text-[11px] font-medium mb-1">
                详情
              </label>
              <pre className="bg-field rounded-control p-2 m-0 overflow-auto
                              font-mono text-[11px] leading-relaxed text-ink-2">
                {JSON.stringify(tool.details, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}