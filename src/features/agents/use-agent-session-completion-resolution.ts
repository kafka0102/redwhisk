import {
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import { type AgentSessionListItem } from "./agent-session-commands";
import { injectSessionPromptWithResume } from "./inject-session-prompt-with-resume";
import type { LinkedSessionIssue } from "./session-pane/agents-session-pane";
import {
  type CompleteIssueFlowResult,
  type DirtyWorkspaceOption,
  type IssueRecord,
} from "../issues/issue-commands";
import {
  CompletionCancelledError,
  CompletionFlowBlockedError,
  runCompletionFlow,
  WorktreeMergeConflictError,
} from "../issues/issue-completion/completion-flow-client";
import { buildWorktreeMergeConflictPrompt } from "../issues/issue-completion/issue-completion-helpers";
import {
  type DirtyWorkspaceDecisionResolver,
  type DirtyWorkspaceDialogState,
} from "../issues/use-issue-completion-resolution";
import type { useI18n } from "../../shared/i18n/i18n";
import type { useAlertDialog } from "@/components/ui/use-alert-dialog";
import type { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import { toast } from "../../shared/toast";

type Messages = ReturnType<typeof useI18n>["messages"];
type Translate = ReturnType<typeof useI18n>["t"];
type Locale = ReturnType<typeof useI18n>["locale"];
type ShowAlert = ReturnType<typeof useAlertDialog>["showAlert"];
type Confirm = ReturnType<typeof useConfirmDialog>["confirm"];

interface UseAgentSessionCompletionResolutionOptions {
  projectId: number;
  locale: Locale;
  messages: Messages;
  t: Translate;
  confirm: Confirm;
  setAllSessions: Dispatch<SetStateAction<AgentSessionListItem[]>>;
  refreshSessions: () => Promise<AgentSessionListItem[]>;
  selectedSession: AgentSessionListItem | null;
  linkedIssue: LinkedSessionIssue | null;
  showAlert: ShowAlert;
  showCommandErrorAlert: (error: unknown) => void;
  setIsTransitionMenuOpen: Dispatch<SetStateAction<boolean>>;
  reviewedIssueIdsRef: MutableRefObject<Set<number>>;
  completedIssueIdsRef: MutableRefObject<Set<number>>;
  closedSessionIdsRef: MutableRefObject<Set<number>>;
}

/**
 * Agents surface 适配层：dirty 三选对话框 / mergePrompt / session list 投影。
 * 完成协议解释统一走 issues/issue-completion/completion-flow-client。
 */
export function useAgentSessionCompletionResolution({
  projectId,
  locale,
  messages,
  confirm,
  setAllSessions,
  refreshSessions,
  showAlert,
  showCommandErrorAlert,
  setIsTransitionMenuOpen,
  reviewedIssueIdsRef: _reviewedIssueIdsRef,
  completedIssueIdsRef,
  closedSessionIdsRef,
}: UseAgentSessionCompletionResolutionOptions) {
  const [isCompletingClean, setIsCompletingClean] = useState(false);
  const [
    isDetectingAgentCommitCompletion,
    setIsDetectingAgentCommitCompletion,
  ] = useState(false);
  const [isSubmittingMergePrompt, setIsSubmittingMergePrompt] = useState(false);
  const [dirtyWorkspaceDialog, setDirtyWorkspaceDialog] =
    useState<DirtyWorkspaceDialogState | null>(null);
  const dirtyWorkspaceDecisionRef =
    useRef<DirtyWorkspaceDecisionResolver | null>(null);
  const [mergePromptSessionId, setMergePromptSessionId] = useState<
    number | null
  >(null);
  const [mergePromptContent, setMergePromptContent] = useState<string | null>(
    null,
  );

  function showIssueMarkedDoneToast() {
    toast.success(messages.toast.issueMarkedDone);
  }

  function applyCompletedIssueToSessions(
    completedIssue: IssueRecord,
    targetSessionId: number,
  ) {
    completedIssueIdsRef.current.add(completedIssue.id);
    closedSessionIdsRef.current.add(targetSessionId);
    setAllSessions((currentSessions) =>
      currentSessions.map((session) =>
        session.issueId === completedIssue.id
          ? {
              ...session,
              status:
                session.sessionId === targetSessionId
                  ? ("closed" as const)
                  : session.status,
              issueStatus: completedIssue.status,
              lastActiveAt: Math.max(
                session.lastActiveAt,
                completedIssue.updatedAt,
              ),
              closedAt:
                session.sessionId === targetSessionId
                  ? Math.max(session.closedAt ?? 0, completedIssue.updatedAt)
                  : session.closedAt,
              canCompleteClean: false,
              canCompleteAgentCommit: false,
            }
          : session,
      ),
    );
  }

  function openMergePromptFromResult(
    result: CompleteIssueFlowResult,
    fallbackSessionId: number,
  ): boolean {
    const isMergeHandoff =
      result.mergeBlockReason === "merge_conflict" ||
      result.mergeBlockReason === "target_worktree_dirty";
    if (!isMergeHandoff) {
      return false;
    }

    const sessionId = result.sessionId ?? fallbackSessionId;
    if (sessionId == null) {
      showAlert({ message: result.message, type: "error" });
      return true;
    }

    setMergePromptSessionId(sessionId);
    setMergePromptContent(
      buildWorktreeMergeConflictPrompt(
        {
          message: result.message,
          targetBranch: result.targetBranch,
          workspaceBranch: result.workspaceBranch,
          workspacePath: result.workspacePath,
        },
        locale,
      ),
    );
    return true;
  }

  function openMergePromptFromConflict(
    error: WorktreeMergeConflictError,
    fallbackSessionId: number,
  ): boolean {
    const sessionId = error.detail.sessionId ?? fallbackSessionId;
    if (sessionId == null) {
      showAlert({
        message: error.detail.message ?? error.message,
        type: "error",
      });
      return true;
    }
    setMergePromptSessionId(sessionId);
    setMergePromptContent(
      buildWorktreeMergeConflictPrompt(
        {
          message: error.detail.message,
          targetBranch: error.detail.targetBranch,
          workspaceBranch: error.detail.workspaceBranch,
          workspacePath: error.detail.workspacePath,
        },
        locale,
      ),
    );
    return true;
  }

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
        // 已知分支只读预填；漂移或 session 关闭无预填时允许手填。
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

  async function completeLinkedIssueViaFlow(
    issueId: number,
    sessionId: number,
    options: {
      ignoreDirty?: boolean;
      initialDirtyDecision?: "auto_commit" | "skip" | "cancel";
    } = {},
  ): Promise<IssueRecord | null> {
    try {
      return await runCompletionFlow(
        {
          projectId,
          issueId,
          ignoreDirty: options.ignoreDirty,
          initialDirtyDecision: options.initialDirtyDecision,
        },
        {
          onWaitingAutoCommitChange: setIsDetectingAgentCommitCompletion,
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
    } catch (error) {
      if (error instanceof CompletionCancelledError) {
        return null;
      }
      if (error instanceof WorktreeMergeConflictError) {
        openMergePromptFromConflict(error, sessionId);
        return null;
      }
      if (error instanceof CompletionFlowBlockedError) {
        if (openMergePromptFromResult(error.result, sessionId)) {
          return null;
        }
        throw error;
      }
      throw error;
    }
  }

  async function completeLinkedIssueClean(
    issue: LinkedSessionIssue,
    session: AgentSessionListItem,
  ) {
    const targetSessionId = session.sessionId;
    setIsTransitionMenuOpen(false);
    setIsCompletingClean(true);

    let completedIssueId: number | null = null;
    let completedSessionId: number | null = null;

    try {
      const completedIssue = await completeLinkedIssueViaFlow(
        issue.issueId,
        targetSessionId,
      );
      if (completedIssue == null) {
        return;
      }
      completedIssueId = completedIssue.id;
      completedSessionId = session.sessionId;
      applyCompletedIssueToSessions(completedIssue, targetSessionId);
      showIssueMarkedDoneToast();
    } catch (error) {
      showCommandErrorAlert(error);
      try {
        await refreshSessions();
      } catch {
        // Keep the command failure visible; future session events can retry refresh.
      }
    } finally {
      if (completedIssueId == null) {
        setIsCompletingClean(false);
      }
    }

    if (completedIssueId == null || completedSessionId == null) {
      return;
    }

    try {
      await refreshSessions();
    } catch (error) {
      showCommandErrorAlert(error);
    } finally {
      setIsCompletingClean(false);
    }
  }

  async function handleConfirmMergePrompt() {
    if (
      mergePromptContent == null ||
      mergePromptSessionId == null ||
      isSubmittingMergePrompt
    ) {
      return;
    }

    setIsSubmittingMergePrompt(true);

    try {
      // live session（含 Codex TUI PTY）直接注入；仅 notRunning 时 resume 再注入。
      // 避免 live TUI 因缺少 codex_session_id 被 resume 误拦。
      await injectSessionPromptWithResume({
        projectId,
        sessionId: mergePromptSessionId,
        prompt: mergePromptContent,
        kind: "follow_up",
      });
      setMergePromptSessionId(null);
      setMergePromptContent(null);
    } catch (error) {
      showCommandErrorAlert(error);
    } finally {
      setIsSubmittingMergePrompt(false);
    }
  }

  function handleCloseMergePrompt() {
    if (isSubmittingMergePrompt) {
      return;
    }
    setMergePromptSessionId(null);
    setMergePromptContent(null);
  }

  return {
    isCompletingClean,
    isDetectingAgentCommitCompletion,
    isSubmittingMergePrompt,
    dirtyWorkspaceDialog,
    mergePromptSessionId,
    mergePromptContent,
    completeLinkedIssueClean,
    resolveDirtyWorkspaceDecision,
    handleConfirmMergePrompt,
    handleCloseMergePrompt,
  };
}
