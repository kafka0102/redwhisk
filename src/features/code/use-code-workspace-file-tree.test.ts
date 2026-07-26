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

  it("polls tree and changes every 5s while visible", async () => {
    treeMock.mockResolvedValue({ nodes: treeNodes, signature: "t1" });
    changesMock.mockResolvedValue({ files: [], signature: "c1" });

    renderHook(() => useCodeWorkspaceFileTree(1, "/tmp/redwhisk", true));
    await settle();
    expect(treeMock).toHaveBeenCalledTimes(1);
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

    await vi.advanceTimersByTimeAsync(5_000);
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

    await vi.advanceTimersByTimeAsync(5_000);
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

    await vi.advanceTimersByTimeAsync(5_000);
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

    await vi.advanceTimersByTimeAsync(5_000);
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
});
