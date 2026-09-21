import { describe, expect, it } from "vitest";

import {
  buildFileTreeDraftNode,
  buildFileTreeDraftNodeId,
  buildFileTreeEntryPath,
  getFileTreeEntryNameError,
  insertFileTreeDraftNode,
  isFileTreeDraftNodeId,
} from "./file-tree-create-draft";
import type { WorkspaceFileTreeNode } from "./workspace-commands";

const tree: WorkspaceFileTreeNode[] = [
  {
    id: "src",
    name: "src",
    path: "src",
    kind: "directory",
    isIgnored: false,
    children: [
      {
        id: "src/a.ts",
        name: "a.ts",
        path: "src/a.ts",
        kind: "file",
        isIgnored: false,
      },
    ],
  },
  {
    id: "readme.md",
    name: "readme.md",
    path: "readme.md",
    kind: "file",
    isIgnored: false,
  },
  {
    id: "docs",
    name: "docs",
    path: "docs",
    kind: "directory",
    isIgnored: false,
  },
];

function draftFile(): WorkspaceFileTreeNode {
  return buildFileTreeDraftNode({ directoryPath: "src", kind: "file" });
}

describe("file tree create draft", () => {
  it("inserts the draft node in front of the target directory children", () => {
    const draft = draftFile();

    const next = insertFileTreeDraftNode(tree, "src", draft);

    const srcNode = next[0];
    expect(srcNode.children?.map((node) => node.id)).toEqual([
      draft.id,
      "src/a.ts",
    ]);
    // 原数据不可变：草稿节点只存在于派生的树数据里。
    expect(tree[0].children?.map((node) => node.id)).toEqual(["src/a.ts"]);
    expect(next).not.toBe(tree);
  });

  it("inserts the draft node into a directory whose children are not loaded", () => {
    const draft = draftFile();

    const next = insertFileTreeDraftNode(tree, "docs", draft);

    expect(next[2].children?.map((node) => node.id)).toEqual([draft.id]);
  });

  it("inserts the draft node at the first position of the tree for the code root", () => {
    const draft = draftFile();

    const next = insertFileTreeDraftNode(tree, "", draft);
    const normalized = insertFileTreeDraftNode(tree, ".", draft);

    expect(next[0]).toBe(draft);
    expect(next).toHaveLength(tree.length + 1);
    expect(normalized[0]).toBe(draft);
  });

  it("keeps the tree content when the target directory is missing", () => {
    const next = insertFileTreeDraftNode(tree, "missing", draftFile());

    expect(
      next.map((node) => ({
        children: node.children?.map((child) => child.id),
        id: node.id,
      })),
    ).toEqual([
      { children: ["src/a.ts"], id: "src" },
      { children: undefined, id: "readme.md" },
      { children: undefined, id: "docs" },
    ]);
  });

  it("builds the workspace relative creation path from the target directory", () => {
    expect(buildFileTreeEntryPath("src", "new.ts")).toBe("src/new.ts");
    expect(buildFileTreeEntryPath("", "new.ts")).toBe("new.ts");
    expect(buildFileTreeEntryPath(".", "new.ts")).toBe("new.ts");
    expect(buildFileTreeEntryPath("/src/nested/", "new.ts")).toBe(
      "src/nested/new.ts",
    );
  });

  it("rejects empty, dot, dot-dot and slash names", () => {
    expect(getFileTreeEntryNameError("")).toBe("empty");
    expect(getFileTreeEntryNameError("   ")).toBe("empty");
    expect(getFileTreeEntryNameError(".")).toBe("invalidName");
    expect(getFileTreeEntryNameError("..")).toBe("invalidName");
    expect(getFileTreeEntryNameError("a/b.ts")).toBe("invalidName");

    expect(getFileTreeEntryNameError("new.ts")).toBeNull();
    expect(getFileTreeEntryNameError(" new folder ")).toBeNull();
    expect(getFileTreeEntryNameError("a.b.ts")).toBeNull();
  });

  it("builds distinguishable sentinel ids per target and kind", () => {
    const fileDraft = buildFileTreeDraftNode({
      directoryPath: "src",
      kind: "file",
    });
    const directoryDraft = buildFileTreeDraftNode({
      directoryPath: "src",
      kind: "directory",
    });
    const nestedDraft = buildFileTreeDraftNode({
      directoryPath: "src/nested",
      kind: "file",
    });

    expect(isFileTreeDraftNodeId(fileDraft.id)).toBe(true);
    expect(isFileTreeDraftNodeId(directoryDraft.id)).toBe(true);
    expect(
      new Set([fileDraft.id, directoryDraft.id, nestedDraft.id]).size,
    ).toBe(3);
    expect(fileDraft.id).toBe(buildFileTreeDraftNodeId("file", "src"));
    expect(isFileTreeDraftNodeId("src/a.ts")).toBe(false);
  });
});
