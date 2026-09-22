import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 只读 Issue 详情页的标题与描述必须跟随全局内容字号，
// 否则「内容字号」设置在详情页只对会话/代码生效，详情页正文看起来没变化。
describe("issue detail content font size", () => {
  const css = readFileSync(
    resolve(process.cwd(), "src/shared/styles/issue-detail.css"),
    "utf8",
  );

  it("scales the read-only detail title with the content font size", () => {
    expect(
      ruleBodyFor(css, ".issue-page__main--readonly .issue-detail__title"),
    ).toMatch(/font-size:\s*var\(--content-font-size\)/);
  });

  it("scales the read-only detail description with the content font size", () => {
    expect(
      ruleBodyFor(
        css,
        ".issue-page__main--readonly .issue-detail__description",
      ),
    ).toMatch(/font-size:\s*var\(--content-font-size\)/);
  });
});

function ruleBodyFor(css: string, selector: string): string {
  const selectorIndex = css.indexOf(selector);
  expect(selectorIndex).toBeGreaterThan(-1);
  const openBraceIndex = css.indexOf("{", selectorIndex);
  const closeBraceIndex = css.indexOf("}", openBraceIndex);
  return css.slice(openBraceIndex, closeBraceIndex);
}
