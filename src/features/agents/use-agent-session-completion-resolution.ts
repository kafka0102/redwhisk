import {
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import {
  injectAgentSessionPrompt,
  listAgentSessions,
  resumeStructuredAgentSession,
  type AgentSessionListItem,
} from "./agent-session-commands";
import { applySessionOverlays } from "./agent-session-overlays";
import type { LinkedSessionIssue } from "./session-pane/agents-session-pane";
import {
  completeIssueFlow,
  prepareAgentCommitCompletion,
  type AgentCommitCompletionPreview,
  type CompleteIssueFlowResult,
  type IssueRecord,
} from "../issues/issue-commands";
import { buildWorktreeMergeConflictPrompt } from "../issues/issue-completion/issue-completion-helpers";
import {
  getCommandErrorMessage,
  toCommandError,
} from "../../shared/commands/command-error";
import type { useI18n } from "../../shared/i18n/i18n";
import type { useAlertDialog } from "@/components/ui/use-alert-dialog";
import { toast } from "../../shared/toast";

type Messages = ReturnType<typeof useI18n>["messages"];
type Translate = ReturnType<typeof useI18n>["t"];
type Locale = ReturnType<typeof useI18n>["locale"];
type ShowAlert = ReturnType<typeof useAlertDialog>["showAlert"];

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
 * issue 完成流的「解析」子层：完成三路径（manual / clean / agent-commit 预备）、
 * agent-commit 完成检测、merge-conflict prompt 注入，以及对应的 loading / preview /
 * mergePrompt state。被 useAgentSessionCompletionFlow（编排层）调用。
 */
export function useAgentSessionCompletionResolution({
  projectId,
  locale,
  messages,
  t,
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

  function handleMergePromptRequirement(
    result: CompleteIssueFlowResult,
    fallbackSessionId: number,
  ) {
    if (
      result.action !== "blocked" ||
      (result.mergeBlockReason !== "merge_conflict" &&
        result.mergeBlockReason !== "target_worktree_dirty")
    ) {
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

  async function completeLinkedIssueViaFlow(
    issueId: number,
    sessionId: number,
    options: { ignoreDirty?: boolean } = {},
  ) {
    const result = await completeIssueFlow({
      projectId,
      issueId,
      ignoreDirty: options.ignoreDirty ?? undefined,
    });
    if (result.action === "completed") {
      return result.issue;
    }
    if (handleMergePromptRequirement(result, sessionId)) {
      return null;
    }
    throw new Error(result.message);
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
      let completionResult = await completeIssueFlow({
        projectId,
        issueId: linkedIssue.issueId,
      });
      setIsDetectingAgentCommitCompletion(true);
      if (completionResult.action === "waiting_auto_commit") {
        completionResult = await completeIssueFlow({
          projectId,
          issueId: linkedIssue.issueId,
        });
      }
      if (completionResult.action === "completed") {
        applyCompletedIssueToSessions(
          completionResult.issue,
          selectedSession.sessionId,
        );
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
      } else if (
        handleMergePromptRequirement(
          completionResult,
          selectedSession.sessionId,
        )
      ) {
        return;
      } else {
        setAgentCommitPreview(null);
        showAlert({ message: completionResult.message, type: "error" });
      }
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
      // worktree session 关闭后 handle 会从 agent_registry 移除，直接注入会报
      // AgentSessionNotRunning。先 resume 重建 handle，再注入合并 prompt。
      // resume 失败时继续尝试注入，让后端的 AgentSessionNotRunning 错误透传给用户。
      await resumeStructuredAgentSession({
        projectId,
        sessionId: mergePromptSessionId,
      }).catch(() => {
        /* 忽略 resume 错误，交给 inject 阶段统一报错 */
      });
      await injectAgentSessionPrompt({
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
