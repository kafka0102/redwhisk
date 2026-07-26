import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import {
  advanceIssueStatus,
  deleteIssue,
  deleteIssueWorktree,
  getIssueWorktreeStatus,
  markIssueReview,
  type IssueRecord,
  type IssueStatus,
} from "./issue-commands";
import {
  EMPTY_FORM,
  type AttachmentPreviewState,
  type DialogMode,
  type IssueFormState,
} from "./issue-activity-types";
import { type LaneTotalsMap, shiftLaneTotals } from "./issue-lane-helpers";
import {
  getIssueStatusLabel,
  issueStatusRank,
  issueToForm,
  mergeIssue,
} from "./issue-form/issue-description-serializer";
import type { RunDialogIssue } from "./use-issue-run-dialog";
import {
  CompletionCancelledError,
  WorktreeMergeConflictError,
  type DirtyWorkspaceDecisionResolver,
  type DirtyWorkspaceDialogState,
  useIssueCompletionResolution,
} from "./use-issue-completion-resolution";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import type { useI18n } from "../../shared/i18n/i18n";
import type { useAlertDialog } from "@/components/ui/use-alert-dialog";
import type { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import { toast } from "../../shared/toast";

// 保持公共 API：错误类与 dirty workspace 类型经本模块透传，主文件与 dialog-lifecycle 无需改动 import。
export { CompletionCancelledError, type DirtyWorkspaceDialogState };

type Messages = ReturnType<typeof useI18n>["messages"];
type Translate = ReturnType<typeof useI18n>["t"];
type Locale = ReturnType<typeof useI18n>["locale"];
type Confirm = ReturnType<typeof useConfirmDialog>["confirm"];
type ShowAlert = ReturnType<typeof useAlertDialog>["showAlert"];

interface UseIssueCompletionFlowOptions {
  projectId: number;
  locale: Locale;
  selectedIssue: IssueRecord | null;
  isSaving: boolean;
  issues: IssueRecord[];
  isEditablePageOpen: boolean;
  activeProjectIdRef: MutableRefObject<number>;
  dirtyWorkspaceDecisionRef: MutableRefObject<DirtyWorkspaceDecisionResolver | null>;
  setDialogErrorMessage: Dispatch<SetStateAction<string | null>>;
  setTitleError: Dispatch<SetStateAction<string | null>>;
  setIsSaving: Dispatch<SetStateAction<boolean>>;
  setIsAdvancingStatus: Dispatch<SetStateAction<boolean>>;
  setIsDeletingIssue: Dispatch<SetStateAction<boolean>>;
  setIssues: Dispatch<SetStateAction<IssueRecord[]>>;
  setLaneTotals: Dispatch<SetStateAction<LaneTotalsMap>>;
  setSelectedIssueId: (id: number | null) => void;
  setForm: Dispatch<SetStateAction<IssueFormState>>;
  setDialogMode: Dispatch<SetStateAction<DialogMode | null>>;
  setIsReadOnlyEditRequested: Dispatch<SetStateAction<boolean>>;
  setAttachmentPreview: Dispatch<SetStateAction<AttachmentPreviewState | null>>;
  setRunDialogIssue: Dispatch<SetStateAction<RunDialogIssue | null>>;
  setDirtyWorkspaceDialog: Dispatch<
    SetStateAction<DirtyWorkspaceDialogState | null>
  >;
  confirm: Confirm;
  showAlert: ShowAlert;
  showCompletionLoadingDialog: () => void;
  hideCompletionLoadingDialog: () => void;
  restoreDialogTriggerFocus: (fallbackIssue: IssueRecord | null) => void;
  t: Translate;
  messages: Messages;
  onOpenAgentsActivity?: (sessionId: number) => void;
}

export function useIssueCompletionFlow({
  projectId,
  locale,
  selectedIssue,
  isSaving,
  issues,
  isEditablePageOpen,
  activeProjectIdRef,
  dirtyWorkspaceDecisionRef,
  setDialogErrorMessage,
  setTitleError,
  setIsSaving,
  setIsAdvancingStatus,
  setIsDeletingIssue,
  setIssues,
  setLaneTotals,
  setSelectedIssueId,
  setForm,
  setDialogMode,
  setIsReadOnlyEditRequested,
  setAttachmentPreview,
  setRunDialogIssue,
  setDirtyWorkspaceDialog,
  confirm,
  showAlert,
  showCompletionLoadingDialog,
  hideCompletionLoadingDialog,
  restoreDialogTriggerFocus,
  t,
  messages,
  onOpenAgentsActivity,
}: UseIssueCompletionFlowOptions) {
  const {
    completeIssueWithCompletionChecks,
    resolveDirtyWorkspaceDecision,
    handOffWorktreeMergeConflict,
  } = useIssueCompletionResolution({
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
  });

  const showCommandErrorAlert = (error: unknown) => {
    showAlert({ message: getCommandErrorMessage(error, t), type: "error" });
  };

  async function handleAdvanceStatus(targetStatus: IssueStatus) {
    if (!selectedIssue || isSaving) {
      return;
    }

    if (targetStatus === selectedIssue.status) {
      return;
    }

    // 已完成 Issue 只能回退到 backlog（后端同步强校验）。
    if (
      selectedIssue.status === "completed" &&
      (targetStatus === "running" || targetStatus === "review")
    ) {
      return;
    }

    const currentIssue = selectedIssue;
    const isBackwardTransition =
      issueStatusRank(targetStatus) < issueStatusRank(currentIssue.status);

    if (
      targetStatus === "completed" &&
      currentIssue.linkedSessionStatus === "running"
    ) {
      const isConfirmed = await confirm({
        message: messages.issues.confirmCompleteWhileRunning,
      });
      if (!isConfirmed) {
        return;
      }
    } else if (isBackwardTransition) {
      const message =
        targetStatus === "backlog"
          ? currentIssue.linkedSessionStatus === "running"
            ? messages.issues.confirmTerminateAndReturnToBacklog
            : messages.issues.confirmReturnToBacklog
          : messages.issues.confirmMoveBackToStatus(
              getIssueStatusLabel(targetStatus, messages),
            );
      const isConfirmed = await confirm({ message });
      if (!isConfirmed) {
        return;
      }
    }

    // 退回 Backlog 时，若存在上次运行残留的同名 worktree，叠加询问是否删除。
    // CurrentBranch 模式无 worktree session，getIssueWorktreeStatus 会返回 exists=false，自然跳过。
    let shouldDeleteWorktree = false;
    if (targetStatus === "backlog") {
      try {
        const worktreeStatus = await getIssueWorktreeStatus({
          projectId,
          issueId: currentIssue.id,
        });
        if (worktreeStatus.exists && worktreeStatus.canDelete) {
          const deleteConfirmed = await confirm({
            title: messages.issues.worktreeConflictTitle,
            message: messages.issues.worktreeConflictMessage,
            confirmLabel: messages.issues.worktreeConflictDeleteLabel,
            cancelLabel: messages.issues.worktreeConflictKeepLabel,
            confirmVariant: "destructive",
          });
          shouldDeleteWorktree = deleteConfirmed;
        }
      } catch (error) {
        setDialogErrorMessage(getCommandErrorMessage(error, t));
        return;
      }
    }

    setDialogErrorMessage(null);
    setTitleError(null);
    setIsSaving(true);
    const requestProjectId = projectId;

    try {
      let updatedIssue: IssueRecord;
      // 已计入 laneTotals 的最近状态：完成流程会先经 review 再到 completed，
      // 中间态单独平移，取消/异常时也能让总数落在实际状态上。
      let totalsAnchor = currentIssue;

      if (
        targetStatus === "review" &&
        currentIssue.status === "running" &&
        currentIssue.linkedSessionStatus === "running"
      ) {
        setIsAdvancingStatus(true);
        updatedIssue = await markIssueReview({
          projectId: requestProjectId,
          issueId: currentIssue.id,
        });
      } else if (
        targetStatus === "completed" &&
        currentIssue.status === "running" &&
        currentIssue.linkedSessionStatus === "running"
      ) {
        // markIssueReview（running->review）期间也显示阻塞 loading，避免这段等待无反馈；
        // 返回后立即关闭，由后续 completion dialog 接管，避免两个 LoadingDialog 同时挂载。
        setIsAdvancingStatus(true);
        const reviewedIssue = await markIssueReview({
          projectId: requestProjectId,
          issueId: currentIssue.id,
        });
        setIsAdvancingStatus(false);
        if (activeProjectIdRef.current !== requestProjectId) {
          return;
        }
        setIssues((currentIssues) => mergeIssue(currentIssues, reviewedIssue));
        setSelectedIssueId(reviewedIssue.id);
        setForm(issueToForm(reviewedIssue));
        // markIssueReview 已把状态从 running 改为 review，先平移到 review；
        // 若随后完成流程被取消或失败，总数停留在 review，与实际状态一致。
        setLaneTotals((prev) =>
          shiftLaneTotals(prev, currentIssue, reviewedIssue),
        );
        totalsAnchor = reviewedIssue;
        updatedIssue = await completeIssueWithCompletionChecks(
          requestProjectId,
          currentIssue.id,
        );
      } else if (
        targetStatus === "completed" &&
        currentIssue.linkedSessionId != null
      ) {
        updatedIssue = await completeIssueWithCompletionChecks(
          requestProjectId,
          currentIssue.id,
        );
      } else {
        setIsAdvancingStatus(true);
        updatedIssue = await advanceIssueStatus({
          projectId: requestProjectId,
          issueId: currentIssue.id,
          targetStatus,
        });
        // 退回 Backlog 已成功（运行中 session 已由后端关闭），再删除残留 worktree。
        // 删除失败不阻断流程：状态已退回，仅提示用户手动清理。
        if (shouldDeleteWorktree) {
          try {
            await deleteIssueWorktree({
              projectId: requestProjectId,
              issueId: currentIssue.id,
            });
          } catch (error) {
            setDialogErrorMessage(getCommandErrorMessage(error, t));
          }
        }
      }

      if (activeProjectIdRef.current !== requestProjectId) {
        return;
      }

      setIssues((currentIssues) => mergeIssue(currentIssues, updatedIssue));
      setLaneTotals((prev) =>
        shiftLaneTotals(prev, totalsAnchor, updatedIssue),
      );
      setSelectedIssueId(updatedIssue.id);
      hideCompletionLoadingDialog();

      if (targetStatus === "backlog") {
        // 退回待办后直接回到看板：避免 status 变为 backlog 时只读页翻转为编辑页。
        setDialogMode(null);
        setIsReadOnlyEditRequested(false);
        setForm(EMPTY_FORM);
        restoreDialogTriggerFocus(updatedIssue);
      } else {
        setForm(issueToForm(updatedIssue));
      }
    } catch (error) {
      if (activeProjectIdRef.current === requestProjectId) {
        if (error instanceof CompletionCancelledError) {
          setDialogErrorMessage(null);
          setTitleError(null);
        } else if (error instanceof WorktreeMergeConflictError) {
          await handOffWorktreeMergeConflict(
            requestProjectId,
            currentIssue,
            error.detail,
          );
        } else {
          hideCompletionLoadingDialog();
          showCommandErrorAlert(error);
        }
      }
    } finally {
      if (activeProjectIdRef.current === requestProjectId) {
        setIsSaving(false);
      }
      setIsAdvancingStatus(false);
    }
  }

  async function handleDeleteIssue() {
    if (!selectedIssue || isSaving) {
      return;
    }

    setDialogErrorMessage(null);
    setTitleError(null);
    setIsSaving(true);
    setIsDeletingIssue(true);
    const requestProjectId = projectId;
    const issueToDelete = selectedIssue;

    try {
      await deleteIssue({
        projectId: requestProjectId,
        issueId: issueToDelete.id,
      });

      if (activeProjectIdRef.current !== requestProjectId) {
        return;
      }

      const remainingIssues = issues.filter(
        (issue) => issue.id !== issueToDelete.id,
      );
      setIssues(remainingIssues);
      setLaneTotals((prev) => shiftLaneTotals(prev, issueToDelete, null));
      setSelectedIssueId(remainingIssues[0]?.id ?? null);
      setDialogMode(null);
      setIsReadOnlyEditRequested(false);
      setRunDialogIssue(null);
      setAttachmentPreview(null);
      setForm(EMPTY_FORM);
      restoreDialogTriggerFocus(remainingIssues[0] ?? null);
      toast.success(messages.toast.deleteSuccess);
    } catch (error) {
      if (activeProjectIdRef.current === requestProjectId) {
        if (isEditablePageOpen) {
          setDialogErrorMessage(getCommandErrorMessage(error, t));
        } else {
          showCommandErrorAlert(error);
        }
      }
    } finally {
      if (activeProjectIdRef.current === requestProjectId) {
        setIsSaving(false);
      }
      setIsDeletingIssue(false);
    }
  }

  return {
    handleAdvanceStatus,
    handleDeleteIssue,
    resolveDirtyWorkspaceDecision,
  };
}
