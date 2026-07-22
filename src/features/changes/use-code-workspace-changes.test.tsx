import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import {
  getProjectWorktreeChanges,
  getProjectWorktreeCommitHistory,
} from "../../shared/workspace/workspace-commands";
import { useCodeWorkspaceChanges } from "./use-code-workspace-changes";

vi.mock("../../shared/workspace/workspace-commands", () => ({
  COMMIT_HISTORY_PAGE_SIZE: 50,
  getProjectWorktreeChanges: vi.fn(),
  getProjectWorktreeCommitHistory: vi.fn(),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider initialLocale="en">{children}</I18nProvider>;
}

const changedFile = {
  filePath: "src/a.ts",
  oldPath: null,
  fileName: "a.ts",
  kind: "modified" as const,
  status: "M",
  additions: 1,
  deletions: 0,
  isBinary: false,
  contentHash: "h-a",
  metadataSignature: "m-a",
};

const inaccessibleError = {
  code: "AGENT_SESSION_VALIDATION_FAILED",
  message: "workspace root inaccessible",
  reason: "codeWorkspaceNotFound",
  details: [{ "@type": "WorkspaceRoot" }],
};

describe("useCodeWorkspaceChanges", () => {
  beforeEach(() => {
    vi.mocked(getProjectWorktreeChanges).mockReset();
    vi.mocked(getProjectWorktreeChanges).mockResolvedValue({
      files: [],
      signature: "changes-empty",
    });
    vi.mocked(getProjectWorktreeCommitHistory).mockReset();
    vi.mocked(getProjectWorktreeCommitHistory).mockResolvedValue({
      commits: [],
      signature: "commits-empty",
      isWorktree: false,
      hasMore: false,
    });
  });

  it("fetches uncommitted changes when enabled with a workspace path", async () => {
    vi.mocked(getProjectWorktreeChanges).mockResolvedValue({
      files: [changedFile],
      signature: "sig-1",
    });

    const { result } = renderHook(
      () => useCodeWorkspaceChanges(1, "/tmp/redwhisk", true),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.changes).toEqual([changedFile]);
    });
    expect(getProjectWorktreeChanges).toHaveBeenCalledWith({
      projectId: 1,
      workspacePath: "/tmp/redwhisk",
    });
    expect(result.current.isChangesLoading).toBe(false);
    expect(result.current.changesErrorMessage).toBeNull();
  });

  it("does not fetch while the changes view is disabled", () => {
    renderHook(() => useCodeWorkspaceChanges(1, "/tmp/redwhisk", false), {
      wrapper,
    });
    expect(getProjectWorktreeChanges).not.toHaveBeenCalled();
  });

  it("refetches and clears stale changes when the workspace path changes", async () => {
    vi.mocked(getProjectWorktreeChanges).mockResolvedValue({
      files: [changedFile],
      signature: "sig-1",
    });

    const { result, rerender } = renderHook(
      ({ path }) => useCodeWorkspaceChanges(1, path, true),
      { initialProps: { path: "/tmp/redwhisk" }, wrapper },
    );

    await waitFor(() => expect(result.current.changes).toEqual([changedFile]));

    vi.mocked(getProjectWorktreeChanges).mockResolvedValue({
      files: [],
      signature: "sig-2",
    });
    rerender({ path: "/tmp/other" });

    await waitFor(() =>
      expect(getProjectWorktreeChanges).toHaveBeenLastCalledWith({
        projectId: 1,
        workspacePath: "/tmp/other",
      }),
    );
    await waitFor(() => expect(result.current.changes).toEqual([]));
  });

  it("marks the workspace unavailable and surfaces an error when the root is inaccessible", async () => {
    vi.mocked(getProjectWorktreeChanges).mockRejectedValue(inaccessibleError);

    const { result } = renderHook(
      () => useCodeWorkspaceChanges(1, "/tmp/gone", true),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isChangesUnavailable).toBe(true);
    });
    expect(result.current.changesErrorMessage).not.toBeNull();
    expect(result.current.isChangesLoading).toBe(false);
  });

  it("keeps existing changes when a manual refresh returns the same signature", async () => {
    vi.mocked(getProjectWorktreeChanges).mockResolvedValue({
      files: [changedFile],
      signature: "sig-1",
    });

    const { result } = renderHook(
      () => useCodeWorkspaceChanges(1, "/tmp/redwhisk", true),
      { wrapper },
    );

    await waitFor(() => expect(result.current.changes).toEqual([changedFile]));
    const initialChanges = result.current.changes;

    // 即便后端返回了不同内容，只要 signature 不变就视为未变化，保留既有引用。
    vi.mocked(getProjectWorktreeChanges).mockResolvedValue({
      files: [{ ...changedFile, additions: 99 }],
      signature: "sig-1",
    });

    await act(async () => {
      result.current.refreshChanges();
    });
    await waitFor(() =>
      expect(getProjectWorktreeChanges).toHaveBeenCalledTimes(2),
    );

    expect(result.current.changes).toBe(initialChanges);
  });

  it("fetches committed history alongside uncommitted changes", async () => {
    const commit = {
      hash: "abc123",
      shortHash: "abc123",
      message: "feat: add thing",
      authorName: "Alice",
      committedAt: 1_780_638_000,
      files: [],
      isPushed: true,
      pushedTo: "origin/main",
      isCreatedInWorktree: false,
    };
    vi.mocked(getProjectWorktreeCommitHistory).mockResolvedValue({
      commits: [commit],
      signature: "commits-1",
      isWorktree: true,
      hasMore: false,
    });

    const { result } = renderHook(
      () => useCodeWorkspaceChanges(1, "/tmp/redwhisk", true),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.commitHistory).toEqual([commit]);
    });
    expect(getProjectWorktreeCommitHistory).toHaveBeenCalledWith({
      projectId: 1,
      workspacePath: "/tmp/redwhisk",
      limit: 50,
      offset: 0,
    });
    expect(result.current.isWorktree).toBe(true);
    expect(result.current.hasMoreCommitHistory).toBe(false);
    expect(result.current.isCommitHistoryLoading).toBe(false);
  });
});
