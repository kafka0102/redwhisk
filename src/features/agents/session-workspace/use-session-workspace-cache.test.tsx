import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../shared/i18n/i18n";
import {
  clearSessionWorkspaceCache,
  clearSessionWorkspaceCacheForTest,
  useSessionWorkspaceCache,
} from "./use-session-workspace-cache";
import {
  getProjectWorktreeChanges,
  getProjectWorktreeCommitHistory,
  readProjectWorktreeDiff,
  type WorkspaceChangedFile,
  type WorkspaceCommitChangedFile,
  type WorkspaceCommitRecord,
  type WorkspaceDiffContent,
} from "./session-workspace-commands";

vi.mock("../session-workspace/session-workspace-commands", () => ({
  CODE_WORKSPACE_ROOTS_UPDATED_EVENT: "code-workspace-roots-updated",
  COMMIT_HISTORY_PAGE_SIZE: 50,
  getProjectWorktreeChanges: vi.fn(),
  getProjectWorktreeCommitHistory: vi.fn(),
  getProjectWorktreeFileTree: vi.fn(),
  listCodeWorkspaceRoots: vi.fn().mockResolvedValue({ roots: [] }),
  readProjectWorktreeDiff: vi.fn(),
  readProjectWorktreeFile: vi.fn(),
}));

const getProjectWorktreeChangesMock = vi.mocked(getProjectWorktreeChanges);
const getProjectWorktreeCommitHistoryMock = vi.mocked(
  getProjectWorktreeCommitHistory,
);
const readProjectWorktreeDiffMock = vi.mocked(readProjectWorktreeDiff);

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider initialLocale="en">{children}</I18nProvider>;
}

afterEach(() => {
  clearSessionWorkspaceCacheForTest();
});

