import {
  completeIssueFlow,
  detectAgentCommitCompletion,
  type CompleteIssueFlowInput,
  type CompleteIssueFlowResult,
  type DirtyWorkspaceOption,
  type IssueRecord,
} from "../issue-commands";
import type { WorktreeMergeDetail } from "./issue-completion-helpers";

export interface WorktreeMergeConflictSessionDetail extends WorktreeMergeDetail {
  sessionId?: number | null;
}

export class CompletionCancelledError extends Error {
  constructor() {
    super("completion cancelled");
    this.name = "CompletionCancelledError";
  }
}

export class WorktreeMergeConflictError extends Error {
  constructor(readonly detail: WorktreeMergeConflictSessionDetail) {
    super("worktree merge conflict");
    this.name = "WorktreeMergeConflictError";
  }
}

/** 非 merge_conflict 的 blocked 终态，携带完整 flow 结果供 surface 适配。 */
export class CompletionFlowBlockedError extends Error {
  constructor(readonly result: CompleteIssueFlowResult) {
    super(result.message);
    this.name = "CompletionFlowBlockedError";
  }
}

export interface CompletionFlowDecisionPorts {
  /** loading 指示（issues 全屏 loading / agents 可选用）。 */
  onLoadingChange?: (loading: boolean) => void;
  /** auto-commit 轮询阶段（agents 用于 isDetectingAgentCommitCompletion）。 */
  onWaitingAutoCommitChange?: (waiting: boolean) => void;
  requestDirtyDecision: (
    result: CompleteIssueFlowResult,
  ) => Promise<{ decision: DirtyWorkspaceOption; branchName: string | null }>;
  confirmContinueAfterCommit: () => Promise<boolean>;
  confirmWorktreeCleanup: (targetBranch: string | null) => Promise<boolean>;
  messages: {
    gitOperationBlocked: string;
    noCommitDetected: string;
  };
}

export interface RunCompletionFlowInput {
  projectId: number;
  issueId: number;
  ignoreDirty?: boolean | null;
  /**
   * 首轮即可带上的 dirty 决策（例如 Agents「提交代码」预览确认 → auto_commit）。
   * 仅在 phase 仍为 detecting / prompting_dirty 时由后端消费。
   */
  initialDirtyDecision?: DirtyWorkspaceOption | null;
  initialBranchName?: string | null;
  initialActualPath?: string | null;
}

export interface CompletionFlowClientDependencies {
  completeIssueFlow: (
    input: CompleteIssueFlowInput,
  ) => Promise<CompleteIssueFlowResult>;
  detectAgentCommitCompletion: typeof detectAgentCommitCompletion;
  delay: (milliseconds: number) => Promise<void>;
  maxDetectAttempts: number;
  detectIntervalMs: number;
}

const defaultDependencies: CompletionFlowClientDependencies = {
  completeIssueFlow,
  detectAgentCommitCompletion,
  delay: (milliseconds) =>
    new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    }),
  maxDetectAttempts: 60,
  detectIntervalMs: 2000,
};

function toMergeConflictError(
  result: CompleteIssueFlowResult,
): WorktreeMergeConflictError {
  return new WorktreeMergeConflictError({
    sessionId: result.sessionId,
    targetBranch: result.targetBranch ?? undefined,
    workspaceBranch: result.workspaceBranch ?? undefined,
    workspacePath: result.workspacePath ?? undefined,
    message: result.message,
  });
}

/**
 * 完成流程 protocol client：解释 CompleteIssueFlowResult，驱动决策端口与
 * detect 轮询，直到 completed / cancelled / blocked。
 *
 * Surface（Issues 看板 / Agents session）只负责实现决策 UI 与结果投影。
 */
export async function runCompletionFlow(
  input: RunCompletionFlowInput,
  ports: CompletionFlowDecisionPorts,
  dependencies: Partial<CompletionFlowClientDependencies> = {},
): Promise<IssueRecord> {
  const deps: CompletionFlowClientDependencies = {
    ...defaultDependencies,
    ...dependencies,
  };

  let dirtyDecision: DirtyWorkspaceOption | null =
    input.initialDirtyDecision ?? null;
  let branchName: string | null = input.initialBranchName ?? null;
  let actualPath: string | null = input.initialActualPath ?? null;
  let continueAfterCommit: boolean | null = null;
  let worktreeCleanupDecision: boolean | null = null;

  while (true) {
    ports.onLoadingChange?.(true);

    const result = await deps.completeIssueFlow({
      projectId: input.projectId,
      issueId: input.issueId,
      ...(input.ignoreDirty != null ? { ignoreDirty: input.ignoreDirty } : {}),
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
      ports.onLoadingChange?.(false);
      return result.issue;
    }

    if (result.action === "cancelled") {
      ports.onLoadingChange?.(false);
      throw new CompletionCancelledError();
    }

    if (result.action === "blocked") {
      ports.onLoadingChange?.(false);
      // merge_conflict 走专用 handoff 类型；其余 blocked 带完整 result。
      if (result.mergeBlockReason === "merge_conflict") {
        throw toMergeConflictError(result);
      }
      throw new CompletionFlowBlockedError(result);
    }

    if (result.action === "prompt_dirty_decision") {
      ports.onLoadingChange?.(false);
      const decision = await ports.requestDirtyDecision(result);
      dirtyDecision = decision.decision;
      branchName = decision.branchName;
      // cancel 仍发给后端，下一轮返回 cancelled。
      continue;
    }

    if (result.action === "waiting_auto_commit") {
      ports.onWaitingAutoCommitChange?.(true);
      try {
        const detection = await waitForAgentCommit(
          input.projectId,
          input.issueId,
          deps,
        );
        if (detection.outcome === "blocked") {
          ports.onLoadingChange?.(false);
          throw new Error(
            detection.message || ports.messages.gitOperationBlocked,
          );
        }
        if (detection.outcome === "no_commit_detected") {
          ports.onLoadingChange?.(false);
          throw new Error(ports.messages.noCommitDetected);
        }
      } finally {
        ports.onWaitingAutoCommitChange?.(false);
      }

      // commit_detected → 弹「代码已提交成功。确定继续标记完成吗？」
      ports.onLoadingChange?.(false);
      continueAfterCommit = await ports.confirmContinueAfterCommit();
      continue;
    }

    if (result.action === "confirm_continue_after_commit") {
      ports.onLoadingChange?.(false);
      continueAfterCommit = await ports.confirmContinueAfterCommit();
      continue;
    }

    if (result.action === "confirm_worktree_cleanup") {
      ports.onLoadingChange?.(false);
      worktreeCleanupDecision = await ports.confirmWorktreeCleanup(
        result.targetBranch,
      );
      continue;
    }

    ports.onLoadingChange?.(false);
    throw new Error(result.message);
  }
}

export type AgentCommitWaitOutcome =
  | { outcome: "commit_detected" }
  | { outcome: "no_commit_detected" }
  | { outcome: "blocked"; message: string };

/** 轮询 detect_agent_commit_completion，直到检测到 commit / 阻塞 / 超时。 */
export async function waitForAgentCommit(
  projectId: number,
  issueId: number,
  dependencies: Partial<CompletionFlowClientDependencies> = {},
): Promise<AgentCommitWaitOutcome> {
  const deps: CompletionFlowClientDependencies = {
    ...defaultDependencies,
    ...dependencies,
  };

  for (let attempt = 0; attempt < deps.maxDetectAttempts; attempt += 1) {
    await deps.delay(deps.detectIntervalMs);
    const detection = await deps.detectAgentCommitCompletion({
      projectId,
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
