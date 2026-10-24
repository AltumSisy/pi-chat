import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Sparkles,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import type { RuntimeStatus } from "../../../shared/types";
import { cn } from "../../lib/utils";
import ConfirmPopover, { type ConfirmCopy } from "./ConfirmPopover";
import GlideMenu from "./GlideMenu";

/* ─────────────────────────────────────────────────────────
 * SIDEBAR NAV
 * 左侧导航栏：工作区标识 / 新建会话 / 会话搜索与列表 / 折叠。
 * 纯展示组件 —— 数据、路由、确认弹窗都由外部注入（AgentHarness）。
 * 折叠时只留图标，文案淡出但图标的 x 坐标不变，所以不会有跳动。
 * ───────────────────────────────────────────────────────── */

export type SidebarWorkspace = {
  key: string;
  name: string;
  monogram?: string;
};

export type SidebarMenuAction = {
  key: string;
  label: string;
  icon?: ReactNode;
};

export type SidebarRecent = {
  id: string;
  label: string;
  /** 会话运行状态，用于行首状态点（ready 不显示） */
  status?: RuntimeStatus;
};

type SidebarNavProps = {
  /** 工作区标识（本项目就是品牌位：Pi Chat） */
  workspace: SidebarWorkspace;
  /** 工作区菜单里的动作；不传则只显示当前工作区 */
  menuActions?: SidebarMenuAction[];
  /** 当前会话 id —— 用 id 匹配而不是标题，标题可能重复 */
  activeId?: string | null;
  recents: SidebarRecent[];
  /** 首次拉取列表时的骨架占位 */
  recentsLoading?: boolean;
  /** 受控折叠；不传则内部自管并记忆到 localStorage */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  onNewChat?: () => void;
  onPick?: (id: string) => void;
  /** 行内改名；空标题自动忽略 */
  onRename?: (id: string, title: string) => void;
  /** 行内删除；确认通过后才会回调 */
  onDelete?: (id: string) => void;
  /** 删除前的就地确认文案（按行生成）；不传用通用文案 */
  deleteConfirm?: (item: SidebarRecent) => ConfirmCopy | undefined;
  onMenuAction?: (key: string) => void;
  /** 底部插槽（模型信息、终止生成…） */
  footer?: ReactNode;
  className?: string;
};

const COLLAPSE_STORAGE_KEY = "pi-chat:sidebar-collapsed";

/** 调用方没给 deleteConfirm 时的兜底文案 */
const DEFAULT_DELETE_CONFIRM: ConfirmCopy = {
  title: "删除该会话？",
  description: "会话记录与工作区文件都会被删除，无法恢复。",
  confirmLabel: "删除",
};

const SIDEBAR_MOTION = {
  expandedWidth: 224,
  collapsedWidth: 52,
  duration: 280,
  copyDuration: 180,
  copyOffset: 8,
  easing: "cubic-bezier(0.16, 1, 0.3, 1)",
};

const CHAT_SEARCH_MOTION = {
  duration: 180,
  closedWidth: 28,
  easing: "cubic-bezier(0.16, 1, 0.3, 1)",
};

/** 运行状态 → 状态点配色（ready 表示空闲，不画点） */
const RECENT_STATUS_DOT: Partial<Record<RuntimeStatus, string>> = {
  running: "bg-accent animate-pulse",
  compacting: "bg-accent animate-pulse",
  stopping: "bg-orange",
  error: "bg-red",
  cold: "bg-line-strong",
};

function readStoredCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "true";
  } catch {
    // 隐私模式下 localStorage 可能不可用，静默降级
    return false;
  }
}

function GlideGroup({ children }: { children: ReactNode }): ReactNode {
  return (
    <GlideMenu
      rowSelector="[data-row]"
      highlightClassName="sidebar-glide-highlight rounded-control bg-hover-2"
      className="group/glide flex flex-col gap-px"
    >
      {children}
    </GlideMenu>
  );
}

/** 顶部固定导航行（新建会话） */
function RailButton({
  icon,
  label,
  active = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}): ReactNode {
  return (
    <button
      data-row
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "sidebar-row relative z-10 mx-2 flex h-8 items-center rounded-control px-2 text-left",
        "transition-[width,background-color,color,transform] duration-150 active:scale-[0.98]",
        active && "bg-hover-2 group-hover/glide:bg-transparent",
      )}
    >
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center",
          active ? "text-ink" : "text-ink-2",
        )}
      >
        {icon}
      </span>
      <span
        className={cn(
          "sidebar-copy ml-1.5 min-w-0 flex-1 truncate text-[14px] font-medium",
          active ? "text-ink" : "text-ink-2",
        )}
      >
        {label}
      </span>
    </button>
  );
}

