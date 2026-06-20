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
// 规范遵循（agent-development-rules.md / DESIGN_GUIDE）：
// - L188：composer 是 Codex Session View 底部固定输入框
// - L214：上下文窗口用量来自 usage_updated 事件 → state.usage

import { AgentComposer } from "./composer/agent-composer";
import { getAgentCapabilities } from "./agent-capabilities";
import { AgentMessageStreamView } from "./message-stream/agent-message-stream";
import { useAgentMessageStream } from "./message-stream/use-agent-message-stream";
import { PermissionCard } from "./message-stream/permission-card";
import type { AgentType } from "./agent-session-commands";

interface AgentSessionViewProps {
  projectId: number;
  sessionId: number;
  agentType: AgentType;
}

export function AgentSessionView({
  projectId,
  sessionId,
  agentType,
}: AgentSessionViewProps) {
  const { state, dispatch } = useAgentMessageStream({ projectId, sessionId });
  const capabilities = getAgentCapabilities(agentType);

  return (
    <div className="agents-session-view" aria-label="Agent 结构化会话视图">
      <AgentMessageStreamView state={state} />
      {state.pendingPermissions.map((request) => (
        <PermissionCard
          key={request.id}
          request={request}
          projectId={projectId}
          sessionId={sessionId}
        />
      ))}
      <AgentComposer
        projectId={projectId}
        sessionId={sessionId}
        capabilities={capabilities}
        turnStatus={state.turnStatus}
        usage={state.usage}
        currentModelId={state.model}
        onMessageSent={(message) => {
          dispatch({ type: "OPTIMISTIC_USER_MESSAGE", text: message });
        }}
      />
    </div>
  );
}
