import { playNotificationSound } from "../../shared/audio/notification-sound";
import type { IssueStatus } from "./issue-commands";

export interface IssueRunningExitContext {
  issueId: number;
  projectId: number;
  fromStatus: "running";
  targetStatus: IssueStatus;
  notificationReminder: boolean;
}

// issue 从 running 切到其他状态时，前端侧异步副作用集中入口。
// 各子钩子并发执行、独立 catch：单个失败不阻断其他副作用，也不影响已成功的状态切换。
// 调用方应以 `void` 触发，不 await；新增 running 切出行为时在此追加子钩子即可。
export async function runIssueRunningExitHooks(
  ctx: IssueRunningExitContext,
): Promise<void> {
  await Promise.allSettled([playReviewNotificationSound(ctx)]);
}

// 仅 running -> review 且开启通知提醒时播放提示音；其他目标状态留作后续扩展占位。
async function playReviewNotificationSound(
  ctx: IssueRunningExitContext,
): Promise<void> {
  if (ctx.targetStatus !== "review" || !ctx.notificationReminder) {
    return;
  }

  playNotificationSound();
}
