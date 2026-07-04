// Agent 结构化会话视图：组合消息流 + 权限卡片 + composer。
//
// 解决双订阅问题：本组件调一次 `useAgentMessageStream` 拿到 `{ state, dispatch }`，
// 把 `state` 下传给 `AgentMessageStreamView`（纯渲染），把 `turnStatus` / `usage` /
// `currentModelId` 下传给 `AgentComposer`，避免消息流与 composer 各自订阅形成双数据源。
//
// 权限卡片消费 `state.pendingPermissions`；用户点击审批后由 reducer 的
// `permission_resolved` 事件自动移除。乐观用户消息合并：composer 发送成功后经
// `onMessageSent` 回调 dispatch `OPTIMISTIC_USER_MESSAGE`，立即在流中展示用户消息。
//
// 性能优化：使用 LRU 缓存 session 状态，切换时立即恢复，避免重新读取 timeline。
//
// 规范遵循（agent-development-rules.md / DESIGN_GUIDE）：
// - L188：composer 是 Codex Session View 底部固定输入框
// - L214：上下文窗口用量来自 usage_updated 事件 → state.usage

import { useCallback, memo, useMemo } from "react";

import { AgentComposer } from "./composer/agent-composer";
import { getAgentCapabilities } from "./agent-capabilities";
import { AgentMessageStreamView } from "./message-stream/agent-message-stream";
import { useAgentMessageStream } from "./message-stream/use-agent-message-stream";
import { PermissionCard } from "./message-stream/permission-card";
import { useI18n } from "../../shared/i18n/i18n";
import {
  resumeStructuredAgentSession,
  type AgentSessionStatus,
  type AgentType,
  type IssueStatus,
} from "./agent-session-commands";

interface AgentSessionViewProps {
  projectId: number;
  sessionId: number;
  agentType: AgentType;
  sessionStatus?: AgentSessionStatus;
  issueStatus?: IssueStatus | null;
  isTurnRunning?: boolean;
}

// memo 化：props 均为 primitive（projectId/sessionId/agentType/sessionStatus/
// issueStatus/isTurnRunning）。实例池模式下 sessions 列表刷新会传入新 session
// 对象引用，但字段值不变时 memo 浅比较可跳过重渲染，避免常驻实例全量重跑
// 消息流 reconciliation（这是切回大 session 极慢的根因）。
export const AgentSessionView = memo(function AgentSessionView({
  projectId,
  sessionId,
  agentType,
  sessionStatus = "running",
  issueStatus = null,
  isTurnRunning = false,
}: AgentSessionViewProps) {
  const { messages } = useI18n();
  const { state, dispatch } = useAgentMessageStream({ projectId, sessionId });
  const capabilities = getAgentCapabilities(agentType);

  // 使用 useMemo 避免不必要的重新计算
  const effectiveTurnStatus = useMemo(() => {
    return state.turnStatus === "running" || isTurnRunning
      ? "running"
      : state.turnStatus;
  }, [state.turnStatus, isTurnRunning]);

  const isReadOnly = issueStatus === "completed";
  const readOnlyReason = isReadOnly
    ? messages.agentsFeature.readOnlyCompletedIssue
    : undefined;
  const shouldResumeBeforeSend =
    sessionStatus !== "running" && issueStatus !== "completed";
  const resumeBeforeSend = useCallback(async () => {
    if (!shouldResumeBeforeSend) {
      return;
    }
    await resumeStructuredAgentSession({ projectId, sessionId });
  }, [projectId, sessionId, shouldResumeBeforeSend]);

  return (
    <div
      className="agents-session-view"
      aria-label={messages.agentsFeature.structuredSessionView}
    >
      {/* 消息流区域先显示轻量加载态，再恢复缓存或历史 timeline。 */}
      <AgentMessageStreamView
        state={state}
        isTurnRunning={isTurnRunning}
        agentType={agentType}
      />

      <div className="agents-session-view__permissions">
        {state.pendingPermissions.map((request) => (
          <PermissionCard
            key={request.id}
            request={request}
            projectId={projectId}
            sessionId={sessionId}
          />
        ))}
      </div>
      {readOnlyReason ? null : (
        <AgentComposer
          key={sessionId}
          projectId={projectId}
          sessionId={sessionId}
          capabilities={capabilities}
          turnStatus={effectiveTurnStatus}
          usage={state.usage}
          currentModelId={state.model}
          currentEffort={state.effort}
          isReadOnly={isReadOnly}
          readOnlyReason={readOnlyReason}
          onBeforeSend={resumeBeforeSend}
          onBeforeSelectModel={resumeBeforeSend}
          onBeforeSetEffort={resumeBeforeSend}
          onMessageSent={(message) => {
            dispatch({ type: "OPTIMISTIC_USER_MESSAGE", text: message });
          }}
        />
      )}
    </div>
  );
});
