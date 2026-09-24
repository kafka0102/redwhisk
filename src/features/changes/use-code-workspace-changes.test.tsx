import { act, render, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import {
  getProjectWorktreeChanges,
  getProjectWorktreeCommitHistory,
} from "../../shared/workspace/workspace-commands";
import { resetChangesWorkspaceCacheForTests } from "./changes-workspace-cache";
import { useChangesAutoRefresh } from "./use-changes-auto-refresh";
import { useCodeWorkspaceChanges } from "./use-code-workspace-changes";

vi.mock("../../shared/workspace/workspace-commands", () => ({
  COMMIT_HISTORY_PAGE_SIZE: 50,
  getProjectWorktreeChanges: vi.fn(),
  getProjectWorktreeCommitHistory: vi.fn(),
  fetchProjectRemotes: vi.fn(),
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
    resetChangesWorkspaceCacheForTests();
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
    resetChangesWorkspaceCacheForTests();
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

  it("does not preempt an in-flight load-more with a background refresh", async () => {
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

    // 同一资源单一在途请求：后台刷新被跳过，不抢占在途的 load-more。
    expect(getProjectWorktreeCommitHistory).toHaveBeenCalledTimes(2);
    expect(result.current.isLoadingMoreCommitHistory).toBe(true);
    expect(result.current.isCommitHistoryLoading).toBe(false);

    await act(async () => {
      resolveLoadMore?.({
        commits: [makeCommit("page-2-0")],
        signature: "sig-stale",
        isWorktree: false,
        hasMore: false,
      });
      await Promise.resolve();
    });

    // load-more 正常落地：追加页、收口 load-more 加载态。
    await waitFor(() => expect(result.current.commitHistory).toHaveLength(51));
    expect(result.current.isLoadingMoreCommitHistory).toBe(false);
    expect(
      result.current.commitHistory.some((commit) => commit.hash === "page-2-0"),
    ).toBe(true);

    // 结算后同资源可再次发起：整窗刷新按当前整窗条数取数。
    await act(async () => {
      result.current.refreshCommitHistory();
    });
    await waitFor(() => {
      expect(getProjectWorktreeCommitHistory).toHaveBeenLastCalledWith({
        projectId: 1,
        workspacePath: "/tmp/redwhisk",
        limit: 51,
        offset: 0,
      });
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

describe("useCodeWorkspaceChanges remount snapshot reuse", () => {
  beforeEach(() => {
    resetChangesWorkspaceCacheForTests();
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

  it("restores cached changes on remount and soft-revalidates in the background", async () => {
    const branchSync = { upstream: "origin/main", ahead: 1, behind: 0 };
    vi.mocked(getProjectWorktreeChanges).mockResolvedValue({
      files: [changedFile],
      signature: "sig-1",
      branchSync,
    });

    const first = renderHook(
      () => useCodeWorkspaceChanges(1, "/tmp/redwhisk", true),
      { wrapper },
    );
    await waitFor(() =>
      expect(first.result.current.changes).toEqual([changedFile]),
    );
    first.unmount();

    let resolveReload:
      | ((value: {
          files: (typeof changedFile)[];
          signature: string;
          branchSync: typeof branchSync;
        }) => void)
      | undefined;
    vi.mocked(getProjectWorktreeChanges).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReload = resolve;
        }),
    );

    const second = renderHook(
      () => useCodeWorkspaceChanges(1, "/tmp/redwhisk", true),
      { wrapper },
    );

    // 首帧即旧数据，重拉在后台进行（不进 loading）。
    expect(second.result.current.changes).toEqual([changedFile]);
    expect(second.result.current.branchSync).toEqual(branchSync);
    expect(second.result.current.isChangesLoading).toBe(false);

    await act(async () => {
      resolveReload?.({ files: [changedFile], signature: "sig-1", branchSync });
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(getProjectWorktreeChanges).toHaveBeenCalledTimes(2),
    );
    expect(second.result.current.isChangesLoading).toBe(false);
    expect(second.result.current.changes).toEqual([changedFile]);
  });

  it("restores the loaded commit window on remount and refreshes that window", async () => {
    const page1 = Array.from({ length: 50 }, (_, index) =>
      makeCommit(`w1-${index}`),
    );
    vi.mocked(getProjectWorktreeCommitHistory)
      .mockResolvedValueOnce({
        commits: page1,
        signature: "sig-page-1",
        isWorktree: false,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        commits: [makeCommit("w2-0")],
        signature: "sig-page-2",
        isWorktree: false,
        hasMore: false,
      });

    const first = renderHook(
      () => useCodeWorkspaceChanges(1, "/tmp/redwhisk", true),
      { wrapper },
    );
    await waitFor(() =>
      expect(first.result.current.commitHistory).toHaveLength(50),
    );
    await act(async () => {
      first.result.current.loadMoreCommitHistory();
    });
    await waitFor(() =>
      expect(first.result.current.commitHistory).toHaveLength(51),
    );
    first.unmount();

    vi.mocked(getProjectWorktreeCommitHistory).mockResolvedValue({
      commits: page1,
      signature: "sig-refresh",
      isWorktree: false,
      hasMore: true,
    });

    const second = renderHook(
      () => useCodeWorkspaceChanges(1, "/tmp/redwhisk", true),
      { wrapper },
    );

    // 快照含 load-more 追加的整窗；恢复期间不进 loading。
    expect(second.result.current.commitHistory).toHaveLength(51);
    expect(second.result.current.hasMoreCommitHistory).toBe(false);
    expect(second.result.current.isCommitHistoryLoading).toBe(false);

    await waitFor(() =>
      expect(getProjectWorktreeCommitHistory).toHaveBeenLastCalledWith({
        projectId: 1,
        workspacePath: "/tmp/redwhisk",
        limit: 51,
        offset: 0,
      }),
    );
    expect(second.result.current.isCommitHistoryLoading).toBe(false);
  });

  it("renders cached changes on the first frame after remount", async () => {
    vi.mocked(getProjectWorktreeChanges).mockResolvedValue({
      files: [changedFile],
      signature: "sig-1",
    });

    const first = renderHook(
      () => useCodeWorkspaceChanges(1, "/tmp/redwhisk", true),
      { wrapper },
    );
    await waitFor(() =>
      expect(first.result.current.changes).toEqual([changedFile]),
    );
    first.unmount();

    const renderedChangeCounts: number[] = [];
    function Probe() {
      const { changes } = useCodeWorkspaceChanges(1, "/tmp/redwhisk", true);
      renderedChangeCounts.push(changes.length);
      return null;
    }
    render(<Probe />, { wrapper });

    // 首帧（还未等任何请求回来）就必须是缓存数据，否则切回时会闪一下空态。
    expect(renderedChangeCounts[0]).toBe(1);
  });

  it("clears stale changes and shows loading when switching to a never-visited workspace", async () => {
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

    rerender({ path: "/tmp/never-visited" });

    await waitFor(() => {
      expect(result.current.changes).toEqual([]);
      expect(result.current.isChangesLoading).toBe(true);
    });

    await act(async () => {
      resolveNext?.({ files: [], signature: "sig-never" });
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.isChangesLoading).toBe(false));
  });
});

/** 单次取数往返 10s，远大于 4s 的 running 轮询间隔。 */
const SLOW_ROUND_TRIP_MS = 10_000;
const RUNNING_POLL_INTERVAL_MS = 4_000;

// 变更 Activity 的真实接线：数据 hook + 4s/8s 轮询 hook。
function useSlowRefreshHarness(workspacePath: string) {
  const state = useCodeWorkspaceChanges(1, workspacePath, true);
  useChangesAutoRefresh({
    enabled: true,
    running: true,
    refreshChanges: state.refreshChanges,
    refreshCommitHistory: state.refreshCommitHistory,
    isUnavailable: false,
    projectId: 1,
    workspacePath,
    isProjectRoot: false,
  });
  return state;
}

describe("useCodeWorkspaceChanges refresh resilience", () => {
  beforeEach(() => {
    resetChangesWorkspaceCacheForTests();
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

  afterEach(() => {
    vi.useRealTimers();
  });

  it("converges without stacking requests when the round trip outlasts the poll interval", async () => {
    vi.useFakeTimers();
    const commits = [makeCommit("slow-1")];
    // 每次请求都在 10s 后才返回：轮询间隔内响应永远不可能落地。
    vi.mocked(getProjectWorktreeChanges).mockImplementation(
      () =>
        new Promise((resolve) => {
          window.setTimeout(
            () => resolve({ files: [changedFile], signature: "sig-changes" }),
            SLOW_ROUND_TRIP_MS,
          );
        }),
    );
    vi.mocked(getProjectWorktreeCommitHistory).mockImplementation(
      () =>
        new Promise((resolve) => {
          window.setTimeout(
            () =>
              resolve({
                commits,
                signature: "sig-commits",
                isWorktree: false,
                hasMore: false,
              }),
            SLOW_ROUND_TRIP_MS,
          );
        }),
    );

    const { result } = renderHook(
      () => useSlowRefreshHarness("/tmp/redwhisk"),
      { wrapper },
    );

    // 无展示数据的首拉进加载态。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.isChangesLoading).toBe(true);
    expect(result.current.isCommitHistoryLoading).toBe(true);

    // 首个响应落地前经过两个轮询 tick：在途请求直接跳过，不发起、不作废。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RUNNING_POLL_INTERVAL_MS * 2);
    });
    expect(getProjectWorktreeChanges).toHaveBeenCalledTimes(1);
    expect(getProjectWorktreeCommitHistory).toHaveBeenCalledTimes(1);
    expect(result.current.isCommitHistoryLoading).toBe(true);

    // 10s 后首个响应落地：加载态收口，列表展示。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SLOW_ROUND_TRIP_MS);
    });
    expect(result.current.isChangesLoading).toBe(false);
    expect(result.current.isCommitHistoryLoading).toBe(false);
    expect(result.current.changes).toEqual([changedFile]);
    expect(result.current.commitHistory).toEqual(commits);

    // 已有数据后的后台轮询刷新不进加载态（哪怕这次响应比轮询更慢）。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RUNNING_POLL_INTERVAL_MS);
    });
    expect(result.current.isChangesLoading).toBe(false);
    expect(result.current.isCommitHistoryLoading).toBe(false);
    expect(result.current.commitHistory).toEqual(commits);

    // 继续跑到 30s 以上：随 tick 线性堆叠会到 8 次以上，收敛后最多 4 次。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(
      vi.mocked(getProjectWorktreeCommitHistory).mock.calls.length,
    ).toBeLessThanOrEqual(4);
    expect(
      vi.mocked(getProjectWorktreeChanges).mock.calls.length,
    ).toBeLessThanOrEqual(4);
    expect(result.current.isCommitHistoryLoading).toBe(false);
    expect(result.current.commitHistory).toEqual(commits);
  });

  it("shows commit-history loading for the first pull and closes it when the response lands", async () => {
    const commits = [makeCommit("first-1")];
    let resolveHistory:
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
          resolveHistory = resolve;
        }),
    );

    const { result } = renderHook(
      () => useCodeWorkspaceChanges(1, "/tmp/redwhisk", true),
      { wrapper },
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.isCommitHistoryLoading).toBe(true);
    expect(result.current.commitHistory).toEqual([]);

    await act(async () => {
      resolveHistory?.({
        commits,
        signature: "sig-first",
        isWorktree: false,
        hasMore: false,
      });
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.commitHistory).toEqual(commits));
    expect(result.current.isCommitHistoryLoading).toBe(false);
  });

  it("switches workspace root with loading and ignores the old root's late commit history", async () => {
    let resolveOldRoot:
      | ((value: {
          commits: ReturnType<typeof makeCommit>[];
          signature: string;
          isWorktree: boolean;
          hasMore: boolean;
        }) => void)
      | undefined;
    let resolveNewRoot: typeof resolveOldRoot;
    vi.mocked(getProjectWorktreeCommitHistory)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOldRoot = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNewRoot = resolve;
          }),
      );

    const { result, rerender } = renderHook(
      ({ path }) => useCodeWorkspaceChanges(1, path, true),
      { initialProps: { path: "/tmp/redwhisk" }, wrapper },
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.isCommitHistoryLoading).toBe(true);

    rerender({ path: "/tmp/other" });
    await act(async () => {
      await Promise.resolve();
    });
    // 新根仍无展示数据 → 继续进加载态。
    expect(result.current.commitHistory).toEqual([]);
    expect(result.current.isCommitHistoryLoading).toBe(true);

    // 旧根的迟到响应不得写入新根，也不得提前收口新根的加载态。
    await act(async () => {
      resolveOldRoot?.({
        commits: [makeCommit("old-root")],
        signature: "sig-old",
        isWorktree: false,
        hasMore: false,
      });
      await Promise.resolve();
    });
    expect(result.current.commitHistory).toEqual([]);
    expect(result.current.isCommitHistoryLoading).toBe(true);

    await act(async () => {
      resolveNewRoot?.({
        commits: [makeCommit("new-root")],
        signature: "sig-new",
        isWorktree: false,
        hasMore: false,
      });
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(result.current.commitHistory.map((commit) => commit.hash)).toEqual(
        ["new-root"],
      ),
    );
    expect(result.current.isCommitHistoryLoading).toBe(false);
  });
});
