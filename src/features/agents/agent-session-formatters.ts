import type { AgentSessionListItem } from "./agent-session-commands";
import type { I18nMessages } from "../../shared/i18n/messages";

export type SessionIssueGroup = "inProcess" | "review" | "done";

/**
 * Agent 是否「实际正在执行一轮 turn」。
 *
 * 判定依据是后端 `is_turn_running`（broadcaster 在 TurnStarted 时写 1，
 * turn 结束经 grace 收尾写 0），比 `issueStatus` 更能反映 agent 此刻的真实运行。
 * 仅当 `status === "running"` 且 `isTurnRunning === true` 时为真；
 * `isTurnRunning` 缺省（旧数据）视为非活跃，避免误报。
 *
 * 用于让 session card 在「issue 处于 review/completed 但 agent 仍在跑」的场景
 * （典型：完成流程 worktree 合并冲突，注入 prompt 后 agent 在解决冲突）
 * 优先按实际运行展示 running，而非静态 issue 状态。
 */
export function isAgentTurnActivelyRunning(
  session: AgentSessionListItem,
): boolean {
  return session.status === "running" && session.isTurnRunning === true;
}

export function formatSessionTitle(session: AgentSessionListItem): string {
  if (session.issueTitle) {
    return session.issueTitle;
  }
  return session.issueTitle ?? session.title ?? `Session #${session.sessionId}`;
}

export function getSessionIssueGroup(
  session: AgentSessionListItem,
): SessionIssueGroup | null {
  switch (session.issueStatus) {
    case "running":
      return "inProcess";
    case "review":
      return "review";
    case "completed":
      return "done";
    case "backlog":
      return null;
    default:
      break;
  }

  if (session.issueId != null) {
    return session.status === "running" ? "inProcess" : "done";
  }

  return session.status === "running" ? "inProcess" : "done";
}

export function formatSessionStatusLabel(
  messages: I18nMessages,
  session: AgentSessionListItem,
): string {
  if (session.status === "crashed") {
    return messages.agentsFeature.sessionCrashed;
  }

  if (session.status === "stopped") {
    return messages.agentsFeature.sessionStopped;
  }

  // agent 实际在跑 turn → running 文案优先，覆盖 issueStatus 的 review/completed。
  if (isAgentTurnActivelyRunning(session)) {
    return messages.agentsFeature.running;
  }

  if (session.issueStatus === "completed") {
    return messages.agentsFeature.done;
  }

  if (session.issueStatus === "review") {
    return messages.agentsFeature.review;
  }

  if (session.issueStatus === "running" && session.isTurnRunning === false) {
    return messages.agentsFeature.inProgress;
  }

  if (session.attention === "requested") {
    return messages.agentsFeature.attentionOutputComplete;
  }

  if (session.status === "running") {
    return messages.agentsFeature.running;
  }

  return messages.agentsFeature.sessionClosed;
}

export function getSessionStatusTone(session: AgentSessionListItem): string {
  if (session.status !== "running") {
    return "done";
  }

  if (session.attention === "requested") {
    return "attention";
  }

  // agent 实际在跑 turn → running 色调优先，覆盖 issueStatus 的 review/completed
  // （完成流程 worktree 合并冲突注入 prompt 后，issue 停在 review 但 agent 在跑）。
  if (isAgentTurnActivelyRunning(session)) {
    return "running";
  }

  if (session.issueStatus === "completed") {
    return "done";
  }

  if (session.issueStatus === "review") {
    return "review";
  }

  if (session.issueStatus === "running" && session.isTurnRunning === false) {
    return "in-progress";
  }

  return "running";
}

export function shouldShowRunningSpinner(
  session: AgentSessionListItem,
): boolean {
  const isTurnRunning =
    session.status === "running" &&
    (session.isTurnRunning ?? session.status === "running");

  if (!isTurnRunning || session.attention === "requested") {
    return false;
  }

  // agent 实际在跑 turn → 转圈优先，覆盖 issueStatus 的 review/completed。
  if (isAgentTurnActivelyRunning(session)) {
    return true;
  }

  return (
    session.issueStatus !== "review" && session.issueStatus !== "completed"
  );
}

export function shouldShowExplicitSessionStatus(
  session: AgentSessionListItem,
): boolean {
  return session.status === "crashed" || session.status === "stopped";
}

// 将毫秒处理时长格式化为秒级本地化字符串。不足 1 秒返回 "-"。
export function formatDuration(ms: number, locale: string): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds <= 0) {
    return "-";
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const isZh = locale === "zh";
  if (hours > 0) {
    return isZh
      ? `${hours}小时${minutes}分${seconds}秒`
      : `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return isZh ? `${minutes}分${seconds}秒` : `${minutes}m ${seconds}s`;
  }
  return isZh ? `${seconds}秒` : `${seconds}s`;
}

// 详情区总耗时展示：crashed/stopped 或无有效处理时长时返回 "-"。
export function formatProcessingDuration(
  session: AgentSessionListItem | null,
  locale: string,
): string {
  if (
    !session ||
    session.processingMs == null ||
    session.processingMs <= 0 ||
    session.status === "crashed" ||
    session.status === "stopped"
  ) {
    return "-";
  }
  return formatDuration(session.processingMs, locale);
}
