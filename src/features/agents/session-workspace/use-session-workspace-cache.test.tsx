import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../shared/i18n/i18n";
import {
  clearSessionWorkspaceCache,
  clearSessionWorkspaceCacheForTest,
  useSessionWorkspaceCache,
} from "./use-session-workspace-cache";
import type { AgentSessionListChangedEvent } from "../agent-session-events";
import {
  getProjectWorktreeChanges,
  getProjectWorktreeCommitHistory,
  readProjectWorktreeDiff,
  type WorkspaceChangedFile,
  type WorkspaceCommitChangedFile,
  type WorkspaceCommitRecord,
  type WorkspaceDiffContent,
} from "./session-workspace-commands";

const eventMocks = vi.hoisted(() => ({
  listeners: [] as Array<{
    eventName: string;
    callback: (event: { payload: AgentSessionListChangedEvent }) => void;
  }>,
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    (
      eventName: string,
      callback: (event: { payload: AgentSessionListChangedEvent }) => void,
    ) => {
      eventMocks.listeners.push({ eventName, callback });
      return Promise.resolve(eventMocks.unlisten);
    },
  ),
}));

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

  it("polls committed history immediately and every 5s by default when the side panel opens on the changes tab", async () => {
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

    // 默认 committedChangesExpanded=true：侧栏开 + changes tab 时进入即补拉一次。
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

  it("resumes committed history polling when the panel is expanded again after being collapsed", async () => {
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
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.toggleCommittedChangesExpanded();
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.toggleCommittedChangesExpanded();
    });
    // 重新展开后进入即补拉一次。
    await settle();
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
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(1);

    // 切到 files tab：committed 轮询门控失活。
    act(() => {
      result.current.setSidePanelTab("files");
    });
    await vi.advanceTimersByTimeAsync(15_000);

    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(1);
  });

  it("stops polling committed history after the side panel is closed", async () => {
    const { rerender } = renderHook(
      ({ isSidePanelOpen }: { isSidePanelOpen: boolean }) =>
        useSessionWorkspaceCache({
          projectId: 1,
          sessionId: 1,
          isSidePanelOpen,
        }),
      { initialProps: { isSidePanelOpen: true }, wrapper },
    );
    await settle();
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(1);

    // 关闭侧栏：committed 轮询门控失活。
    rerender({ isSidePanelOpen: false });
    await vi.advanceTimersByTimeAsync(15_000);

    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(1);
  });

  it("stops committed history polling once the workspace root is found inaccessible", async () => {
    // changes 轮询命中不可恢复错误会把 isChangesUnavailable 置 true，committed 轮询门控
    // 同样失活（与 changes 轮询语义一致）。
    getProjectWorktreeChangesMock.mockRejectedValue({
      code: "AGENT_SESSION_VALIDATION_FAILED",
      message: "workspace root inaccessible",
      details: [{ "@type": "WorkspaceRoot" }],
    });
    renderHook(
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
    // 默认展开：挂载时已补拉一次；此时仓库尚被判定为可访问。
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15_000);

    // 仓库判定不可访问后 committed 轮询不再继续。
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(1);
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

    await act(async () => {
      await result.current.loadMoreCommitHistory();
    });

    expect(result.current.commitHistory).toHaveLength(50);
    expect(result.current.loadMoreCommitHistoryErrorMessage).not.toBeNull();
    expect(result.current.isLoadingMoreCommitHistory).toBe(false);
  });

  it("clears the previous load-more error once a full-window refresh succeeds", async () => {
    const page1 = Array.from({ length: 50 }, (_, index) =>
      makeCommit(`ce-${index}`),
    );
    getProjectWorktreeCommitHistoryMock
      .mockResolvedValueOnce({
        commits: page1,
        signature: "sig-1",
        isWorktree: false,
        hasMore: true,
      })
      .mockRejectedValueOnce(new Error("page failed"))
      .mockResolvedValue({
        commits: page1,
        signature: "sig-refresh",
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

    await act(async () => {
      await result.current.loadMoreCommitHistory();
    });
    expect(result.current.loadMoreCommitHistoryErrorMessage).not.toBeNull();

    // 整窗刷新成功后不再保留上一轮 load-more 的错误提示（避免挡住自动连拉与重试）。
    await act(async () => {
      await result.current.refreshCommitHistory();
    });
    expect(result.current.loadMoreCommitHistoryErrorMessage).toBeNull();
    expect(result.current.commitHistory).toHaveLength(50);
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

/** 单次取数往返 10s，远大于未提交变更 2s 与已提交历史 5s 的轮询间隔。 */
const SLOW_ROUND_TRIP_MS = 10_000;

type CommitHistoryPage = {
  commits: ReturnType<typeof makeCommit>[];
  signature: string;
  isWorktree: boolean;
  hasMore: boolean;
};

describe("useSessionWorkspaceCache refresh resilience", () => {
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

  it("converges without stacking requests when the round trip outlasts the poll intervals", async () => {
    const changedFile = makeChangedFile("src/a.ts", "modified");
    const commits = [makeCommit("slow-1")];
    // 每次请求都在 10s 后才返回：轮询间隔内响应永远不可能落地。
    getProjectWorktreeChangesMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          window.setTimeout(
            () => resolve({ files: [changedFile], signature: "sig-changes" }),
            SLOW_ROUND_TRIP_MS,
          );
        }),
    );
    getProjectWorktreeCommitHistoryMock.mockImplementation(
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
      () =>
        useSessionWorkspaceCache({
          projectId: 1,
          sessionId: 1,
          isSidePanelOpen: true,
        }),
      { wrapper },
    );

    // 无展示数据的首拉进加载态。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.isChangesLoading).toBe(true);
    expect(result.current.isCommitHistoryLoading).toBe(true);

    // 首个响应落地前经过两个 2s tick 与一个 5s tick：在途请求直接跳过，不发起也不作废。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(1);
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(1);
    expect(result.current.isChangesLoading).toBe(true);
    expect(result.current.isCommitHistoryLoading).toBe(true);

    // 10s 后首个响应落地：加载态收口，数据展示。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SLOW_ROUND_TRIP_MS);
    });
    expect(result.current.isChangesLoading).toBe(false);
    expect(result.current.isCommitHistoryLoading).toBe(false);
    expect(result.current.changes).toEqual([changedFile]);
    expect(result.current.commitHistory).toEqual(commits);

    // 已有展示数据后的后台轮询刷新不进加载态（哪怕响应仍然比轮询慢）。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SLOW_ROUND_TRIP_MS);
    });
    expect(result.current.isChangesLoading).toBe(false);
    expect(result.current.isCommitHistoryLoading).toBe(false);
    expect(result.current.commitHistory).toEqual(commits);

    // 继续跑到 46s：随 tick 线性堆叠会到 20 次以上；收敛后只随响应落地次数增长。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(getProjectWorktreeChangesMock.mock.calls.length).toBeLessThanOrEqual(
      6,
    );
    expect(
      getProjectWorktreeCommitHistoryMock.mock.calls.length,
    ).toBeLessThanOrEqual(6);
    expect(result.current.isChangesLoading).toBe(false);
    expect(result.current.isCommitHistoryLoading).toBe(false);
    expect(result.current.commitHistory).toEqual(commits);
  });

  it("does not flash loading while refreshing a commit history that already has commits", async () => {
    const commits = [makeCommit("existing-1")];
    let resolveRefresh: ((page: CommitHistoryPage) => void) | undefined;
    getProjectWorktreeCommitHistoryMock
      .mockResolvedValueOnce({
        commits,
        signature: "sig-existing",
        isWorktree: false,
        hasMore: false,
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve;
          }),
      );

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
    expect(result.current.commitHistory).toEqual(commits);
    expect(result.current.isCommitHistoryLoading).toBe(false);

    // 5s tick 进入慢刷新：已有展示数据，不进加载态、不覆盖列表。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(2);
    expect(result.current.isCommitHistoryLoading).toBe(false);
    expect(result.current.commitHistory).toEqual(commits);

    await act(async () => {
      resolveRefresh?.({
        commits: [...commits, makeCommit("existing-2")],
        signature: "sig-existing-2",
        isWorktree: false,
        hasMore: false,
      });
      await Promise.resolve();
    });
    expect(result.current.commitHistory).toHaveLength(2);
    expect(result.current.isCommitHistoryLoading).toBe(false);
  });

  it("deduplicates repeated refreshes while the first request is still in flight", async () => {
    const changedFile = makeChangedFile("src/dedup.ts", "modified");
    const commits = [makeCommit("dedup-1")];
    let resolveChanges:
      | ((page: { files: WorkspaceChangedFile[]; signature: string }) => void)
      | undefined;
    let resolveHistory: ((page: CommitHistoryPage) => void) | undefined;
    getProjectWorktreeChangesMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveChanges = resolve;
        }),
    );
    getProjectWorktreeCommitHistoryMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveHistory = resolve;
        }),
    );

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

    // 挂载首拉仍在途：重复点击刷新不再发起并发请求。
    act(() => {
      void result.current.refreshChanges();
      void result.current.refreshChanges();
      void result.current.refreshCommitHistory();
      void result.current.refreshCommitHistory();
    });
    await settle();
    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(1);
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveChanges?.({ files: [changedFile], signature: "sig-changes" });
      resolveHistory?.({
        commits,
        signature: "sig-commits",
        isWorktree: false,
        hasMore: false,
      });
      await Promise.resolve();
    });
    await settle();
    expect(result.current.changes).toEqual([changedFile]);
    expect(result.current.commitHistory).toEqual(commits);
    expect(result.current.isChangesLoading).toBe(false);
    expect(result.current.isCommitHistoryLoading).toBe(false);
  });

  it("does not start a concurrent request when the hook remounts while a request is in flight", async () => {
    const commits = [makeCommit("remount-1")];
    let resolveFirst: ((page: CommitHistoryPage) => void) | undefined;
    getProjectWorktreeCommitHistoryMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue({
        commits,
        signature: "sig-remount",
        isWorktree: false,
        hasMore: false,
      });

    const first = renderHook(
      () =>
        useSessionWorkspaceCache({
          projectId: 1,
          sessionId: 1,
          isSidePanelOpen: true,
        }),
      { wrapper },
    );
    await settle();
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(1);

    // 卸载重挂载复用同一份会话缓存与在途登记：在途请求未结算前不并发发起。
    first.unmount();
    const second = renderHook(
      () =>
        useSessionWorkspaceCache({
          projectId: 1,
          sessionId: 1,
          isSidePanelOpen: true,
        }),
      { wrapper },
    );
    await settle();
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(1);
    expect(second.result.current.isCommitHistoryLoading).toBe(true);
    expect(second.result.current.commitHistory).toEqual([]);

    // 旧实例的响应写入 module-level 会话缓存；重挂载后的下一次轮询渲染出来。
    await act(async () => {
      resolveFirst?.({
        commits,
        signature: "sig-remount",
        isWorktree: false,
        hasMore: false,
      });
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(2);
    expect(second.result.current.commitHistory).toEqual(commits);
    expect(second.result.current.isCommitHistoryLoading).toBe(false);
  });

  it("keeps the previous session's late response out of the newly selected session", async () => {
    const firstSessionFile = makeChangedFile("src/one.ts", "modified");
    const secondSessionFile = makeChangedFile("src/two.ts", "modified");
    let resolveFirstSession:
      | ((page: { files: WorkspaceChangedFile[]; signature: string }) => void)
      | undefined;
    getProjectWorktreeChangesMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstSession = resolve;
          }),
      )
      .mockResolvedValueOnce({
        signature: "session-2",
        files: [secondSessionFile],
      });

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: number }) =>
        useSessionWorkspaceCache({
          projectId: 1,
          sessionId,
          isSidePanelOpen: true,
        }),
      { wrapper, initialProps: { sessionId: 1 } },
    );
    await settle();
    expect(result.current.changes).toEqual([]);

    // 切到另一个会话：新会话按自己的会话缓存取数，进入加载态后展示自己的数据。
    rerender({ sessionId: 2 });
    await settle();
    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(2);
    expect(result.current.isChangesLoading).toBe(false);
    expect(result.current.changes).toEqual([secondSessionFile]);

    // 旧会话的迟到响应不得写入新会话（各会话的在途登记与缓存互相隔离）。
    await act(async () => {
      resolveFirstSession?.({
        signature: "session-1",
        files: [firstSessionFile],
      });
      await Promise.resolve();
    });
    await settle();
    expect(result.current.changes).toEqual([secondSessionFile]);
  });

  it("does not preempt an in-flight load-more with a background refresh", async () => {
    const page1 = Array.from({ length: 50 }, (_, index) =>
      makeCommit(`lm-${index}`),
    );
    let resolveLoadMore: ((page: CommitHistoryPage) => void) | undefined;
    getProjectWorktreeCommitHistoryMock
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
      .mockResolvedValue({
        commits: page1,
        signature: "sig-2",
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
    expect(result.current.commitHistory).toHaveLength(50);

    act(() => {
      void result.current.loadMoreCommitHistory();
    });
    await settle();
    expect(result.current.isLoadingMoreCommitHistory).toBe(true);

    // load-more 在途时 5s tick 与手动刷新都被跳过：不抢占在途请求。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    act(() => {
      void result.current.refreshCommitHistory();
    });
    await settle();
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(2);
    expect(result.current.isLoadingMoreCommitHistory).toBe(true);
    expect(result.current.isCommitHistoryLoading).toBe(false);

    // load-more 正常落地：追加页、收口 load-more 加载态。
    await act(async () => {
      resolveLoadMore?.({
        commits: [makeCommit("lm-page-2")],
        signature: "sig-page-2",
        isWorktree: false,
        hasMore: false,
      });
      await Promise.resolve();
    });
    await settle();
    expect(result.current.isLoadingMoreCommitHistory).toBe(false);
    expect(result.current.commitHistory).toHaveLength(51);
    expect(
      result.current.commitHistory.some(
        (commit) => commit.hash === "lm-page-2",
      ),
    ).toBe(true);

    // 结算之后同资源可再次发起：整窗刷新按当前整窗条数取数。
    act(() => {
      void result.current.refreshCommitHistory();
    });
    await settle();
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenLastCalledWith({
      projectId: 1,
      sessionId: 1,
      limit: 51,
      offset: 0,
    });
  });
});

