import { describe, expect, it, vi } from "vitest";

import {
  getProjectWorktreeChanges,
  getProjectWorktreeFileTree,
  readProjectWorktreeDiff,
  readProjectWorktreeFile,
} from "./session-workspace-commands";

vi.mock("../../shared/commands/command-client", () => ({
  invokeCommand: vi.fn(async (command: string) => ({ command })),
}));

describe("session workspace commands", () => {
  it("invokes workspace commands with input envelope", async () => {
    await expect(
      getProjectWorktreeChanges({ projectId: 1, sessionId: 2 }),
    ).resolves.toEqual({ command: "get_project_worktree_changes" });
    await expect(
      getProjectWorktreeFileTree({ projectId: 1, sessionId: 2 }),
    ).resolves.toEqual({ command: "get_project_worktree_file_tree" });
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
  });
});
