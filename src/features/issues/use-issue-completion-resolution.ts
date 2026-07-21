import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import {
  type CompleteIssueFlowResult,
  type DirtyWorkspaceOption,
  type IssueRecord,
} from "./issue-commands";
import {
  CompletionCancelledError,
  runCompletionFlow,
  WorktreeMergeConflictError,
  type WorktreeMergeConflictSessionDetail,
} from "./issue-completion/completion-flow-client";
import { buildWorktreeMergeConflictPrompt } from "./issue-completion/issue-completion-helpers";
import {
  EMPTY_FORM,
  type DialogMode,
  type IssueFormState,
} from "./issue-activity-types";
import { injectSessionPromptWithResume } from "../agents/inject-session-prompt-with-resume";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import type { useI18n } from "../../shared/i18n/i18n";
import type { useConfirmDialog } from "@/components/ui/use-confirm-dialog";

type Messages = ReturnType<typeof useI18n>["messages"];
type Translate = ReturnType<typeof useI18n>["t"];
type Locale = ReturnType<typeof useI18n>["locale"];
type Confirm = ReturnType<typeof useConfirmDialog>["confirm"];

export interface DirtyWorkspaceDialogState {
  issueId: number;
  branchName: string | null;
  branchNameEditable: boolean;
}

export type DirtyWorkspaceDecisionResolver = (
  decision: DirtyWorkspaceOption,
  branchName: string | null,
) => void;

// 保持既有公共 API：flow / activity 继续从本模块拿错误类型。
export {
  CompletionCancelledError,
  WorktreeMergeConflictError,
  type WorktreeMergeConflictSessionDetail,
};

interface UseIssueCompletionResolutionOptions {
  locale: Locale;
  activeProjectIdRef: MutableRefObject<number>;
  dirtyWorkspaceDecisionRef: MutableRefObject<DirtyWorkspaceDecisionResolver | null>;
  setDialogErrorMessage: Dispatch<SetStateAction<string | null>>;
  setTitleError: Dispatch<SetStateAction<string | null>>;
  setForm: Dispatch<SetStateAction<IssueFormState>>;
  setDialogMode: Dispatch<SetStateAction<DialogMode | null>>;
  setIsReadOnlyEditRequested: Dispatch<SetStateAction<boolean>>;
  setDirtyWorkspaceDialog: Dispatch<
    SetStateAction<DirtyWorkspaceDialogState | null>
  >;
  confirm: Confirm;
  showCompletionLoadingDialog: () => void;
  hideCompletionLoadingDialog: () => void;
  t: Translate;
  messages: Messages;
  onOpenAgentsActivity?: (sessionId: number) => void;
}

export function useIssueCompletionResolution({
  locale,
  activeProjectIdRef,
  dirtyWorkspaceDecisionRef,
  setDialogErrorMessage,
  setTitleError,
  setForm,
  setDialogMode,
  setIsReadOnlyEditRequested,
  setDirtyWorkspaceDialog,
  confirm,
  showCompletionLoadingDialog,
  hideCompletionLoadingDialog,
  t,
  messages,
  onOpenAgentsActivity,
}: UseIssueCompletionResolutionOptions) {
  function requestDirtyWorkspaceDecision(
    result: CompleteIssueFlowResult,
  ): Promise<{ decision: DirtyWorkspaceOption; branchName: string | null }> {
    return new Promise((resolve) => {
      dirtyWorkspaceDecisionRef.current = (decision, branchName) =>
        resolve({ decision, branchName });
      const prefill = result.workspaceBranch ?? result.targetBranch ?? null;
      setDirtyWorkspaceDialog({
        issueId: result.issue.id,
        branchName: prefill,
        // 情况一/二（已知分支）只读预填；情况三（漂移）/session 关闭无预填时允许手填。
        branchNameEditable: result.drifted || prefill == null,
      });
    });
  }

  function resolveDirtyWorkspaceDecision(
    decision: DirtyWorkspaceOption,
    branchName: string | null,
  ) {
    dirtyWorkspaceDecisionRef.current?.(decision, branchName);
    dirtyWorkspaceDecisionRef.current = null;
    setDirtyWorkspaceDialog(null);
  }

  async function completeIssueWithCompletionChecks(
    requestProjectId: number,
    issueId: number,
  ): Promise<IssueRecord> {
    return runCompletionFlow(
      { projectId: requestProjectId, issueId },
      {
        onLoadingChange: (loading) => {
          if (loading) {
            showCompletionLoadingDialog();
          } else {
            hideCompletionLoadingDialog();
          }
        },
        requestDirtyDecision: requestDirtyWorkspaceDecision,
        confirmContinueAfterCommit: () =>
          confirm({
            title: messages.issues.completionContinueAfterCommitTitle,
            message: messages.issues.completionContinueAfterCommitMessage,
            confirmLabel: messages.issues.completionContinueLabel,
            cancelLabel: messages.issues.completionCancel,
            confirmVariant: "default",
          }),
        confirmWorktreeCleanup: (targetBranch) =>
          confirm({
            title: messages.issues.completionWorktreeCleanupTitle,
            message: messages.issues.completionWorktreeCleanupMessage(
              targetBranch ?? "",
            ),
            confirmLabel: messages.issues.completionWorktreeCleanupConfirm,
            cancelLabel: messages.issues.completionWorktreeCleanupKeep,
            confirmVariant: "destructive",
          }),
        messages: {
          gitOperationBlocked: messages.issues.completionGitOperationBlocked,
          noCommitDetected: messages.issues.completionNoCommitDetected,
        },
      },
    );
  }

  async function handOffWorktreeMergeConflict(
    requestProjectId: number,
    issue: IssueRecord,
    detail: WorktreeMergeConflictSessionDetail,
  ) {
    const sessionId = detail.sessionId ?? issue.linkedSessionId;
    if (sessionId == null) {
      setDialogErrorMessage(t("issues.mergeConflictNoSessionHandoff"));
      return;
    }

    const prompt = buildWorktreeMergeConflictPrompt(detail, locale);
    // worktree session 关闭后 handle / PTY 会移除，直接注入会报 notRunning。
    // injectSessionPromptWithResume：live session（含 Codex TUI PTY）直接注入；
    // 仅 notRunning 时再 resume 重建。resume 失败时在对话框展示具体错误，避免
    // 冒泡成 unhandled rejection，也避免 live TUI 因缺少 codex_session_id 误报。
    try {
      await injectSessionPromptWithResume({
        projectId: requestProjectId,
        sessionId,
        prompt,
        kind: "follow_up",
      });
    } catch (error) {
      setDialogErrorMessage(getCommandErrorMessage(error, t));
      return;
    }

    if (activeProjectIdRef.current !== requestProjectId) {
      return;
    }

    setDialogErrorMessage(null);
    setTitleError(null);
    setDialogMode(null);
    setIsReadOnlyEditRequested(false);
    setForm(EMPTY_FORM);
    onOpenAgentsActivity?.(sessionId);
  }

  return {
    completeIssueWithCompletionChecks,
    resolveDirtyWorkspaceDecision,
    handOffWorktreeMergeConflict,
  };
}
