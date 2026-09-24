export const AGENT_SESSION_LIST_CHANGED_EVENT = "agent-session-list-changed";

export interface AgentSessionListChangedEvent {
  projectId: number;
  sessionId: number | null;
  reason: string;
}

/**
 * 会话列表变更事件是否命中某个消费方（变更模块各消费点共用的「事件 → 是否失效」判定：
 * running 重算、变更 Activity、会话右侧栏变更 Tab；agents 列表与通知等更早的消费方各自判定）。
 *
 * 事件随会话列表变化广播（回合开始 / 结束、prompt 注入等），因此它是「Agent 可能刚
 * 提交了代码」当前最早且已跨窗口可用的失效信号（应用内没有 commit 命令：提交提示由
 * Issue 完成流程注入，真正的 `git commit` 发生在回合内）。消费方按项目判定；会话侧栏
 * 再按会话判定——payload 的 `sessionId` 为 null 表示项目级变更，视为命中本会话。
 */
export function isAgentSessionListChangedFor(
  event: AgentSessionListChangedEvent,
  scope: { projectId: number; sessionId?: number | null },
): boolean {
  if (event.projectId !== scope.projectId) {
    return false;
  }
  const sessionId = scope.sessionId ?? null;
  if (sessionId === null) {
    return true;
  }
  return event.sessionId === null || event.sessionId === sessionId;
}
