import { useCallback, useEffect, useRef, useState } from "react";
import { getConversationConfig, updateConversationConfig } from "../api";
import type {
  ConversationConfig,
  ConversationConfigUpdate,
  ModelOption,
  ThinkingLevel,
} from "../../shared/types";

/** 拖动滑块时的合并窗口：这段时间内的连续改动只发一次 PATCH */
const THINKING_PATCH_DELAY = 180;

interface ConfigState {
  conversationId?: string;
  config?: ConversationConfig;
  loading: boolean;
  error: string;
}

interface PendingPatch {
  conversationId: string;
  update: ConversationConfigUpdate;
}

interface SavingState {
  conversationId?: string;
  saving: boolean;
}

const EMPTY_STATE: ConfigState = { loading: false, error: "" };

/**
 * 会话级模型 / 推理强度配置。
 *
 * - 读取：切到某个会话时拉一次 `/config`
 * - 修改：先乐观更新本地状态，再把 PATCH 串行排队（滑块改动合并 180ms）
 * - 同步：成功响应覆盖本地（除非期间又有新改动）；失败则回滚到服务端最后一次确认值
 * - flush()：发送消息前调用，保证「下一轮对话」一定用上当前选择
 */
export function useConversationConfig(conversationId?: string) {
  const [state, setState] = useState<ConfigState>(EMPTY_STATE);
  const [savingState, setSavingState] = useState<SavingState>({
    saving: false,
  });

  const conversationIdRef = useRef(conversationId);
  const configRef = useRef<ConversationConfig | undefined>(undefined);
  /** 服务端最后一次确认的配置，用于 PATCH 失败时回滚 */
  const serverConfigRef = useRef<ConversationConfig | undefined>(undefined);
  const pendingRef = useRef<PendingPatch | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** PATCH 串行链：避免同一会话的两次修改互相覆盖 */
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  /** 本地改动版本号：发出请求后又有新改动时，丢弃旧响应 */
  const versionRef = useRef(0);

  conversationIdRef.current = conversationId;

  const runPatch = useCallback(async () => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;

    const { conversationId: targetId, update } = pending;
    const version = versionRef.current;

    setSavingState({ conversationId: targetId, saving: true });
    try {
      const next = await updateConversationConfig(targetId, update);
      if (conversationIdRef.current !== targetId) return;

      serverConfigRef.current = next;
      if (versionRef.current === version && !pendingRef.current) {
        configRef.current = next;
        setState({
          conversationId: targetId,
          config: next,
          loading: false,
          error: "",
        });
      }
    } catch (error) {
      if (conversationIdRef.current !== targetId) return;

      const message =
        (error as Error)?.message || "Failed to update conversation config";
      const fallback = serverConfigRef.current;
      // 没有更新的本地改动时才回滚，否则会把用户刚拖到的位置弹回去
      const canRevert =
        versionRef.current === version &&
        !pendingRef.current &&
        fallback !== undefined;
      if (canRevert) configRef.current = fallback;

      setState((current) =>
        current.conversationId === targetId
          ? {
              conversationId: targetId,
              config: canRevert ? fallback : current.config,
              loading: false,
              error: message,
            }
          : current,
      );
    } finally {
      setSavingState((current) =>
        current.conversationId === targetId
          ? { conversationId: targetId, saving: false }
          : current,
      );
    }
  }, []);

  const enqueue = useCallback(() => {
    chainRef.current = chainRef.current.then(runPatch, runPatch);
  }, [runPatch]);

  const schedule = useCallback(
    (targetId: string, update: ConversationConfigUpdate, immediate: boolean) => {
      pendingRef.current = { conversationId: targetId, update };
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (immediate) {
        enqueue();
        return;
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        enqueue();
      }, THINKING_PATCH_DELAY);
    },
    [enqueue],
  );

  // ── 加载当前会话配置 ──
  useEffect(() => {
    versionRef.current += 1;

    if (!conversationId) {
      configRef.current = undefined;
      serverConfigRef.current = undefined;
      setState(EMPTY_STATE);
      return;
    }

    let cancelled = false;
    const fetchVersion = versionRef.current;
    configRef.current = undefined;
    serverConfigRef.current = undefined;
    setState({ conversationId, loading: true, error: "" });

    void getConversationConfig(conversationId)
      .then((config) => {
        // 请求期间已经改过配置：这份结果过期了，别覆盖用户的选择
        if (cancelled || versionRef.current !== fetchVersion) return;
        configRef.current = config;
        serverConfigRef.current = config;
        setState({ conversationId, config, loading: false, error: "" });
      })
      .catch((error: unknown) => {
        if (cancelled || versionRef.current !== fetchVersion) return;
        setState({
          conversationId,
          loading: false,
          error:
            (error as Error)?.message || "Failed to load conversation config",
        });
      });

    return () => {
      cancelled = true;
      // 切换会话 / 卸载时，别让 debounce 窗口里的改动凭空消失
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (pendingRef.current) enqueue();
    };
  }, [conversationId, enqueue]);

  /** 切换模型：立即提交（模型可能改变可用推理强度，交给服务端收敛后回传） */
  const setModel = useCallback(
    (model: Pick<ModelOption, "provider" | "id">) => {
      const targetId = conversationIdRef.current;
      const current = configRef.current;
      if (!targetId || !current) return;

      versionRef.current += 1;
      const next: ConversationConfig = { ...current, model };
      configRef.current = next;
      setState((value) =>
        value.conversationId === targetId
          ? { ...value, config: next, error: "" }
          : value,
      );

      // 只提交 model，避免把旧模型下的 thinkingLevel 一起带给新模型
      schedule(targetId, { model }, true);
    },
    [schedule],
  );

  /** 调节推理强度：本地立即联动，请求合并后再发 */
  const setThinkingLevel = useCallback(
    (thinkingLevel: ThinkingLevel) => {
      const targetId = conversationIdRef.current;
      const current = configRef.current;
      if (!targetId || !current) return;

      versionRef.current += 1;
      const next: ConversationConfig = { ...current, thinkingLevel };
      configRef.current = next;
      setState((value) =>
        value.conversationId === targetId
          ? { ...value, config: next, error: "" }
          : value,
      );

      const pending = pendingRef.current;
      const update: ConversationConfigUpdate = {
        ...(pending?.conversationId === targetId ? pending.update : {}),
        thinkingLevel,
      };
      schedule(targetId, update, false);
    },
    [schedule],
  );

  /** 发送消息前调用：把还在 debounce / 排队中的修改全部落盘 */
  const flush = useCallback(async () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (pendingRef.current) enqueue();
    await chainRef.current;
  }, [enqueue]);

  const matchesCurrent = state.conversationId === conversationId;

  return {
    config: matchesCurrent ? state.config : undefined,
    loading: matchesCurrent ? state.loading : Boolean(conversationId),
    saving: savingState.saving && savingState.conversationId === conversationId,
    error: matchesCurrent ? state.error : "",
    setModel,
    setThinkingLevel,
    flush,
  };
}