// flush async refresh* 微任务链（fake timers 下需显式 await），并在 act 内提交 React
// 状态更新，使 result.current 与 effect 调用次数反映最新值。
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useSessionWorkspaceCache committed history polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getProjectWorktreeChangesMock.mockReset();
    getProjectWorktreeChangesMock.mockResolvedValue({
      signature: "changes-empty",
      files: [],
    });
    getProjectWorktreeCommitHistoryMock.mockReset();
    getProjectWorktreeCommitHistoryMock.mockResolvedValue({
      signature: "commits-empty",
      commits: [],
      isWorktree: false,
      hasMore: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not poll committed history when the committed panel is collapsed on mount", async () => {
    renderHook(
      () =>
        useSessionWorkspaceCache({
          projectId: 1,
          sessionId: 1,
          isSidePanelOpen: true,
        }),
      { wrapper },
    );
    await vi.advanceTimersByTimeAsync(10_000);

    // 默认 committedChangesExpanded=false，即便侧栏开 + changes tab 也不应拉取。
    expect(getProjectWorktreeCommitHistoryMock).not.toHaveBeenCalled();
  });

  it("polls committed history immediately and every 5s when expanded on the changes tab with the side panel open", async () => {
    const { result } = renderHook(
      () =>
        useSessionWorkspaceCache({
          projectId: 1,
          sessionId: 1,
          isSidePanelOpen: true,
        }),
      { wrapper },
    );
    await settle();

    act(() => {
      result.current.toggleCommittedChangesExpanded();
    });
    // 展开后进入即补拉一次。
    await settle();
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(1);
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 1,
      limit: 50,
      offset: 0,
    });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(3);
  });

  it("stops polling committed history after the committed panel is collapsed", async () => {
    const { result } = renderHook(
      () =>
        useSessionWorkspaceCache({
          projectId: 1,
          sessionId: 1,
          isSidePanelOpen: true,
        }),
      { wrapper },
    );
    await settle();

    act(() => {
      result.current.toggleCommittedChangesExpanded();
    });
    await settle();
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(1);

    // 收起已提交面板，interval 应被清理。
    act(() => {
      result.current.toggleCommittedChangesExpanded();
    });
    await vi.advanceTimersByTimeAsync(15_000);

    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(1);
  });

  it("stops polling committed history after switching away from the changes tab", async () => {
    const { result } = renderHook(
      () =>
        useSessionWorkspaceCache({
          projectId: 1,
          sessionId: 1,
          isSidePanelOpen: true,
        }),
      { wrapper },
    );
    await settle();

    act(() => {
      result.current.toggleCommittedChangesExpanded();
    });
    await settle();
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(1);

    // 切到 files tab：committed 轮询门控失活。
    act(() => {
      result.current.setSidePanelTab("files");
    });
    await vi.advanceTimersByTimeAsync(15_000);

    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(1);
  });

  it("stops polling committed history after the side panel is closed", async () => {
    const { result, rerender } = renderHook(
      ({ isSidePanelOpen }: { isSidePanelOpen: boolean }) =>
        useSessionWorkspaceCache({
          projectId: 1,
          sessionId: 1,
          isSidePanelOpen,
        }),
      { initialProps: { isSidePanelOpen: true }, wrapper },
    );
    await settle();

    act(() => {
      result.current.toggleCommittedChangesExpanded();
    });
    await settle();
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(1);

    // 关闭侧栏：committed 轮询门控失活。
    rerender({ isSidePanelOpen: false });
    await vi.advanceTimersByTimeAsync(15_000);

    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(1);
  });

  it("does not poll committed history when the workspace root is inaccessible", async () => {
    // changes 轮询命中不可恢复错误会把 isChangesUnavailable 置 true，committed 轮询门控
    // 同样失活（与 changes 轮询语义一致）。
    getProjectWorktreeChangesMock.mockRejectedValue({
      code: "AGENT_SESSION_VALIDATION_FAILED",
      message: "workspace root inaccessible",
      details: [{ "@type": "WorkspaceRoot" }],
    });
    const { result } = renderHook(
      () =>
        useSessionWorkspaceCache({
          projectId: 1,
          sessionId: 1,
          isSidePanelOpen: true,
        }),
      { wrapper },
    );
    // 等待 changes 轮询的拒绝被处理、isChangesUnavailable 标记为 true。
    await settle();
    await settle();
    expect(getProjectWorktreeChangesMock).toHaveBeenCalled();

    act(() => {
      result.current.toggleCommittedChangesExpanded();
    });
    await vi.advanceTimersByTimeAsync(15_000);

    // 仓库不可访问时 committed 轮询不应启动。
    expect(getProjectWorktreeCommitHistoryMock).not.toHaveBeenCalled();
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

describe("useSessionWorkspaceCache commit history pagination", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getProjectWorktreeChangesMock.mockReset();
    getProjectWorktreeChangesMock.mockResolvedValue({
      signature: "changes-empty",
      files: [],
    });
    getProjectWorktreeCommitHistoryMock.mockReset();
    getProjectWorktreeCommitHistoryMock.mockResolvedValue({
      signature: "commits-empty",
      commits: [],
      isWorktree: false,
      hasMore: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads more from the loaded offset and refreshes the whole window", async () => {
    const page1 = Array.from({ length: 50 }, (_, index) =>
      makeCommit(`s1-${index}`),
    );
    const page2 = Array.from({ length: 50 }, (_, index) =>
      makeCommit(`s2-${index}`),
    );
    const refreshed = Array.from({ length: 100 }, (_, index) =>
      makeCommit(`sr-${index}`),
    );

    getProjectWorktreeCommitHistoryMock
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
      .mockResolvedValueOnce({
        commits: refreshed,
        signature: "sig-r",
        isWorktree: false,
        hasMore: true,
      });

    const { result } = renderHook(
      () =>
        useSessionWorkspaceCache({
          projectId: 1,
          sessionId: 1,
          isSidePanelOpen: true,
        }),
      { wrapper },
    );
    await settle();

    act(() => {
      result.current.toggleCommittedChangesExpanded();
    });
    await settle();
    expect(result.current.commitHistory).toHaveLength(50);
    expect(result.current.hasMoreCommitHistory).toBe(true);

    await act(async () => {
      await result.current.loadMoreCommitHistory();
    });
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenLastCalledWith({
      projectId: 1,
      sessionId: 1,
      limit: 50,
      offset: 50,
    });
    expect(result.current.commitHistory).toHaveLength(100);

    await act(async () => {
      await result.current.refreshCommitHistory();
    });
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenLastCalledWith({
      projectId: 1,
      sessionId: 1,
      limit: 100,
      offset: 0,
    });
    expect(result.current.commitHistory).toEqual(refreshed);
  });

  it("keeps loaded pages when load-more fails", async () => {
    const page1 = Array.from({ length: 50 }, (_, index) =>
      makeCommit(`se-${index}`),
    );
    getProjectWorktreeCommitHistoryMock
      .mockResolvedValueOnce({
        commits: page1,
        signature: "sig-1",
        isWorktree: false,
        hasMore: true,
      })
      .mockRejectedValueOnce(new Error("page failed"));

    const { result } = renderHook(
      () =>
        useSessionWorkspaceCache({
          projectId: 1,
          sessionId: 1,
          isSidePanelOpen: true,
        }),
      { wrapper },
    );
    await settle();
    act(() => {
      result.current.toggleCommittedChangesExpanded();
    });
    await settle();

    await act(async () => {
      await result.current.loadMoreCommitHistory();
    });

    expect(result.current.commitHistory).toHaveLength(50);
    expect(result.current.loadMoreCommitHistoryErrorMessage).not.toBeNull();
    expect(result.current.isLoadingMoreCommitHistory).toBe(false);
  });
});

function makeChangedFile(
  filePath: string,
  kind:
    | "added"
    | "modified"
    | "deleted"
    | "renamed"
    | "copied"
    | "untracked"
    | "binary",
) {
  return {
    filePath,
    oldPath: null,
    fileName: filePath.split("/").pop() ?? filePath,
    kind,
    status: kind === "untracked" ? "??" : " M",
    additions: 1,
    deletions: 0,
    isBinary: false,
    contentHash: `${filePath}:${kind}`,
    metadataSignature: `${filePath}:${kind}:meta`,
  };
}

describe("useSessionWorkspaceCache uncommitted changes for files decorations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getProjectWorktreeChangesMock.mockReset();
    getProjectWorktreeChangesMock.mockResolvedValue({
      signature: "changes-empty",
      files: [],
    });
    getProjectWorktreeCommitHistoryMock.mockReset();
    getProjectWorktreeCommitHistoryMock.mockResolvedValue({
      signature: "commits-empty",
      commits: [],
      isWorktree: false,
      hasMore: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads and polls worktree changes while the files tab is active", async () => {
    const { result, rerender } = renderHook(
      ({ isSidePanelOpen }: { isSidePanelOpen: boolean }) =>
        useSessionWorkspaceCache({
          projectId: 1,
          sessionId: 1,
          isSidePanelOpen,
        }),
      { wrapper, initialProps: { isSidePanelOpen: false } },
    );

    act(() => {
      result.current.setSidePanelTab("files");
    });
    await settle();
    expect(getProjectWorktreeChangesMock).not.toHaveBeenCalled();

    rerender({ isSidePanelOpen: true });
    await settle();
    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(1);
    expect(getProjectWorktreeChangesMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 1,
    });

    await vi.advanceTimersByTimeAsync(2_000);
    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(3);
  });

  it("still loads worktree changes while the changes tab is active", async () => {
    renderHook(
      () =>
        useSessionWorkspaceCache({
          projectId: 1,
          sessionId: 1,
          isSidePanelOpen: true,
        }),
      { wrapper },
    );
    await settle();

    // 默认 sidePanelTab 为 changes。
    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(2);
  });

  it("builds file and directory decoration maps from session changes", async () => {
    getProjectWorktreeChangesMock.mockResolvedValue({
      signature: "decorations",
      files: [
        makeChangedFile("src/features/a.ts", "modified"),
        makeChangedFile("src/features/b.ts", "deleted"),
      ],
    });

    const { result, rerender } = renderHook(
      ({ isSidePanelOpen }: { isSidePanelOpen: boolean }) =>
        useSessionWorkspaceCache({
          projectId: 1,
          sessionId: 1,
          isSidePanelOpen,
        }),
      { wrapper, initialProps: { isSidePanelOpen: false } },
    );

    act(() => {
      result.current.setSidePanelTab("files");
    });
    rerender({ isSidePanelOpen: true });
    await settle();

    expect(result.current.changedFileKinds.get("src/features/a.ts")).toBe(
      "modified",
    );
    expect(result.current.changedFileKinds.get("src/features/b.ts")).toBe(
      "deleted",
    );
    expect(result.current.directoryKinds.get("src")).toBe("deleted");
    expect(result.current.directoryKinds.get("src/features")).toBe("deleted");
  });

  it("stops polling changes after leaving files and changes tabs", async () => {
    const { result } = renderHook(
      () =>
        useSessionWorkspaceCache({
          projectId: 1,
          sessionId: 1,
          isSidePanelOpen: true,
        }),
      { wrapper },
    );
    await settle();
    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.setSidePanelTab("files");
    });
    // files 仍属 changes 轮询门控，切换不应停轮询；isActive 保持 true 时不强制补拉。
    await vi.advanceTimersByTimeAsync(2_000);
    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(2);

    act(() => {
      result.current.setSidePanelTab("issue");
    });
    const callsAfterLeave = getProjectWorktreeChangesMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(6_000);
    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(
      callsAfterLeave,
    );
  });
});

