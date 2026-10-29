import { useEffect, useRef, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronRight, CircleStop, Sparkles, SquarePen } from "lucide-react";
import { useConversationList } from "../hooks/useConversationList";
import { isBusyStatus, STATUS_LABEL } from "../lib/status";
import { useConversationStream2 } from "../hooks/useConversationStream2";
import { useConversationConfig } from "../hooks/useConversationConfig";
import { MessageItem } from "./MessageItem";
import LoadingState from "./primitives/LoadingState";
import ModelConfigPill from "./primitives/ModelConfigPill";
import PromptBar from "./primitives/PromptBar";
import type { ConfirmCopy } from "./primitives/ConfirmPopover";
import SidebarNav, { type SidebarRecent } from "./primitives/SidebarNav";
import type { ConversationSummary } from "../../shared/types";

/** 空状态时展示的建议 prompt */
const suggestedPrompts = [
  "帮我制定本周的学习计划",
  "解释一个复杂的技术概念",
  "帮我整理一份项目方案",
];

/** 服务端目前不会自动起标题，创建时都是这个值 */
const DEFAULT_TITLE = "New Conversation";

/** 标题还是默认值就用短 id 兜底，否则侧栏是一整列同名 */
function conversationLabel(item: ConversationSummary): string {
  const title = item.title.trim();
  if (!title || title === DEFAULT_TITLE) return `会话 ${item.id.slice(0, 6)}`;
  return title;
}

