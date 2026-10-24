import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { LoaderCircle } from "lucide-react";
import { cn } from "../../lib/utils";

/* ─────────────────────────────────────────────────────────
 * CONFIRM POPOVER
 * 就地二次确认：贴在触发元素旁边的轻量弹层，替代 window.confirm。
 *
 * 为什么不用 AlertDialog：删一条会话是"破坏性动作、上下文已经很清楚"的场景，
 * 模态会打断整页；原生 confirm 更糟 —— 阻塞事件循环、样式不可控，
 * 某些嵌入式环境下直接不显示。
 *
 * 机具沿用 SidebarNav 里 WorkspaceMenu 的那一套（portal + fixed 定位 +
 * Esc + 外点关闭），但把定位收进组件内部：调用方只写文案和动作。
 * ───────────────────────────────────────────────────────── */

export type ConfirmCopy = {
  /** 标题，必填（同时作为弹层的 aria-labelledby） */
  title: string;
  /** 补充说明，形如"删了就不能恢复"这种后果描述 */
  description?: string;
  /** 确认按钮文案，默认「确认」 */
  confirmLabel?: string;
  /** 取消按钮文案，默认「取消」 */
  cancelLabel?: string;
};

type ConfirmPopoverProps = ConfirmCopy & {
  /**
   * 触发器：单个元素（DOM 元素或 forwardRef 组件）。会被注入
   * onClick / ref / aria-haspopup / aria-expanded / data-confirm-open，
   * 所以它必须接受这些属性 —— 直接放一个 <button> 最省事。
   */
  children: ReactElement;
  /** 确认动作；返回 Promise 时按钮进入 loading 态 */
  onConfirm: () => void | Promise<void>;
  /** 水平对齐：end = 弹层右边贴触发器右边（默认），start = 左边贴左边 */
  align?: "start" | "end";
  /** 竖直方向：auto（默认）= 下面放不下就翻到上面 */
  side?: "top" | "bottom" | "auto";
  /** 弹层附加样式（merge 进面板，可覆盖宽度等） */
  panelClassName?: string;
};

/** 弹层与触发器之间的间距 */
const GAP = 6;
/** 弹层与视口边缘的最小留白 */
const VIEWPORT_MARGIN = 8;

type Placement = {
  top: number;
  left: number;
  /** 实际落在哪一侧，用来定 transformOrigin */
  side: "top" | "bottom";
};

/** 贴边定位：竖直方向自动翻转，水平方向夹在视口内 */
function place(
  trigger: DOMRect,
  panel: { width: number; height: number },
  align: "start" | "end",
  prefer: "top" | "bottom" | "auto",
): Placement {
  const below = window.innerHeight - trigger.bottom - GAP - VIEWPORT_MARGIN;
  const above = trigger.top - GAP - VIEWPORT_MARGIN;

  let side: "top" | "bottom";
  if (prefer === "auto") {
    // 下面放得下就放下面；放不下但上面更宽裕就翻上去
    side = below >= panel.height || below >= above ? "bottom" : "top";
  } else {
    side = prefer;
  }

  const wantedTop =
    side === "bottom" ? trigger.bottom + GAP : trigger.top - GAP - panel.height;
  const maxTop = window.innerHeight - panel.height - VIEWPORT_MARGIN;
  const top = Math.min(
    Math.max(wantedTop, VIEWPORT_MARGIN),
    Math.max(maxTop, VIEWPORT_MARGIN),
  );

  const wantedLeft =
    align === "end" ? trigger.right - panel.width : trigger.left;
  const maxLeft = window.innerWidth - panel.width - VIEWPORT_MARGIN;
  const left = Math.min(
    Math.max(wantedLeft, VIEWPORT_MARGIN),
    Math.max(maxLeft, VIEWPORT_MARGIN),
  );

  return { top, left, side };
}

