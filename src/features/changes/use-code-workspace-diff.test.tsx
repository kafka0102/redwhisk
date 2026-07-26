import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import {
  type WorkspaceChangedFile,
  type WorkspaceCommitChangedFile,
  type WorkspaceCommitRecord,
  type WorkspaceDiffContent,
  readProjectWorktreeDiff,
} from "../../shared/workspace/workspace-commands";
import { useCodeWorkspaceDiff } from "./use-code-workspace-diff";

vi.mock("../../shared/workspace/workspace-commands", () => ({
  readProjectWorktreeDiff: vi.fn(),
}));

const readDiffMock = vi.mocked(readProjectWorktreeDiff);

const changedFile: WorkspaceChangedFile = {
  filePath: "src/a.ts",
  oldPath: null,
  fileName: "a.ts",
  kind: "modified",
  status: "M",
  additions: 1,
  deletions: 1,
  isBinary: false,
  contentHash: "hash",
  metadataSignature: "sig",
};

const committedFile: WorkspaceCommitChangedFile = {
  filePath: "src/a.ts",
  oldPath: null,
  fileName: "a.ts",
  kind: "modified",
  status: "M",
};

const diffContent: WorkspaceDiffContent = {
  filePath: "src/a.ts",
  oldPath: null,
  kind: "modified",
  language: "typescript",
  originalContent: "old",
  modifiedContent: "new",
  isBinary: false,
  isTooLarge: false,
};

function renderDiffHook(workspacePath: string | null = "/tmp/repo") {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nProvider initialLocale="en">{children}</I18nProvider>
  );
  return renderHook(() => useCodeWorkspaceDiff(1, workspacePath), { wrapper });
}

