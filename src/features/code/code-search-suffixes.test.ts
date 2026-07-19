import { describe, expect, it } from "vitest";

import type { WorkspaceFileTreeNode } from "../../shared/workspace/workspace-commands";
import {
  appendFilterTags,
  collectTopFileSuffixes,
  parseFilterTagInput,
  suffixToIncludeGlob,
} from "./code-search-suffixes";

function file(path: string, name: string): WorkspaceFileTreeNode {
  return {
    id: path,
    name,
    path,
    kind: "file",
    isIgnored: false,
  };
}

function dir(
  path: string,
  name: string,
  children: WorkspaceFileTreeNode[],
): WorkspaceFileTreeNode {
  return {
    id: path,
    name,
    path,
    kind: "directory",
    isIgnored: false,
    children,
  };
}

describe("collectTopFileSuffixes", () => {
  it("returns empty for empty tree", () => {
    expect(collectTopFileSuffixes([])).toEqual([]);
  });

  it("aggregates nested file suffixes case-insensitively", () => {
    const tree = [
      dir("src", "src", [
        file("src/a.ts", "a.ts"),
        file("src/b.TS", "b.TS"),
        file("src/c.js", "c.js"),
      ]),
      file("readme.md", "readme.md"),
    ];
    expect(collectTopFileSuffixes(tree)).toEqual(["ts", "js", "md"]);
  });

  it("prioritizes code-like suffixes over more frequent non-code ones", () => {
    const tree = [
      file("a.md", "a.md"),
      file("b.md", "b.md"),
      file("c.md", "c.md"),
      file("d.md", "d.md"),
      file("e.md", "e.md"),
      file("f.json", "f.json"),
      file("g.json", "g.json"),
      file("h.json", "h.json"),
      file("i.ts", "i.ts"),
      file("j.rs", "j.rs"),
    ];
    const top = collectTopFileSuffixes(tree, 3);
    expect(top).toEqual(["rs", "ts", "md"]);
  });

  it("limits to top 8 by default", () => {
    const tree = Array.from({ length: 12 }, (_, index) =>
      file(`f${index}.e${index}`, `f${index}.e${index}`),
    );
    // e0.. are not code-like; still caps at 8.
    expect(collectTopFileSuffixes(tree)).toHaveLength(8);
  });

  it("skips extensionless and dotfiles without real extensions", () => {
    const tree = [
      file("Makefile", "Makefile"),
      file(".gitignore", ".gitignore"),
      file("src/a.ts", "a.ts"),
    ];
    expect(collectTopFileSuffixes(tree)).toEqual(["ts"]);
  });
});

describe("suffixToIncludeGlob", () => {
  it("builds **/*.<suffix> from bare or dotted suffix", () => {
    expect(suffixToIncludeGlob("ts")).toBe("**/*.ts");
    expect(suffixToIncludeGlob(".TS")).toBe("**/*.ts");
  });
});

describe("parseFilterTagInput / appendFilterTags", () => {
  it("splits on commas and trims", () => {
    expect(parseFilterTagInput(" *.ts, src/** ，docs/** ")).toEqual([
      "*.ts",
      "src/**",
      "docs/**",
    ]);
  });

  it("appends unique tags in order", () => {
    expect(
      appendFilterTags(["**/*.ts"], ["**/*.ts", "**/*.rs", "src/**"]),
    ).toEqual(["**/*.ts", "**/*.rs", "src/**"]);
  });
});
