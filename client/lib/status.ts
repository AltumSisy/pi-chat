import type { RuntimeStatus } from "../../shared/types";

/** 「正在跑」的三种状态：轮询、禁用输入、显示终止按钮都看它 */
export const BUSY_STATUS: RuntimeStatus[] = [
  "running",
  "stopping",
  "compacting",
];

export function isBusyStatus(status: RuntimeStatus): boolean {
  return BUSY_STATUS.includes(status);
}

/** 状态 → 文案（header 徽标、侧栏底部） */
export const STATUS_LABEL: Record<RuntimeStatus, string> = {
  ready: "空闲",
  running: "运行中",
  stopping: "正在停止",
  compacting: "正在压缩上下文",
  error: "出错",
  cold: "未加载",
};