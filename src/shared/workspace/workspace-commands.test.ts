import { describe, expect, it, vi } from "vitest";

import { invokeCommand } from "../commands/command-client";
import {
  getProjectWorktreeFileTree,
  listCodeWorkspaceRoots,
  readProjectWorktreeFile,
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
  });
});
