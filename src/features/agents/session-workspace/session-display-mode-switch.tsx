import { ArrowLeftRight } from "lucide-react";
import { useState } from "react";

import { ConfirmContent } from "../../../components/ui/confirm-dialog";
import { Dialog } from "../../../components/ui/dialog";
import { useI18n } from "../../../shared/i18n/i18n";
import { getDisplayModeDefaults } from "../../settings/agent-display-mode";
import {
  switchAgentSessionDisplayMode,
  type AgentSessionStatus,
  type AgentType,
  type IssueStatus,
} from "../agent-session-commands";

interface SessionDisplayModeSwitchProps {
  agentType: AgentType;
  displayMode: "json" | "tui";
  issueStatus: IssueStatus | null;
  projectId: number;
  sessionId: number;
  sessionStatus: AgentSessionStatus;
}

export function SessionDisplayModeSwitch({
  agentType,
  displayMode,
  issueStatus,
  projectId,
  sessionId,
  sessionStatus,
}: SessionDisplayModeSwitchProps) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const issueUnfinished = issueStatus === "running" || issueStatus === "review";
  const visible =
    issueUnfinished && getDisplayModeDefaults(agentType).canSwitch;

  const label =
    displayMode === "json"
      ? t("agentsFeature.switchToTerminal")
      : t("agentsFeature.switchToMessages");

  function requestSwitch(): void {
    void switchAgentSessionDisplayMode({ projectId, sessionId });
  }

  function onClick(): void {
    if (sessionStatus === "running") {
      setConfirming(true);
      return;
    }
    requestSwitch();
  }

  if (!visible) {
    return null;
  }

  return (
    <>
      <button
        aria-label={label}
        className="session-workspace-tabs__add session-workspace-tabs__switch"
        type="button"
        onClick={onClick}
      >
        <ArrowLeftRight aria-hidden="true" size={14} strokeWidth={1.8} />
      </button>
      {confirming ? (
        <Dialog
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              setConfirming(false);
            }
          }}
        >
          <ConfirmContent
            confirmLabel={t("agentsFeature.switchDisplayModeConfirm")}
            confirmVariant="destructive"
            message={t("agentsFeature.switchDisplayModeRunning")}
            title={t("agentsFeature.switchDisplayModeTitle")}
            onCancel={() => setConfirming(false)}
            onConfirm={() => {
              setConfirming(false);
              requestSwitch();
            }}
          />
        </Dialog>
      ) : null}
    </>
  );
}
