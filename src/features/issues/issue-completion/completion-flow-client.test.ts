import { describe, expect, it, vi } from "vitest";

import {
  CompletionCancelledError,
  runCompletionFlow,
  waitForAgentCommit,
  WorktreeMergeConflictError,
  type CompletionFlowDecisionPorts,
} from "./completion-flow-client";
import type { CompleteIssueFlowResult, IssueRecord } from "../issue-commands";

function baseIssue(overrides: Partial<IssueRecord> = {}): IssueRecord {
  return {
    id: 10,
    number: 10,
    projectId: 1,
    title: "Issue",
    description: "",
    status: "review",
    linkedSessionId: 100,
    linkedSessionStatus: "running",
    linkedSessionAttention: "none",
    createdAt: 1,
    updatedAt: 2,
    statusChangedAt: 2,
    attachments: [],
    labels: [],
    linkedSessionLogPath: null,
    linkedSessionLatestOutput: null,
    ...overrides,
  };
}

function flowResult(
  action: CompleteIssueFlowResult["action"],
  overrides: Partial<CompleteIssueFlowResult> = {},
): CompleteIssueFlowResult {
  return {
    action,
    issue: baseIssue(
      action === "completed" ? { status: "completed" } : undefined,
    ),
    flow: null,
    message: overrides.message ?? `action:${action}`,
    mergeBlockReason: null,
    targetBranch: "main",
    workspaceBranch: "issue-10",
    workspacePath: "/tmp/wt",
    actualPath: "/tmp/wt",
    drifted: false,
    sessionId: 100,
    ...overrides,
  };
}

function ports(
  overrides: Partial<CompletionFlowDecisionPorts> = {},
): CompletionFlowDecisionPorts {
  return {
    requestDirtyDecision: vi.fn(async () => ({
      decision: "skip" as const,
      branchName: null,
    })),
    confirmContinueAfterCommit: vi.fn(async () => true),
    confirmWorktreeCleanup: vi.fn(async () => false),
    messages: {
      gitOperationBlocked: "git blocked",
      noCommitDetected: "no commit",
    },
    ...overrides,
  };
}

