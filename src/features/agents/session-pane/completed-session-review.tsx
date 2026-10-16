import { ArrowLeftRight } from "lucide-react";
import { useState, type ReactNode } from "react";

import { ConfirmContent } from "../../../components/ui/confirm-dialog";
import { Dialog } from "../../../components/ui/dialog";
import { useI18n } from "../../../shared/i18n/i18n";
import { AgentTuiArchiveMarkdownView } from "./agent-tui-archive-markdown-view";

interface CompletedSessionReviewProps {
  projectId: number;
  sessionId: number;
  readOnlySession: ReactNode;
  /** 按钮由标签行渲染；主区只负责归档与只读内容。 */
  showingSession: boolean;
}

/**
 * Issue 已完成时的主区：默认归档，确认后切到只读 Session，再点一次回到归档。
 * 状态只留在当前界面，不写库，不恢复进程。
 */
export function CompletedSessionReview({
  projectId,
  sessionId,
  readOnlySession,
  showingSession,
}: CompletedSessionReviewProps) {
  const { t } = useI18n();

  return (
    <>
      <div
        aria-label={t("agentsFeature.completedArchiveView")}
        hidden={showingSession}
      >
        <AgentTuiArchiveMarkdownView
          projectId={projectId}
          sessionId={sessionId}
        />
      </div>
      <div
        aria-label={t("agentsFeature.readOnlySessionView")}
        hidden={!showingSession}
      >
        {readOnlySession}
      </div>
    </>
  );
}

interface CompletedSessionReviewButtonProps {
  displayMode: "json" | "tui";
  showingSession: boolean;
  onShowArchive: () => void;
  onShowSession: () => void;
}

/** 已完成 Issue 的同一个标签行按钮：归档与只读 Session 来回切。 */
export function CompletedSessionReviewButton({
  displayMode,
  showingSession,
  onShowArchive,
  onShowSession,
}: CompletedSessionReviewButtonProps) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const label = showingSession
    ? t("agentsFeature.backToArchive")
    : displayMode === "json"
      ? t("agentsFeature.switchToMessages")
      : t("agentsFeature.switchToTerminal");

  return (
    <>
      <button
        aria-label={label}
        className="session-workspace-tabs__add"
        type="button"
        onClick={() => {
          if (showingSession) {
            onShowArchive();
            return;
          }
          setConfirming(true);
        }}
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
            confirmLabel={t("agentsFeature.viewReadOnlySessionConfirm")}
            message={t("agentsFeature.viewReadOnlySessionMessage")}
            title={t("agentsFeature.viewReadOnlySessionTitle")}
            onCancel={() => setConfirming(false)}
            onConfirm={() => {
              setConfirming(false);
              onShowSession();
            }}
          />
        </Dialog>
      ) : null}
    </>
  );
}
