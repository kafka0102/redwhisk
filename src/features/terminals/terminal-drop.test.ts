import { describe, expect, it } from "vitest";

import { formatDroppedPaths, isPositionInRect } from "./terminal-drop";

describe("formatDroppedPaths", () => {
  it("returns empty string for empty input", () => {
    expect(formatDroppedPaths([])).toBe("");
  });

  it("single quotes a plain path so the shell receives it verbatim", () => {
    expect(formatDroppedPaths(["/Users/me/code/app.ts"])).toBe(
      "'/Users/me/code/app.ts'",
    );
  });

  it("joins multiple paths with a single space", () => {
    expect(formatDroppedPaths(["/a.txt", "/b.txt"])).toBe("'/a.txt' '/b.txt'");
  });

  it("escapes embedded single quotes (POSIX shell-safe) so spaces still hold", () => {
    // it's a dir -> '/...it'\''s a dir' reconstructs the literal in any POSIX shell
    expect(formatDroppedPaths(["/Users/me/it's a dir"])).toBe(
      "'/Users/me/it'\\''s a dir'",
    );
  });

  it("keeps spaces inside a path as part of one shell word", () => {
    expect(formatDroppedPaths(["/Users/me/my project/file.txt"])).toBe(
      "'/Users/me/my project/file.txt'",
    );
  });
});

describe("isPositionInRect", () => {
  const rect = {
    left: 10,
    top: 20,
    right: 110,
    bottom: 70,
    width: 100,
    height: 50,
  };

  it("hits when the CSS-equivalent point is inside the rect", () => {
    // physical 60,40 with dpr 2 -> css 30,20 which is inside [10,110)x[20,70)
    expect(isPositionInRect(60, 40, rect, 2)).toBe(true);
  });

  it("misses when the point is outside the rect", () => {
    // physical 400,40 with dpr 2 -> css 200,20 -> x outside [10,110)
    expect(isPositionInRect(400, 40, rect, 2)).toBe(false);
  });

  it("treats dpr 1 as identity (physical == css)", () => {
    expect(isPositionInRect(50, 30, rect, 1)).toBe(true);
  });

  it("returns false on non-positive devicePixelRatio to avoid divide-by-zero ambiguity", () => {
    expect(isPositionInRect(50, 30, rect, 0)).toBe(false);
  });

  it("excludes the bottom/right edge (half-open rect)", () => {
    // css x = 110 is right edge -> not inside
    expect(isPositionInRect(110, 30, rect, 1)).toBe(false);
  });
});