describe("runCompletionFlow", () => {
  it("returns issue when flow completes immediately", async () => {
    const complete = vi.fn().mockResolvedValueOnce(flowResult("completed"));
    const decisionPorts = ports();
    const onLoadingChange = vi.fn();

    const issue = await runCompletionFlow(
      { projectId: 1, issueId: 10 },
      { ...decisionPorts, onLoadingChange },
      {
        completeIssueFlow: complete,
        delay: async () => undefined,
        maxDetectAttempts: 1,
        detectIntervalMs: 0,
      },
    );

    expect(issue.status).toBe("completed");
    expect(complete).toHaveBeenCalledWith({
      projectId: 1,
      issueId: 10,
      dirtyDecision: null,
      branchName: null,
      actualPath: null,
      continueAfterCommit: null,
      worktreeCleanupDecision: null,
    });
    expect(onLoadingChange).toHaveBeenCalledWith(true);
    expect(onLoadingChange).toHaveBeenLastCalledWith(false);
  });

  it("forwards ignoreDirty and initial dirty decision", async () => {
    const complete = vi.fn().mockResolvedValueOnce(flowResult("completed"));

    await runCompletionFlow(
      {
        projectId: 1,
        issueId: 10,
        ignoreDirty: true,
        initialDirtyDecision: "auto_commit",
        initialBranchName: "feature",
      },
      ports(),
      {
        completeIssueFlow: complete,
        delay: async () => undefined,
        maxDetectAttempts: 1,
        detectIntervalMs: 0,
      },
    );

    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        ignoreDirty: true,
        dirtyDecision: "auto_commit",
        branchName: "feature",
      }),
    );
  });

  it("prompts dirty decision and continues with user choice", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce(flowResult("prompt_dirty_decision"))
      .mockResolvedValueOnce(flowResult("completed"));
    const requestDirtyDecision = vi.fn(async () => ({
      decision: "skip" as const,
      branchName: "issue-10-fixed",
    }));

    await runCompletionFlow(
      { projectId: 1, issueId: 10 },
      ports({ requestDirtyDecision }),
      {
        completeIssueFlow: complete,
        delay: async () => undefined,
        maxDetectAttempts: 1,
        detectIntervalMs: 0,
      },
    );

    expect(requestDirtyDecision).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        dirtyDecision: "skip",
        branchName: "issue-10-fixed",
      }),
    );
  });

  it("waits for agent commit then confirms continue", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce(flowResult("waiting_auto_commit"))
      .mockResolvedValueOnce(flowResult("completed"));
    const detect = vi.fn().mockResolvedValue({
      outcome: "commit_detected",
      issue: baseIssue(),
      message: "ok",
    });
    const confirmContinueAfterCommit = vi.fn(async () => true);
    const onWaitingAutoCommitChange = vi.fn();

    await runCompletionFlow(
      { projectId: 1, issueId: 10 },
      ports({ confirmContinueAfterCommit, onWaitingAutoCommitChange }),
      {
        completeIssueFlow: complete,
        detectAgentCommitCompletion: detect,
        delay: async () => undefined,
        maxDetectAttempts: 3,
        detectIntervalMs: 0,
      },
    );

    expect(detect).toHaveBeenCalledWith({ projectId: 1, issueId: 10 });
    expect(confirmContinueAfterCommit).toHaveBeenCalledTimes(1);
    expect(onWaitingAutoCommitChange).toHaveBeenCalledWith(true);
    expect(onWaitingAutoCommitChange).toHaveBeenLastCalledWith(false);
    expect(complete).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ continueAfterCommit: true }),
    );
  });

  it("handles confirm_continue_after_commit without waiting loop", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce(flowResult("confirm_continue_after_commit"))
      .mockResolvedValueOnce(flowResult("cancelled"));
    const confirmContinueAfterCommit = vi.fn(async () => false);

    await expect(
      runCompletionFlow(
        { projectId: 1, issueId: 10 },
        ports({ confirmContinueAfterCommit }),
        {
          completeIssueFlow: complete,
          delay: async () => undefined,
          maxDetectAttempts: 1,
          detectIntervalMs: 0,
        },
      ),
    ).rejects.toBeInstanceOf(CompletionCancelledError);

    expect(confirmContinueAfterCommit).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ continueAfterCommit: false }),
    );
  });

  it("throws CompletionCancelledError on cancelled", async () => {
    await expect(
      runCompletionFlow({ projectId: 1, issueId: 10 }, ports(), {
        completeIssueFlow: vi
          .fn()
          .mockResolvedValueOnce(flowResult("cancelled")),
        delay: async () => undefined,
        maxDetectAttempts: 1,
        detectIntervalMs: 0,
      }),
    ).rejects.toBeInstanceOf(CompletionCancelledError);
  });

  it("throws WorktreeMergeConflictError on merge_conflict", async () => {
    await expect(
      runCompletionFlow({ projectId: 1, issueId: 10 }, ports(), {
        completeIssueFlow: vi.fn().mockResolvedValueOnce(
          flowResult("blocked", {
            mergeBlockReason: "merge_conflict",
            message: "conflict",
          }),
        ),
        delay: async () => undefined,
        maxDetectAttempts: 1,
        detectIntervalMs: 0,
      }),
    ).rejects.toBeInstanceOf(WorktreeMergeConflictError);
  });

  it("throws CompletionFlowBlockedError on other blocked reasons", async () => {
    await expect(
      runCompletionFlow({ projectId: 1, issueId: 10 }, ports(), {
        completeIssueFlow: vi.fn().mockResolvedValueOnce(
          flowResult("blocked", {
            mergeBlockReason: "target_worktree_dirty",
            message: "dirty target",
          }),
        ),
        delay: async () => undefined,
        maxDetectAttempts: 1,
        detectIntervalMs: 0,
      }),
    ).rejects.toMatchObject({
      name: "CompletionFlowBlockedError",
      message: "dirty target",
    });
  });

  it("confirms worktree cleanup decision", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce(flowResult("confirm_worktree_cleanup"))
      .mockResolvedValueOnce(flowResult("completed"));
    const confirmWorktreeCleanup = vi.fn(async () => true);

    await runCompletionFlow(
      { projectId: 1, issueId: 10 },
      ports({ confirmWorktreeCleanup }),
      {
        completeIssueFlow: complete,
        delay: async () => undefined,
        maxDetectAttempts: 1,
        detectIntervalMs: 0,
      },
    );

    expect(confirmWorktreeCleanup).toHaveBeenCalledWith("main");
    expect(complete).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ worktreeCleanupDecision: true }),
    );
  });
});

describe("waitForAgentCommit", () => {
  it("returns blocked when detection reports git operation", async () => {
    const outcome = await waitForAgentCommit(1, 10, {
      detectAgentCommitCompletion: vi.fn().mockResolvedValue({
        outcome: "git_operation_blocked",
        issue: baseIssue(),
        message: "busy",
      }),
      delay: async () => undefined,
      maxDetectAttempts: 2,
      detectIntervalMs: 0,
    });
    expect(outcome).toEqual({ outcome: "blocked", message: "busy" });
  });

  it("returns no_commit_detected after max attempts", async () => {
    const detect = vi.fn().mockResolvedValue({
      outcome: "no_commit_detected",
      issue: baseIssue(),
      message: "",
    });
    const outcome = await waitForAgentCommit(1, 10, {
      detectAgentCommitCompletion: detect,
      delay: async () => undefined,
      maxDetectAttempts: 3,
      detectIntervalMs: 0,
    });
    expect(outcome).toEqual({ outcome: "no_commit_detected" });
    expect(detect).toHaveBeenCalledTimes(3);
  });
});
