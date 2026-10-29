import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  ChevronUp,
  LoaderCircle,
  Search,
  X,
  Zap,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { listSkills } from "../../api";
import type { SkillOption } from "../../../shared/types";

/** 弹层与触发器的间距 */
const GAP = 8;
/** 弹层与视口边缘的最小留白 */
const VIEWPORT_MARGIN = 8;

type Placement = {
  left: number;
  bottom: number;
  maxHeight: number;
};

type SkillPickerProps = {
  /** 已选中的技能名 */
  active: string[];
  /** 配置里带的候选；弹层打开后会再用 /api/skills 刷一次 */
  available: SkillOption[];
  /** 流式输出中：服务端此时拒绝改配置（会重建 runtime） */
  disabled?: boolean;
  saving?: boolean;
  error?: string;
  onChange: (skills: string[]) => void;
};

/** 向上弹出：底边贴在触发器上方，水平右对齐并夹在视口内 */
function placeAbove(trigger: DOMRect, panel: { width: number }): Placement {
  const width = Math.min(panel.width, window.innerWidth - VIEWPORT_MARGIN * 2);
  const wantedLeft = trigger.right - width;
  const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
  const left = Math.min(
    Math.max(wantedLeft, VIEWPORT_MARGIN),
    Math.max(maxLeft, VIEWPORT_MARGIN),
  );

  return {
    left,
    bottom: Math.max(window.innerHeight - trigger.top + GAP, VIEWPORT_MARGIN),
    maxHeight: Math.max(trigger.top - GAP - VIEWPORT_MARGIN, 160),
  };
}

/**
 * 技能选择 Dropdown。
 *
 * 结构：触发器（⚡ 技能 (N) + 箭头）→ 弹层
 *   顶部  Search Input（按 name / description 过滤）
 *   中间  Scrollable listbox：每行 = Checkbox + Title + Description
 *   底部  操作区：已选数量 + 清空 / 完成
 *
 * 选中的技能会进 system prompt（服务端 `skillsOverride` 过滤 skillsDir 的结果），
 * 切换需要重建 runtime，所以流式输出期间禁用。
 */
