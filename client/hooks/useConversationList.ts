import { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationSummary } from "../../shared/types";
import {
  abortConversation,
  deleteConversation,
  listConversation,
  renameConversation,
} from "../api";
import { isBusyStatus } from "../lib/status";

const POLL_INTERVAL = 3000;

/** 历史记录是天粒度（toDateString），新记录是 ISO，两种都要能比较 */
function timestampOf(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** 最近更新的排前面（不依赖服务端排序，历史格式混用也能排） */
function sortByUpdatedAt(list: ConversationSummary[]): ConversationSummary[] {
  return [...list].sort(
    (a, b) => timestampOf(b.updateAt) - timestampOf(a.updateAt),
  );
}

/** 服务端报错偏英文，把可预期的两种翻成人话 */
function friendlyError(cause: unknown, fallback: string): string {
  const message = (cause as Error)?.message ?? "";
  if (message.includes("busy")) return "会话正在运行，请先终止再操作";
  if (message.includes("title cannot be empty")) return "标题不能为空";
  return message || fallback;
}

/**
 * 会话列表数据源。传 activeConversationId 是为了切会话时顺带刷新
 * —— 列表状态是服务端快照，不刷新会一直停在旧值。
 */
export function useConversationList(activeConversationId?: string) {
  const [summaries, setSummaries] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    try {
      const list = await listConversation();
      // 只认最新一次请求：慢的旧响应不许覆盖新数据
      if (requestId !== requestIdRef.current) return;
      setSummaries(sortByUpdatedAt(list));
      setError("");
    } catch (cause) {
      if (requestId !== requestIdRef.current) return;
      setError(friendlyError(cause, "会话列表加载失败"));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  // 首屏 + 会话切换（切换只是刷新触发器）
  useEffect(() => {
    void refresh();
  }, [activeConversationId, refresh]);

  // 有会话在跑时轻量轮询，跑到 ready 自动停
  const hasBusy = summaries.some((item) => isBusyStatus(item.status));
  useEffect(() => {
    if (!hasBusy) return;
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL);
    return () => window.clearInterval(timer);
  }, [hasBusy, refresh]);

  // 切回标签页时对齐一次
  useEffect(() => {
    const handleFocus = () => void refresh();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refresh]);

  /** 重命名：先改本地，失败拉服务端数据回滚 */
  const rename = useCallback(
    async (id: string, title: string) => {
      const cleanedTitle = title.trim();
      if (!cleanedTitle) return;
      setSummaries((current) =>
        current.map((item) =>
          item.id === id ? { ...item, title: cleanedTitle } : item,
        ),
      );
      try {
        const updated = await renameConversation(id, cleanedTitle);
        setSummaries((current) =>
          current.map((item) => (item.id === id ? updated : item)),
        );
      } catch (cause) {
        const message = friendlyError(cause, "重命名失败");
        // 先拉回真实数据再报错：refresh 成功会清空 error
        await refresh();
        setError(message);
      }
    },
    [refresh],
  );

  /** 删除：先从列表抹掉，失败再拉回来（服务端 busy 时会拒绝删除） */
  const remove = useCallback(
    async (id: string) => {
      setSummaries((current) => current.filter((item) => item.id !== id));
      try {
        await deleteConversation(id);
      } catch (cause) {
        const message = friendlyError(cause, "删除失败");
        await refresh();
        setError(message);
      }
    },
    [refresh],
  );

  /** 终止：终止完状态会变，顺手刷新 */
  const abort = useCallback(
    async (id: string) => {
      let message = "";
      try {
        await abortConversation(id);
      } catch (cause) {
        message = friendlyError(cause, "终止失败");
      }
      await refresh();
      if (message) setError(message);
    },
    [refresh],
  );

  return { summaries, loading, error, refresh, rename, remove, abort };
}