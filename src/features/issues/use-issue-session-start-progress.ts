import { useState } from "react";

import { useI18n } from "../../shared/i18n/i18n";
import { useTauriEvent } from "../../shared/tauri-event/use-tauri-event";
import type { IssueSessionStartProgressEvent } from "./issue-commands";
import {
  ISSUE_SESSION_START_PROGRESS_EVENT,
  isIssueSessionStartProgressEvent,
} from "./issue-session-events";

interface UseIssueSessionStartProgressMessageOptions {
  projectId: number;
  issueId: number | null;
  isStartingSession: boolean;
}

export function useIssueSessionStartProgressMessage({
  projectId,
  issueId,
  isStartingSession,
}: UseIssueSessionStartProgressMessageOptions): string {
  const { t } = useI18n();
  const [progress, setProgress] =
    useState<IssueSessionStartProgressEvent | null>(null);

  useTauriEvent(ISSUE_SESSION_START_PROGRESS_EVENT, (payload) => {
    if (!isIssueSessionStartProgressEvent(payload)) {
      return;
    }
    if (payload.projectId !== projectId) {
      return;
    }
    if (issueId == null || payload.issueId !== issueId) {
      return;
    }
    setProgress(payload);
  });

  if (!isStartingSession && progress !== null) {
    setProgress(null);
  }

  if (
    !isStartingSession ||
    progress == null ||
    progress.projectId !== projectId ||
    issueId == null ||
    progress.issueId !== issueId
  ) {
    return t("issues.sessionStarting");
  }
  if (progress.phase === "creating_worktree") {
    return t("issues.sessionStartingCreatingWorktree");
  }
  if (progress.phase === "running_setup_command") {
    return t("issues.sessionStartingSetupCommand");
  }
  return t("issues.sessionStarting");
}