/** 工作区菜单：portal 到 body，位置对齐触发按钮 */
function WorkspaceMenu({
  workspace,
  actions,
  position,
  onAction,
  onClose,
}: {
  workspace: SidebarWorkspace;
  actions: SidebarMenuAction[];
  position: { top: number; left: number };
  onAction?: (key: string) => void;
  onClose: () => void;
}): ReactNode {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const monogram =
    workspace.monogram ?? workspace.name.slice(0, 1).toUpperCase();

  return createPortal(
    <div
      data-workspace-menu
      className="fixed z-50 w-64 rounded-window bg-surface p-1.5 shadow-overlay"
      style={{
        top: position.top,
        left: position.left,
        animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both",
        transformOrigin: "top left",
      }}
    >
      <GlideMenu
        className="flex flex-col gap-px"
        highlightClassName="inset-x-0 rounded-control bg-hover-2"
      >
        <button
          data-menu-row
          type="button"
          onClick={onClose}
          className="relative z-10 flex h-10 w-full items-center gap-1.5 rounded-control px-2 text-left"
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-chip bg-ink text-[11px] font-semibold text-surface">
            {monogram}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">
            {workspace.name}
          </span>
          <span className="shrink-0 text-ink">
            <Check size={18} />
          </span>
        </button>

        {actions.length > 0 && <div className="my-1 h-px bg-line" />}

        {actions.map((action) => (
          <button
            key={action.key}
            data-menu-row
            type="button"
            onClick={() => {
              onAction?.(action.key);
              onClose();
            }}
            className="relative z-10 flex h-9 w-full items-center gap-1.5 rounded-control px-2 text-left"
          >
            {action.icon && (
              <span className="flex size-5 shrink-0 items-center justify-center text-ink-2">
                {action.icon}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">
              {action.label}
            </span>
          </button>
        ))}
      </GlideMenu>
    </div>,
    document.body,
  );
}

export default function SidebarNav({
  workspace,
  menuActions = [],
  activeId,
  recents,
  recentsLoading = false,
  collapsed,
  onCollapsedChange,
  onNewChat,
  onPick,
  onRename,
  onDelete,
  deleteConfirm,
  onMenuAction,
  footer,
  className,
}: SidebarNavProps): ReactNode {
  const [internalCollapsed, setInternalCollapsed] = useState(readStoredCollapsed);
  const isCollapsed = collapsed ?? internalCollapsed;
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspacePosition, setWorkspacePosition] = useState({
    top: 0,
    left: 0,
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const workspaceButtonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleRecents = normalizedQuery
    ? recents.filter((item) => item.label.toLowerCase().includes(normalizedQuery))
    : recents;
  const hasRowActions = Boolean(onRename || onDelete);

  const setCollapsed = (next: boolean) => {
    if (collapsed === undefined) {
      setInternalCollapsed(next);
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next));
      } catch {
        // 存不了就算了，不影响交互
      }
    }
    onCollapsedChange?.(next);
  };

  // 点击外部关闭工作区菜单
  useEffect(() => {
    if (!workspaceOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Element;
      if (
        !target.closest("[data-workspace-trigger]") &&
        !target.closest("[data-workspace-menu]")
      ) {
        setWorkspaceOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [workspaceOpen]);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const collapse = () => {
    setEditingId(null);
    setWorkspaceOpen(false);
    setSearchOpen(false);
    setQuery("");
    setCollapsed(true);
  };

  const commitRename = () => {
    if (!editingId) return;
    const title = draft.trim();
    if (title) onRename?.(editingId, title);
    setEditingId(null);
  };

  return (
    <aside
      data-sidebar-collapsed={isCollapsed}
      aria-label="会话导航"
      className={cn(
        "relative flex h-full shrink-0 overflow-hidden border-r border-line bg-surface",
        "transition-[width]",
        className,
      )}
      style={
        {
          width: isCollapsed
            ? SIDEBAR_MOTION.collapsedWidth
            : SIDEBAR_MOTION.expandedWidth,
          transitionDuration: `${SIDEBAR_MOTION.duration}ms`,
          transitionTimingFunction: SIDEBAR_MOTION.easing,
          "--sidebar-copy-duration": `${SIDEBAR_MOTION.copyDuration}ms`,
          "--sidebar-copy-offset": `${SIDEBAR_MOTION.copyOffset}px`,
          "--sidebar-easing": SIDEBAR_MOTION.easing,
        } as CSSProperties
      }
    >
      <div className="flex min-h-0 w-[224px] shrink-0 flex-col">
        {/* ── 工作区 / 折叠按钮 ─────────────────────────── */}
        <div className="relative mb-2.5 h-10 shrink-0">
          <button
            ref={workspaceButtonRef}
            data-workspace-trigger
            type="button"
            aria-expanded={workspaceOpen}
            aria-hidden={isCollapsed}
            tabIndex={isCollapsed ? -1 : 0}
            onClick={() => {
              if (!workspaceOpen && workspaceButtonRef.current) {
                const rect = workspaceButtonRef.current.getBoundingClientRect();
                setWorkspacePosition({ top: rect.bottom + 6, left: rect.left });
              }
              setWorkspaceOpen((open) => !open);
            }}
            className="sidebar-workspace-control absolute left-2 top-1 flex h-8 w-[164px] items-center rounded-control px-2 text-left transition-[background-color,transform] duration-100 hover:bg-hover-2 active:scale-[0.99]"
          >
            <span className="sidebar-logo flex size-5 shrink-0 items-center justify-center text-ink">
              <Sparkles size={18} />
            </span>
            <span className="sidebar-copy ml-1.5 min-w-0 flex-1 truncate text-[14px] font-medium text-ink-2">
              {workspace.name}
            </span>
            <span className="sidebar-copy ml-1 flex shrink-0 text-ink-3">
              <ChevronDown size={16} />
            </span>
          </button>

          {workspaceOpen && (
            <WorkspaceMenu
              workspace={workspace}
              actions={menuActions}
              position={workspacePosition}
              onAction={onMenuAction}
              onClose={() => setWorkspaceOpen(false)}
            />
          )}

          <button
            type="button"
            aria-label="收起侧边栏"
            aria-hidden={isCollapsed}
            tabIndex={isCollapsed ? -1 : 0}
            onClick={collapse}
            className="sidebar-collapse-control absolute right-2 top-1 flex size-8 items-center justify-center rounded-control text-ink-3 transition-[opacity,background-color,color] duration-150 hover:bg-hover-2 hover:text-ink"
          >
            <PanelLeftClose size={18} />
          </button>

          <button
            type="button"
            aria-label="展开侧边栏"
            aria-hidden={!isCollapsed}
            tabIndex={isCollapsed ? 0 : -1}
            onClick={() => setCollapsed(false)}
            className="sidebar-expand-control absolute left-2 top-0.5 flex size-9 items-center justify-center rounded-control text-ink-3 transition-[opacity,background-color,color] duration-150 hover:bg-hover-2 hover:text-ink"
          >
            <PanelLeftOpen size={18} />
          </button>
        </div>

        {/* ── 固定导航 ─────────────────────────────────── */}
        <GlideGroup>
          <RailButton
            icon={<SquarePen size={18} />}
            label="新建会话"
            onClick={() => {
              setEditingId(null);
              onNewChat?.();
            }}
          />
        </GlideGroup>

        {/* ── 会话区 ───────────────────────────────────── */}
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          <div className="sidebar-copy relative mx-2 mb-1 h-8">
            <div
              aria-hidden={searchOpen}
              className={cn(
                "absolute inset-0 flex items-center gap-1.5 px-2 text-[12.5px] font-medium text-ink-3",
                "transition-[opacity,transform]",
                searchOpen
                  ? "pointer-events-none -translate-x-1 opacity-0"
                  : "translate-x-0 opacity-100",
              )}
              style={{
                transitionDuration: `${CHAT_SEARCH_MOTION.duration}ms`,
                transitionTimingFunction: CHAT_SEARCH_MOTION.easing,
              }}
            >
              <ChevronDown size={16} />
              <span>会话</span>
            </div>

            <button
              type="button"
              aria-label="搜索会话"
              aria-expanded={searchOpen}
              onClick={() => setSearchOpen(true)}
              className={cn(
                "absolute right-0 top-0 z-10 flex size-8 items-center justify-center rounded-control",
                "text-ink-3 transition-[opacity,background-color,color,transform] hover:bg-hover-2 hover:text-ink active:scale-[0.96]",
                searchOpen ? "pointer-events-none opacity-0" : "opacity-100",
              )}
              style={{ transitionDuration: `${CHAT_SEARCH_MOTION.duration}ms` }}
            >
              <Search size={16} />
            </button>

            <div
              className={cn(
                "absolute right-0 top-0 z-20 flex h-8 items-center overflow-hidden rounded-control",
                "bg-field text-ink-3 shadow-hairline transition-[width,opacity] focus-within:text-ink-2",
                searchOpen
                  ? "pointer-events-auto opacity-100"
                  : "pointer-events-none opacity-0",
              )}
              style={{
                width: searchOpen ? "100%" : CHAT_SEARCH_MOTION.closedWidth,
                transitionDuration: `${CHAT_SEARCH_MOTION.duration}ms`,
                transitionTimingFunction: CHAT_SEARCH_MOTION.easing,
              }}
            >
              <span className="ml-2 flex shrink-0 items-center justify-center">
                <Search size={15} />
              </span>
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setSearchOpen(false);
                    setQuery("");
                  }
                }}
                placeholder="搜索会话"
                aria-label="搜索会话历史"
                className="ml-1.5 min-w-0 flex-1 bg-transparent text-[13px] font-medium text-ink outline-none placeholder:text-ink-3"
              />
              <button
                type="button"
                aria-label="关闭搜索"
                onClick={() => {
                  setSearchOpen(false);
                  setQuery("");
                }}
                className="flex size-8 shrink-0 items-center justify-center rounded-control text-ink-3 transition-[background-color,color,transform] duration-150 hover:bg-hover-2 hover:text-ink active:scale-[0.96]"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <GlideGroup>
            {/* 骨架 */}
            {recentsLoading &&
              recents.length === 0 &&
              [0, 1, 2].map((index) => (
                <div
                  key={index}
                  className="sidebar-copy mx-2 flex h-8 items-center rounded-control px-2"
                >
                  <span
                    className="h-3 w-full max-w-[132px] animate-pulse rounded-full bg-hover-2"
                    style={{ animationDelay: `${index * 90}ms` }}
                  />
                </div>
              ))}

            {/* 会话行 */}
            {visibleRecents.map((item) => {
              const active = item.id === activeId;
              const editing = item.id === editingId;
              const dot = item.status
                ? RECENT_STATUS_DOT[item.status]
                : undefined;

              return (
                <div key={item.id} className="group/row relative">
                  <button
                    data-row
                    type="button"
                    title={item.label}
                    aria-current={active ? "page" : undefined}
                    onClick={() => {
                      if (editing) return;
                      onPick?.(item.id);
                    }}
                    className={cn(
                      "sidebar-row relative z-10 mx-2 flex h-8 items-center rounded-control px-2 text-left",
                      "transition-[width,background-color,color,transform] duration-150 active:scale-[0.98]",
                      hasRowActions && "pr-12",
                      active && "bg-hover-2 group-hover/glide:bg-transparent",
                    )}
                  >
                    {dot && (
                      <span
                        aria-hidden
                        className={cn(
                          "mr-1.5 size-1.5 shrink-0 rounded-full",
                          dot,
                        )}
                      />
                    )}
                    {editing ? (
                      <input
                        autoFocus
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitRename();
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setEditingId(null);
                          }
                        }}
                        onBlur={commitRename}
                        aria-label="重命名会话"
                        className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-ink outline-none"
                      />
                    ) : (
                      <span
                        className={cn(
                          "sidebar-copy min-w-0 flex-1 truncate text-[14px] font-medium",
                          active ? "text-ink" : "text-ink-2",
                        )}
                      >
                        {item.label}
                      </span>
                    )}
                  </button>

                  {/* 悬停操作：改名 / 删除（折叠时由 CSS 整体隐藏） */}
                  {hasRowActions && !editing && (
                    <div className="sidebar-row-action pointer-events-none absolute right-2 top-1/2 z-20 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/row:pointer-events-auto group-hover/row:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
                      {onRename && (
                        <button
                          type="button"
                          aria-label={`重命名 ${item.label}`}
                          onClick={() => {
                            setDraft(item.label);
                            setEditingId(item.id);
                          }}
                          className="flex size-6 items-center justify-center rounded-chip text-ink-3 transition-[background-color,color] duration-150 hover:bg-hover-2 hover:text-ink"
                        >
                          <SquarePen size={13} />
                        </button>
                      )}
                      {onDelete && (
                        <ConfirmPopover
                          {...(deleteConfirm?.(item) ?? DEFAULT_DELETE_CONFIRM)}
                          onConfirm={() => onDelete(item.id)}
                        >
                          <button
                            type="button"
                            aria-label={`删除 ${item.label}`}
                            className="flex size-6 items-center justify-center rounded-chip text-ink-3 transition-[background-color,color] duration-150 hover:bg-hover-2 hover:text-red"
                          >
                            <Trash2 size={13} />
                          </button>
                        </ConfirmPopover>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* 空态 */}
            {!recentsLoading && visibleRecents.length === 0 && (
              <div className="sidebar-copy mx-2 px-2 py-2 text-[12.5px] text-ink-3">
                {normalizedQuery ? "没有匹配的会话" : "还没有会话"}
              </div>
            )}
          </GlideGroup>
        </div>

        {/* ── 底部插槽 ─────────────────────────────────── */}
        {footer && (
          <div className="sidebar-copy mx-2 mt-3 w-[208px] border-t border-line pt-3">
            {footer}
          </div>
        )}
      </div>
    </aside>
  );
}