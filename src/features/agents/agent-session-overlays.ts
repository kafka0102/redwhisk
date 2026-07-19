import type { AgentSessionListItem } from "./agent-session-commands";

/**
 * 把单条 session 按本地乐观状态覆盖：
 * reviewedIssueIds 把 running issue 折叠成 review；
 * completedIssueIds / closedSessionIds 把 issue 标记 completed、session 标记 closed。
 * 与后端真实状态解耦，用于在事件刷新间隙维持 UI 连续性。
 */
export function applySessionOverlay(
  session: AgentSessionListItem,
  reviewedIssueIds: Set<number>,
  completedIssueIds: Set<number>,
  closedSessionIds: Set<number>,
): AgentSessionListItem {
  let nextSession = session;

  if (
    nextSession.issueId != null &&
    reviewedIssueIds.has(nextSession.issueId) &&
    nextSession.issueStatus === "running"
  ) {
    nextSession = { ...nextSession, issueStatus: "review" as const };
  }

  const shouldCloseSession = closedSessionIds.has(nextSession.sessionId);
  const shouldCompleteIssue =
    nextSession.issueId != null && completedIssueIds.has(nextSession.issueId);

  if (!shouldCloseSession && !shouldCompleteIssue) {
    return nextSession;
  }

  return {
    ...nextSession,
    status: shouldCloseSession ? "closed" : nextSession.status,
    issueStatus: shouldCompleteIssue ? "completed" : nextSession.issueStatus,
    closedAt: shouldCloseSession
      ? Math.max(nextSession.closedAt ?? 0, nextSession.lastActiveAt)
      : nextSession.closedAt,
  };
}

/**
 * 批量应用乐观 overlay。三个集合都为空时直接返回原数组引用，避免无谓 map。
 */
export function applySessionOverlays(
  sessions: AgentSessionListItem[],
  reviewedIssueIds: Set<number>,
  completedIssueIds: Set<number>,
  closedSessionIds: Set<number>,
): AgentSessionListItem[] {
  if (
    reviewedIssueIds.size === 0 &&
    completedIssueIds.size === 0 &&
    closedSessionIds.size === 0
  ) {
    return sessions;
  }

  return sessions.map((session) =>
    applySessionOverlay(
      session,
      reviewedIssueIds,
      completedIssueIds,
      closedSessionIds,
    ),
  );
}

/**
 * 侧栏 transition 菜单的 session 相位：仅 running / review / completed 三态有意义。
 */
export function getSessionTransitionPhase(
  session: AgentSessionListItem | null,
): "running" | "review" | "completed" | null {
  if (!session?.issueId || !session.issueStatus) {
    return null;
  }

  switch (session.issueStatus) {
    case "running":
    case "review":
    case "completed":
      return session.issueStatus;
    default:
      return null;
  }
}