/** 会话列表变更事件的失效去抖窗口（与源码常量同值）。 */
const SESSION_LIST_EVENT_DEBOUNCE_MS = 500;

function dispatchSessionListChanged(payload: AgentSessionListChangedEvent) {
  eventMocks.listeners
    .filter((listener) => listener.eventName === "agent-session-list-changed")
    .forEach((listener) => {
      listener.callback({ payload });
    });
}

describe("useSessionWorkspaceCache session list event invalidation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    eventMocks.listeners = [];
    eventMocks.unlisten.mockReset();
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

  it("invalidates uncommitted changes and committed history after a debounced event for this session", async () => {
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
    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(1);
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(1);

    dispatchSessionListChanged({
      projectId: 1,
      sessionId: 1,
      reason: "turn-ended",
    });

    // 去抖窗口内不刷新：一次回合开始 / 结束会连发多条会话列表变更事件。
    await vi.advanceTimersByTimeAsync(SESSION_LIST_EVENT_DEBOUNCE_MS - 1);
    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(1);
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(2);
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(2);
  });

  it("treats a project-level event without sessionId as hitting this session", async () => {
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

    dispatchSessionListChanged({
      projectId: 1,
      sessionId: null,
      reason: "updated",
    });
    await vi.advanceTimersByTimeAsync(SESSION_LIST_EVENT_DEBOUNCE_MS);
    await settle();

    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(2);
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(2);
  });

  it("ignores events for other sessions and other projects", async () => {
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

    // 两次推进合计仍短于 2s 轮询间隔，计数只反映事件路径。
    dispatchSessionListChanged({
      projectId: 1,
      sessionId: 999,
      reason: "turn-ended",
    });
    await vi.advanceTimersByTimeAsync(SESSION_LIST_EVENT_DEBOUNCE_MS + 100);
    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(1);
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(1);

    dispatchSessionListChanged({
      projectId: 999,
      sessionId: 1,
      reason: "turn-ended",
    });
    await vi.advanceTimersByTimeAsync(SESSION_LIST_EVENT_DEBOUNCE_MS + 100);
    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(1);
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(1);
  });

  it("merges a burst of events into a single invalidation", async () => {
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

    for (let index = 0; index < 3; index += 1) {
      dispatchSessionListChanged({
        projectId: 1,
        sessionId: 1,
        reason: "turn-running",
      });
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(SESSION_LIST_EVENT_DEBOUNCE_MS);
    await settle();

    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(2);
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledTimes(2);
  });

  it("defers the invalidation instead of stacking when a changes request is already in flight", async () => {
    let resolveFirstChanges:
      | ((value: { files: WorkspaceChangedFile[]; signature: string }) => void)
      | undefined;
    getProjectWorktreeChangesMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstChanges = resolve;
        }),
    );

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
    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(1);

    dispatchSessionListChanged({
      projectId: 1,
      sessionId: 1,
      reason: "turn-ended",
    });
    await vi.advanceTimersByTimeAsync(SESSION_LIST_EVENT_DEBOUNCE_MS);
    // 在途：不叠加上第二次请求。
    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(1);

    // 在途请求结算后补一次刷新，失效不丢失。
    await act(async () => {
      resolveFirstChanges?.({ files: [], signature: "sig-late" });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(2);
  });

  it("drops the deferred invalidation when the side panel closes before the in-flight request settles", async () => {
    let resolveFirstChanges:
      | ((value: { files: WorkspaceChangedFile[]; signature: string }) => void)
      | undefined;
    getProjectWorktreeChangesMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstChanges = resolve;
        }),
    );

    const { rerender } = renderHook(
      ({ isSidePanelOpen }: { isSidePanelOpen: boolean }) =>
        useSessionWorkspaceCache({
          projectId: 1,
          sessionId: 1,
          isSidePanelOpen,
        }),
      { initialProps: { isSidePanelOpen: true }, wrapper },
    );
    await settle();
    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(1);

    dispatchSessionListChanged({
      projectId: 1,
      sessionId: 1,
      reason: "turn-ended",
    });
    await vi.advanceTimersByTimeAsync(SESSION_LIST_EVENT_DEBOUNCE_MS);
    // 在途：这次失效停泊在结算之后，不叠加第二个请求。
    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(1);

    // 结算前关闭侧栏：补刷新作废（用户已不在看这块面板）。
    rerender({ isSidePanelOpen: false });
    await settle();
    await act(async () => {
      resolveFirstChanges?.({ files: [], signature: "sig-panel-closed" });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the uncommitted-changes invalidation when the committed panel is collapsed mid-flight", async () => {
    let resolveFirstChanges:
      | ((value: { files: WorkspaceChangedFile[]; signature: string }) => void)
      | undefined;
    getProjectWorktreeChangesMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstChanges = resolve;
        }),
    );

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

    dispatchSessionListChanged({
      projectId: 1,
      sessionId: 1,
      reason: "turn-ended",
    });
    await vi.advanceTimersByTimeAsync(SESSION_LIST_EVENT_DEBOUNCE_MS);
    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(1);

    // 收起「已提交」面板：只作废已提交历史的补刷新，未提交变更仍要看在途请求的结算。
    act(() => {
      result.current.toggleCommittedChangesExpanded();
    });
    await settle();

    await act(async () => {
      resolveFirstChanges?.({ files: [], signature: "sig-late" });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(2);
  });

  it("drops the deferred invalidation when the session switches before the in-flight request settles", async () => {
    let resolveFirstChanges:
      | ((value: { files: WorkspaceChangedFile[]; signature: string }) => void)
      | undefined;
    getProjectWorktreeChangesMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstChanges = resolve;
        }),
    );

    const { rerender } = renderHook(
      ({ sessionId }: { sessionId: number }) =>
        useSessionWorkspaceCache({
          projectId: 1,
          sessionId,
          isSidePanelOpen: true,
        }),
      { initialProps: { sessionId: 1 }, wrapper },
    );
    await settle();
    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(1);

    dispatchSessionListChanged({
      projectId: 1,
      sessionId: 1,
      reason: "turn-ended",
    });
    await vi.advanceTimersByTimeAsync(SESSION_LIST_EVENT_DEBOUNCE_MS);

    // 切到另一个会话：新会话自己走首拉，旧会话的补刷新作废。
    rerender({ sessionId: 2 });
    await settle();
    expect(getProjectWorktreeChangesMock).toHaveBeenLastCalledWith({
      projectId: 1,
      sessionId: 2,
    });
    const callsAfterSwitch = getProjectWorktreeChangesMock.mock.calls.length;

    await act(async () => {
      resolveFirstChanges?.({ files: [], signature: "sig-old-session" });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getProjectWorktreeChangesMock.mock.calls.length).toBe(
      callsAfterSwitch,
    );
  });

  it("does not invalidate while the side panel is closed", async () => {
    renderHook(
      () =>
        useSessionWorkspaceCache({
          projectId: 1,
          sessionId: 1,
          isSidePanelOpen: false,
        }),
      { wrapper },
    );
    await settle();
    expect(getProjectWorktreeChangesMock).not.toHaveBeenCalled();

    dispatchSessionListChanged({
      projectId: 1,
      sessionId: 1,
      reason: "turn-ended",
    });
    await vi.advanceTimersByTimeAsync(SESSION_LIST_EVENT_DEBOUNCE_MS * 2);

    expect(getProjectWorktreeChangesMock).not.toHaveBeenCalled();
    expect(getProjectWorktreeCommitHistoryMock).not.toHaveBeenCalled();
  });
});
