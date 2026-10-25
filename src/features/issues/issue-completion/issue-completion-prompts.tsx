import { IssueCompletionDirtyWorkspaceDialog } from "./issue-completion-dirty-workspace-dialog";
import { IssueCompletionCloseoutDialog } from "./issue-completion-closeout-dialog";
import type { CloseoutFlowDecision } from "./completion-flow-client";
import type { CloseoutDialogState } from "./use-closeout-prompt";
import type { DirtyWorkspaceDialogState } from "../use-issue-completion-resolution";
import type { DirtyWorkspaceOption } from "../issue-commands";
import { useI18n } from "../../../shared/i18n/i18n";

interface IssueCompletionPromptsProps {
  dirty: DirtyWorkspaceDialogState | null;
  closeout: CloseoutDialogState | null;
  onDirtyDecision: (
    decision: DirtyWorkspaceOption,
    branchName: string | null,
  ) => void;
  onCloseoutDecision: (decision: CloseoutFlowDecision | null) => void;
}

export function IssueCompletionPrompts({
  dirty,
  closeout,
  onDirtyDecision,
  onCloseoutDecision,
}: IssueCompletionPromptsProps) {
  const { messages } = useI18n();
  return (
    <>
      {dirty ? (
        <IssueCompletionDirtyWorkspaceDialog
          title={messages.issues.completionDirtyTitle}
          message={messages.issues.completionDirtyMessage}
          branchName={dirty.branchName}
          branchNameEditable={dirty.branchNameEditable}
          branchNameLabel={messages.issues.completionBranchNameLabel}
          autoCommitLabel={messages.issues.completionAutoCommit}
          skipLabel={messages.issues.completionSkipDirty}
          cancelLabel={messages.issues.completionCancel}
          onDecision={onDirtyDecision}
        />
      ) : null}
      {closeout ? (
        <IssueCompletionCloseoutDialog
          state={closeout}
          onDecision={onCloseoutDecision}
        />
      ) : null}
    </>
  );
}
