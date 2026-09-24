import { describe, expect, it } from "vitest";

import {
  computeDiffHunks,
  DEFAULT_HUNK_CONTEXT_LINES,
  MAX_HUNK_EDIT_DISTANCE,
} from "./diff-hunks";

function lineList(count: number, prefix = "l"): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);
}

function lines(count: number, prefix = "l"): string {
  return lineList(count, prefix).join("\n");
}

/** 按行号（从 1 开始）替换若干行，生成「改后」文本。 */
function withReplacedLines(
  source: string[],
  replacements: Record<number, string>,
): string[] {
  return source.map((line, index) => replacements[index + 1] ?? line);
}

describe("computeDiffHunks", () => {
  it("returns no hunk when both sides are identical", () => {
    expect(computeDiffHunks("a\nb\nc\n", "a\nb\nc\n")).toEqual([]);
  });

  it("keeps three context lines around a single replaced line", () => {
    expect(
      computeDiffHunks(
        "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\n",
        "l1\nl2\nl3\nl4\nL5\nl6\nl7\nl8\nl9\n",
      ),
    ).toEqual([
      {
        oldStart: 2,
        oldCount: 7,
        newStart: 2,
        newCount: 7,
        lines: [
          { kind: "context", oldLineNumber: 2, newLineNumber: 2, text: "l2" },
          { kind: "context", oldLineNumber: 3, newLineNumber: 3, text: "l3" },
          { kind: "context", oldLineNumber: 4, newLineNumber: 4, text: "l4" },
          {
            kind: "removed",
            oldLineNumber: 5,
            newLineNumber: null,
            text: "l5",
          },
          { kind: "added", oldLineNumber: null, newLineNumber: 5, text: "L5" },
          { kind: "context", oldLineNumber: 6, newLineNumber: 6, text: "l6" },
          { kind: "context", oldLineNumber: 7, newLineNumber: 7, text: "l7" },
          { kind: "context", oldLineNumber: 8, newLineNumber: 8, text: "l8" },
        ],
      },
    ]);
  });

  it("defaults to three context lines", () => {
    expect(DEFAULT_HUNK_CONTEXT_LINES).toBe(3);
  });

  it("marks a single inserted line with a new line number only", () => {
    expect(
      computeDiffHunks(
        "l1\nl2\nl3\nl4\nl5\nl6\n",
        "l1\nl2\nl3\nINSERT\nl4\nl5\nl6\n",
      ),
    ).toEqual([
      {
        oldStart: 1,
        oldCount: 6,
        newStart: 1,
        newCount: 7,
        lines: [
          { kind: "context", oldLineNumber: 1, newLineNumber: 1, text: "l1" },
          { kind: "context", oldLineNumber: 2, newLineNumber: 2, text: "l2" },
          { kind: "context", oldLineNumber: 3, newLineNumber: 3, text: "l3" },
          {
            kind: "added",
            oldLineNumber: null,
            newLineNumber: 4,
            text: "INSERT",
          },
          { kind: "context", oldLineNumber: 4, newLineNumber: 5, text: "l4" },
          { kind: "context", oldLineNumber: 5, newLineNumber: 6, text: "l5" },
          { kind: "context", oldLineNumber: 6, newLineNumber: 7, text: "l6" },
        ],
      },
    ]);
  });

  it("marks a single deleted line with an old line number only", () => {
    expect(
      computeDiffHunks("l1\nl2\nl3\nl4\nl5\nl6\n", "l1\nl2\nl4\nl5\nl6\n"),
    ).toEqual([
      {
        oldStart: 1,
        oldCount: 6,
        newStart: 1,
        newCount: 5,
        lines: [
          { kind: "context", oldLineNumber: 1, newLineNumber: 1, text: "l1" },
          { kind: "context", oldLineNumber: 2, newLineNumber: 2, text: "l2" },
          {
            kind: "removed",
            oldLineNumber: 3,
            newLineNumber: null,
            text: "l3",
          },
          { kind: "context", oldLineNumber: 4, newLineNumber: 3, text: "l4" },
          { kind: "context", oldLineNumber: 5, newLineNumber: 4, text: "l5" },
          { kind: "context", oldLineNumber: 6, newLineNumber: 5, text: "l6" },
        ],
      },
    ]);
  });

  it("merges two changes separated by fewer than six unchanged lines", () => {
    const originalLines = lineList(12);
    const original = originalLines.join("\n");
    const modified = withReplacedLines(originalLines, {
      3: "L3",
      9: "L9",
    }).join("\n");

    // 两处改动之间只隔 l4..l8 五行，合并为一个 hunk：l1..l12 全在窗口内。
    const hunks = computeDiffHunks(original, modified);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].oldStart).toBe(1);
    expect(hunks[0].oldCount).toBe(12);
    expect(hunks[0].newCount).toBe(12);
    expect(hunks[0].lines.map((line) => line.kind)).toEqual([
      "context",
      "context",
      "removed",
      "added",
      "context",
      "context",
      "context",
      "context",
      "context",
      "removed",
      "added",
      "context",
      "context",
      "context",
    ]);
  });

  it("splits two changes separated by six unchanged lines", () => {
    const originalLines = lineList(13);
    const original = originalLines.join("\n");
    const modified = withReplacedLines(originalLines, {
      3: "L3",
      10: "L10",
    }).join("\n");

    const hunks = computeDiffHunks(original, modified);
    expect(
      hunks.map((hunk) => [hunk.oldStart, hunk.oldCount, hunk.newCount]),
    ).toEqual([
      [1, 6, 6],
      [7, 7, 7],
    ]);
    expect(hunks[0].lines[hunks[0].lines.length - 1]).toEqual({
      kind: "context",
      oldLineNumber: 6,
      newLineNumber: 6,
      text: "l6",
    });
    expect(hunks[1].lines[0]).toEqual({
      kind: "context",
      oldLineNumber: 7,
      newLineNumber: 7,
      text: "l7",
    });
  });

  it("clamps context at the file head and tail", () => {
    const original = lines(6);
    const modified = original.replace("l1\n", "L1\n").replace("l6", "L6");

    const hunks = computeDiffHunks(original, modified);
    expect(hunks).toEqual([
      {
        oldStart: 1,
        oldCount: 6,
        newStart: 1,
        newCount: 6,
        lines: [
          {
            kind: "removed",
            oldLineNumber: 1,
            newLineNumber: null,
            text: "l1",
          },
          { kind: "added", oldLineNumber: null, newLineNumber: 1, text: "L1" },
          { kind: "context", oldLineNumber: 2, newLineNumber: 2, text: "l2" },
          { kind: "context", oldLineNumber: 3, newLineNumber: 3, text: "l3" },
          { kind: "context", oldLineNumber: 4, newLineNumber: 4, text: "l4" },
          { kind: "context", oldLineNumber: 5, newLineNumber: 5, text: "l5" },
          {
            kind: "removed",
            oldLineNumber: 6,
            newLineNumber: null,
            text: "l6",
          },
          { kind: "added", oldLineNumber: null, newLineNumber: 6, text: "L6" },
        ],
      },
    ]);
  });

  it("renders an added file as one hunk with new-side line numbers only", () => {
    expect(computeDiffHunks("", "a\nb\nc\n")).toEqual([
      {
        oldStart: 1,
        oldCount: 0,
        newStart: 1,
        newCount: 3,
        lines: [
          { kind: "added", oldLineNumber: null, newLineNumber: 1, text: "a" },
          { kind: "added", oldLineNumber: null, newLineNumber: 2, text: "b" },
          { kind: "added", oldLineNumber: null, newLineNumber: 3, text: "c" },
        ],
      },
    ]);
  });

  it("renders a deleted file as one hunk with old-side line numbers only", () => {
    expect(computeDiffHunks("a\nb\nc\n", "")).toEqual([
      {
        oldStart: 1,
        oldCount: 3,
        newStart: 1,
        newCount: 0,
        lines: [
          { kind: "removed", oldLineNumber: 1, newLineNumber: null, text: "a" },
          { kind: "removed", oldLineNumber: 2, newLineNumber: null, text: "b" },
          { kind: "removed", oldLineNumber: 3, newLineNumber: null, text: "c" },
        ],
      },
    ]);
  });

  it("keeps a one-line change as a single-line hunk", () => {
    expect(computeDiffHunks("only", "ONLY")).toEqual([
      {
        oldStart: 1,
        oldCount: 1,
        newStart: 1,
        newCount: 1,
        lines: [
          {
            kind: "removed",
            oldLineNumber: 1,
            newLineNumber: null,
            text: "only",
          },
          {
            kind: "added",
            oldLineNumber: null,
            newLineNumber: 1,
            text: "ONLY",
          },
        ],
      },
    ]);
  });

  it("ignores a missing trailing newline", () => {
    expect(computeDiffHunks("a\nb", "a\nb\n")).toEqual([]);
    expect(computeDiffHunks("a\nb\nc", "a\nb\nC")).toHaveLength(1);
  });

  it("ignores CRLF versus LF differences", () => {
    expect(computeDiffHunks("a\r\nb\r\nc\r\n", "a\nb\nc\n")).toEqual([]);
    expect(computeDiffHunks("a\r\nb\r\nc\r\n", "a\r\nB\r\nc\r\n")).toEqual([
      {
        oldStart: 1,
        oldCount: 3,
        newStart: 1,
        newCount: 3,
        lines: [
          { kind: "context", oldLineNumber: 1, newLineNumber: 1, text: "a" },
          { kind: "removed", oldLineNumber: 2, newLineNumber: null, text: "b" },
          { kind: "added", oldLineNumber: null, newLineNumber: 2, text: "B" },
          { kind: "context", oldLineNumber: 3, newLineNumber: 3, text: "c" },
        ],
      },
    ]);
  });

  it("falls back to a whole-segment replacement for very large rewrites", () => {
    const count = MAX_HUNK_EDIT_DISTANCE;
    const original = lines(count, "old");
    const modified = lines(count, "new");

    const hunks = computeDiffHunks(original, modified);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines).toHaveLength(count * 2);
    expect(hunks[0].lines[0]).toEqual({
      kind: "removed",
      oldLineNumber: 1,
      newLineNumber: null,
      text: "old1",
    });
    expect(hunks[0].lines[count]).toEqual({
      kind: "added",
      oldLineNumber: null,
      newLineNumber: 1,
      text: "new1",
    });
    expect(hunks[0].lines[count * 2 - 1]).toEqual({
      kind: "added",
      oldLineNumber: null,
      newLineNumber: count,
      text: `new${count}`,
    });
  });
});
