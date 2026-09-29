import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 内容字号只作用于对外结论正文。思考过程与工具调用展开是过程信息，
// 必须保持设计系统默认字号，不能跟着「内容字号」一起放大。
describe("agent message stream content font size", () => {
  const css = readFileSync(
    resolve(process.cwd(), "src/shared/styles/message-stream.css"),
    "utf8",
  );

  it("keeps assistant conclusion text on the configured content font size", () => {
    expect(ruleBodyFor(css, ".agents-message__bubble")).toMatch(
      /font-size:\s*var\(--content-font-size\)/,
    );
    expect(ruleBodyFor(css, ".agents-message__markdown")).toMatch(
      /font-size:\s*var\(--content-font-size\)/,
    );
  });

  it("renders the thinking label at the default tool-row size", () => {
    const summary = ruleBodyFor(css, ".agents-message__reasoning-summary");
    expect(summary).not.toMatch(/var\(--content-font-size\)/);
    expect(summary).toMatch(/font-size:\s*12\.5px/);
  });

  it("renders expanded thinking text at the default body size", () => {
    const text = ruleBodyFor(css, ".agents-message__reasoning-text");
    expect(text).not.toMatch(/var\(--content-font-size\)/);
    expect(text).toMatch(/font-size:\s*13px/);
  });

  it("renders expanded tool command, path, and output at the default mono size", () => {
    for (const selector of [
      ".agents-message__command",
      ".agents-message__path",
      ".agents-message__output",
    ]) {
      const body = ruleBodyFor(css, selector);
      expect(body).not.toMatch(/var\(--content-font-size\)/);
      expect(body).toMatch(/font-size:\s*12px/);
    }
  });
});

function ruleBodyFor(css: string, selector: string): string {
  const selectorIndex = css.indexOf(selector);
  expect(selectorIndex).toBeGreaterThan(-1);
  const openBraceIndex = css.indexOf("{", selectorIndex);
  const closeBraceIndex = css.indexOf("}", openBraceIndex);
  return css.slice(openBraceIndex, closeBraceIndex);
}
