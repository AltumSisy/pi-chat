import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  ChevronUp,
  LoaderCircle,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type {
  ConversationConfig,
  ModelOption,
  ThinkingLevel,
} from "../../../shared/types";

/** 弹层与触发器的间距 */
const GAP = 8;
/** 弹层与视口边缘的最小留白 */
const VIEWPORT_MARGIN = 8;

const THINKING_LABEL: Record<ThinkingLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "X-High",
  max: "Max",
};

type Placement = {
  left: number;
  bottom: number;
  maxHeight: number;
};

type ModelConfigPillProps = {
  config: ConversationConfig;
  /** 流式输出中：服务端此时拒绝改配置，直接禁用 */
  disabled?: boolean;
  saving?: boolean;
  error?: string;
  onModelChange: (model: Pick<ModelOption, "provider" | "id">) => void;
  onThinkingLevelChange: (level: ThinkingLevel) => void;
};

function modelKey(model: Pick<ModelOption, "provider" | "id">) {
  return `${model.provider}\u0000${model.id}`;
}

/** 向上弹出：底边贴在触发器上方，水平右对齐并夹在视口内 */
function placeAbove(
  trigger: DOMRect,
  panel: { width: number },
): Placement {
  const width = Math.min(
    panel.width,
    window.innerWidth - VIEWPORT_MARGIN * 2,
  );
  const wantedLeft = trigger.right - width;
  const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
  const left = Math.min(
    Math.max(wantedLeft, VIEWPORT_MARGIN),
    Math.max(maxLeft, VIEWPORT_MARGIN),
  );

  return {
    left,
    bottom: Math.max(window.innerHeight - trigger.top + GAP, VIEWPORT_MARGIN),
    // 永远向上展开：高度不够时由弹层内部滚动
    maxHeight: Math.max(
      trigger.top - GAP - VIEWPORT_MARGIN,
      160,
    ),
  };
}

/**
 * PromptBar 里的配置胶囊：模型 + 推理强度。
 *
 * 点开向上弹出的浮层，里面是模型候选列表和离散档位滑块。
 * 选择先乐观更新到 UI，真正的持久化在 useConversationConfig 里。
 */
