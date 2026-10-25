import { useRef, useState } from "react";

import type { CompleteIssueFlowResult } from "../issue-commands";
import type { CloseoutFlowDecision } from "./completion-flow-client";

export interface CloseoutDialogState {
  projectId: number;
  workspacePath: string | null;
  workBranch: string | null;
  issueBase: string | null;
}

export function useCloseoutPrompt() {
  const [closeoutDialog, setCloseoutDialog] =
    useState<CloseoutDialogState | null>(null);
  const resolverRef = useRef<
    ((decision: CloseoutFlowDecision | null) => void) | null
  >(null);

  function requestCloseoutDecision(
    result: CompleteIssueFlowResult,
  ): Promise<CloseoutFlowDecision | null> {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setCloseoutDialog({
        projectId: result.issue.projectId,
        workspacePath: result.workspacePath,
        workBranch: result.workspaceBranch,
        issueBase: result.targetBranch,
      });
    });
  }

  function resolveCloseoutDecision(decision: CloseoutFlowDecision | null) {
    resolverRef.current?.(decision);
    resolverRef.current = null;
    setCloseoutDialog(null);
  }

  return {
    closeoutDialog,
    requestCloseoutDecision,
    resolveCloseoutDecision,
  };
}
