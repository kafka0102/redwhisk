import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentSessionListItem } from "../agents/agent-session-commands";
import type { AgentSessionListChangedEvent } from "../agents/agent-session-events";
import {
  useChangesAutoRefresh,
  useWorktreeRunningSession,
} from "./use-changes-auto-refresh";

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

vi.mock("../agents/agent-session-commands", () => ({
  listAgentSessions: vi.fn(),
}));

import { listAgentSessions } from "../agents/agent-session-commands";

const listAgentSessionsMock = vi.mocked(listAgentSessions);

function setVisibility(visible: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (visible ? "visible" : "hidden"),
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

// 在 act 内切换可见性并 flush，使 visibilitychange 驱动的 setState 与 effect 同步生效。
function changeVisibility(visible: boolean) {
  act(() => {
    setVisibility(visible);
  });
}

// flush listAgentSessions 的 mockResolvedValue 微任务链（fake timers 下需多次），
// 并在 act 内提交 React 状态更新，使 result.current 反映最新 isRunning。
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function makeSession(
  overrides: Partial<AgentSessionListItem>,
): AgentSessionListItem {
  return {
    sessionId: 1,
    number: 1,
    projectId: 1,
    issueId: null,
    issueNumber: null,
    issueTitle: null,
    agentType: "codex",
    status: "running",
    attention: "none",
    isTurnRunning: true,
    workspacePath: "/tmp/redwhisk",
    title: null,
    lastActiveAt: 0,
    startedAt: 0,
    closedAt: null,
    ...overrides,
  };
}

describe("useWorktreeRunningSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    eventMocks.listeners = [];
    eventMocks.unlisten.mockReset();
    listAgentSessionsMock.mockReset();
    setVisibility(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns false and skips fetching when workspacePath is null", async () => {
    listAgentSessionsMock.mockResolvedValue({ sessions: [] });
    const { result } = renderHook(() =>
      useWorktreeRunningSession(1, null, true),
    );
    expect(result.current).toBe(false);
    expect(listAgentSessionsMock).not.toHaveBeenCalled();
  });

  it("returns false and skips fetching when disabled", async () => {
    listAgentSessionsMock.mockResolvedValue({ sessions: [] });
    const { result } = renderHook(() =>
      useWorktreeRunningSession(1, "/tmp/redwhisk", false),
    );
    expect(result.current).toBe(false);
    expect(listAgentSessionsMock).not.toHaveBeenCalled();
  });

  it("returns true when a matching running turn exists on the worktree", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        makeSession({
          workspacePath: "/tmp/redwhisk",
          status: "running",
          isTurnRunning: true,
        }),
      ],
    });
    const { result } = renderHook(() =>
      useWorktreeRunningSession(1, "/tmp/redwhisk", true),
    );
    await settle();
    expect(result.current).toBe(true);
  });

  it("returns false when sessions on the worktree are not running a turn", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        makeSession({
          workspacePath: "/tmp/redwhisk",
          status: "running",
          isTurnRunning: false,
        }),
        makeSession({
          sessionId: 2,
          workspacePath: "/tmp/other",
          status: "running",
          isTurnRunning: true,
        }),
      ],
    });
    const { result } = renderHook(() =>
      useWorktreeRunningSession(1, "/tmp/redwhisk", true),
    );
    await settle();
    expect(result.current).toBe(false);
  });

  it("recomputes after a debounced agent-session-list-changed event for this project", async () => {
    listAgentSessionsMock.mockResolvedValue({ sessions: [] });
    const { result } = renderHook(() =>
      useWorktreeRunningSession(1, "/tmp/redwhisk", true),
    );
    await settle();
    expect(result.current).toBe(false);

    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        makeSession({
          workspacePath: "/tmp/redwhisk",
          status: "running",
          isTurnRunning: true,
        }),
      ],
    });

    eventMocks.listeners
      .filter((listener) => listener.eventName === "agent-session-list-changed")
      .forEach((listener) => {
        listener.callback({
          payload: { projectId: 1, sessionId: 1, reason: "updated" },
        });
      });

    // 事件命中后 500ms 去抖窗口内不重算。
    await vi.advanceTimersByTimeAsync(499);
    expect(listAgentSessionsMock).toHaveBeenCalledTimes(1);
    // 去抖到期后重算命中 running。
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(result.current).toBe(true);
  });

  it("ignores agent-session-list-changed events for other projects", async () => {
    listAgentSessionsMock.mockResolvedValue({ sessions: [] });
    renderHook(() => useWorktreeRunningSession(1, "/tmp/redwhisk", true));
    await vi.advanceTimersByTimeAsync(0);
    expect(listAgentSessionsMock).toHaveBeenCalledTimes(1);

    eventMocks.listeners
      .filter((listener) => listener.eventName === "agent-session-list-changed")
      .forEach((listener) => {
        listener.callback({
          payload: { projectId: 999, sessionId: 1, reason: "updated" },
        });
      });
    await vi.advanceTimersByTimeAsync(600);
    // 其它 projectId 不触发重算，调用数不变。
    expect(listAgentSessionsMock).toHaveBeenCalledTimes(1);
  });

  it("unlistens and clears timers on unmount", async () => {
    listAgentSessionsMock.mockResolvedValue({ sessions: [] });
    const { unmount } = renderHook(() =>
      useWorktreeRunningSession(1, "/tmp/redwhisk", true),
    );
    await vi.advanceTimersByTimeAsync(0);
    unmount();
    expect(eventMocks.unlisten).toHaveBeenCalled();
    // 卸载后兜底轮询不再触发请求。
    const callsBefore = listAgentSessionsMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(listAgentSessionsMock.mock.calls.length).toBe(callsBefore);
  });
});