export default function SkillPicker({
  active,
  available,
  disabled = false,
  saving = false,
  error,
  onChange,
}: SkillPickerProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [skills, setSkills] = useState<SkillOption[]>(available);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogId = useId();

  const count = active.length;
  /** 流式输出时服务端会拒绝重建 runtime，弹层直接视为关闭 */
  const isOpen = open && !disabled;
  /** 每次打开递增：丢弃过期的 /api/skills 响应 */
  const fetchTicketRef = useRef(0);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return skills;
    return skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(keyword) ||
        skill.description.toLowerCase().includes(keyword),
    );
  }, [skills, query]);

  /**
   * 打开：重置搜索词 → 刷一次 skillsDir（可能有新技能 / 新的 warnings）。
   * 拉取放在事件里而不是 effect 里，避免 effect 同步 setState 引起级联渲染。
   */
  function openPanel() {
    setQuery("");
    setOpen(true);
    setRefreshing(true);
    const ticket = ++fetchTicketRef.current;
    void listSkills()
      .then((result) => {
        if (fetchTicketRef.current !== ticket) return;
        setSkills(result.skills);
        setWarnings(result.warnings);
      })
      .catch(() => {
        if (fetchTicketRef.current !== ticket) return;
        // 拉失败就用配置里带的那份，不影响选择
        setSkills(available);
        setWarnings([]);
      })
      .finally(() => {
        if (fetchTicketRef.current !== ticket) return;
        setRefreshing(false);
        // 搜索框是弹层的第一个落点：打开即可打字过滤
        searchRef.current?.focus();
      });
  }

  function closePanel() {
    setOpen(false);
  }

  // ── 定位：先用 visibility:hidden 渲染，量完再显示，避免闪一下 ──
  useLayoutEffect(() => {
    if (!isOpen) return;

    const update = () => {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      setPlacement(
        placeAbove(trigger.getBoundingClientRect(), {
          width: panel.offsetWidth,
        }),
      );
    };

    update();
    window.addEventListener("resize", update);
    // 捕获阶段：输入框 / 侧栏内部滚动也要跟
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [isOpen, filtered.length, warnings.length, error, saving]);

  // ── 外点关闭 ──
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      closePanel();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  // ── Esc 关闭 ──
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      closePanel();
      // Esc 是键盘关闭：焦点必须回到触发器，否则会掉到 body
      requestAnimationFrame(() => triggerRef.current?.focus());
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  function toggle(name: string) {
    if (disabled) return;
    const next = active.includes(name)
      ? active.filter((item) => item !== name)
      : [...active, name];
    onChange(next);
  }

  /** 方向键在列表里上下走；搜索框按 ↓ 进入列表 */
  function focusRow(offset: number) {
    const rows = listRef.current?.querySelectorAll<HTMLElement>(
      "[data-skill-option]",
    );
    if (!rows || rows.length === 0) return;
    const index = Array.from(rows).indexOf(document.activeElement as HTMLElement);
    const next = index === -1 ? 0 : Math.min(Math.max(index + offset, 0), rows.length - 1);
    rows[next]?.focus();
  }

  function handlePanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusRow(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      // 已经在第一项时退回搜索框
      if (document.activeElement === listRef.current?.querySelector("[data-skill-option]")) {
        searchRef.current?.focus();
        return;
      }
      focusRow(-1);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      return;
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (isOpen ? closePanel() : openPanel())}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? dialogId : undefined}
        aria-label={count > 0 ? `技能，已选 ${count} 个` : "技能，未选择"}
        title={count > 0 ? `已启用技能：${active.join("、")}` : "选择技能（可多选）"}
        className={cn(
          "flex h-8 max-w-[200px] items-center gap-1.5 rounded-full border border-line",
          "bg-inset pl-2.5 pr-2 text-[11.5px] font-medium text-ink-2",
          "transition-[background-color,border-color,color,box-shadow] duration-150",
          "hover:border-line-strong hover:bg-hover hover:text-ink",
          "active:scale-[0.98]",
          open && "border-line-strong bg-hover text-ink shadow-hairline",
          count > 0 && !isOpen && "border-line-strong text-ink",
          disabled && "cursor-not-allowed opacity-50 active:scale-100",
        )}
      >
        <Zap
          size={12}
          className={cn("shrink-0", count > 0 ? "text-accent-ink" : "text-ink-3")}
          aria-hidden
        />
        <span className="truncate">
          技能{count > 0 ? ` (${count})` : ""}
        </span>
        {saving ? (
          <LoaderCircle
            size={12}
            className="shrink-0 animate-spin text-ink-3"
            aria-hidden
          />
        ) : isOpen ? (
          <ChevronDown size={12} className="shrink-0 text-ink-3" aria-hidden />
        ) : (
          <ChevronUp size={12} className="shrink-0 text-ink-3" aria-hidden />
        )}
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={panelRef}
            id={dialogId}
            role="dialog"
            aria-label="选择技能"
            data-skill-picker-popover
            onKeyDown={handlePanelKeyDown}
            className={cn(
              "fixed z-50 flex w-[340px] max-w-[calc(100vw-16px)] flex-col",
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
            {/* ── 顶部：搜索框 ── */}
            <div className="relative px-0.5 pb-1.5">
              <Search
                size={13}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
                aria-hidden
              />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索技能…"
                aria-label="搜索技能"
                autoComplete="off"
                spellCheck={false}
                className={cn(
                  "h-8 w-full rounded-control border border-line bg-inset",
                  "pl-8 pr-7 text-[12px] text-ink placeholder:text-ink-3",
                  "outline-none transition-colors duration-150",
                  "focus:border-line-strong focus:bg-surface",
                )}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    searchRef.current?.focus();
                  }}
                  aria-label="清空搜索"
                  className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-full text-ink-3 hover:bg-hover hover:text-ink"
                >
                  <X size={11} aria-hidden />
                </button>
              )}
            </div>

            {/* ── 中间：可滚动的技能列表 ── */}
            <div
              ref={listRef}
              role="listbox"
              aria-label="技能候选"
              aria-multiselectable="true"
              className="min-h-0 flex-1 overflow-y-auto"
            >
              {skills.length === 0 ? (
                <p className="px-2.5 py-3 text-[11px] leading-relaxed text-ink-3">
                  没有可用技能。把技能目录放到后端的 skillsDir 下（每个技能一个子目录，里面有 SKILL.md）后重开这个面板。
                </p>
              ) : filtered.length === 0 ? (
                <p className="px-2.5 py-3 text-[11px] leading-relaxed text-ink-3">
                  没有匹配「{query.trim()}」的技能。
                </p>
              ) : (
                filtered.map((skill) => {
                  const selected = active.includes(skill.name);
                  return (
                    <button
                      key={skill.name}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      data-skill-option
                      disabled={disabled}
                      onClick={() => toggle(skill.name)}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-control px-2.5 py-1.5 text-left",
                        "transition-colors duration-150 disabled:cursor-not-allowed",
                        selected
                          ? "bg-accent-tint"
                          : "hover:bg-hover focus-visible:bg-hover",
                      )}
                    >
                      {/* Checkbox */}
                      <span
                        aria-hidden
                        className={cn(
                          "mt-[3px] grid size-[15px] shrink-0 place-items-center rounded-[4px] border",
                          "transition-[background-color,border-color,color] duration-150",
                          selected
                            ? "border-accent bg-accent text-surface"
                            : "border-line-strong bg-surface text-transparent",
                        )}
                      >
                        <Check size={11} strokeWidth={3} />
                      </span>

                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "flex items-center gap-1.5 text-[12.5px] font-medium",
                            selected ? "text-accent-ink" : "text-ink",
                          )}
                        >
                          <span className="truncate">{skill.name}</span>
                          {skill.disableModelInvocation && (
                            <span className="shrink-0 rounded-chip bg-inset px-1 py-px text-[9px] font-medium text-ink-3">
                              仅手动
                            </span>
                          )}
                        </span>
                        {skill.description && (
                          <span className="mt-0.5 line-clamp-2 block text-[10.5px] leading-relaxed text-ink-3">
                            {skill.description}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {/* ── 加载失败提示（SKILL.md 校验不过的技能不会出现，这里给原因） ── */}
            {warnings.length > 0 && (
              <div className="mx-0.5 mt-1 rounded-control bg-inset px-2.5 py-1.5">
                <p className="text-[10.5px] leading-relaxed text-ink-3">
                  {warnings.length} 个技能加载失败：
                </p>
                <ul className="mt-1 space-y-0.5">
                  {warnings.slice(0, 2).map((warning) => (
                    <li
                      key={warning}
                      className="break-all text-[10px] leading-relaxed text-ink-3"
                    >
                      {warning}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ── 底部：操作区 ── */}
            <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-line px-1 pt-1.5">
              <span className="flex items-center gap-1.5 text-[10.5px] text-ink-3">
                {refreshing && (
                  <LoaderCircle size={9} className="animate-spin" aria-hidden />
                )}
                {count > 0 ? `已选 ${count} 个` : "未选择"}
              </span>

              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  disabled={disabled || count === 0}
                  onClick={() => onChange([])}
                  className={cn(
                    "rounded-chip px-1.5 py-1 text-[10.5px] font-medium",
                    "text-ink-3 transition-colors duration-150",
                    "hover:bg-hover hover:text-ink",
                    (disabled || count === 0) && "cursor-not-allowed opacity-50",
                  )}
                >
                  清空
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closePanel();
                    requestAnimationFrame(() => triggerRef.current?.focus());
                  }}
                  className={cn(
                    "rounded-chip bg-ink px-2 py-1 text-[10.5px] font-medium text-surface",
                    "transition-opacity duration-150 hover:opacity-88",
                  )}
                >
                  完成
                </button>
              </div>
            </div>

            {/* ── 保存 / 错误反馈 ── */}
            {(saving || error) && (
              <div className="mx-0.5 mt-1 flex items-start gap-1.5 rounded-control bg-inset px-2.5 py-1.5">
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
                  {error || "正在应用技能选择…"}
                </span>
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}