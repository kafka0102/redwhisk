import { describe, expect, it, vi } from "vitest";

import { invokeCommand } from "../../shared/commands/command-client";
import {
  getProjectWorktreeChanges,
  getProjectWorktreeCommitHistory,
  getProjectWorktreeFileTree,
  readProjectWorktreeDiff,
  readProjectWorktreeFile,
} from "./session-workspace-commands";

vi.mock("../../shared/commands/command-client", () => ({
  invokeCommand: vi.fn(async (command: string) => ({ command })),
}));

const invokeCommandMock = vi.mocked(invokeCommand);

describe("session workspace commands", () => {
  it("invokes workspace commands with input envelope", async () => {
    await expect(
      getProjectWorktreeChanges({ projectId: 1, sessionId: 2 }),
    ).resolves.toEqual({ command: "get_project_worktree_changes" });
    await expect(
      getProjectWorktreeFileTree({ projectId: 1, sessionId: 2 }),
    ).resolves.toEqual({ command: "get_project_worktree_file_tree" });
    await expect(
      getProjectWorktreeCommitHistory({ projectId: 1, sessionId: 2 }),
    ).resolves.toEqual({ command: "get_project_worktree_commit_history" });
    await expect(
      readProjectWorktreeFile({
        projectId: 1,
        sessionId: 2,
        filePath: "src/main.ts",
      }),
    ).resolves.toEqual({ command: "read_project_worktree_file" });
    await expect(
      readProjectWorktreeDiff({
        projectId: 1,
        sessionId: 2,
        filePath: "src/main.ts",
      }),
    ).resolves.toEqual({ command: "read_project_worktree_diff" });

    expect(invokeCommandMock).toHaveBeenNthCalledWith(
      1,
      "get_project_worktree_changes",
      { input: { projectId: 1, sessionId: 2 } },
    );
    expect(invokeCommandMock).toHaveBeenNthCalledWith(
      2,
      "get_project_worktree_file_tree",
      { input: { projectId: 1, sessionId: 2 } },
    );
    expect(invokeCommandMock).toHaveBeenNthCalledWith(
      3,
      "get_project_worktree_commit_history",
      { input: { projectId: 1, sessionId: 2 } },
    );
    expect(invokeCommandMock).toHaveBeenNthCalledWith(
      4,
      "read_project_worktree_file",
      { input: { projectId: 1, sessionId: 2, filePath: "src/main.ts" } },
    );
    expect(invokeCommandMock).toHaveBeenNthCalledWith(
      5,
      "read_project_worktree_diff",
      { input: { projectId: 1, sessionId: 2, filePath: "src/main.ts" } },
    );
  });
});
