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

vi.mock("../../shared/workspace/workspace-commands", () => ({
  fetchProjectRemotes: vi.fn(),
}));

import { listAgentSessions } from "../agents/agent-session-commands";
import { fetchProjectRemotes } from "../../shared/workspace/workspace-commands";

const listAgentSessionsMock = vi.mocked(listAgentSessions);
const fetchProjectRemotesMock = vi.mocked(fetchProjectRemotes);

const REMOTE_FETCH_MS = 60_000;
/** 会话列表变更事件的失效去抖窗口（与源码常量同值）。 */
const SESSION_LIST_EVENT_DEBOUNCE_MS = 500;

function dispatchSessionListChanged(payload: AgentSessionListChangedEvent) {
  eventMocks.listeners
    .filter((listener) => listener.eventName === "agent-session-list-changed")
    .forEach((listener) => {
      listener.callback({ payload });
    });
}

function baseAutoRefreshOptions(
  overrides: Partial<{
    enabled: boolean;
    running: boolean;
    refreshChanges: () => void;
    refreshCommitHistory: () => void;
    invalidateChanges: (isStillWanted: () => boolean) => void;
    invalidateCommitHistory: (isStillWanted: () => boolean) => void;
    isUnavailable: boolean;
    projectId: number;
    workspacePath: string | null;
    isProjectRoot: boolean;
  }> = {},
) {
  return {
    enabled: true,
    running: false,
    refreshChanges: vi.fn() as unknown as () => void,
    refreshCommitHistory: vi.fn() as unknown as () => void,
    invalidateChanges: vi.fn() as unknown as (
      isStillWanted: () => boolean,
    ) => void,
    invalidateCommitHistory: vi.fn() as unknown as (
      isStillWanted: () => boolean,
    ) => void,
    isUnavailable: false,
    projectId: 1,
    workspacePath: "/tmp/repo",
    // 默认 false：本地 4s/8s 轮询用例不受激活首拍 remote fetch 干扰；
    // 需要后台 fetch 的用例显式传 isProjectRoot: true。
    isProjectRoot: false,
    ...overrides,
  };
}

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
    issueStatus: null,
    agentProfileId: 1,
    agentProfileName: "Test Profile",
    workflowSkillName: null,
    canCompleteClean: false,
    canCompleteAgentCommit: false,
    agentType: "codex",
    displayMode: "json",
    status: "running",
    attention: "none",
    isTurnRunning: true,
    workspaceMode: "current_branch",
    workingDir: "/tmp/repo",
    workspacePath: "/tmp/redwhisk",
    originBranch: null,
    workspaceBranch: null,
    worktreeOwner: "redwhisk",
    logPath: "/tmp/session.log",
    latestOutput: null,
    title: null,
    lastActiveAt: 0,
    startedAt: 0,
    closedAt: null,
    processingMs: 0,
    lastOutputAt: null,
    startupModel: null,
    tokenInput: null,
    tokenOutput: null,
    tokenCache: null,
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

  it("skips the fallback tick while a session-list request is still in flight", async () => {
    // 单次往返 10s，远大于 5s 兜底轮询：在途期间的 tick 直接跳过，不叠加请求。
    listAgentSessionsMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          window.setTimeout(
            () =>
              resolve({
                sessions: [
                  makeSession({
                    workspacePath: "/tmp/redwhisk",
                    status: "running",
                    isTurnRunning: true,
                  }),
                ],
              }),
            10_000,
          );
        }),
    );

    const { result } = renderHook(() =>
      useWorktreeRunningSession(1, "/tmp/redwhisk", true),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    // 首拉落地：running 状态收敛。
    expect(result.current).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    // 30s / 5s 兜底轮询会 tick 6 次；在途去重后最多 4 次请求。
    expect(listAgentSessionsMock.mock.calls.length).toBeLessThanOrEqual(4);
    expect(result.current).toBe(true);
  });

  it("keeps ticking when the session-list command throws synchronously", async () => {
    // 同步抛错也必须结算在途登记，否则后续 tick 会被永久跳过。
    let shouldThrow = true;
    listAgentSessionsMock.mockImplementation(() => {
      if (shouldThrow) throw new Error("boom");
      return Promise.resolve({ sessions: [] });
    });

    const { result } = renderHook(() =>
      useWorktreeRunningSession(1, "/tmp/redwhisk", true),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(listAgentSessionsMock).toHaveBeenCalledTimes(1);

    shouldThrow = false;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(listAgentSessionsMock).toHaveBeenCalledTimes(2);
    expect(result.current).toBe(false);
  });
});

