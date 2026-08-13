import { describe, expect, it, vi } from "vitest";

import { invokeCommand } from "../commands/command-client";
import {
  getProjectWorktreeFileTree,
  listCodeWorkspaceRoots,
  readProjectWorktreeFile,
  writeProjectWorktreeFile,
  deleteCodeWorkspaceWorktree,
  listProjectCheckoutBranches,
  fetchProjectRemotes,
  checkoutProjectBranch,
  createProjectBranch,
  listProjectMergeBranches,
  mergeProjectBranch,
  pullProjectWorktree,
  pushProjectWorktree,
  searchProjectWorktreeContent,
  statProjectWorktreeFile,
  resolveWorkspaceGithubRemote,
  probeGithubCommit,
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
      listProjectCheckoutBranches({
        projectId: 1,
        workspacePath: "/tmp/root",
      }),
    ).resolves.toEqual({ command: "list_project_checkout_branches" });
    await expect(
      fetchProjectRemotes({ projectId: 1, workspacePath: "/tmp/root" }),
    ).resolves.toEqual({ command: "fetch_project_remotes" });
    await expect(
      checkoutProjectBranch({
        projectId: 1,
        workspacePath: "/tmp/root",
        kind: "local",
        name: "main",
      }),
    ).resolves.toEqual({ command: "checkout_project_branch" });
    await expect(
      pullProjectWorktree({ projectId: 1, workspacePath: "/tmp/root" }),
    ).resolves.toEqual({ command: "pull_project_worktree" });
    await expect(
      pushProjectWorktree({ projectId: 1, workspacePath: "/tmp/root" }),
    ).resolves.toEqual({ command: "push_project_worktree" });
    expect(invokeCommandMock).toHaveBeenNthCalledWith(
      5,
      "list_project_checkout_branches",
      { input: { projectId: 1, workspacePath: "/tmp/root" } },
    );
    expect(invokeCommandMock).toHaveBeenNthCalledWith(
      6,
      "fetch_project_remotes",
      { input: { projectId: 1, workspacePath: "/tmp/root" } },
    );
    expect(invokeCommandMock).toHaveBeenNthCalledWith(
      7,
      "checkout_project_branch",
      {
        input: {
          projectId: 1,
          workspacePath: "/tmp/root",
          kind: "local",
          name: "main",
        },
      },
    );
    expect(invokeCommandMock).toHaveBeenNthCalledWith(
      8,
      "pull_project_worktree",
      { input: { projectId: 1, workspacePath: "/tmp/root" } },
    );
    expect(invokeCommandMock).toHaveBeenNthCalledWith(
      9,
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
      10,
      "delete_code_workspace_worktree",
      {
        input: {
          projectId: 1,
          workspacePath: "/tmp/root.wt/issue-1",
        },
      },
    );
  });

  it("invokes create_project_branch with branch name envelope", async () => {
    await expect(
      createProjectBranch({
        projectId: 1,
        workspacePath: "/tmp/root",
        name: "feature-x",
      }),
    ).resolves.toEqual({ command: "create_project_branch" });
    expect(invokeCommandMock).toHaveBeenCalledWith("create_project_branch", {
      input: {
        projectId: 1,
        workspacePath: "/tmp/root",
        name: "feature-x",
      },
    });
  });

  it("invokes merge branch list and merge commands with envelopes", async () => {
    await expect(
      listProjectMergeBranches({
        projectId: 1,
        workspacePath: "/tmp/root",
      }),
    ).resolves.toEqual({ command: "list_project_merge_branches" });
    await expect(
      mergeProjectBranch({
        projectId: 1,
        workspacePath: "/tmp/root",
        kind: "local",
        name: "feature-a",
      }),
    ).resolves.toEqual({ command: "merge_project_branch" });
    expect(invokeCommandMock).toHaveBeenCalledWith(
      "list_project_merge_branches",
      {
        input: { projectId: 1, workspacePath: "/tmp/root" },
      },
    );
    expect(invokeCommandMock).toHaveBeenCalledWith("merge_project_branch", {
      input: {
        projectId: 1,
        workspacePath: "/tmp/root",
        kind: "local",
        name: "feature-a",
      },
    });
  });

  it("invokes merge_project_branch with remote tracking name", async () => {
    await expect(
      mergeProjectBranch({
        projectId: 1,
        workspacePath: "/tmp/root",
        kind: "remote",
        name: "origin/foo",
      }),
    ).resolves.toEqual({ command: "merge_project_branch" });
    expect(invokeCommandMock).toHaveBeenCalledWith("merge_project_branch", {
      input: {
        projectId: 1,
        workspacePath: "/tmp/root",
        kind: "remote",
        name: "origin/foo",
      },
    });
  });

  it("invokes write_project_worktree_file with path and content envelope", async () => {
    await expect(
      writeProjectWorktreeFile({
        projectId: 1,
        workspacePath: "/tmp/root",
        filePath: "src/main.ts",
        content: "export const value = 2;\n",
      }),
    ).resolves.toEqual({ command: "write_project_worktree_file" });

    expect(invokeCommandMock).toHaveBeenCalledWith(
      "write_project_worktree_file",
      {
        input: {
          projectId: 1,
          workspacePath: "/tmp/root",
          filePath: "src/main.ts",
          content: "export const value = 2;\n",
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

  it("invokes github remote resolve and commit probe commands", async () => {
    await expect(
      resolveWorkspaceGithubRemote({
        projectId: 1,
        workspacePath: "/tmp/repo",
      }),
    ).resolves.toEqual({ command: "resolve_workspace_github_remote" });
    await expect(
      probeGithubCommit({
        owner: "acme",
        repo: "widgets",
        commitHash: "abc",
      }),
    ).resolves.toEqual({ command: "probe_github_commit" });

    expect(invokeCommandMock).toHaveBeenCalledWith(
      "resolve_workspace_github_remote",
      { input: { projectId: 1, workspacePath: "/tmp/repo" } },
    );
    expect(invokeCommandMock).toHaveBeenCalledWith("probe_github_commit", {
      input: { owner: "acme", repo: "widgets", commitHash: "abc" },
    });
  });
});
