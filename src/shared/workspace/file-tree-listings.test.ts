import { describe, expect, it, vi } from "vitest";

import {
  ROOT_FILE_TREE_DIRECTORY,
  assembleFileTree,
  fileTreeChildrenAccessor,
  fileTreeDirectoryAncestors,
  fileTreeDirectoryPathsToLoad,
  normalizeFileTreeDirectoryPath,
  parentFileTreeDirectory,
  upsertFileTreeListing,
  visitFileTreeAncestorDirectories,
  type FileTreeDirectoryListing,
} from "./file-tree-listings";
import type { WorkspaceFileTreeNode } from "./workspace-commands";

function fileNode(path: string): WorkspaceFileTreeNode {
  const name = path.split("/").pop() ?? path;
  return {
    id: path,
    name,
    path,
    kind: "file",
    isIgnored: false,
  };
}

function dirNode(path: string): WorkspaceFileTreeNode {
  const name = path.split("/").pop() ?? path;
  return {
    id: path,
    name,
    path,
    kind: "directory",
    isIgnored: false,
  };
}

function listing(
  nodes: WorkspaceFileTreeNode[],
  signature: string,
): FileTreeDirectoryListing {
  return { nodes, signature };
}

describe("file-tree-listings", () => {
  it("normalizes blank and dotted paths to the root key", () => {
    expect(normalizeFileTreeDirectoryPath(null)).toBe(ROOT_FILE_TREE_DIRECTORY);
    expect(normalizeFileTreeDirectoryPath("")).toBe(ROOT_FILE_TREE_DIRECTORY);
    expect(normalizeFileTreeDirectoryPath(".")).toBe(ROOT_FILE_TREE_DIRECTORY);
    expect(normalizeFileTreeDirectoryPath(" /src/ ")).toBe("src");
  });

  it("builds ancestor directory paths from the root down", () => {
    expect(fileTreeDirectoryAncestors("")).toEqual([]);
    expect(fileTreeDirectoryAncestors("src")).toEqual(["src"]);
    expect(fileTreeDirectoryAncestors("src/features/code")).toEqual([
      "src",
      "src/features",
      "src/features/code",
    ]);
  });

  it("visits parent directories of a file path", () => {
    const visit = vi.fn();
    visitFileTreeAncestorDirectories("src/features/a.ts", visit);
    expect(visit.mock.calls.map((call) => call[0])).toEqual([
      "src",
      "src/features",
    ]);
    visit.mockClear();
    visitFileTreeAncestorDirectories("README.md", visit);
    expect(visit).not.toHaveBeenCalled();
  });

  it("returns the parent directory of a file path", () => {
    expect(parentFileTreeDirectory("src/a.ts")).toBe("src");
    expect(parentFileTreeDirectory("a.ts")).toBe(ROOT_FILE_TREE_DIRECTORY);
  });

  it("assembles only loaded directory layers", () => {
    const listings = {
      [ROOT_FILE_TREE_DIRECTORY]: listing(
        [dirNode("src"), fileNode("README.md")],
        "root",
      ),
      src: listing([dirNode("src/features"), fileNode("src/main.ts")], "src"),
    };
    const tree = assembleFileTree(listings);
    expect(tree.map((node) => node.path)).toEqual(["src", "README.md"]);
    const src = tree[0];
    expect(src.children?.map((node) => node.path)).toEqual([
      "src/features",
      "src/main.ts",
    ]);
    expect(src.children?.[0]?.children).toBeUndefined();
  });

  it("keeps the same listings object when the signature is unchanged", () => {
    const current = {
      [ROOT_FILE_TREE_DIRECTORY]: listing([fileNode("a.ts")], "sig"),
    };
    const next = upsertFileTreeListing(current, "", {
      nodes: [fileNode("b.ts")],
      signature: "sig",
    });
    expect(next).toBe(current);
  });

  it("treats directories as expandable even before children load", () => {
    expect(fileTreeChildrenAccessor(fileNode("a.ts"))).toBeNull();
    expect(fileTreeChildrenAccessor(dirNode("src"))).toEqual([]);
    expect(
      fileTreeChildrenAccessor({
        ...dirNode("src"),
        children: [fileNode("src/a.ts")],
      }),
    ).toEqual([fileNode("src/a.ts")]);
  });

  it("does not recurse when a listing repeats its own directory node", () => {
    const src = dirNode("src");
    const listings = {
      [ROOT_FILE_TREE_DIRECTORY]: listing([src], "root"),
      src: listing([src], "src-as-root-shape"),
    };
    const tree = assembleFileTree(listings);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.path).toBe("src");
    expect(tree[0]?.children?.[0]?.path).toBe("src");
    expect(tree[0]?.children?.[0]?.children).toBeUndefined();
  });

  it("refreshes root when no listings exist yet", () => {
    expect(fileTreeDirectoryPathsToLoad({})).toEqual([
      ROOT_FILE_TREE_DIRECTORY,
    ]);
    expect(
      fileTreeDirectoryPathsToLoad({
        [ROOT_FILE_TREE_DIRECTORY]: listing([], "root"),
        src: listing([], "src"),
      }),
    ).toEqual([ROOT_FILE_TREE_DIRECTORY, "src"]);
  });
});