describe("useChangesAutoRefresh", () => {
  // 运行时为 vi.fn 以便 toHaveBeenCalledTimes 断言；类型声明为 () => void 与 hook
  // 选项签名对齐（vitest Mock 含构造签名，直接赋值会触发 TS 不兼容）。
  let refreshChanges: () => void;
  let refreshCommitHistory: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    refreshChanges = vi.fn() as unknown as () => void;
    refreshCommitHistory = vi.fn() as unknown as () => void;
    setVisibility(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls every 4000ms when visible and a running turn is active", async () => {
    renderHook(() =>
      useChangesAutoRefresh({
        enabled: true,
        workspacePath: "/tmp/redwhisk",
        running: true,
        refreshChanges,
        refreshCommitHistory,
        isUnavailable: false,
      }),
    );
    // 挂载不补拉。
    expect(refreshChanges).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4_000);
    expect(refreshChanges).toHaveBeenCalledTimes(1);
    expect(refreshCommitHistory).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(refreshChanges).toHaveBeenCalledTimes(2);
  });

  it("polls every 8000ms when visible and idle", async () => {
    renderHook(() =>
      useChangesAutoRefresh({
        enabled: true,
        workspacePath: "/tmp/redwhisk",
        running: false,
        refreshChanges,
        refreshCommitHistory,
        isUnavailable: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(4_000);
    expect(refreshChanges).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4_000);
    expect(refreshChanges).toHaveBeenCalledTimes(1);
  });

  it("pauses polling while the document is hidden", async () => {
    renderHook(() =>
      useChangesAutoRefresh({
        enabled: true,
        workspacePath: "/tmp/redwhisk",
        running: true,
        refreshChanges,
        refreshCommitHistory,
        isUnavailable: false,
      }),
    );
    changeVisibility(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refreshChanges).not.toHaveBeenCalled();
  });

  it("refreshes immediately when becoming visible again", async () => {
    renderHook(() =>
      useChangesAutoRefresh({
        enabled: true,
        workspacePath: "/tmp/redwhisk",
        running: true,
        refreshChanges,
        refreshCommitHistory,
        isUnavailable: false,
      }),
    );
    changeVisibility(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshChanges).not.toHaveBeenCalled();

    changeVisibility(true);
    await vi.advanceTimersByTimeAsync(0);
    // 恢复可见立即补拉一次。
    expect(refreshChanges).toHaveBeenCalledTimes(1);
    expect(refreshCommitHistory).toHaveBeenCalledTimes(1);
  });

  it("stops polling when the workspace becomes unavailable", async () => {
    const { rerender } = renderHook(
      ({ isUnavailable }: { isUnavailable: boolean }) =>
        useChangesAutoRefresh({
          enabled: true,
          workspacePath: "/tmp/redwhisk",
          running: true,
          refreshChanges,
          refreshCommitHistory,
          isUnavailable,
        }),
      { initialProps: { isUnavailable: false } },
    );
    await vi.advanceTimersByTimeAsync(4_000);
    expect(refreshChanges).toHaveBeenCalledTimes(1);

    rerender({ isUnavailable: true });
    await vi.advanceTimersByTimeAsync(10_000);
    // 不可用后不再 tick。
    expect(refreshChanges).toHaveBeenCalledTimes(1);
  });

  it("does not poll when disabled (files view)", async () => {
    renderHook(() =>
      useChangesAutoRefresh({
        enabled: false,
        workspacePath: "/tmp/redwhisk",
        running: true,
        refreshChanges,
        refreshCommitHistory,
        isUnavailable: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refreshChanges).not.toHaveBeenCalled();
  });

  it("does not refresh on mount or when workspacePath changes (avoids redundant fetches)", async () => {
    const { rerender } = renderHook(
      ({ workspacePath }: { workspacePath: string }) =>
        useChangesAutoRefresh({
          enabled: true,
          workspacePath,
          running: false,
          refreshChanges,
          refreshCommitHistory,
          isUnavailable: false,
        }),
      { initialProps: { workspacePath: "/tmp/a" } },
    );
    expect(refreshChanges).not.toHaveBeenCalled();
    rerender({ workspacePath: "/tmp/b" });
    // 切分支不主动补拉（useCodeWorkspaceChanges 已在切分支时拉取）。
    expect(refreshChanges).not.toHaveBeenCalled();
  });
});
