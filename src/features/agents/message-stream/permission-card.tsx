// 权限审批卡片：渲染后端 `permission_requested` 事件挂起的待审批请求。
//
// 后端在 codex 发起 server→client request（命令执行/文件变更/用户输入）时阻塞，
// 广播 `AgentStreamEvent::PermissionRequested`；用户点击 action 后调
// `respond_agent_permission` 把决策投递回被阻塞的 handler，后端随后广播
// `PermissionResolved` 由 reducer 移除本卡片。
//
// 视觉遵循 DESIGN_GUIDE：黑白灰优先、13px body、1px 边框、无阴影、
// 状态不只靠颜色（kind 图标 + 文字标签 + behavior 按钮变体）。

import { HelpCircle, LoaderCircle, ShieldAlert, Wrench } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui";
import { respondAgentPermission } from "../agent-session-commands";
import type {
  AgentPermissionAction,
  AgentPermissionRequest,
  PermissionKind,
} from "../agent-stream-types";
import type { AgentPermissionDecisionLiteral } from "../agent-session-commands";
import { getCommandErrorMessage } from "../../../shared/commands/command-error";
import { useI18n } from "../../../shared/i18n/i18n";

interface PermissionCardProps {
  request: AgentPermissionRequest;
  projectId: number;
  sessionId: number;
}

const KIND_ICON: Record<PermissionKind, typeof Wrench> = {
  tool: Wrench,
  plan: ShieldAlert,
  question: HelpCircle,
  mode: ShieldAlert,
  other: ShieldAlert,
};

const KIND_LABEL_KEY: Record<PermissionKind, string> = {
  tool: "agentsFeature.permissionKindTool",
  plan: "agentsFeature.permissionKindPlan",
  question: "agentsFeature.permissionKindQuestion",
  mode: "agentsFeature.permissionKindMode",
  other: "agentsFeature.permissionKindOther",
};

export function PermissionCard({
  request,
  projectId,
  sessionId,
}: PermissionCardProps) {
  const { messages, t } = useI18n();
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const KindIcon = KIND_ICON[request.kind] ?? ShieldAlert;
  const kindLabel = t(KIND_LABEL_KEY[request.kind] ?? KIND_LABEL_KEY.other);

  async function handleAction(action: AgentPermissionAction) {
    const decision = toDecisionLiteral(action.id);
    if (decision === null) {
      setErrorMessage(
        t("agentsFeature.permissionActionUnrecognized", {
          actionId: action.id,
        }),
      );
      return;
    }
    setPendingActionId(action.id);
    setErrorMessage(null);
    try {
      await respondAgentPermission({
        projectId,
        sessionId,
        requestId: request.id,
        decision,
      });
      // 成功后由 reducer 的 permission_resolved 事件移除本卡片，无需手动处理。
    } catch (error) {
      setErrorMessage(getCommandErrorMessage(error, t));
      setPendingActionId(null);
    }
  }

  return (
    <article
      className="agents-message__entry agents-permission-card"
      aria-label={messages.agentsFeature.permissionCard}
      data-request-id={request.id}
    >
      <div className="agents-permission-card__header">
        <KindIcon
          aria-hidden="true"
          size={14}
          strokeWidth={1.8}
          className="agents-permission-card__icon"
        />
        <span className="agents-permission-card__kind">{kindLabel}</span>
      </div>
      {request.title ? (
        <p className="agents-permission-card__title">{request.title}</p>
      ) : null}
      {request.description ? (
        <p className="agents-permission-card__description">
          {request.description}
        </p>
      ) : null}
      <div className="agents-permission-card__actions">
        {request.actions.map((action) => {
          const isPending = pendingActionId === action.id;
          const isDisabled = pendingActionId !== null;
          return (
            <Button
              key={action.id}
              type="button"
              variant={action.behavior === "allow" ? "default" : "destructive"}
              size="sm"
              disabled={isDisabled}
              onClick={() => void handleAction(action)}
            >
              {isPending ? (
                <LoaderCircle
                  aria-hidden="true"
                  size={13}
                  strokeWidth={2}
                  className="agents-message__spinner"
                />
              ) : null}
              {action.label}
            </Button>
          );
        })}
      </div>
      {errorMessage ? (
        <p className="agents-permission-card__error" role="status">
          {errorMessage}
        </p>
      ) : null}
    </article>
  );
}

/**
 * 把 action.id（后端保证为 accept/decline/cancel）映射为 decision 字面量。
 *
 * 后端 `default_permission_actions()` 固定产出 accept(Allow) + decline(Deny)，
 * 未来若扩展 cancel 也会沿用同一字面量集。无法识别时返回 null 由调用方报错。
 */
function toDecisionLiteral(
  actionId: string,
): AgentPermissionDecisionLiteral | null {
  if (
    actionId === "accept" ||
    actionId === "decline" ||
    actionId === "cancel"
  ) {
    return actionId;
  }
  return null;
}
