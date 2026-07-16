import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import { useSessionWorkspaceCache } from "./use-session-workspace-cache";
import {
  getProjectWorktreeChanges,
  getProjectWorktreeCommitHistory,
} from "./session-workspace-commands";

vi.mock("./session-workspace-commands", () => ({
  CODE_WORKSPACE_ROOTS_UPDATED_EVENT: "code-workspace-roots-updated",
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

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider initialLocale="en">{children}</I18nProvider>;
}

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
