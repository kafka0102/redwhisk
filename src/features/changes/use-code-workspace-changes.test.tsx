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
    expect(result.current.branchSync).toBeNull();
  });

  it("exposes branchSync from getProjectWorktreeChanges and updates when signature changes", async () => {
    vi.mocked(getProjectWorktreeChanges).mockResolvedValue({
      files: [changedFile],
      signature: "sig-sync-1",
      branchSync: { upstream: "origin/main", ahead: 1, behind: 0 },
    });

    const { result } = renderHook(
      () => useCodeWorkspaceChanges(1, "/tmp/redwhisk", true),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.branchSync).toEqual({
        upstream: "origin/main",
        ahead: 1,
        behind: 0,
      });
    });

    vi.mocked(getProjectWorktreeChanges).mockResolvedValue({
      files: [changedFile],
      signature: "sig-sync-2",
      branchSync: { upstream: "origin/main", ahead: 1, behind: 2 },
    });

    await act(async () => {
      result.current.refreshChanges();
    });

    await waitFor(() => {
      expect(result.current.branchSync).toEqual({
        upstream: "origin/main",
        ahead: 1,
        behind: 2,
      });
    });
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
      branchSync: { upstream: "origin/main", ahead: 0, behind: 1 },
    });

    const { result } = renderHook(
      () => useCodeWorkspaceChanges(1, "/tmp/redwhisk", true),
      { wrapper },
    );

    await waitFor(() => expect(result.current.changes).toEqual([changedFile]));
    const initialChanges = result.current.changes;
    const initialBranchSync = result.current.branchSync;
    expect(result.current.isChangesLoading).toBe(false);

    // 即便后端返回了不同内容，只要 signature 不变就视为未变化，保留既有引用。
    let resolveRefresh:
      | ((value: {
          files: (typeof changedFile)[];
          signature: string;
          branchSync: { upstream: string; ahead: number; behind: number };
        }) => void)
      | undefined;
    vi.mocked(getProjectWorktreeChanges).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    await act(async () => {
      result.current.refreshChanges();
    });

    // soft revalidate：已有展示数据时刷新全程不进 loading。
    expect(result.current.isChangesLoading).toBe(false);

    await act(async () => {
      resolveRefresh?.({
        files: [{ ...changedFile, additions: 99 }],
        signature: "sig-1",
        branchSync: { upstream: "origin/main", ahead: 9, behind: 9 },
      });
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(getProjectWorktreeChanges).toHaveBeenCalledTimes(2),
    );

    expect(result.current.isChangesLoading).toBe(false);
    expect(result.current.changes).toBe(initialChanges);
    expect(result.current.branchSync).toBe(initialBranchSync);
  });

  it("soft-revalidates changes without loading and updates when signature changes", async () => {
    const nextFile = { ...changedFile, path: "b.ts", additions: 3 };
    vi.mocked(getProjectWorktreeChanges).mockResolvedValue({
      files: [changedFile],
      signature: "sig-1",
      branchSync: { upstream: "origin/main", ahead: 0, behind: 0 },
    });

    const { result } = renderHook(
      () => useCodeWorkspaceChanges(1, "/tmp/redwhisk", true),
      { wrapper },
    );
    await waitFor(() => expect(result.current.changes).toEqual([changedFile]));
    const initialChanges = result.current.changes;

    let resolveRefresh:
      | ((value: {
          files: (typeof changedFile)[];
          signature: string;
          branchSync: { upstream: string; ahead: number; behind: number };
        }) => void)
      | undefined;
    vi.mocked(getProjectWorktreeChanges).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    await act(async () => {
      result.current.refreshChanges();
    });
    expect(result.current.isChangesLoading).toBe(false);
    expect(result.current.changes).toBe(initialChanges);

    await act(async () => {
      resolveRefresh?.({
        files: [nextFile],
        signature: "sig-2",
        branchSync: { upstream: "origin/main", ahead: 1, behind: 0 },
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.changes).toEqual([nextFile]);
    });
    expect(result.current.branchSync).toEqual({
      upstream: "origin/main",
      ahead: 1,
      behind: 0,
    });
    expect(result.current.isChangesLoading).toBe(false);
  });

  it("shows loading and clears stale changes when workspace path switches", async () => {
    vi.mocked(getProjectWorktreeChanges).mockResolvedValue({
      files: [changedFile],
      signature: "sig-1",
    });

    const { result, rerender } = renderHook(
      ({ path }) => useCodeWorkspaceChanges(1, path, true),
      { initialProps: { path: "/tmp/redwhisk" }, wrapper },
    );
    await waitFor(() => expect(result.current.changes).toEqual([changedFile]));

    let resolveNext:
      | ((value: { files: (typeof changedFile)[]; signature: string }) => void)
      | undefined;
    vi.mocked(getProjectWorktreeChanges).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveNext = resolve;
        }),
    );

    rerender({ path: "/tmp/other" });

    await waitFor(() => {
      expect(result.current.changes).toEqual([]);
      expect(result.current.isChangesLoading).toBe(true);
    });

    await act(async () => {
      resolveNext?.({
        files: [],
        signature: "sig-other",
      });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.isChangesLoading).toBe(false);
    });
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

