import { describe, expect, it, vi } from "vitest";

import { invokeCommand } from "../commands/command-client";
import {
  getProjectWorktreeFileTree,
  listCodeWorkspaceRoots,
  readProjectWorktreeFile,
  deleteCodeWorkspaceWorktree,
  pullProjectWorktree,
  pushProjectWorktree,
  searchProjectWorktreeContent,
  statProjectWorktreeFile,
} from "./workspace-commands";

vi.mock("../commands/command-client", () => ({
  invokeCommand: vi.fn(async (command: string) => ({ command })),
}));

const invokeCommandMock = vi.mocked(invokeCommand);

describe("workspace commands", () => {
  it("invokes shared workspace commands with input envelope", async () => {
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
    await expect(listCodeWorkspaceRoots(1)).resolves.toEqual({
      command: "list_code_workspace_roots",
    });
    await expect(
      searchProjectWorktreeContent({
        projectId: 1,
        workspacePath: "/tmp/root",
        query: "foo",
        matchCase: true,
      }),
    ).resolves.toEqual({ command: "search_project_worktree_content" });

    expect(invokeCommandMock).toHaveBeenNthCalledWith(
      1,
      "get_project_worktree_file_tree",
      { input: { projectId: 1, sessionId: 2 } },
    );
    expect(invokeCommandMock).toHaveBeenNthCalledWith(
      2,
      "read_project_worktree_file",
      { input: { projectId: 1, sessionId: 2, filePath: "src/main.ts" } },
    );
    expect(invokeCommandMock).toHaveBeenNthCalledWith(
      3,
      "list_code_workspace_roots",
      { projectId: 1 },
    );
    expect(invokeCommandMock).toHaveBeenNthCalledWith(
      4,
      "search_project_worktree_content",
      {
        input: {
          projectId: 1,
          workspacePath: "/tmp/root",
          query: "foo",
          matchCase: true,
        },
      },
    );

    await expect(
      pullProjectWorktree({ projectId: 1, workspacePath: "/tmp/root" }),
    ).resolves.toEqual({ command: "pull_project_worktree" });
    await expect(
      pushProjectWorktree({ projectId: 1, workspacePath: "/tmp/root" }),
    ).resolves.toEqual({ command: "push_project_worktree" });
    expect(invokeCommandMock).toHaveBeenNthCalledWith(
      5,
      "pull_project_worktree",
      { input: { projectId: 1, workspacePath: "/tmp/root" } },
    );
    expect(invokeCommandMock).toHaveBeenNthCalledWith(
      6,
      "push_project_worktree",
      { input: { projectId: 1, workspacePath: "/tmp/root" } },
    );

    await expect(
      deleteCodeWorkspaceWorktree({
        projectId: 1,
        workspacePath: "/tmp/root.wt/issue-1",
      }),
    ).resolves.toEqual({ command: "delete_code_workspace_worktree" });
    expect(invokeCommandMock).toHaveBeenNthCalledWith(
      7,
      "delete_code_workspace_worktree",
      {
        input: {
          projectId: 1,
          workspacePath: "/tmp/root.wt/issue-1",
        },
      },
    );
  });

  it("invokes stat_project_worktree_file with path input envelope", async () => {
    await expect(
      statProjectWorktreeFile({
        projectId: 1,
        workspacePath: "/tmp/root",
        filePath: "src/main.ts",
      }),
    ).resolves.toEqual({ command: "stat_project_worktree_file" });

    expect(invokeCommandMock).toHaveBeenCalledWith(
      "stat_project_worktree_file",
      {
        input: {
          projectId: 1,
          workspacePath: "/tmp/root",
          filePath: "src/main.ts",
        },
      },
    );
  });
});
