import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CodeWorkspaceRoot } from "./workspace-commands";
import type { CodeWorkspaceRootsUpdatedEvent } from "./workspace-commands";
import { useCodeWorkspaceRoots } from "./use-code-workspace-roots";

const eventMocks = vi.hoisted(() => ({
  listeners: [] as Array<{
    eventName: string;
    callback: (event: { payload: CodeWorkspaceRootsUpdatedEvent }) => void;
  }>,
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    (
      eventName: string,
      callback: (event: { payload: CodeWorkspaceRootsUpdatedEvent }) => void,
    ) => {
      eventMocks.listeners.push({ eventName, callback });
      return Promise.resolve(eventMocks.unlisten);
    },
  ),
}));

vi.mock("./workspace-commands", () => ({
  CODE_WORKSPACE_ROOTS_UPDATED_EVENT: "code-workspace-roots-updated",
  listCodeWorkspaceRoots: vi.fn(),
}));

import { listCodeWorkspaceRoots } from "./workspace-commands";

const listRootsMock = vi.mocked(listCodeWorkspaceRoots);

const mainRoot: CodeWorkspaceRoot = {
  branch: "main",
  path: "/tmp/redwhisk",
  isProjectRoot: true,
};
const issueRoot: CodeWorkspaceRoot = {
  branch: "issue-1",
  path: "/tmp/redwhisk.wt/issue-1",
  isProjectRoot: false,
};

function setVisibility(visible: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (visible ? "visible" : "hidden"),
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useCodeWorkspaceRoots", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    eventMocks.listeners = [];
    eventMocks.unlisten.mockReset();
    listRootsMock.mockReset();
    setVisibility(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the initial roots snapshot before the first fetch resolves", () => {
    listRootsMock.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() =>
      useCodeWorkspaceRoots(1, [mainRoot], true),
    );
    expect(result.current.roots).toEqual([mainRoot]);
  });

  it("fetches fresh roots on mount and adopts them when changed", async () => {
    listRootsMock.mockResolvedValue({ roots: [mainRoot, issueRoot] });
    const { result } = renderHook(() =>
      useCodeWorkspaceRoots(1, [mainRoot], true),
    );
    await settle();
    expect(listRootsMock).toHaveBeenCalledWith(1);
    expect(result.current.roots).toEqual([mainRoot, issueRoot]);
  });

  it("updates roots from the backend event for the matching project", async () => {
    listRootsMock.mockResolvedValue({ roots: [mainRoot] });
    const { result } = renderHook(() =>
      useCodeWorkspaceRoots(1, [mainRoot], true),
    );
    await settle();

    act(() => {
      eventMocks.listeners
        .filter((l) => l.eventName === "code-workspace-roots-updated")
        .forEach((l) =>
          l.callback({
            payload: { projectId: 1, roots: [mainRoot, issueRoot] },
          }),
        );
    });
    expect(result.current.roots).toEqual([mainRoot, issueRoot]);
  });

  it("ignores backend events for other projects", async () => {
    listRootsMock.mockResolvedValue({ roots: [mainRoot] });
    const { result } = renderHook(() =>
      useCodeWorkspaceRoots(1, [mainRoot], true),
    );
    await settle();

    act(() => {
      eventMocks.listeners
        .filter((l) => l.eventName === "code-workspace-roots-updated")
        .forEach((l) =>
          l.callback({
            payload: { projectId: 999, roots: [mainRoot, issueRoot] },
          }),
        );
    });
    expect(result.current.roots).toEqual([mainRoot]);
  });

  it("polls listCodeWorkspaceRoots every 15s while visible", async () => {
    listRootsMock.mockResolvedValue({ roots: [mainRoot] });
    renderHook(() => useCodeWorkspaceRoots(1, [mainRoot], true));
    await settle();
    expect(listRootsMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(listRootsMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(listRootsMock).toHaveBeenCalledTimes(3);
  });

  it("pauses polling while the document is hidden", async () => {
    listRootsMock.mockResolvedValue({ roots: [mainRoot] });
    renderHook(() => useCodeWorkspaceRoots(1, [mainRoot], true));
    await settle();
    expect(listRootsMock).toHaveBeenCalledTimes(1);

    act(() => setVisibility(false));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(listRootsMock).toHaveBeenCalledTimes(1);
  });

  it("does not fetch or poll when disabled", async () => {
    listRootsMock.mockResolvedValue({ roots: [mainRoot] });
    renderHook(() => useCodeWorkspaceRoots(1, [mainRoot], false));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(listRootsMock).not.toHaveBeenCalled();
  });

  it("unlistens on unmount", async () => {
    listRootsMock.mockResolvedValue({ roots: [mainRoot] });
    const { unmount } = renderHook(() =>
      useCodeWorkspaceRoots(1, [mainRoot], true),
    );
    await settle();
    unmount();
    expect(eventMocks.unlisten).toHaveBeenCalled();
  });
});