function makeCommit(hash: string, message = `msg ${hash}`) {
  return {
    hash,
    shortHash: hash.slice(0, 6),
    message,
    authorName: "Alice",
    committedAt: 1_780_638_000,
    files: [],
    isPushed: true,
    pushedTo: "origin/main",
    isCreatedInWorktree: false,
  };
}

describe("useCodeWorkspaceChanges commit history pagination", () => {
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

  it("loads more by offset of the loaded count and appends without duplicates", async () => {
    const page1 = Array.from({ length: 50 }, (_, index) =>
      makeCommit(`p1-${index}`),
    );
    const page2 = [makeCommit("p1-49"), makeCommit("p2-0"), makeCommit("p2-1")];
    vi.mocked(getProjectWorktreeCommitHistory)
      .mockResolvedValueOnce({
        commits: page1,
        signature: "sig-page-1",
        isWorktree: false,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        commits: page2,
        signature: "sig-page-2",
        isWorktree: false,
        hasMore: false,
      });

    const { result } = renderHook(
      () => useCodeWorkspaceChanges(1, "/tmp/redwhisk", true),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.commitHistory).toHaveLength(50);
    });
    expect(result.current.hasMoreCommitHistory).toBe(true);

    await act(async () => {
      result.current.loadMoreCommitHistory();
    });

    await waitFor(() => {
      expect(result.current.commitHistory).toHaveLength(52);
    });
    expect(getProjectWorktreeCommitHistory).toHaveBeenLastCalledWith({
      projectId: 1,
      workspacePath: "/tmp/redwhisk",
      limit: 50,
      offset: 50,
    });
    expect(result.current.hasMoreCommitHistory).toBe(false);
    expect(result.current.isLoadingMoreCommitHistory).toBe(false);
    expect(result.current.commitHistory.map((commit) => commit.hash)).toEqual([
      ...page1.map((commit) => commit.hash),
      "p2-0",
      "p2-1",
    ]);
  });

  it("refreshes the whole loaded window without clearing the list first", async () => {
    const page1 = Array.from({ length: 50 }, (_, index) =>
      makeCommit(`r1-${index}`),
    );
    const page2 = Array.from({ length: 50 }, (_, index) =>
      makeCommit(`r2-${index}`),
    );
    const refreshed = Array.from({ length: 100 }, (_, index) =>
      makeCommit(`rf-${index}`),
    );

    let resolveRefresh:
      | ((value: {
          commits: ReturnType<typeof makeCommit>[];
          signature: string;
          isWorktree: boolean;
          hasMore: boolean;
        }) => void)
      | undefined;

    vi.mocked(getProjectWorktreeCommitHistory)
      .mockResolvedValueOnce({
        commits: page1,
        signature: "sig-1",
        isWorktree: false,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        commits: page2,
        signature: "sig-2",
        isWorktree: false,
        hasMore: true,
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve;
          }),
      );

    const { result } = renderHook(
      () => useCodeWorkspaceChanges(1, "/tmp/redwhisk", true),
      { wrapper },
    );

    await waitFor(() => expect(result.current.commitHistory).toHaveLength(50));
    await act(async () => {
      result.current.loadMoreCommitHistory();
    });
    await waitFor(() => expect(result.current.commitHistory).toHaveLength(100));

    const listBeforeRefresh = result.current.commitHistory;
    await act(async () => {
      result.current.refreshCommitHistory();
    });

    // 刷新进行中不清空列表；已有展示数据时 soft revalidate 不进 loading。
    expect(result.current.commitHistory).toBe(listBeforeRefresh);
    expect(result.current.isCommitHistoryLoading).toBe(false);
    expect(getProjectWorktreeCommitHistory).toHaveBeenLastCalledWith({
      projectId: 1,
      workspacePath: "/tmp/redwhisk",
      limit: 100,
      offset: 0,
    });

    await act(async () => {
      resolveRefresh?.({
        commits: refreshed,
        signature: "sig-refresh",
        isWorktree: false,
        hasMore: true,
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.commitHistory).toEqual(refreshed);
    });
    expect(result.current.isCommitHistoryLoading).toBe(false);
  });

  it("discards a stale load-more when a refresh starts first", async () => {
    const page1 = Array.from({ length: 50 }, (_, index) =>
      makeCommit(`g1-${index}`),
    );
    let resolveLoadMore:
      | ((value: {
          commits: ReturnType<typeof makeCommit>[];
          signature: string;
          isWorktree: boolean;
          hasMore: boolean;
        }) => void)
      | undefined;
    let resolveRefresh:
      | ((value: {
          commits: ReturnType<typeof makeCommit>[];
          signature: string;
          isWorktree: boolean;
          hasMore: boolean;
        }) => void)
      | undefined;

    vi.mocked(getProjectWorktreeCommitHistory)
      .mockResolvedValueOnce({
        commits: page1,
        signature: "sig-1",
        isWorktree: false,
        hasMore: true,
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLoadMore = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve;
          }),
      );

    const { result } = renderHook(
      () => useCodeWorkspaceChanges(1, "/tmp/redwhisk", true),
      { wrapper },
    );
    await waitFor(() => expect(result.current.commitHistory).toHaveLength(50));

    await act(async () => {
      result.current.loadMoreCommitHistory();
    });
    await waitFor(() =>
      expect(result.current.isLoadingMoreCommitHistory).toBe(true),
    );

    await act(async () => {
      result.current.refreshCommitHistory();
    });

    // 刷新优先：作废 load-more loading 态。
    await waitFor(() =>
      expect(result.current.isLoadingMoreCommitHistory).toBe(false),
    );

    await act(async () => {
      resolveLoadMore?.({
        commits: [makeCommit("stale-page-2")],
        signature: "sig-stale",
        isWorktree: false,
        hasMore: false,
      });
      await Promise.resolve();
    });

    // 过期 load-more 不得污染列表。
    expect(result.current.commitHistory).toHaveLength(50);
    expect(
      result.current.commitHistory.some(
        (commit) => commit.hash === "stale-page-2",
      ),
    ).toBe(false);

    await act(async () => {
      resolveRefresh?.({
        commits: page1.map((commit) => ({
          ...commit,
          message: "refreshed",
        })),
        signature: "sig-refresh",
        isWorktree: false,
        hasMore: true,
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.commitHistory[0]?.message).toBe("refreshed");
    });
  });

  it("keeps loaded pages when load-more fails and surfaces an error", async () => {
    const page1 = Array.from({ length: 50 }, (_, index) =>
      makeCommit(`e1-${index}`),
    );
    vi.mocked(getProjectWorktreeCommitHistory)
      .mockResolvedValueOnce({
        commits: page1,
        signature: "sig-1",
        isWorktree: false,
        hasMore: true,
      })
      .mockRejectedValueOnce(new Error("network down"));

    const { result } = renderHook(
      () => useCodeWorkspaceChanges(1, "/tmp/redwhisk", true),
      { wrapper },
    );
    await waitFor(() => expect(result.current.commitHistory).toHaveLength(50));

    await act(async () => {
      result.current.loadMoreCommitHistory();
    });

    await waitFor(() => {
      expect(result.current.loadMoreCommitHistoryErrorMessage).not.toBeNull();
    });
    expect(result.current.commitHistory).toHaveLength(50);
    expect(result.current.isLoadingMoreCommitHistory).toBe(false);
    expect(result.current.hasMoreCommitHistory).toBe(true);
  });

  it("keeps the previous window when a refresh fails", async () => {
    const page1 = [makeCommit("keep-1")];
    vi.mocked(getProjectWorktreeCommitHistory)
      .mockResolvedValueOnce({
        commits: page1,
        signature: "sig-1",
        isWorktree: false,
        hasMore: false,
      })
      .mockRejectedValueOnce(new Error("refresh failed"));

    const { result } = renderHook(
      () => useCodeWorkspaceChanges(1, "/tmp/redwhisk", true),
      { wrapper },
    );
    await waitFor(() => expect(result.current.commitHistory).toEqual(page1));

    await act(async () => {
      result.current.refreshCommitHistory();
    });

    await waitFor(() => {
      expect(result.current.commitHistoryErrorMessage).not.toBeNull();
    });
    expect(result.current.commitHistory).toEqual(page1);
    expect(result.current.isCommitHistoryLoading).toBe(false);
  });

  it("soft-revalidates commit history: same signature keeps list and skips loading", async () => {
    const commits = [makeCommit("soft-1")];
    vi.mocked(getProjectWorktreeCommitHistory).mockResolvedValue({
      commits,
      signature: "sig-soft",
      isWorktree: false,
      hasMore: false,
    });

    const { result } = renderHook(
      () => useCodeWorkspaceChanges(1, "/tmp/redwhisk", true),
      { wrapper },
    );
    await waitFor(() => expect(result.current.commitHistory).toEqual(commits));
    const listBefore = result.current.commitHistory;

    let resolveRefresh:
      | ((value: {
          commits: ReturnType<typeof makeCommit>[];
          signature: string;
          isWorktree: boolean;
          hasMore: boolean;
        }) => void)
      | undefined;
    vi.mocked(getProjectWorktreeCommitHistory).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    await act(async () => {
      result.current.refreshCommitHistory();
    });
    expect(result.current.isCommitHistoryLoading).toBe(false);
    expect(result.current.commitHistory).toBe(listBefore);

    await act(async () => {
      resolveRefresh?.({
        commits: [makeCommit("soft-1-replaced")],
        signature: "sig-soft",
        isWorktree: true,
        hasMore: true,
      });
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(getProjectWorktreeCommitHistory).toHaveBeenCalledTimes(2),
    );

    expect(result.current.isCommitHistoryLoading).toBe(false);
    expect(result.current.commitHistory).toBe(listBefore);
    expect(result.current.isWorktree).toBe(false);
    expect(result.current.hasMoreCommitHistory).toBe(false);
  });

  it("soft-revalidates commit history: different signature updates without loading", async () => {
    const first = [makeCommit("soft-a")];
    const second = [makeCommit("soft-b")];
    vi.mocked(getProjectWorktreeCommitHistory).mockResolvedValue({
      commits: first,
      signature: "sig-a",
      isWorktree: false,
      hasMore: false,
    });

    const { result } = renderHook(
      () => useCodeWorkspaceChanges(1, "/tmp/redwhisk", true),
      { wrapper },
    );
    await waitFor(() => expect(result.current.commitHistory).toEqual(first));

    let resolveRefresh:
      | ((value: {
          commits: ReturnType<typeof makeCommit>[];
          signature: string;
          isWorktree: boolean;
          hasMore: boolean;
        }) => void)
      | undefined;
    vi.mocked(getProjectWorktreeCommitHistory).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    await act(async () => {
      result.current.refreshCommitHistory();
    });
    expect(result.current.isCommitHistoryLoading).toBe(false);

    await act(async () => {
      resolveRefresh?.({
        commits: second,
        signature: "sig-b",
        isWorktree: true,
        hasMore: true,
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.commitHistory).toEqual(second);
    });
    expect(result.current.isWorktree).toBe(true);
    expect(result.current.hasMoreCommitHistory).toBe(true);
    expect(result.current.isCommitHistoryLoading).toBe(false);
  });
});
