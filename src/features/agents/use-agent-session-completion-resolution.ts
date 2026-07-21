import {
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import {
  listAgentSessions,
  type AgentSessionListItem,
} from "./agent-session-commands";
import { injectSessionPromptWithResume } from "./inject-session-prompt-with-resume";
import { applySessionOverlays } from "./agent-session-overlays";
import type { LinkedSessionIssue } from "./session-pane/agents-session-pane";
import {
  prepareAgentCommitCompletion,
  type AgentCommitCompletionPreview,
  type CompleteIssueFlowResult,
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
  getCommandErrorMessage,
  toCommandError,
} from "../../shared/commands/command-error";
import type { useI18n } from "../../shared/i18n/i18n";
import type { useAlertDialog } from "@/components/ui/use-alert-dialog";
import type { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import { toast } from "../../shared/toast";

type Messages = ReturnType<typeof useI18n>["messages"];
type Translate = ReturnType<typeof useI18n>["t"];
type Locale = ReturnType<typeof useI18n>["locale"];
type ShowAlert = ReturnType<typeof useAlertDialog>["showAlert"];
type Confirm = ReturnType<typeof useConfirmDialog>["confirm"];

function isCleanWorktreeAgentCommitPreviewError(error: {
  code: string;
  message: string;
  details?: Array<Record<string, unknown>>;
}) {
  return (
    error.code === "ISSUE_VALIDATION_FAILED" &&
    error.details?.some(
      (detail) => detail["@type"] === "GitStatus" && detail.isClean === true,
    ) === true
  );
}

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
 * Agents surface 适配层：preview / mergePrompt / session list 投影。
 * 完成协议解释统一走 issues/issue-completion/completion-flow-client。
 */
export function useAgentSessionCompletionResolution({
  projectId,
  locale,
  messages,
  t,
  confirm,
  setAllSessions,
  refreshSessions,
  selectedSession,
  linkedIssue,
  showAlert,
  showCommandErrorAlert,
  setIsTransitionMenuOpen,
  reviewedIssueIdsRef,
  completedIssueIdsRef,
  closedSessionIdsRef,
}: UseAgentSessionCompletionResolutionOptions) {
  const [isCompletingManual, setIsCompletingManual] = useState(false);
  const [isCompletingClean, setIsCompletingClean] = useState(false);
  const [isPreparingAgentCommit, setIsPreparingAgentCommit] = useState(false);
  const [isSendingAgentCommitPrompt, setIsSendingAgentCommitPrompt] =
    useState(false);
  const [
    isDetectingAgentCommitCompletion,
    setIsDetectingAgentCommitCompletion,
  ] = useState(false);
  const [isSubmittingMergePrompt, setIsSubmittingMergePrompt] = useState(false);
  const [agentCommitPreview, setAgentCommitPreview] =
    useState<AgentCommitCompletionPreview | null>(null);
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
          requestDirtyDecision: async (result) => {
            // Agents surface 无 dirty 三选项对话框；clean 路径应已保证工作区干净，
            // agent-commit 路径通过 initialDirtyDecision=auto_commit 进入。
            throw new Error(
              result.message || messages.issues.completionDirtyMessage,
            );
          },
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

  async function completeLinkedIssueManual(
    issue: NonNullable<typeof linkedIssue>,
    session: AgentSessionListItem,
    options: { ignoreDirty?: boolean } = {},
  ) {
    const targetSessionId = session.sessionId;
    setIsTransitionMenuOpen(false);
    setIsCompletingManual(true);

    let completedIssueId: number | null = null;
    let completedSessionId: number | null = null;

    try {
      const completedIssue = await completeLinkedIssueViaFlow(
        issue.issueId,
        targetSessionId,
        options,
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
        setIsCompletingManual(false);
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
      setIsCompletingManual(false);
    }
  }

  async function completeLinkedIssueClean(
    issue: NonNullable<typeof linkedIssue>,
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

  async function prepareLinkedIssueAgentCommit(
    issue: NonNullable<typeof linkedIssue>,
    session: AgentSessionListItem,
  ) {
    setIsTransitionMenuOpen(false);
    setIsPreparingAgentCommit(true);

    try {
      const preview = await prepareAgentCommitCompletion({
        projectId,
        issueId: issue.issueId,
      });
      setAgentCommitPreview(preview);
    } catch (error) {
      const commandError = toCommandError(error);
      if (isCleanWorktreeAgentCommitPreviewError(commandError)) {
        await completeLinkedIssueClean(issue, session);
      } else {
        showAlert({ message: getCommandErrorMessage(error, t), type: "error" });
      }
    } finally {
      setIsPreparingAgentCommit(false);
    }
  }

  async function handleConfirmAgentCommit() {
    if (!linkedIssue || !agentCommitPreview || !selectedSession) {
      return;
    }

    setIsSendingAgentCommitPrompt(true);

    try {
      // 预览确认「提交代码」= dirty 三选项中的 auto_commit。
      const completedIssue = await completeLinkedIssueViaFlow(
        linkedIssue.issueId,
        selectedSession.sessionId,
        { initialDirtyDecision: "auto_commit" },
      );
      if (completedIssue == null) {
        return;
      }
      applyCompletedIssueToSessions(completedIssue, selectedSession.sessionId);
      showIssueMarkedDoneToast();
      setAgentCommitPreview(null);
      const response = await listAgentSessions(projectId);
      setAllSessions(
        applySessionOverlays(
          response.sessions,
          reviewedIssueIdsRef.current,
          completedIssueIdsRef.current,
          closedSessionIdsRef.current,
        ),
      );
    } catch (error) {
      showCommandErrorAlert(error);
    } finally {
      setIsDetectingAgentCommitCompletion(false);
      setIsSendingAgentCommitPrompt(false);
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
    isCompletingManual,
    isCompletingClean,
    isPreparingAgentCommit,
    isSendingAgentCommitPrompt,
    isDetectingAgentCommitCompletion,
    isSubmittingMergePrompt,
    agentCommitPreview,
    setAgentCommitPreview,
    mergePromptSessionId,
    mergePromptContent,
    completeLinkedIssueManual,
    completeLinkedIssueClean,
    prepareLinkedIssueAgentCommit,
    handleConfirmAgentCommit,
    handleConfirmMergePrompt,
    handleCloseMergePrompt,
  };
}
