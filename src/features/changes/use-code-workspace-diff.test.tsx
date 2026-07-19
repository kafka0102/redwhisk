import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import {
  type WorkspaceChangedFile,
  type WorkspaceCommitChangedFile,
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
});
