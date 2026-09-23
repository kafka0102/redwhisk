import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  WorkspaceChangedFile,
  WorkspaceFileTreeNode,
} from "../../shared/workspace/workspace-commands";
import {
  resetCodeWorkspaceFileTreeCacheForTests,
  useCodeWorkspaceFileTree,
} from "./use-code-workspace-file-tree";

function makeChangedFile(
  filePath: string,
  kind: WorkspaceChangedFile["kind"],
): WorkspaceChangedFile {
  return {
    filePath,
    oldPath: null,
    fileName: filePath.split("/").pop() ?? filePath,
    kind,
    status: kind === "added" ? "A" : "M",
    additions: 1,
    deletions: 0,
    isBinary: false,
    contentHash: "h",
    metadataSignature: "m",
  };
}

vi.mock("../../shared/workspace/workspace-commands", () => ({
  getProjectWorktreeFileTree: vi.fn(),
  getProjectWorktreeChanges: vi.fn(),
}));

const windowMocks = vi.hoisted(() => ({
  focusListener: null as ((event: { payload: boolean }) => void) | null,
  isFocused: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isFocused: windowMocks.isFocused,
    onFocusChanged: (handler: (event: { payload: boolean }) => void) => {
      windowMocks.focusListener = handler;
      return Promise.resolve(() => {});
    },
  }),
}));

import {
  getProjectWorktreeChanges,
  getProjectWorktreeFileTree,
} from "../../shared/workspace/workspace-commands";

const treeMock = vi.mocked(getProjectWorktreeFileTree);
const changesMock = vi.mocked(getProjectWorktreeChanges);

const treeNodes: WorkspaceFileTreeNode[] = [
  { id: "a.ts", name: "a.ts", path: "a.ts", kind: "file", isIgnored: false },
];

const treeNodesB: WorkspaceFileTreeNode[] = [
  { id: "b.ts", name: "b.ts", path: "b.ts", kind: "file", isIgnored: false },
];

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
    await Promise.resolve();
  });
}

