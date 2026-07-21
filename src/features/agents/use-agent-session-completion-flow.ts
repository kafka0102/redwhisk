import {
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import {
  listAgentSessions,
  setAgentSessionAttention,
  type AgentSessionListItem,
} from "./agent-session-commands";
import {
  applySessionOverlays,
  getSessionTransitionPhase,
} from "./agent-session-overlays";
import type {
  LinkedSessionIssue,
  SessionIssueTransition,
} from "./session-pane/agents-session-pane";
import { markIssueReview } from "../issues/issue-commands";
import type { useI18n } from "../../shared/i18n/i18n";
import type { useAlertDialog } from "@/components/ui/use-alert-dialog";
import type { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import { useAgentSessionCompletionResolution } from "./use-agent-session-completion-resolution";

type Messages = ReturnType<typeof useI18n>["messages"];
type Translate = ReturnType<typeof useI18n>["t"];
type Locale = ReturnType<typeof useI18n>["locale"];
type Confirm = ReturnType<typeof useConfirmDialog>["confirm"];
type ShowAlert = ReturnType<typeof useAlertDialog>["showAlert"];

interface UseAgentSessionCompletionFlowOptions {
  projectId: number;
  locale: Locale;
  messages: Messages;
  t: Translate;
  allSessions: AgentSessionListItem[];
  setAllSessions: Dispatch<SetStateAction<AgentSessionListItem[]>>;
  refreshSessions: () => Promise<AgentSessionListItem[]>;
  selectedSession: AgentSessionListItem | null;
  linkedIssue: LinkedSessionIssue | null;
  confirm: Confirm;
  showAlert: ShowAlert;
  showCommandErrorAlert: (error: unknown) => void;
  setIsTransitionMenuOpen: Dispatch<SetStateAction<boolean>>;
  isDeletingSession: boolean;
  reviewedIssueIdsRef: MutableRefObject<Set<number>>;
  completedIssueIdsRef: MutableRefObject<Set<number>>;
  closedSessionIdsRef: MutableRefObject<Set<number>>;
}

/**
 * agents-activity 的 issue 完成状态机编排层：attention 确认、mark review、状态转换
 * 入口（review / done）、手动完成与 preview 关闭。完成三路径、agent-commit 完成检测、
 * merge-conflict prompt 注入下沉到 useAgentSessionCompletionResolution。列表 state 与
 * 跨簇编排留在容器，经 options 传入；3 个 completion dialog 的 JSX 仍在容器。
 */
export function useAgentSessionCompletionFlow({
  projectId,
  locale,
  messages,
  t,
  allSessions,
  setAllSessions,
  refreshSessions,
  selectedSession,
  linkedIssue,
  confirm,
  showAlert,
  showCommandErrorAlert,
  setIsTransitionMenuOpen,
  isDeletingSession,
  reviewedIssueIdsRef,
  completedIssueIdsRef,
  closedSessionIdsRef,
}: UseAgentSessionCompletionFlowOptions) {
  const [isUpdatingAttention, setIsUpdatingAttention] = useState(false);
  const [isMarkingReview, setIsMarkingReview] = useState(false);
  const [
    isCompletionLoadingDialogDismissed,
    setIsCompletionLoadingDialogDismissed,
  ] = useState(false);

  const {
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
  } = useAgentSessionCompletionResolution({
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
  });

  const sessionTransitionPhase = getSessionTransitionPhase(selectedSession);
  const transitionButtonLabel =
    sessionTransitionPhase === "running"
      ? messages.agentsFeature.markReview
      : sessionTransitionPhase === "review"
        ? messages.agentsFeature.markDone
        : null;
  const transitionMenuOptions: Array<{
    action: SessionIssueTransition;
    label: string;
  }> =
    sessionTransitionPhase === "running"
      ? [
          { action: "review", label: messages.agentsFeature.review },
          { action: "done", label: messages.agentsFeature.done },
        ]
      : [];
  const canRenderTransitionButton = transitionButtonLabel !== null;
  const canRenderTransitionMenu = transitionMenuOptions.length > 0;
  const isTransitionPending =
    isMarkingReview ||
    isCompletingManual ||
    isCompletingClean ||
    isPreparingAgentCommit ||
    isSendingAgentCommitPrompt ||
    isDetectingAgentCommitCompletion ||
    isSubmittingMergePrompt ||
    isDeletingSession;
  const isAgentCommitPreviewPending =
    isCompletingManual ||
    isSendingAgentCommitPrompt ||
    isDetectingAgentCommitCompletion ||
    isSubmittingMergePrompt;
  const isCompletionCheckPending =
    isCompletingManual ||
    isCompletingClean ||
    isPreparingAgentCommit ||
    isSendingAgentCommitPrompt ||
    isDetectingAgentCommitCompletion ||
    isSubmittingMergePrompt;
  const isCompletionLoadingDialogOpen =
    isCompletionCheckPending && !isCompletionLoadingDialogDismissed;

  // completion 检查结束（pending 转 false）时重置 dismiss 标志，供下次显示。
  // 用渲染期 state 调整替代 effect 内 setState，避开 react-hooks/set-state-in-effect。
  const [prevCompletionCheckPending, setPrevCompletionCheckPending] = useState(
    isCompletionCheckPending,
  );
  if (isCompletionCheckPending !== prevCompletionCheckPending) {
    setPrevCompletionCheckPending(isCompletionCheckPending);
    if (!isCompletionCheckPending) {
      setIsCompletionLoadingDialogDismissed(false);
    }
  }

  async function acknowledgeSessionAttention(sessionId: number) {
    const targetSession = allSessions.find(
      (session) => session.sessionId === sessionId,
    );
    if (targetSession == null || targetSession.status !== "running") {
      return;
    }

    if (targetSession.attention === "requested") {
      if (isUpdatingAttention) {
        return;
      }

      setIsUpdatingAttention(true);

      try {
        await setAgentSessionAttention({
          projectId,
          sessionId,
          attention: "none",
        });
        const response = await listAgentSessions(projectId);
        const nextSessions = applySessionOverlays(
          response.sessions,
          reviewedIssueIdsRef.current,
          completedIssueIdsRef.current,
          closedSessionIdsRef.current,
        );
        setAllSessions(nextSessions);
      } catch (error) {
        showCommandErrorAlert(error);
      } finally {
        setIsUpdatingAttention(false);
      }

      return;
    }
  }

  async function markLinkedIssueReview(issue: NonNullable<typeof linkedIssue>) {
    setIsTransitionMenuOpen(false);
    setIsMarkingReview(true);

    let reviewedIssueId: number | null = null;

    try {
      const reviewedIssue = await markIssueReview({
        projectId,
        issueId: issue.issueId,
      });
      reviewedIssueId = reviewedIssue.id;
      reviewedIssueIdsRef.current.add(reviewedIssue.id);
      setAllSessions((currentSessions) =>
        currentSessions.map((session) =>
          session.issueId === reviewedIssue.id
            ? {
                ...session,
                issueStatus: reviewedIssue.status,
                lastActiveAt: Math.max(
                  session.lastActiveAt,
                  reviewedIssue.updatedAt,
                ),
              }
            : session,
        ),
      );
    } catch (error) {
      showCommandErrorAlert(error);
      try {
        await refreshSessions();
      } catch {
        // Keep the command failure visible; future session events can retry refresh.
      }
    } finally {
      if (reviewedIssueId == null) {
        setIsMarkingReview(false);
      }
    }

    if (reviewedIssueId == null) {
      return null;
    }

    try {
      return await refreshSessions();
    } catch (error) {
      showCommandErrorAlert(error);
      return null;
    } finally {
      setIsMarkingReview(false);
    }
  }

  async function handleMarkReview() {
    if (!linkedIssue) {
      return;
    }

    await markLinkedIssueReview(linkedIssue);
  }

  async function handleMarkDone() {
    if (!linkedIssue || !selectedSession) {
      return;
    }

    const currentSession =
      allSessions.find(
        (session: AgentSessionListItem) =>
          session.sessionId === selectedSession.sessionId,
      ) ?? selectedSession;
    const isSessionClosed = currentSession.status === "closed";

    if (isSessionClosed) {
      await completeLinkedIssueManual(linkedIssue, currentSession);
      return;
    }

    if (currentSession.canCompleteAgentCommit) {
      await prepareLinkedIssueAgentCommit(linkedIssue, currentSession);
      return;
    }

    // completion_policy 已移除：默认走 clean 完成入口，由 complete_issue_flow
    // 在后端统一检测实际工作区状态并驱动新流程。
    await completeLinkedIssueClean(linkedIssue, currentSession);
  }

  async function handleTransitionAction(action: SessionIssueTransition) {
    if (action === "review") {
      await handleMarkReview();
      return;
    }

    await handleMarkDone();
  }

  // 直接点击状态转换主按钮（非下拉菜单）时走此入口：
  // - 「待验收」：仅当前 Session 仍有进行中轮次（isTurnRunning）时二次确认；
  //   轮次已结束（agent 空闲等待）或 session 已关闭则直接标记。
  //   注意：session.status === "running" 对所有未关闭 session 均成立，
  //   不能据此判断 agent 是否正在执行，须用 isTurnRunning。
  // - 「完成」：直接执行。
  // 下拉菜单选项仍走 handleTransitionAction，不弹确认。
  async function handleTransitionMainAction(action: SessionIssueTransition) {
    setIsTransitionMenuOpen(false);

    if (action === "review") {
      const currentSession = selectedSession
        ? (allSessions.find(
            (session: AgentSessionListItem) =>
              session.sessionId === selectedSession.sessionId,
          ) ?? selectedSession)
        : null;
      const isTurnRunning =
        currentSession?.status === "running" &&
        currentSession.isTurnRunning === true;

      if (isTurnRunning) {
        const confirmed = await confirm({
          cancelLabel: messages.agentsFeature.confirmMarkReviewNo,
          confirmLabel: messages.agentsFeature.confirmMarkReviewYes,
          message: messages.agentsFeature.confirmMarkReview,
        });
        if (!confirmed) {
          return;
        }
      }
    }

    await handleTransitionAction(action);
  }

  function handleCloseAgentCommitPreview() {
    if (isAgentCommitPreviewPending) {
      return;
    }
    setAgentCommitPreview(null);
  }

  async function handleCompleteAgentCommitPreviewManually() {
    if (!linkedIssue || !selectedSession) {
      return;
    }

    const currentSession =
      allSessions.find(
        (session: AgentSessionListItem) =>
          session.sessionId === selectedSession.sessionId,
      ) ?? selectedSession;

    await completeLinkedIssueManual(linkedIssue, currentSession, {
      ignoreDirty: true,
    });
    setAgentCommitPreview(null);
  }

  return {
    isUpdatingAttention,
    isMarkingReview,
    isCompletionLoadingDialogDismissed,
    setIsCompletionLoadingDialogDismissed,
    agentCommitPreview,
    mergePromptSessionId,
    mergePromptContent,
    isSubmittingMergePrompt,
    sessionTransitionPhase,
    transitionButtonLabel,
    transitionMenuOptions,
    canRenderTransitionButton,
    canRenderTransitionMenu,
    isTransitionPending,
    isAgentCommitPreviewPending,
    isCompletionLoadingDialogOpen,
    acknowledgeSessionAttention,
    handleMarkReview,
    handleMarkDone,
    handleTransitionAction,
    handleTransitionMainAction,
    handleCloseAgentCommitPreview,
    handleCompleteAgentCommitPreviewManually,
    handleConfirmAgentCommit,
    handleConfirmMergePrompt,
    handleCloseMergePrompt,
  };
}