describe("useSessionWorkspaceCache multi-diff change tab", () => {
  beforeEach(() => {
    getProjectWorktreeChangesMock.mockReset();
    getProjectWorktreeChangesMock.mockResolvedValue({
      signature: "changes-empty",
      files: [],
    });
    getProjectWorktreeCommitHistoryMock.mockReset();
    getProjectWorktreeCommitHistoryMock.mockResolvedValue({
      signature: "commits-empty",
      commits: [],
      isWorktree: false,
      hasMore: false,
    });
    readProjectWorktreeDiffMock.mockReset();
  });

  it("openCommitChanges opens multi tab labeled short hash plus subject", async () => {
    const fileA: WorkspaceCommitChangedFile = {
      filePath: "src/a.ts",
      oldPath: null,
      fileName: "a.ts",
      kind: "modified",
      status: "M",
    };
    const fileB: WorkspaceCommitChangedFile = {
      filePath: "src/b.ts",
      oldPath: null,
      fileName: "b.ts",
      kind: "added",
      status: "A",
    };
    const commit: WorkspaceCommitRecord = {
      hash: "fullhash123456",
      shortHash: "fullhash",
      message: "feat: multi tab",
      authorName: "dev",
      committedAt: 1,
      files: [fileA, fileB],
      isPushed: false,
      isCreatedInWorktree: false,
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
    readProjectWorktreeDiffMock.mockImplementation(async ({ filePath }) => ({
      ...diffContent,
      filePath,
    }));

    const { result } = renderHook(
      () =>
        useSessionWorkspaceCache({
          projectId: 1,
          sessionId: 1,
          isSidePanelOpen: true,
        }),
      { wrapper },
    );

    await act(async () => {
      result.current.openCommitChanges(commit);
    });

    expect(result.current.changeTab).toMatchObject({
      mode: "multi",
      label: "fullhash feat: multi tab",
      commitHash: "fullhash123456",
    });
    expect(result.current.activeWorkspaceTab).toBe("changes");
    expect(result.current.changeTab?.mode).toBe("multi");
    if (result.current.changeTab?.mode === "multi") {
      expect(result.current.changeTab.multiDiff.files).toHaveLength(2);
    }

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    if (result.current.changeTab?.mode === "multi") {
      expect(
        result.current.changeTab.multiDiff.files.every((f) => !f.isLoading),
      ).toBe(true);
      expect(result.current.changeTab.multiDiff.files[0]?.diff).not.toBeNull();
    }
    expect(readProjectWorktreeDiffMock).toHaveBeenCalledTimes(2);
  });

  it("openCommitChanges and single-file change tab are mutually exclusive", async () => {
    const changed: WorkspaceChangedFile = {
      filePath: "src/a.ts",
      oldPath: null,
      fileName: "a.ts",
      kind: "modified",
      status: "M",
      additions: 1,
      deletions: 0,
      isBinary: false,
      contentHash: "h",
      metadataSignature: "s",
    };
    const commit: WorkspaceCommitRecord = {
      hash: "abc123",
      shortHash: "abc123",
      message: "chore: exclusivity",
      authorName: "dev",
      committedAt: 1,
      files: [
        {
          filePath: "src/b.ts",
          oldPath: null,
          fileName: "b.ts",
          kind: "modified",
          status: "M",
        },
      ],
      isPushed: false,
      isCreatedInWorktree: false,
    };
    readProjectWorktreeDiffMock.mockResolvedValue({
      filePath: "src/a.ts",
      oldPath: null,
      kind: "modified",
      language: "typescript",
      originalContent: "o",
      modifiedContent: "n",
      isBinary: false,
      isTooLarge: false,
    });

    const { result } = renderHook(
      () =>
        useSessionWorkspaceCache({
          projectId: 1,
          sessionId: 1,
          isSidePanelOpen: true,
        }),
      { wrapper },
    );

    await act(async () => {
      await result.current.openChange(changed);
    });
    expect(result.current.changeTab?.mode).toBe("file");

    await act(async () => {
      result.current.openCommitChanges(commit);
    });
    expect(result.current.changeTab?.mode).toBe("multi");
    expect(result.current.changeTab).toMatchObject({
      label: "abc123 chore: exclusivity",
    });

    await act(async () => {
      await result.current.openCommittedChange("abc123", {
        filePath: "src/b.ts",
        oldPath: null,
        fileName: "b.ts",
        kind: "modified",
        status: "M",
      });
    });
    expect(result.current.changeTab?.mode).toBe("file");
    if (result.current.changeTab?.mode === "file") {
      expect(result.current.changeTab.fileName).toBe("b.ts");
    }
  });

  it("closing changes tab clears multi-diff residual", async () => {
    const commit: WorkspaceCommitRecord = {
      hash: "zzz",
      shortHash: "zzz",
      message: "clear me",
      authorName: "dev",
      committedAt: 1,
      files: [],
      isPushed: false,
      isCreatedInWorktree: false,
    };
    const { result } = renderHook(
      () =>
        useSessionWorkspaceCache({
          projectId: 1,
          sessionId: 1,
          isSidePanelOpen: true,
        }),
      { wrapper },
    );

    await act(async () => {
      result.current.openCommitChanges(commit);
    });
    expect(result.current.changeTab?.mode).toBe("multi");

    await act(async () => {
      result.current.closeWorkspaceTab("changes");
    });
    expect(result.current.changeTab).toBeNull();
    expect(result.current.activeWorkspaceTab).toBe("session");
  });
});

describe("useSessionWorkspaceCache remount persistence", () => {
  beforeEach(() => {
    getProjectWorktreeChangesMock.mockReset();
    getProjectWorktreeChangesMock.mockResolvedValue({
      signature: "changes-empty",
      files: [],
    });
    getProjectWorktreeCommitHistoryMock.mockReset();
    getProjectWorktreeCommitHistoryMock.mockResolvedValue({
      signature: "commits-empty",
      commits: [],
      isWorktree: false,
      hasMore: false,
    });
    readProjectWorktreeDiffMock.mockReset();
    readProjectWorktreeDiffMock.mockResolvedValue({
      filePath: "src/a.ts",
      oldPath: null,
      kind: "modified",
      language: "typescript",
      originalContent: "old",
      modifiedContent: "new",
      isBinary: false,
      isTooLarge: false,
    });
  });

  it("restores the opened change tab after the hook remounts", async () => {
    const changed: WorkspaceChangedFile = {
      filePath: "src/a.ts",
      oldPath: null,
      fileName: "a.ts",
      kind: "modified",
      status: "M",
      additions: 1,
      deletions: 0,
      isBinary: false,
      contentHash: "h",
      metadataSignature: "s",
    };

    const { result, unmount } = renderHook(
      () =>
        useSessionWorkspaceCache({
          projectId: 1,
          sessionId: 1,
          isSidePanelOpen: true,
        }),
      { wrapper },
    );

    await act(async () => {
      await result.current.openChange(changed);
    });
    expect(result.current.activeWorkspaceTab).toBe("changes");
    expect(result.current.changeTab).toMatchObject({
      mode: "file",
      fileName: "a.ts",
    });

    unmount();

    const remounted = renderHook(
      () =>
        useSessionWorkspaceCache({
          projectId: 1,
          sessionId: 1,
          isSidePanelOpen: true,
        }),
      { wrapper },
    );

    expect(remounted.result.current.activeWorkspaceTab).toBe("changes");
    expect(remounted.result.current.changeTab).toMatchObject({
      mode: "file",
      fileName: "a.ts",
    });
  });

  it("does not restore a change tab after the session cache is cleared", async () => {
    const changed: WorkspaceChangedFile = {
      filePath: "src/a.ts",
      oldPath: null,
      fileName: "a.ts",
      kind: "modified",
      status: "M",
      additions: 1,
      deletions: 0,
      isBinary: false,
      contentHash: "h",
      metadataSignature: "s",
    };

    const { result, unmount } = renderHook(
      () =>
        useSessionWorkspaceCache({
          projectId: 1,
          sessionId: 1,
          isSidePanelOpen: true,
        }),
      { wrapper },
    );

    await act(async () => {
      await result.current.openChange(changed);
    });
    expect(result.current.changeTab).toMatchObject({ fileName: "a.ts" });

    unmount();
    clearSessionWorkspaceCache(1);

    const remounted = renderHook(
      () =>
        useSessionWorkspaceCache({
          projectId: 1,
          sessionId: 1,
          isSidePanelOpen: true,
        }),
      { wrapper },
    );

    expect(remounted.result.current.activeWorkspaceTab).toBe("session");
    expect(remounted.result.current.changeTab).toBeNull();
  });
});