export default function AgentHarness(): ReactNode {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const { messageItems, loading, error, send } =
    useConversationStream2(conversationId);
  const {
    config,
    loading: configLoading,
    saving: configSaving,
    error: configError,
    setModel,
    setThinkingLevel,
    flush: flushConfig,
  } = useConversationConfig(conversationId);
  const {
    summaries,
    loading: listLoading,
    error: listError,
    refresh,
    rename,
    remove,
    abort,
  } = useConversationList(conversationId);

  const bottomRef = useRef<HTMLDivElement>(null);
  const submittedRef = useRef(false);

  const isEmpty = messageItems.length === 0;
  const active = summaries.find((item) => item.id === conversationId);
  const activeLabel = active ? conversationLabel(active) : "新会话";
  const recents: SidebarRecent[] = summaries.map((item) => ({
    id: item.id,
    label: conversationLabel(item),
    status: item.status,
  }));

  // ── 发送消息后 smooth 滚到底 ──
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
  }, [loading, messageItems, isEmpty]);

  function handleSend(text: string) {
    submittedRef.current = true;
    // 先把模型 / 推理强度的待提交改动落盘，确保本轮请求用上最新配置
    void (async () => {
      await flushConfig();
      await send(text);
      refresh();
    })();
  }

  /** 不立刻建会话：回空状态，首次发送时才创建，避免列表堆空记录 */
  function handleNewChat() {
    if (conversationId) navigate("/");
  }

  function handlePick(id: string) {
    if (id !== conversationId) navigate(`/conversation/${id}`);
  }

  function handleDelete(id: string) {
    // 走到这里用户已经在行内确认过了（ConfirmPopover），直接删
    // 先离开当前会话，避免 SSE 还挂在被删掉的会话上
    if (id === conversationId) navigate("/");
    void remove(id);
  }

  /** 就地确认文案：用列表里同一个 label，避免弹层和侧栏叫法不一致 */
  function deleteConfirmCopy(item: SidebarRecent): ConfirmCopy {
    return {
      title: `删除「${item.label}」？`,
      description: "会话记录与工作区文件都会被删除，无法恢复。",
      confirmLabel: "删除",
    };
  }

  /** 侧栏底部：当前会话状态 + 跑着的时候给个终止入口 */
  const sidebarFooter = active ? (
    <div className="flex flex-col gap-2">
      <span className="px-1 text-[11.5px] text-ink-3">
        {STATUS_LABEL[active.status]}
      </span>
      {isBusyStatus(active.status) && (
        <button
          type="button"
          onClick={() => void abort(active.id)}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-control
                     bg-hover-2 text-[12.5px] font-medium text-ink
                     transition-[background-color,transform] duration-150
                     hover:bg-line-strong active:scale-[0.98]"
        >
          <CircleStop size={14} />
          终止生成
        </button>
      )}
    </div>
  ) : undefined;

  return (
    <div className="flex h-screen overflow-hidden bg-page">
      {/* ════════════════════════════════════════════
          左侧导航：工作区 / 新建会话 / 会话列表
          ════════════════════════════════════════════ */}
      <SidebarNav
        workspace={{ key: "pi-chat", name: "Pi Chat", monogram: "P" }}
        menuActions={[
          { key: "new-chat", label: "新建会话", icon: <SquarePen size={16} /> },
        ]}
        onMenuAction={(key) => {
          if (key === "new-chat") handleNewChat();
        }}
        activeId={conversationId ?? null}
        recents={recents}
        recentsLoading={listLoading}
        onNewChat={handleNewChat}
        onPick={handlePick}
        onRename={(id, title) => void rename(id, title)}
        onDelete={handleDelete}
        deleteConfirm={deleteConfirmCopy}
        footer={sidebarFooter}
      />

      {/* ════════════════════════════════════════════
          右列：main 自己滚动，footer 是 flex 兄弟节点所以自然吸底
          （不再用 fixed，否则会盖住侧栏）
          ════════════════════════════════════════════ */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* ── Header：当前会话标题 + 状态 ── */}
        <header
          className="flex h-16 shrink-0 items-center gap-3 border-b border-line
                     bg-surface/94 px-6 backdrop-blur-sm"
        >
          <span className="min-w-0 flex-1 truncate text-[17px] font-semibold tracking-[-0.02em] text-ink">
            {activeLabel}
          </span>
          {active && (
            <span className="shrink-0 rounded-chip bg-inset px-2 py-1 text-[11px] font-medium text-ink-3">
              {STATUS_LABEL[active.status]}
            </span>
          )}
        </header>

        {/* ── Main：消息区 ── */}
        <main className="flex-1 overflow-y-auto">
          {isEmpty ? (
            /* ── 空状态 ── */
            <div className="flex min-h-full items-center justify-center">
              <div className="w-full max-w-[560px] px-6 text-center">
                {/* 图标 */}
                <div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-inset">
                  <Sparkles size={22} className="text-ink" />
                </div>

                <h1 className="mb-2 text-[26px] font-semibold tracking-[-0.035em] text-ink">
                  有什么我可以帮你？
                </h1>
                <p className="mb-5 text-[13px] text-ink-3">
                  输入问题，或从下面的建议开始一段新对话。
                </p>

                {/* 建议 Prompt */}
                <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-1">
                  {suggestedPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => handleSend(prompt)}
                      className="flex min-h-[58px] items-center justify-between gap-2
                                 rounded-control border border-line bg-surface p-[10px_11px]
                                 text-left text-xs text-ink-2 transition-colors
                                 hover:border-line-strong hover:bg-hover hover:text-ink"
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
            <div className="mx-auto max-w-[960px] px-6 py-8">
              {messageItems.map((item) => (
                <MessageItem key={item.id} item={item} />
              ))}

              {/* 加载指示器 */}
              {loading && <LoadingState label="正在生成" />}

              {/* 底部锚点（滚动目标） */}
              <div ref={bottomRef} className="h-6" aria-hidden />
            </div>
          )}

          {/* ── 错误提示：流错误 + 列表操作失败 + 配置保存失败 ── */}
          {(error || listError || configError) && (
            <div className="mx-auto max-w-[960px] px-6 pb-4">
              <div
                className="w-fit max-w-full rounded-md bg-red-tint px-2.5 py-1.5 text-xs text-red"
                role="alert"
              >
                {error || listError || configError}
              </div>
            </div>
          )}
        </main>

        {/* ── Composer：底部输入区 ── */}
        <footer className="shrink-0 bg-gradient-to-t from-page via-page to-transparent px-6 pb-4 pt-3">
          <div className="mx-auto max-w-[960px]">
            <PromptBar
              onSend={handleSend}
              loading={loading}
              placeholder="输入消息，按 Enter 发送…"
              actions={
                config ? (
                  <ModelConfigPill
                    config={config}
                    disabled={loading}
                    saving={configSaving}
                    error={configError}
                    onModelChange={setModel}
                    onThinkingLevelChange={setThinkingLevel}
                  />
                ) : conversationId && configLoading ? (
                  <span
                    aria-hidden
                    className="block h-8 w-[148px] animate-pulse rounded-full bg-inset"
                  />
                ) : undefined
              }
            />
            <div className="mt-1.5 text-[10px] text-ink-3">
              <span>Enter 发送 · Shift + Enter 换行</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