export default function ModelConfigPill({
  config,
  disabled = false,
  saving = false,
  error,
  onModelChange,
  onThinkingLevelChange,
}: ModelConfigPillProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusMovedRef = useRef(false);
  const dialogId = useId();

  const selectedModel = config.models.find(
    (model) => modelKey(model) === modelKey(config.model),
  );
  const modelLabel = selectedModel?.id ?? config.model.id;
  const levelLabel = THINKING_LABEL[config.thinkingLevel] ?? config.thinkingLevel;

  const levels = config.availableThinkingLevels;
  const levelIndex = Math.max(0, levels.indexOf(config.thinkingLevel));
  const sliderDisabled = disabled || levels.length <= 1;
  const fillPercent =
    levels.length <= 1 ? 0 : (levelIndex / (levels.length - 1)) * 100;

  // ── 流式输出时不允许改配置（服务端会拒绝） ──
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  // ── 定位：先用 visibility:hidden 渲染，量完再显示，避免闪一下 ──
  useLayoutEffect(() => {
    if (!open) return;

    const update = () => {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      setPlacement(placeAbove(trigger.getBoundingClientRect(), {
        width: panel.offsetWidth,
      }));
    };

    update();
    window.addEventListener("resize", update);
    // 捕获阶段：输入框 / 侧栏内部滚动也要跟
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, config.models.length, error, saving]);

  // ── 焦点：打开落在当前选中模型上；关闭不再抢焦点（Esc 单独处理） ──
  useEffect(() => {
    if (!open) {
      focusMovedRef.current = false;
      return;
    }
    if (!placement || focusMovedRef.current) return;
    focusMovedRef.current = true;
    const panel = panelRef.current;
    const target =
      panel?.querySelector<HTMLElement>('[data-selected="true"]') ??
      panel?.querySelector<HTMLElement>("[data-model-option]");
    target?.focus();
  }, [open, placement]);

  // ── 外点关闭 ──
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  // ── Esc 关闭 ──
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      // Esc 是键盘关闭：焦点必须回到触发器，否则会掉到 body
      requestAnimationFrame(() => triggerRef.current?.focus());
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  /** Tab 不跑出弹层（panel 是 portal 到 body 末尾的，顺序会跳到页首） */
  function handlePanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }
  }

  function handleLevelChange(next: ThinkingLevel) {
    if (sliderDisabled || next === config.thinkingLevel) return;
    onThinkingLevelChange(next);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        aria-label={`模型 ${modelLabel}，推理强度 ${levelLabel}`}
        title={`${config.model.provider}/${config.model.id} · ${levelLabel}`}
        className={cn(
          "flex h-8 max-w-[220px] items-center gap-1.5 rounded-full border border-line",
          "bg-inset pl-3 pr-2 text-[11.5px] font-medium text-ink-2",
          "transition-[background-color,border-color,color,box-shadow] duration-150",
          "hover:border-line-strong hover:bg-hover hover:text-ink",
          "active:scale-[0.98]",
          open && "border-line-strong bg-hover text-ink shadow-hairline",
          disabled && "cursor-not-allowed opacity-50 active:scale-100",
        )}
      >
        <span className="truncate">{modelLabel}</span>
        <span aria-hidden className="h-3 w-px shrink-0 bg-line-strong" />
        <span
          className={cn(
            "shrink-0 text-ink-3",
            open && "text-ink-2",
          )}
        >
          {levelLabel}
        </span>
        {saving ? (
          <LoaderCircle
            size={12}
            className="shrink-0 animate-spin text-ink-3"
            aria-hidden
          />
        ) : open ? (
          <ChevronDown size={12} className="shrink-0 text-ink-3" aria-hidden />
        ) : (
          <ChevronUp size={12} className="shrink-0 text-ink-3" aria-hidden />
        )}
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={dialogId}
            role="dialog"
            aria-label="模型与推理强度"
            data-model-config-popover
            onKeyDown={handlePanelKeyDown}
            className={cn(
              "fixed z-50 w-[336px] max-w-[calc(100vw-16px)] overflow-y-auto",
              "rounded-window bg-surface p-1.5 shadow-overlay",
            )}
            style={{
              top: "auto",
              left: placement?.left ?? 0,
              bottom: placement?.bottom ?? 0,
              maxHeight: placement?.maxHeight,
              visibility: placement ? "visible" : "hidden",
              animation: "pop-in 160ms cubic-bezier(0.23,1,0.32,1) both",
              transformOrigin: "bottom right",
            }}
          >
            {/* ── 模型候选 ── */}
            <div className="flex items-baseline justify-between px-2.5 pb-1.5 pt-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                模型
              </span>
              <span className="text-[10px] text-ink-3">
                {config.models.length} 个可用
              </span>
            </div>

            <div className="max-h-[236px] overflow-y-auto" role="group" aria-label="模型候选">
              {config.models.map((model) => {
                const selected = modelKey(model) === modelKey(config.model);
                return (
                  <button
                    key={modelKey(model)}
                    type="button"
                    aria-pressed={selected}
                    data-model-option
                    data-selected={selected ? "true" : undefined}
                    onClick={() =>
                      onModelChange({
                        provider: model.provider,
                        id: model.id,
                      })
                    }
                    className={cn(
                      "flex w-full items-center gap-2 rounded-control px-2.5 py-2 text-left",
                      "transition-colors duration-150",
                      selected
                        ? "bg-accent-tint"
                        : "hover:bg-hover focus-visible:bg-hover",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate text-[12.5px] font-medium",
                          selected ? "text-accent-ink" : "text-ink",
                        )}
                      >
                        {model.name || model.id}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-ink-3">
                        <span className="truncate">
                          {model.provider}/{model.id}
                        </span>
                        {model.reasoning && (
                          <span className="shrink-0 rounded-chip bg-inset px-1 py-px text-[9px] font-medium text-ink-3">
                            推理
                          </span>
                        )}
                      </span>
                    </span>
                    {selected && (
                      <Check
                        size={14}
                        className="shrink-0 text-accent-ink"
                        aria-hidden
                      />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mx-2 my-2 h-px bg-line" />

            {/* ── 推理强度滑块 ── */}
            <div className="px-2.5">
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                  推理强度
                </span>
                <span className="text-[11px] font-medium text-ink-2">
                  {levelLabel}
                </span>
              </div>

              <input
                type="range"
                min={0}
                max={Math.max(levels.length - 1, 0)}
                step={1}
                value={levelIndex}
                disabled={sliderDisabled}
                onChange={(event) => {
                  const next = levels[Number(event.target.value)];
                  if (next) handleLevelChange(next);
                }}
                aria-label="推理强度"
                aria-valuetext={levelLabel}
                className="thinking-range mt-1.5 w-full"
                style={{ "--range-fill": `${fillPercent}%` } as CSSProperties}
              />

              <div className="mt-0.5 flex items-center justify-between gap-0.5">
                {levels.map((level, index) => (
                  <button
                    key={level}
                    type="button"
                    disabled={disabled}
                    onClick={() => handleLevelChange(level)}
                    className={cn(
                      "min-w-0 flex-1 truncate rounded-chip px-0.5 py-1 text-center text-[10px]",
                      "transition-colors duration-150",
                      index === levelIndex
                        ? "font-semibold text-ink"
                        : "text-ink-3 hover:bg-hover hover:text-ink-2",
                      disabled && "cursor-not-allowed",
                    )}
                  >
                    {THINKING_LABEL[level] ?? level}
                  </button>
                ))}
              </div>

              {levels.length <= 1 && (
                <p className="mt-1 pb-1 text-[10.5px] leading-relaxed text-ink-3">
                  当前模型不支持调节推理强度。
                </p>
              )}
            </div>

            {/* ── 保存 / 错误反馈 ── */}
            {(saving || error) && (
              <div className="mt-1 flex items-start gap-1.5 rounded-control bg-inset px-2.5 py-1.5">
                {saving && (
                  <LoaderCircle
                    size={12}
                    className="mt-px shrink-0 animate-spin text-ink-3"
                    aria-hidden
                  />
                )}
                <span
                  className={cn(
                    "text-[10.5px] leading-relaxed",
                    error ? "text-red" : "text-ink-3",
                  )}
                  role={error ? "alert" : undefined}
                >
                  {error || "正在保存配置…"}
                </span>
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}