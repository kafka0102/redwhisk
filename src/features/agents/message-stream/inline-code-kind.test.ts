import { describe, expect, it } from "vitest";

import {
  extractInlineCodeTexts,
  inlineCodeKind,
  resolveInlineCodeFilePath,
} from "./inline-code-kind";

describe("inlineCodeKind", () => {
  it.each([
    "src/features/agents/message-stream/agent-markdown.tsx",
    "./src/app/a.ts",
    "a.ts",
    "README.md",
    "Dockerfile",
    "Makefile",
    "src/features/agents/message-stream",
  ])("把看起来像工作区内文件的行内代码判定为 path：%s", (text) => {
    expect(inlineCodeKind(text)).toBe("path");
  });

  it.each([
    "pnpm test",
    "const a = 1",
    "foo()",
    "foo{bar}.ts",
    'a"b.ts',
    "a|b.ts",
    "a<b>.ts",
    "useI18n",
    "-flag",
    "--out=dist",
    "/etc/hosts",
    "~/src/a.ts",
    "//server/share/a.ts",
    "\\\\server\\share\\a.ts",
    "https://example.com",
    "file:///Users/tester/repo/a.ts",
    "src/app/",
    "",
  ])("不把散文 / 表达式 / 非本地路径判定为 path：%s", (text) => {
    expect(inlineCodeKind(text)).toBe("other");
  });
});

describe("extractInlineCodeTexts", () => {
  it("扫出段落里的单反引号 span", () => {
    expect(extractInlineCodeTexts("见 `src/a.ts` 与 `b.ts`。")).toEqual([
      "src/a.ts",
      "b.ts",
    ]);
  });

  it("跳过围栏代码块内的内容（含语言标注与围栏内的反引号）", () => {
    const markdown = [
      "改动如下：",
      "",
      "```ts",
      "const a = `src/ignored.ts`;",
      "```",
      "",
      "见 `src/b.ts`。",
    ].join("\n");

    expect(extractInlineCodeTexts(markdown)).toEqual(["src/b.ts"]);
  });

  it("跳过波浪线围栏代码块", () => {
    expect(
      extractInlineCodeTexts(["~~~", "src/a.ts", "~~~"].join("\n")),
    ).toEqual([]);
  });

  it("未闭合的反引号不产出候选", () => {
    expect(extractInlineCodeTexts("见 `src/a.ts")).toEqual([]);
  });
});

describe("resolveInlineCodeFilePath", () => {
  const WORKSPACE = "/Users/tester/repo";
  const HOME = "/Users/tester";

  it.each([
    ["src/app/a.ts", "src/app/a.ts"],
    ["./src/app/a.ts", "src/app/a.ts"],
    ["src/app/a.ts:12", "src/app/a.ts"],
    ["Dockerfile", "Dockerfile"],
  ])("把 %s 收成工作区相对路径 %s", (text, expected) => {
    expect(resolveInlineCodeFilePath(text, WORKSPACE, HOME)).toBe(expected);
  });

  it.each([
    "pnpm test",
    "useI18n",
    "/etc/hosts",
    "https://example.com",
    "//server/share/a.ts",
  ])("解析不了或不属于工作区的行内代码返回 null：%s", (text) => {
    expect(resolveInlineCodeFilePath(text, WORKSPACE, HOME)).toBeNull();
  });
});