export default function ConfirmPopover({
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  children,
  onConfirm,
  align = "end",
  side = "auto",
  panelClassName,
}: ConfirmPopoverProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);

  /** 触发器元素：点击时从 event.currentTarget 取，不给子元素注 ref */
  const anchorRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  /** 本轮打开是否已把焦点移进面板（否则 scroll/resize 重算位置会把焦点抢回来） */
  const focusMovedRef = useRef(false);
  const titleId = useId();
  const descriptionId = useId();

  const close = () => {
    setPlacement(null);
    setOpen(false);
  };

  // ── 定位：在提交期算好，所以不会先闪在 (0,0) 再跳 ──
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const trigger = anchorRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      // 面板尺寸用 offset* 而不是 getBoundingClientRect：面板挂着 pop-in 缩放动画，
      // rect 会量到缩放后的高度，靠远边定位（翻到上方）时会算错、和触发器贴在一起。
      setPlacement(
        place(
          trigger.getBoundingClientRect(),
          { width: panel.offsetWidth, height: panel.offsetHeight },
          align,
          side,
        ),
      );
    };
    update();

    // scroll 用捕获阶段：侧栏内部滚动容器不会冒泡到 window
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, align, side]);

  // ── 焦点：打开落在「取消」上，关闭还给触发器 ──
  // 破坏性动作默认焦点给取消按钮，回车不会误删
  useEffect(() => {
    if (!open) {
      if (!focusMovedRef.current) return;
      focusMovedRef.current = false;
      // 行可能已经随删除消失，触发元素没了就不用还
      anchorRef.current?.focus?.();
      return;
    }
    // 必须等 placement 算完：那时面板才从 visibility:hidden 变可见，
    // 而对 visibility:hidden 的元素调 focus() 是静默失效的
    if (!placement || focusMovedRef.current) return;
    focusMovedRef.current = true;
    cancelRef.current?.focus();
  }, [open, placement]);

  // ── 外点关闭：删除进行中不响应，避免"关了但删了"的含糊状态 ──
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (pending) return;
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open, pending]);

  // ── Esc 关闭 ──
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || pending) return;
      // 别让 Esc 顺手把别的全局监听也触发了
      event.stopPropagation();
      close();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, pending]);

  const handleConfirm = async () => {
    if (pending) return;
    setPending(true);
    try {
      await onConfirm();
      close();
    } finally {
      setPending(false);
    }
  };

  // ── 触发器：注入点击/无障碍属性，保留它自己的 props ──
  const triggerProps = children.props as {
    onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
  };
  const trigger = cloneElement(
    children as ReactElement<Record<string, unknown>>,
    {
      onClick: (event: ReactMouseEvent<HTMLElement>) => {
        triggerProps.onClick?.(event);
        if (event.defaultPrevented || pending) return;
        // 触发器元素直接从事件里拿：不给子元素注 ref，也就没有「render 期读 ref」的告警
        anchorRef.current = event.currentTarget as HTMLElement;
        if (open) close();
        else setOpen(true);
      },
      "aria-haspopup": "dialog",
      "aria-expanded": open,
      // 供宿主样式使用：行内操作按钮在弹层打开时要保持可见
      "data-confirm-open": open ? "true" : undefined,
    } as Record<string, unknown>,
  );

  return (
    <>
      {trigger}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            data-confirm-popover
            className={cn(
              "fixed z-50 w-56 max-w-[calc(100vw-16px)]",
              "rounded-window bg-surface p-3 shadow-overlay",
              panelClassName,
            )}
            style={{
              top: placement?.top ?? 0,
              left: placement?.left ?? 0,
              visibility: placement ? "visible" : "hidden",
              animation: "pop-in 160ms cubic-bezier(0.23,1,0.32,1) both",
              transformOrigin:
                placement?.side === "top" ? "bottom right" : "top right",
            }}
            onKeyDown={(event) => {
              // 只有两个按钮，Tab 在它们之间循环，别把焦点漏到背景
              if (event.key !== "Tab") return;
              const first = cancelRef.current;
              const last = confirmRef.current;
              if (!first || !last) return;
              if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
              } else if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
              }
            }}
          >
            <p id={titleId} className="text-[13px] font-medium text-ink">
              {title}
            </p>
            {description && (
              <p
                id={descriptionId}
                className="mt-1 text-[12.5px] leading-relaxed text-ink-3"
              >
                {description}
              </p>
            )}

            <div className="mt-3 flex items-center justify-end gap-1.5">
              <button
                ref={cancelRef}
                type="button"
                onClick={close}
                disabled={pending}
                className="flex h-7 items-center rounded-control px-2.5 text-[12.5px] font-medium
                           text-ink-2 transition-colors duration-150
                           hover:bg-hover-2 hover:text-ink disabled:opacity-60"
              >
                {cancelLabel}
              </button>

              <button
                ref={confirmRef}
                type="button"
                onClick={() => void handleConfirm()}
                disabled={pending}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-control px-2.5",
                  "text-[12.5px] font-medium text-red bg-red-tint",
                  "transition-[background-color,color,transform] duration-150",
                  "hover:bg-red hover:text-surface active:scale-[0.98]",
                  "disabled:opacity-60",
                )}
              >
                {pending && <LoaderCircle size={13} className="animate-spin" />}
                {confirmLabel}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}