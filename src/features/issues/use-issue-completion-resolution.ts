import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import {
  completeIssueFlow,
  detectAgentCommitCompletion,
  type CompleteIssueFlowResult,
  type DirtyWorkspaceOption,
  type IssueRecord,
} from "./issue-commands";
import {
  EMPTY_FORM,
  type DialogMode,
  type IssueFormState,
} from "./issue-activity-types";
import {
  buildWorktreeMergeConflictPrompt,
  type WorktreeMergeDetail,
} from "./issue-completion/issue-completion-helpers";
import {
  injectAgentSessionPrompt,
  resumeStructuredAgentSession,
} from "../agents/agent-session-commands";
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

export interface WorktreeMergeConflictSessionDetail extends WorktreeMergeDetail {
  sessionId?: number | null;
}

export type DirtyWorkspaceDecisionResolver = (
  decision: DirtyWorkspaceOption,
  branchName: string | null,
) => void;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class CompletionCancelledError extends Error {
  constructor() {
    super("completion cancelled");
  }
}

export class WorktreeMergeConflictError extends Error {
  constructor(readonly detail: WorktreeMergeConflictSessionDetail) {
    super("worktree merge conflict");
  }
}

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
  async function completeIssueWithCompletionChecks(
    requestProjectId: number,
    issueId: number,
  ): Promise<IssueRecord> {
    let dirtyDecision: DirtyWorkspaceOption | null = null;
    let branchName: string | null = null;
    let actualPath: string | null = null;
    let continueAfterCommit: boolean | null = null;
    let worktreeCleanupDecision: boolean | null = null;

    while (true) {
      showCompletionLoadingDialog();

      const result = await completeIssueFlow({
        projectId: requestProjectId,
        issueId,
        dirtyDecision,
        branchName,
        actualPath,
        continueAfterCommit,
        worktreeCleanupDecision,
      });
      // 决策一次性消费，下一轮不再重复发送。
      dirtyDecision = null;
      branchName = null;
      actualPath = null;
      continueAfterCommit = null;
      worktreeCleanupDecision = null;

      if (result.action === "completed") {
        hideCompletionLoadingDialog();
        return result.issue;
      }

      if (result.action === "cancelled") {
        hideCompletionLoadingDialog();
        throw new CompletionCancelledError();
      }

      if (result.action === "blocked") {
        hideCompletionLoadingDialog();
        // 仅 worktree merge 冲突走 agent handoff；git_operation / target_worktree_dirty 等直接展示详细 message。
        if (result.mergeBlockReason === "merge_conflict") {
          throw new WorktreeMergeConflictError({
            sessionId: result.sessionId,
            targetBranch: result.targetBranch ?? undefined,
            workspaceBranch: result.workspaceBranch ?? undefined,
            workspacePath: result.workspacePath ?? undefined,
            message: result.message,
          });
        }
        throw new Error(result.message);
      }

      if (result.action === "prompt_dirty_decision") {
        hideCompletionLoadingDialog();
        const decision = await requestDirtyWorkspaceDecision(result);
        dirtyDecision = decision.decision;
        branchName = decision.branchName;
        if (decision.decision === "cancel") {
          // 让后端记录 cancelled，下一轮返回 cancelled → 抛 CompletionCancelledError。
          continue;
        }
        continue;
      }

      if (result.action === "waiting_auto_commit") {
        const detection = await waitForAgentCommit(requestProjectId, issueId);
        if (detection.outcome === "blocked") {
          hideCompletionLoadingDialog();
          throw new Error(
            detection.message || messages.issues.completionGitOperationBlocked,
          );
        }
        if (detection.outcome === "no_commit_detected") {
          hideCompletionLoadingDialog();
          throw new Error(messages.issues.completionNoCommitDetected);
        }
        // commit_detected → 弹「代码已提交成功。确定继续标记完成吗？」
        hideCompletionLoadingDialog();
        const proceed = await confirm({
          title: messages.issues.completionContinueAfterCommitTitle,
          message: messages.issues.completionContinueAfterCommitMessage,
          confirmLabel: messages.issues.completionContinueLabel,
          cancelLabel: messages.issues.completionCancel,
          confirmVariant: "default",
        });
        continueAfterCommit = proceed;
        continue;
      }

      if (result.action === "confirm_worktree_cleanup") {
        hideCompletionLoadingDialog();
        const del = await confirm({
          title: messages.issues.completionWorktreeCleanupTitle,
          message: messages.issues.completionWorktreeCleanupMessage(
            result.targetBranch ?? "",
          ),
          confirmLabel: messages.issues.completionWorktreeCleanupConfirm,
          cancelLabel: messages.issues.completionWorktreeCleanupKeep,
          confirmVariant: "destructive",
        });
        worktreeCleanupDecision = del;
        continue;
      }

      throw new Error(result.message);
    }
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

  /** 轮询检测 agent 是否已提交新 commit。 */
  async function waitForAgentCommit(
    requestProjectId: number,
    issueId: number,
  ): Promise<
    | { outcome: "commit_detected" }
    | { outcome: "no_commit_detected" }
    | { outcome: "blocked"; message: string }
  > {
    const maxAttempts = 60;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await delay(2000);
      const detection = await detectAgentCommitCompletion({
        projectId: requestProjectId,
        issueId,
      });
      if (detection.outcome === "commit_detected") {
        return { outcome: "commit_detected" };
      }
      if (detection.outcome === "git_operation_blocked") {
        return { outcome: "blocked", message: detection.message };
      }
      // no_commit_detected → 继续轮询。
    }
    return { outcome: "no_commit_detected" };
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
    // worktree session 关闭后 handle 会从 agent_registry 移除，直接注入会报
    // AgentSessionNotRunning。先 resume 重建 handle，再注入合并 prompt。
    // resume 失败（如工作区丢失、provider 不支持续接）时 handle 必然不在
    // registry，inject 随后也会失败——这里捕获并在对话框展示具体错误，避免
    // 错误冒泡出 completeIssueWithCompletionChecks 的 catch 块成为 unhandled
    // rejection，且比 inject 的泛化 notRunning 错误更有利于排查。
    try {
      await resumeStructuredAgentSession({
        projectId: requestProjectId,
        sessionId,
      });
      await injectAgentSessionPrompt({
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
