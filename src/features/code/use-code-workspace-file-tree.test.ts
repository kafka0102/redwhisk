import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  WorkspaceChangedFile,
  WorkspaceFileTreeNode,
} from "../../shared/workspace/workspace-commands";
import { useCodeWorkspaceFileTree } from "./use-code-workspace-file-tree";

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
    setVisibility(true);
  });

  afterEach(() => {
    vi.useRealTimers();
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
  });
});