describe("useCodeWorkspaceDiff", () => {
  beforeEach(() => {
    readDiffMock.mockReset();
  });

  it("fetches an uncommitted diff without commitHash and loads the diff", async () => {
    readDiffMock.mockResolvedValue(diffContent);
    const { result } = renderDiffHook();

    expect(result.current.diffTab).toBeNull();

    await act(async () => {
      result.current.openChange(changedFile);
    });

    expect(readDiffMock).toHaveBeenCalledWith({
      projectId: 1,
      workspacePath: "/tmp/repo",
      filePath: "src/a.ts",
    });
    expect(result.current.diffTab).not.toBeNull();
    expect(result.current.diffTab?.isLoading).toBe(false);
    expect(result.current.diffTab?.errorMessage).toBeNull();
    expect(result.current.diffTab?.diff).toEqual(diffContent);
  });

  it("fetches a committed diff with commitHash", async () => {
    readDiffMock.mockResolvedValue(diffContent);
    const { result } = renderDiffHook();

    await act(async () => {
      result.current.openCommittedChange("abc123", committedFile);
    });

    expect(readDiffMock).toHaveBeenCalledWith({
      projectId: 1,
      workspacePath: "/tmp/repo",
      filePath: "src/a.ts",
      commitHash: "abc123",
    });
    expect(result.current.diffTab?.diff).toEqual(diffContent);
  });

  it("refetches when the same file is reopened", async () => {
    readDiffMock.mockResolvedValue(diffContent);
    const { result } = renderDiffHook();

    await act(async () => {
      result.current.openChange(changedFile);
    });
    await act(async () => {
      result.current.openChange(changedFile);
    });

    expect(readDiffMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces an error message when the diff command rejects", async () => {
    readDiffMock.mockRejectedValue({
      code: "WORKSPACE_DIFF_FAILED",
      message: "boom",
    });
    const { result } = renderDiffHook();

    await act(async () => {
      result.current.openChange(changedFile);
    });

    await waitFor(() => expect(result.current.diffTab?.isLoading).toBe(false));
    expect(result.current.diffTab?.errorMessage).not.toBeNull();
    expect(result.current.diffTab?.diff).toBeNull();
  });

  it("does not fetch when workspacePath is null", () => {
    const { result } = renderDiffHook(null);

    act(() => {
      result.current.openChange(changedFile);
    });

    expect(readDiffMock).not.toHaveBeenCalled();
    expect(result.current.diffTab).toBeNull();
  });

  it("clears the diff tab", async () => {
    readDiffMock.mockResolvedValue(diffContent);
    const { result } = renderDiffHook();

    await act(async () => {
      result.current.openChange(changedFile);
    });
    expect(result.current.diffTab).not.toBeNull();

    act(() => {
      result.current.clear();
    });
    expect(result.current.diffTab).toBeNull();
  });

  it("openCommitChanges loads all files and clears single-file mode", async () => {
    const fileB: WorkspaceCommitChangedFile = {
      filePath: "src/b.ts",
      oldPath: null,
      fileName: "b.ts",
      kind: "added",
      status: "A",
    };
    const commit: WorkspaceCommitRecord = {
      hash: "fullhash123",
      shortHash: "fullhash",
      message: "feat: multi",
      authorName: "dev",
      committedAt: 1,
      files: [committedFile, fileB],
      isPushed: false,
      isCreatedInWorktree: false,
    };
    readDiffMock.mockImplementation(async ({ filePath }) => ({
      ...diffContent,
      filePath,
    }));
    const { result } = renderDiffHook();

    await act(async () => {
      result.current.openChange(changedFile);
    });
    expect(result.current.diffTab).not.toBeNull();

    await act(async () => {
      result.current.openCommitChanges(commit);
    });

    expect(result.current.diffTab).toBeNull();
    expect(result.current.multiDiff?.commitHash).toBe("fullhash123");
    expect(result.current.multiDiff?.files).toHaveLength(2);

    await waitFor(() =>
      expect(result.current.multiDiff?.files.every((f) => !f.isLoading)).toBe(
        true,
      ),
    );
    expect(readDiffMock).toHaveBeenCalledWith(
      expect.objectContaining({
        commitHash: "fullhash123",
        filePath: "src/a.ts",
      }),
    );
    expect(readDiffMock).toHaveBeenCalledWith(
      expect.objectContaining({
        commitHash: "fullhash123",
        filePath: "src/b.ts",
      }),
    );
    expect(result.current.multiDiff?.files[0].diff).not.toBeNull();
    expect(result.current.multiDiff?.files[1].diff).not.toBeNull();
  });

  it("openCommitChanges with zero files shows empty multiDiff without IPC", async () => {
    const commit: WorkspaceCommitRecord = {
      hash: "emptyhash",
      shortHash: "empty",
      message: "empty",
      authorName: "dev",
      committedAt: 1,
      files: [],
      isPushed: false,
      isCreatedInWorktree: false,
    };
    const { result } = renderDiffHook();

    await act(async () => {
      result.current.openCommitChanges(commit);
    });

    expect(result.current.multiDiff).toEqual({
      commitHash: "emptyhash",
      files: [],
    });
    expect(readDiffMock).not.toHaveBeenCalled();
  });

  it("opening a single file clears multi-diff mode", async () => {
    const commit: WorkspaceCommitRecord = {
      hash: "h1",
      shortHash: "h1",
      message: "m",
      authorName: "dev",
      committedAt: 1,
      files: [committedFile],
      isPushed: false,
      isCreatedInWorktree: false,
    };
    readDiffMock.mockResolvedValue(diffContent);
    const { result } = renderDiffHook();

    await act(async () => {
      result.current.openCommitChanges(commit);
    });
    await waitFor(() =>
      expect(result.current.multiDiff?.files[0].isLoading).toBe(false),
    );

    await act(async () => {
      result.current.openCommittedChange("h1", committedFile);
    });

    expect(result.current.multiDiff).toBeNull();
    expect(result.current.diffTab?.filePath).toBe("src/a.ts");
  });

  it("surfaces per-file error in multi-diff without failing siblings", async () => {
    const fileB: WorkspaceCommitChangedFile = {
      filePath: "src/b.ts",
      oldPath: null,
      fileName: "b.ts",
      kind: "modified",
      status: "M",
    };
    const commit: WorkspaceCommitRecord = {
      hash: "h2",
      shortHash: "h2",
      message: "m",
      authorName: "dev",
      committedAt: 1,
      files: [committedFile, fileB],
      isPushed: false,
      isCreatedInWorktree: false,
    };
    readDiffMock.mockImplementation(async ({ filePath }) => {
      if (filePath === "src/a.ts") {
        throw { code: "WORKSPACE_DIFF_FAILED", message: "boom-a" };
      }
      return { ...diffContent, filePath: "src/b.ts" };
    });
    const { result } = renderDiffHook();

    await act(async () => {
      result.current.openCommitChanges(commit);
    });

    await waitFor(() =>
      expect(result.current.multiDiff?.files.every((f) => !f.isLoading)).toBe(
        true,
      ),
    );
    expect(result.current.multiDiff?.files[0].errorMessage).not.toBeNull();
    expect(result.current.multiDiff?.files[0].diff).toBeNull();
    expect(result.current.multiDiff?.files[1].diff).not.toBeNull();
    expect(result.current.multiDiff?.files[1].errorMessage).toBeNull();
  });

  it("clear wipes both single and multi diff", async () => {
    const commit: WorkspaceCommitRecord = {
      hash: "h3",
      shortHash: "h3",
      message: "m",
      authorName: "dev",
      committedAt: 1,
      files: [committedFile],
      isPushed: false,
      isCreatedInWorktree: false,
    };
    readDiffMock.mockResolvedValue(diffContent);
    const { result } = renderDiffHook();

    await act(async () => {
      result.current.openCommitChanges(commit);
    });
    expect(result.current.multiDiff).not.toBeNull();

    act(() => {
      result.current.clear();
    });
    expect(result.current.multiDiff).toBeNull();
    expect(result.current.diffTab).toBeNull();
  });
});
