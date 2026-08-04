import { describe, expect, it } from "vitest";

import { deltaToMarkdown, markdownToDelta } from "./rich-text-editor-markdown";

describe("markdownToDelta ordered list heuristics", () => {
  it("keeps an isolated non-1 numbered line as literal text", () => {
    const { ops } = markdownToDelta(
      "4. 加深「列表搜索 / 写权限」共享 module",
      [],
    );

    expect(ops).toEqual([
      { insert: "4. 加深「列表搜索 / 写权限」共享 module" },
      { insert: "\n" },
    ]);
    expect(deltaToMarkdown(ops, [])).toBe(
      "4. 加深「列表搜索 / 写权限」共享 module",
    );
  });

  it("still parses an isolated 1. line as an ordered list item", () => {
    const { ops } = markdownToDelta("1. first item", []);

    expect(ops).toEqual([
      { insert: "first item" },
      { insert: "\n", attributes: { list: "ordered" } },
    ]);
  });

  it("parses consecutive numbered lines as an ordered list block", () => {
    const { ops } = markdownToDelta("2. alpha\n3. beta", []);

    expect(ops).toEqual([
      { insert: "alpha" },
      { insert: "\n", attributes: { list: "ordered" } },
      { insert: "beta" },
      { insert: "\n", attributes: { list: "ordered" } },
    ]);
  });

  it("does not treat numbered lines inside fenced code as lists", () => {
    const { ops } = markdownToDelta("```\n4. code line\n```", []);

    expect(ops).toEqual([
      { insert: "4. code line" },
      { insert: "\n", attributes: { "code-block": true } },
    ]);
  });
});
