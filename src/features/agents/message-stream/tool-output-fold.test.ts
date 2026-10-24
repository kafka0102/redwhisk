import { describe, expect, it } from "vitest";

import {
  countTextLines,
  isFoldableToolDiff,
  isFoldableToolOutput,
} from "./tool-output-fold";

/** 拼接出指定行数的文本，每行 1 个字符。 */
function textWithLines(lines: number): string {
  return Array.from({ length: lines }, () => "a").join("\n");
}

describe("countTextLines", () => {
  it("空文本按 0 行计", () => {
    expect(countTextLines("")).toBe(0);
  });

  it("按换行切分且末行换行不额外计一行", () => {
    expect(countTextLines("a")).toBe(1);
    expect(countTextLines("a\nb")).toBe(2);
    expect(countTextLines("a\nb\n")).toBe(2);
    expect(countTextLines("\n")).toBe(1);
  });

  it("CRLF 换行计为一行", () => {
    expect(countTextLines("a\r\nb\r\n")).toBe(2);
  });
});

describe("isFoldableToolOutput", () => {
  it("40 行以内不折叠", () => {
    expect(isFoldableToolOutput(textWithLines(40))).toBe(false);
  });

  it("超过 40 行折叠", () => {
    expect(isFoldableToolOutput(textWithLines(41))).toBe(true);
  });

  it("4000 字符以内不折叠", () => {
    expect(isFoldableToolOutput("a".repeat(4000))).toBe(false);
  });

  it("超过 4000 字符折叠", () => {
    expect(isFoldableToolOutput("a".repeat(4001))).toBe(true);
  });
});

describe("isFoldableToolDiff", () => {
  it("120 行以内不折叠", () => {
    expect(isFoldableToolDiff(textWithLines(120))).toBe(false);
  });

  it("超过 120 行折叠", () => {
    expect(isFoldableToolDiff(textWithLines(121))).toBe(true);
  });
});