describe("useChangesAutoRefresh", () => {
  // 运行时为 vi.fn 以便 toHaveBeenCalledTimes 断言；类型声明为 () => void 与 hook
  // 选项签名对齐（vitest Mock 含构造签名，直接赋值会触发 TS 不兼容）。
  let refreshChanges: () => void;
  let refreshCommitHistory: () => void;
  let invalidateChanges: (isStillWanted: () => boolean) => void;
  let invalidateCommitHistory: (isStillWanted: () => boolean) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    refreshChanges = vi.fn() as unknown as () => void;
    refreshCommitHistory = vi.fn() as unknown as () => void;
    invalidateChanges = vi.fn() as unknown as (
      isStillWanted: () => boolean,
    ) => void;
    invalidateCommitHistory = vi.fn() as unknown as (
      isStillWanted: () => boolean,
    ) => void;
    eventMocks.listeners = [];
    eventMocks.unlisten.mockReset();
    fetchProjectRemotesMock.mockReset();
    fetchProjectRemotesMock.mockResolvedValue(undefined);
    setVisibility(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls every 4000ms when visible and a running turn is active", async () => {
    renderHook(() =>
      useChangesAutoRefresh(
        baseAutoRefreshOptions({
          running: true,
          refreshChanges,
          refreshCommitHistory,
        }),
      ),
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
      useChangesAutoRefresh(
        baseAutoRefreshOptions({
          refreshChanges,
          refreshCommitHistory,
        }),
      ),
    );
    await vi.advanceTimersByTimeAsync(4_000);
    expect(refreshChanges).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4_000);
    expect(refreshChanges).toHaveBeenCalledTimes(1);
  });

  it("pauses polling while the document is hidden", async () => {
    renderHook(() =>
      useChangesAutoRefresh(
        baseAutoRefreshOptions({
          running: true,
          refreshChanges,
          refreshCommitHistory,
        }),
      ),
    );
    changeVisibility(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refreshChanges).not.toHaveBeenCalled();
  });

  it("refreshes immediately when becoming visible again", async () => {
    renderHook(() =>
      useChangesAutoRefresh(
        baseAutoRefreshOptions({
          running: true,
          refreshChanges,
          refreshCommitHistory,
        }),
      ),
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
        useChangesAutoRefresh(
          baseAutoRefreshOptions({
            running: true,
            refreshChanges,
            refreshCommitHistory,
            isUnavailable,
          }),
        ),
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
      useChangesAutoRefresh(
        baseAutoRefreshOptions({
          enabled: false,
          running: true,
          refreshChanges,
          refreshCommitHistory,
        }),
      ),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refreshChanges).not.toHaveBeenCalled();
  });

  it("does not refresh on mount or when refresh identity changes (worktree switch avoids redundant fetches)", async () => {
    const refreshChangesA = vi.fn() as unknown as () => void;
    const { rerender } = renderHook(
      ({ refreshChanges }: { refreshChanges: () => void }) =>
        useChangesAutoRefresh(
          baseAutoRefreshOptions({
            refreshChanges,
            refreshCommitHistory,
          }),
        ),
      { initialProps: { refreshChanges: refreshChangesA } },
    );
    expect(refreshChangesA).not.toHaveBeenCalled();

    // 切换工作区 -> refresh identity 变化，refreshOnActivate=false 不补拉
    // （useCodeWorkspaceChanges 已在切分支时拉取，signature 去重）。
    const refreshChangesB = vi.fn() as unknown as () => void;
    rerender({ refreshChanges: refreshChangesB });
    expect(refreshChangesA).not.toHaveBeenCalled();
    expect(refreshChangesB).not.toHaveBeenCalled();
  });

  it("fetches remotes on activate and every 60s, refreshing after success", async () => {
    renderHook(() =>
      useChangesAutoRefresh(
        baseAutoRefreshOptions({
          refreshChanges,
          refreshCommitHistory,
          isProjectRoot: true,
          workspacePath: "/tmp/repo",
        }),
      ),
    );

    // 激活即首拍（变更 Activity 切走会卸载；不能只等满 60s）。
    await settle();
    expect(fetchProjectRemotesMock).toHaveBeenCalledTimes(1);
    expect(fetchProjectRemotesMock).toHaveBeenCalledWith({
      projectId: 1,
      workspacePath: "/tmp/repo",
    });
    // fetch 成功后 soft revalidate 本地变更 + 提交历史。
    expect(refreshChanges).toHaveBeenCalled();
    expect(refreshCommitHistory).toHaveBeenCalled();

    const refreshCallsAfterActivate = (
      refreshChanges as ReturnType<typeof vi.fn>
    ).mock.calls.length;

    await vi.advanceTimersByTimeAsync(REMOTE_FETCH_MS - 1);
    expect(fetchProjectRemotesMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(fetchProjectRemotesMock).toHaveBeenCalledTimes(2);
    expect(
      (refreshChanges as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBeGreaterThan(refreshCallsAfterActivate);
  });

  it("fetches remotes on each short activate (intermittent Changes visits)", async () => {
    // 回归：用户多次短时打开变更页（<60s）却从不连续停满 60s 时，旧实现永不 fetch，
    // 远端 behind 无法驱动「同步更改」，空态一直显示「暂无未提交变更」。
    const { unmount } = renderHook(() =>
      useChangesAutoRefresh(
        baseAutoRefreshOptions({
          refreshChanges,
          refreshCommitHistory,
          isProjectRoot: true,
          workspacePath: "/tmp/repo",
        }),
      ),
    );
    await settle();
    expect(fetchProjectRemotesMock).toHaveBeenCalledTimes(1);

    unmount();
    await vi.advanceTimersByTimeAsync(30_000);

    renderHook(() =>
      useChangesAutoRefresh(
        baseAutoRefreshOptions({
          refreshChanges,
          refreshCommitHistory,
          isProjectRoot: true,
          workspacePath: "/tmp/repo",
        }),
      ),
    );
    await settle();
    expect(fetchProjectRemotesMock).toHaveBeenCalledTimes(2);
  });

  it("does not background-fetch remotes on linked worktree", async () => {
    renderHook(() =>
      useChangesAutoRefresh(
        baseAutoRefreshOptions({
          refreshChanges,
          refreshCommitHistory,
          isProjectRoot: false,
          workspacePath: "/tmp/worktree",
        }),
      ),
    );
    await vi.advanceTimersByTimeAsync(REMOTE_FETCH_MS + 5_000);
    expect(fetchProjectRemotesMock).not.toHaveBeenCalled();
  });

  it("does not background-fetch remotes while hidden", async () => {
    setVisibility(false);
    renderHook(() =>
      useChangesAutoRefresh(
        baseAutoRefreshOptions({
          refreshChanges,
          refreshCommitHistory,
          isProjectRoot: true,
        }),
      ),
    );
    await settle();
    await vi.advanceTimersByTimeAsync(REMOTE_FETCH_MS + 5_000);
    expect(fetchProjectRemotesMock).not.toHaveBeenCalled();
  });

  it("does not background-fetch remotes when workspace is unavailable", async () => {
    renderHook(() =>
      useChangesAutoRefresh(
        baseAutoRefreshOptions({
          refreshChanges,
          refreshCommitHistory,
          isProjectRoot: true,
          isUnavailable: true,
        }),
      ),
    );
    await vi.advanceTimersByTimeAsync(REMOTE_FETCH_MS + 5_000);
    expect(fetchProjectRemotesMock).not.toHaveBeenCalled();
  });

  it("skips local refresh when remote fetch fails", async () => {
    fetchProjectRemotesMock.mockRejectedValueOnce(new Error("network"));
    renderHook(() =>
      useChangesAutoRefresh(
        baseAutoRefreshOptions({
          refreshChanges,
          refreshCommitHistory,
          isProjectRoot: true,
        }),
      ),
    );
    const localCallsBeforeFetch = (refreshChanges as ReturnType<typeof vi.fn>)
      .mock.calls.length;
    await settle();
    expect(fetchProjectRemotesMock).toHaveBeenCalledTimes(1);
    // 失败不因 fetch 额外触发 refresh（本地 8s 轮询另计，此窗口内不应再增）。
    expect((refreshChanges as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      localCallsBeforeFetch,
    );
  });

  it("invalidates uncommitted changes and commit history after a debounced session list event for this project", async () => {
    renderHook(() =>
      useChangesAutoRefresh(
        baseAutoRefreshOptions({
          refreshChanges,
          refreshCommitHistory,
          invalidateChanges,
          invalidateCommitHistory,
        }),
      ),
    );

    dispatchSessionListChanged({
      projectId: 1,
      sessionId: 7,
      reason: "turn-ended",
    });

    // 去抖窗口内不刷新：一次回合开始 / 结束会连发多条会话列表变更事件。
    await vi.advanceTimersByTimeAsync(SESSION_LIST_EVENT_DEBOUNCE_MS - 1);
    expect(invalidateChanges).not.toHaveBeenCalled();
    expect(invalidateCommitHistory).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(invalidateChanges).toHaveBeenCalledTimes(1);
    expect(invalidateCommitHistory).toHaveBeenCalledTimes(1);
  });

  it("ignores session list events for other projects", async () => {
    renderHook(() =>
      useChangesAutoRefresh(
        baseAutoRefreshOptions({
          refreshChanges,
          refreshCommitHistory,
          invalidateChanges,
          invalidateCommitHistory,
        }),
      ),
    );

    dispatchSessionListChanged({
      projectId: 999,
      sessionId: 7,
      reason: "turn-ended",
    });
    await vi.advanceTimersByTimeAsync(SESSION_LIST_EVENT_DEBOUNCE_MS * 2);

    expect(invalidateChanges).not.toHaveBeenCalled();
    expect(invalidateCommitHistory).not.toHaveBeenCalled();
  });

  it("merges a burst of session list events into a single invalidation", async () => {
    renderHook(() =>
      useChangesAutoRefresh(
        baseAutoRefreshOptions({
          refreshChanges,
          refreshCommitHistory,
          invalidateChanges,
          invalidateCommitHistory,
        }),
      ),
    );

    for (let index = 0; index < 3; index += 1) {
      dispatchSessionListChanged({
        projectId: 1,
        sessionId: index,
        reason: "turn-running",
      });
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(SESSION_LIST_EVENT_DEBOUNCE_MS);

    expect(invalidateChanges).toHaveBeenCalledTimes(1);
    expect(invalidateCommitHistory).toHaveBeenCalledTimes(1);
  });

  it("does not invalidate while the document is hidden and drops a pending debounce when it goes hidden", async () => {
    renderHook(() =>
      useChangesAutoRefresh(
        baseAutoRefreshOptions({
          refreshChanges,
          refreshCommitHistory,
          invalidateChanges,
          invalidateCommitHistory,
        }),
      ),
    );

    dispatchSessionListChanged({
      projectId: 1,
      sessionId: 7,
      reason: "turn-ended",
    });
    await vi.advanceTimersByTimeAsync(SESSION_LIST_EVENT_DEBOUNCE_MS - 100);
    // 去抖窗口未到期就切到后台：这次失效不发起请求。
    changeVisibility(false);
    await vi.advanceTimersByTimeAsync(SESSION_LIST_EVENT_DEBOUNCE_MS * 2);
    expect(invalidateChanges).not.toHaveBeenCalled();

    // 隐藏期间收到的事件同样不刷新。
    dispatchSessionListChanged({
      projectId: 1,
      sessionId: 7,
      reason: "turn-ended",
    });
    await vi.advanceTimersByTimeAsync(SESSION_LIST_EVENT_DEBOUNCE_MS * 2);
    expect(invalidateChanges).not.toHaveBeenCalled();

    // 恢复可见仍走既有补拉（与失效路径无关）。
    changeVisibility(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshChanges).toHaveBeenCalledTimes(1);
    expect(invalidateChanges).not.toHaveBeenCalled();
  });

  it("hands the invalidation a gate check that turns false once the window goes hidden", async () => {
    renderHook(() =>
      useChangesAutoRefresh(
        baseAutoRefreshOptions({
          invalidateChanges,
          invalidateCommitHistory,
        }),
      ),
    );

    dispatchSessionListChanged({
      projectId: 1,
      sessionId: 7,
      reason: "turn-ended",
    });
    await vi.advanceTimersByTimeAsync(SESSION_LIST_EVENT_DEBOUNCE_MS);
    expect(invalidateChanges).toHaveBeenCalledTimes(1);

    // 失效刷新可能停泊在「等在途结算」上；门控收紧后消费方必须能放弃这次补刷新。
    const isStillWanted = (invalidateChanges as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as (() => boolean) | undefined;
    expect(isStillWanted?.()).toBe(true);

    changeVisibility(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(isStillWanted?.()).toBe(false);
  });

  it("does not invalidate while the changes view is disabled or the workspace is unavailable", async () => {
    const { unmount } = renderHook(() =>
      useChangesAutoRefresh(
        baseAutoRefreshOptions({
          enabled: false,
          invalidateChanges,
          invalidateCommitHistory,
        }),
      ),
    );
    dispatchSessionListChanged({
      projectId: 1,
      sessionId: 7,
      reason: "turn-ended",
    });
    await vi.advanceTimersByTimeAsync(SESSION_LIST_EVENT_DEBOUNCE_MS * 2);
    expect(invalidateChanges).not.toHaveBeenCalled();
    unmount();

    renderHook(() =>
      useChangesAutoRefresh(
        baseAutoRefreshOptions({
          isUnavailable: true,
          invalidateChanges,
          invalidateCommitHistory,
        }),
      ),
    );
    dispatchSessionListChanged({
      projectId: 1,
      sessionId: 7,
      reason: "turn-ended",
    });
    await vi.advanceTimersByTimeAsync(SESSION_LIST_EVENT_DEBOUNCE_MS * 2);
    expect(invalidateChanges).not.toHaveBeenCalled();
  });
});
