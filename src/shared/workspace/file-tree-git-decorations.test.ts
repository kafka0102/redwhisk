import { describe, expect, it } from "vitest";

import { buildFileTreeDecorations } from "./file-tree-git-decorations";
import type { WorkspaceChangeKind } from "./workspace-commands";

function entry(
  filePath: string,
  kind: WorkspaceChangeKind,
): { filePath: string; kind: WorkspaceChangeKind } {
  return { filePath, kind };
}

describe("buildFileTreeDecorations", () => {
  it("returns stable empty maps for empty input", () => {
    const first = buildFileTreeDecorations([]);
    const second = buildFileTreeDecorations([]);

    expect(first.fileKinds.size).toBe(0);
    expect(first.directoryKinds.size).toBe(0);
    expect(first.fileKinds).toBe(second.fileKinds);
    expect(first.directoryKinds).toBe(second.directoryKinds);
  });

  it("maps each file path to its original kind", () => {
    const result = buildFileTreeDecorations([
      entry("src/a.ts", "modified"),
      entry("src/b.ts", "added"),
      entry("deleted.ts", "deleted"),
      entry("new-name.ts", "renamed"),
      entry("copy.ts", "copied"),
      entry("bin.dat", "binary"),
      entry("loose.txt", "untracked"),
    ]);

    expect(result.fileKinds.get("src/a.ts")).toBe("modified");
    expect(result.fileKinds.get("src/b.ts")).toBe("added");
    expect(result.fileKinds.get("deleted.ts")).toBe("deleted");
    expect(result.fileKinds.get("new-name.ts")).toBe("renamed");
    expect(result.fileKinds.get("copy.ts")).toBe("copied");
    expect(result.fileKinds.get("bin.dat")).toBe("binary");
    expect(result.fileKinds.get("loose.txt")).toBe("untracked");
  });

  it("does not decorate oldPath for renames", () => {
    const result = buildFileTreeDecorations([
      {
        filePath: "src/new.ts",
        kind: "renamed",
        // oldPath is intentionally ignored even if present on a wider input shape
      },
    ]);

    expect(result.fileKinds.get("src/new.ts")).toBe("renamed");
    expect(result.fileKinds.has("src/old.ts")).toBe(false);
    expect(result.directoryKinds.get("src")).toBe("modified");
  });

  it("derives ancestor directory paths from filePath prefixes", () => {
    const result = buildFileTreeDecorations([
      entry("src/features/code/a.ts", "modified"),
    ]);

    expect(result.directoryKinds.get("src")).toBe("modified");
    expect(result.directoryKinds.get("src/features")).toBe("modified");
    expect(result.directoryKinds.get("src/features/code")).toBe("modified");
    expect(result.directoryKinds.has("src/features/code/a.ts")).toBe(false);
  });

  it("aggregates directory kinds with priority D > M > A/untracked", () => {
    const result = buildFileTreeDecorations([
      entry("pkg/added.ts", "added"),
      entry("pkg/untracked.ts", "untracked"),
      entry("pkg/modified.ts", "modified"),
      entry("pkg/deleted.ts", "deleted"),
    ]);

    expect(result.directoryKinds.get("pkg")).toBe("deleted");

    const modifiedWinsOverAdded = buildFileTreeDecorations([
      entry("pkg/added.ts", "added"),
      entry("pkg/modified.ts", "modified"),
    ]);
    expect(modifiedWinsOverAdded.directoryKinds.get("pkg")).toBe("modified");

    const addedOnly = buildFileTreeDecorations([
      entry("pkg/added.ts", "added"),
      entry("pkg/untracked.ts", "untracked"),
    ]);
    expect(addedOnly.directoryKinds.get("pkg")).toBe("added");
  });

  it("treats renamed and copied as M for directory aggregation", () => {
    const renamed = buildFileTreeDecorations([
      entry("pkg/new.ts", "renamed"),
      entry("pkg/added.ts", "added"),
    ]);
    expect(renamed.directoryKinds.get("pkg")).toBe("modified");

    const copied = buildFileTreeDecorations([
      entry("pkg/copy.ts", "copied"),
      entry("pkg/added.ts", "untracked"),
    ]);
    expect(copied.directoryKinds.get("pkg")).toBe("modified");

    const deletedWins = buildFileTreeDecorations([
      entry("pkg/new.ts", "renamed"),
      entry("pkg/gone.ts", "deleted"),
    ]);
    expect(deletedWins.directoryKinds.get("pkg")).toBe("deleted");
  });

  it("aggregates nested prefixes independently by their subtree", () => {
    const result = buildFileTreeDecorations([
      entry("src/a/x.ts", "deleted"),
      entry("src/b/y.ts", "added"),
    ]);

    expect(result.directoryKinds.get("src/a")).toBe("deleted");
    expect(result.directoryKinds.get("src/b")).toBe("added");
    expect(result.directoryKinds.get("src")).toBe("deleted");
  });

  it("does not invent directory entries for root-level files only", () => {
    const result = buildFileTreeDecorations([entry("root.ts", "modified")]);

    expect(result.fileKinds.get("root.ts")).toBe("modified");
    expect(result.directoryKinds.size).toBe(0);
  });
});
