import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("issue sync status tone", () => {
  const css = readFileSync(
    resolve(process.cwd(), "src/shared/styles/issues-board.css"),
    "utf8",
  );
  const tokens = readFileSync(
    resolve(process.cwd(), "src/shared/styles/tokens.css"),
    "utf8",
  );

  it("paints the success dot with the green review marker", () => {
    const rule = ruleBodyFor(
      css,
      '.issue-sync-status__dot[data-tone="success"]',
    );
    expect(rule).toMatch(/background:\s*var\(--color-lane-review-marker\)/);
    expect(rule).not.toContain("--color-lane-running-marker");
    expect(rule).not.toContain("#d97706");
    expect(tokenValue(tokens, "--color-lane-running-marker")).toBe("#d97706");
    expect(tokenValue(tokens, "--color-lane-review-marker")).not.toBe(
      "#d97706",
    );
  });
});

function ruleBodyFor(css: string, selector: string): string {
  const selectorIndex = css.indexOf(selector);
  expect(selectorIndex).toBeGreaterThan(-1);
  const openBraceIndex = css.indexOf("{", selectorIndex);
  const closeBraceIndex = css.indexOf("}", openBraceIndex);
  return css.slice(openBraceIndex, closeBraceIndex);
}

function tokenValue(css: string, name: string): string {
  const match = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  expect(match?.[1]).toBeTruthy();
  return match?.[1]?.trim() ?? "";
}