describe("useCodeWorkspaceFileTree", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    treeMock.mockReset();
    changesMock.mockReset();
    windowMocks.focusListener = null;
    windowMocks.isFocused.mockReset();
    windowMocks.isFocused.mockResolvedValue(true);
    resetCodeWorkspaceFileTreeCacheForTests();
    setVisibility(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetCodeWorkspaceFileTreeCacheForTests();
  });

  it("fetches tree and changes on mount and exposes change-kind badges", async () => {
    treeMock.mockResolvedValue({ nodes: treeNodes, signature: "t1" });
    changesMock.mockResolvedValue({
      files: [
        makeChangedFile("a.ts", "added"),
        makeChangedFile("b.ts", "modified"),
      ],
      signature: "c1",
    });

    const { result } = renderHook(() =>
      useCodeWorkspaceFileTree(1, "/tmp/redwhisk", true),
    );
    await settle();

    expect(treeMock).toHaveBeenCalledWith({
      projectId: 1,
      workspacePath: "/tmp/redwhisk",
    });
    expect(changesMock).toHaveBeenCalledWith({
      projectId: 1,
      workspacePath: "/tmp/redwhisk",
    });
    expect(result.current.tree).toEqual(treeNodes);
    expect(result.current.changedFileKinds.get("a.ts")).toBe("added");
    expect(result.current.changedFileKinds.get("b.ts")).toBe("modified");
    expect(result.current.directoryKinds.size).toBe(0);
  });

  it("exposes directory aggregation kinds for nested changed files", async () => {
    treeMock.mockResolvedValue({ nodes: treeNodes, signature: "t1" });
    changesMock.mockResolvedValue({
      files: [
        makeChangedFile("src/features/a.ts", "modified"),
        makeChangedFile("src/features/b.ts", "deleted"),
      ],
      signature: "c1",
    });

    const { result } = renderHook(() =>
      useCodeWorkspaceFileTree(1, "/tmp/redwhisk", true),
    );
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

  it("does not fetch when workspacePath is null", async () => {
    const { result } = renderHook(() =>
      useCodeWorkspaceFileTree(1, null, true),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(treeMock).not.toHaveBeenCalled();
    expect(changesMock).not.toHaveBeenCalled();
    expect(result.current.tree).toEqual([]);
    expect(result.current.changedFileKinds.size).toBe(0);
    expect(result.current.directoryKinds.size).toBe(0);
  });

  it("polls directory listing and change badges on separate intervals", async () => {
    treeMock.mockResolvedValue({ nodes: treeNodes, signature: "t1" });
    changesMock.mockResolvedValue({ files: [], signature: "c1" });

    renderHook(() => useCodeWorkspaceFileTree(1, "/tmp/redwhisk", true));
    await settle();
    expect(treeMock).toHaveBeenCalledTimes(1);
    expect(changesMock).toHaveBeenCalledTimes(1);

    // 目录 listing 每 10s：此时变更徽标（15s）还没到点，不应跟着一起拉。
    await vi.advanceTimersByTimeAsync(10_000);
    expect(treeMock).toHaveBeenCalledTimes(2);
    expect(changesMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(treeMock).toHaveBeenCalledTimes(2);
    expect(changesMock).toHaveBeenCalledTimes(2);
  });

  it("pauses polling while the document is hidden", async () => {
    treeMock.mockResolvedValue({ nodes: treeNodes, signature: "t1" });
    changesMock.mockResolvedValue({ files: [], signature: "c1" });

    renderHook(() => useCodeWorkspaceFileTree(1, "/tmp/redwhisk", true));
    await settle();

    act(() => setVisibility(false));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(treeMock).toHaveBeenCalledTimes(1);
    expect(changesMock).toHaveBeenCalledTimes(1);
  });

  it("pauses polling while the window is unfocused and refreshes on refocus", async () => {
    treeMock.mockResolvedValue({ nodes: treeNodes, signature: "t1" });
    changesMock.mockResolvedValue({ files: [], signature: "c1" });

    renderHook(() => useCodeWorkspaceFileTree(1, "/tmp/redwhisk", true));
    await settle();
    expect(treeMock).toHaveBeenCalledTimes(1);

    act(() => {
      windowMocks.focusListener?.({ payload: false });
    });
    await settle();

    // 失焦窗口不再按 10s / 15s 轮询，多窗口不再线性叠加 git 与 IPC。
    await vi.advanceTimersByTimeAsync(60_000);
    expect(treeMock).toHaveBeenCalledTimes(1);
    expect(changesMock).toHaveBeenCalledTimes(1);

    act(() => {
      windowMocks.focusListener?.({ payload: true });
    });
    await settle();

    // 重新聚焦立即补拉一次，并恢复定时器。
    expect(treeMock).toHaveBeenCalledTimes(2);
    expect(changesMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(treeMock).toHaveBeenCalledTimes(3);
  });

  it("updates the tree when the polled signature changes", async () => {
    treeMock.mockResolvedValue({ nodes: treeNodes, signature: "t1" });
    changesMock.mockResolvedValue({ files: [], signature: "c1" });

    const { result } = renderHook(() =>
      useCodeWorkspaceFileTree(1, "/tmp/redwhisk", true),
    );
    await settle();
    expect(result.current.tree).toEqual(treeNodes);

    const newTree: WorkspaceFileTreeNode[] = [
      {
        id: "a.ts",
        name: "a.ts",
        path: "a.ts",
        kind: "file",
        isIgnored: false,
      },
      {
        id: "c.ts",
        name: "c.ts",
        path: "c.ts",
        kind: "file",
        isIgnored: false,
      },
    ];
    treeMock.mockResolvedValue({ nodes: newTree, signature: "t2" });

    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    expect(result.current.tree).toEqual(newTree);
  });

  it("clears tree and badges when disabled", async () => {
    treeMock.mockResolvedValue({ nodes: treeNodes, signature: "t1" });
    changesMock.mockResolvedValue({
      files: [makeChangedFile("a.ts", "added")],
      signature: "c1",
    });

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useCodeWorkspaceFileTree(1, "/tmp/redwhisk", enabled),
      { initialProps: { enabled: true } },
    );
    await settle();
    expect(result.current.tree).toEqual(treeNodes);
    expect(result.current.changedFileKinds.size).toBe(1);

    rerender({ enabled: false });
    await settle();
    expect(result.current.tree).toEqual([]);
    expect(result.current.changedFileKinds.size).toBe(0);
    expect(result.current.directoryKinds.size).toBe(0);
  });

  it("shows loading on cold mount until the first tree response arrives", async () => {
    let resolveTree!: (value: {
      nodes: WorkspaceFileTreeNode[];
      signature: string;
    }) => void;
    treeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTree = resolve;
        }),
    );
    changesMock.mockResolvedValue({ files: [], signature: "c1" });

    const { result } = renderHook(() =>
      useCodeWorkspaceFileTree(1, "/tmp/redwhisk", true),
    );
    await settle();

    expect(result.current.tree).toEqual([]);
    expect(result.current.isTreeLoading).toBe(true);

    await act(async () => {
      resolveTree({ nodes: treeNodes, signature: "t1" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.tree).toEqual(treeNodes);
    expect(result.current.isTreeLoading).toBe(false);
  });

  it("hydrates cached tree and badges on remount without loading flash", async () => {
    treeMock.mockResolvedValue({ nodes: treeNodes, signature: "t1" });
    changesMock.mockResolvedValue({
      files: [makeChangedFile("a.ts", "added")],
      signature: "c1",
    });

    const first = renderHook(() =>
      useCodeWorkspaceFileTree(1, "/tmp/redwhisk", true),
    );
    await settle();
    first.unmount();

    treeMock.mockClear();
    changesMock.mockClear();
    treeMock.mockResolvedValue({ nodes: treeNodes, signature: "t1" });
    changesMock.mockResolvedValue({
      files: [makeChangedFile("a.ts", "added")],
      signature: "c1",
    });

    const second = renderHook(() =>
      useCodeWorkspaceFileTree(1, "/tmp/redwhisk", true),
    );

    expect(second.result.current.tree).toEqual(treeNodes);
    expect(second.result.current.changedFileKinds.get("a.ts")).toBe("added");
    expect(second.result.current.isTreeLoading).toBe(false);

    await settle();
    expect(treeMock).toHaveBeenCalledTimes(1);
    expect(changesMock).toHaveBeenCalledTimes(1);
    expect(second.result.current.isTreeLoading).toBe(false);
  });

  it("keeps the same tree identity when revalidate signature is unchanged", async () => {
    treeMock.mockResolvedValue({ nodes: treeNodes, signature: "t1" });
    changesMock.mockResolvedValue({ files: [], signature: "c1" });

    const { result } = renderHook(() =>
      useCodeWorkspaceFileTree(1, "/tmp/redwhisk", true),
    );
    await settle();
    const firstTree = result.current.tree;

    treeMock.mockResolvedValue({
      nodes: [
        {
          id: "a.ts",
          name: "a.ts",
          path: "a.ts",
          kind: "file",
          isIgnored: false,
        },
      ],
      signature: "t1",
    });

    await vi.advanceTimersByTimeAsync(10_000);
    await settle();

    expect(result.current.tree).toBe(firstTree);
    expect(treeMock).toHaveBeenCalledTimes(2);
  });

  it("silently replaces tree when signature changes without loading true", async () => {
    treeMock.mockResolvedValue({ nodes: treeNodes, signature: "t1" });
    changesMock.mockResolvedValue({ files: [], signature: "c1" });

    const { result } = renderHook(() =>
      useCodeWorkspaceFileTree(1, "/tmp/redwhisk", true),
    );
    await settle();

    const newTree: WorkspaceFileTreeNode[] = [
      ...treeNodes,
      {
        id: "c.ts",
        name: "c.ts",
        path: "c.ts",
        kind: "file",
        isIgnored: false,
      },
    ];
    treeMock.mockResolvedValue({ nodes: newTree, signature: "t2" });

    await vi.advanceTimersByTimeAsync(10_000);
    await settle();

    expect(result.current.tree).toEqual(newTree);
    expect(result.current.isTreeLoading).toBe(false);
  });

  it("does not show previous root nodes when switching to an uncached root", async () => {
    treeMock.mockImplementation(async ({ workspacePath }) => {
      if (workspacePath === "/tmp/a") {
        return { nodes: treeNodes, signature: "ta" };
      }
      await new Promise<void>(() => {
        // intentionally unresolved while we assert intermediate UI
      });
      return { nodes: treeNodesB, signature: "tb" };
    });
    changesMock.mockResolvedValue({ files: [], signature: "c1" });

    const { result, rerender } = renderHook(
      ({ path }: { path: string }) => useCodeWorkspaceFileTree(1, path, true),
      { initialProps: { path: "/tmp/a" } },
    );
    await settle();
    expect(result.current.tree).toEqual(treeNodes);

    rerender({ path: "/tmp/b" });
    await settle();

    expect(result.current.tree).toEqual([]);
    expect(result.current.isTreeLoading).toBe(true);
  });

  it("shows cached root immediately when switching back to a cached path", async () => {
    treeMock.mockImplementation(async ({ workspacePath }) => {
      if (workspacePath === "/tmp/a") {
        return { nodes: treeNodes, signature: "ta" };
      }
      return { nodes: treeNodesB, signature: "tb" };
    });
    changesMock.mockResolvedValue({ files: [], signature: "c1" });

    const { result, rerender } = renderHook(
      ({ path }: { path: string }) => useCodeWorkspaceFileTree(1, path, true),
      { initialProps: { path: "/tmp/a" } },
    );
    await settle();
    rerender({ path: "/tmp/b" });
    await settle();
    expect(result.current.tree).toEqual(treeNodesB);

    treeMock.mockClear();
    treeMock.mockImplementation(async ({ workspacePath }) => {
      if (workspacePath === "/tmp/a") {
        return { nodes: treeNodes, signature: "ta" };
      }
      return { nodes: treeNodesB, signature: "tb" };
    });

    rerender({ path: "/tmp/a" });

    expect(result.current.tree).toEqual(treeNodes);
    expect(result.current.isTreeLoading).toBe(false);

    await settle();
    expect(treeMock).toHaveBeenCalled();
  });

  it("keeps previous tree when revalidate fails", async () => {
    treeMock.mockResolvedValue({ nodes: treeNodes, signature: "t1" });
    changesMock.mockResolvedValue({ files: [], signature: "c1" });

    const { result } = renderHook(() =>
      useCodeWorkspaceFileTree(1, "/tmp/redwhisk", true),
    );
    await settle();
    expect(result.current.tree).toEqual(treeNodes);

    treeMock.mockRejectedValue(new Error("network down"));

    await vi.advanceTimersByTimeAsync(10_000);
    await settle();

    expect(result.current.tree).toEqual(treeNodes);
    expect(result.current.isTreeLoading).toBe(false);
  });

  it("isolates cases after cache reset", async () => {
    treeMock.mockResolvedValue({ nodes: treeNodes, signature: "t1" });
    changesMock.mockResolvedValue({ files: [], signature: "c1" });

    const first = renderHook(() =>
      useCodeWorkspaceFileTree(1, "/tmp/redwhisk", true),
    );
    await settle();
    first.unmount();

    resetCodeWorkspaceFileTreeCacheForTests();

    let resolveTree!: (value: {
      nodes: WorkspaceFileTreeNode[];
      signature: string;
    }) => void;
    treeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTree = resolve;
        }),
    );

    const second = renderHook(() =>
      useCodeWorkspaceFileTree(1, "/tmp/redwhisk", true),
    );
    await settle();

    expect(second.result.current.tree).toEqual([]);
    expect(second.result.current.isTreeLoading).toBe(true);

    await act(async () => {
      resolveTree({ nodes: treeNodes, signature: "t1" });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(second.result.current.tree).toEqual(treeNodes);
  });

  it("loads a directory layer on demand and attaches children", async () => {
    const rootNodes: WorkspaceFileTreeNode[] = [
      {
        id: "src",
        name: "src",
        path: "src",
        kind: "directory",
        isIgnored: false,
      },
    ];
    treeMock.mockResolvedValue({ nodes: rootNodes, signature: "t1" });
    changesMock.mockResolvedValue({ files: [], signature: "c1" });

    const { result } = renderHook(() =>
      useCodeWorkspaceFileTree(1, "/tmp/redwhisk", true),
    );
    await settle();
    expect(result.current.tree[0]?.children).toBeUndefined();

    const srcChildren: WorkspaceFileTreeNode[] = [
      {
        id: "src/main.ts",
        name: "main.ts",
        path: "src/main.ts",
        kind: "file",
        isIgnored: false,
      },
    ];
    treeMock.mockResolvedValue({ nodes: srcChildren, signature: "src1" });
    act(() => {
      result.current.loadDirectory("src");
    });
    await settle();

    expect(treeMock).toHaveBeenCalledWith({
      projectId: 1,
      workspacePath: "/tmp/redwhisk",
      directoryPath: "src",
    });
    expect(result.current.tree[0]?.children).toEqual(srcChildren);
  });

  it("does not refetch an already loaded directory until the next poll", async () => {
    treeMock.mockResolvedValue({ nodes: treeNodes, signature: "t1" });
    changesMock.mockResolvedValue({ files: [], signature: "c1" });

    const { result } = renderHook(() =>
      useCodeWorkspaceFileTree(1, "/tmp/redwhisk", true),
    );
    await settle();
    expect(treeMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.loadDirectory("");
    });
    await settle();
    expect(treeMock).toHaveBeenCalledTimes(1);
  });

  const srcDirectoryNodes: WorkspaceFileTreeNode[] = [
    {
      id: "src",
      name: "src",
      path: "src",
      kind: "directory",
      isIgnored: false,
    },
  ];

  const srcChildrenNodes: WorkspaceFileTreeNode[] = [
    {
      id: "src/main.ts",
      name: "main.ts",
      path: "src/main.ts",
      kind: "file",
      isIgnored: false,
    },
  ];

  it("retries a failed directory listing instead of leaving the folder empty", async () => {
    treeMock.mockResolvedValue({ nodes: srcDirectoryNodes, signature: "t1" });
    changesMock.mockResolvedValue({ files: [], signature: "c1" });

    const { result } = renderHook(() =>
      useCodeWorkspaceFileTree(1, "/tmp/redwhisk", true),
    );
    await settle();

    // 展开目录的拉取失败（并发争抢 / 超时）后，箭头已向下但子节点为空。
    treeMock.mockRejectedValueOnce(new Error("workspace read failed"));
    act(() => {
      result.current.loadDirectory("src");
    });
    await settle();
    expect(result.current.tree[0]?.children).toBeUndefined();

    // 按路径区分返回：轮询的根请求必须仍返回根节点，否则无法验证「失败目录被补拉」。
    treeMock.mockImplementation(async (input) =>
      input.directoryPath === "src"
        ? { nodes: srcChildrenNodes, signature: "src1" }
        : { nodes: srcDirectoryNodes, signature: "t1" },
    );

    await vi.advanceTimersByTimeAsync(10_000);
    await settle();

    // 轮询只重拉 listings 里已成功的目录，失败目录必须由重试表补回来。
    expect(result.current.tree[0]?.children).toEqual(srcChildrenNodes);
  });

  it("keeps a single in-flight request per directory", async () => {
    treeMock.mockResolvedValue({ nodes: srcDirectoryNodes, signature: "t1" });
    changesMock.mockResolvedValue({ files: [], signature: "c1" });

    const { result } = renderHook(() =>
      useCodeWorkspaceFileTree(1, "/tmp/redwhisk", true),
    );
    await settle();

    let resolveSrc!: (value: {
      nodes: WorkspaceFileTreeNode[];
      signature: string;
    }) => void;
    treeMock.mockImplementation((input) =>
      input.directoryPath === "src"
        ? new Promise((resolve) => {
            resolveSrc = resolve;
          })
        : Promise.resolve({ nodes: srcDirectoryNodes, signature: "t1" }),
    );
    treeMock.mockClear();

    const srcRequestCount = () =>
      treeMock.mock.calls.filter(([input]) => input.directoryPath === "src")
        .length;

    act(() => {
      result.current.loadDirectory("src");
    });
    act(() => {
      result.current.loadDirectory("src");
    });
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);

    // 重复触发与轮询都不能在同一个目录上叠加在途请求。
    expect(srcRequestCount()).toBe(1);

    await act(async () => {
      resolveSrc({ nodes: srcChildrenNodes, signature: "src1" });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.tree[0]?.children).toEqual(srcChildrenNodes);
  });
});
