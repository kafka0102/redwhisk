import { describe, expect, it } from "vitest";

import {
  isTuiArchiveLogPath,
  prepareTuiArchiveMarkdownForRender,
} from "./agent-tui-archive-path";

describe("isTuiArchiveLogPath", () => {
  it("识别 session-logs/archive 连续段", () => {
    expect(
      isTuiArchiveLogPath(
        "/Users/x/.redwhisk/session-logs/archive/project-2/archive-project-2-issue-33-session-44.log",
      ),
    ).toBe(true);
  });

  it("拒绝 runtime 日志与伪 archive 路径", () => {
    expect(
      isTuiArchiveLogPath(
        "/Users/x/.redwhisk/session-logs/project-2/runtime.log",
      ),
    ).toBe(false);
    expect(
      isTuiArchiveLogPath("/tmp/other-archive/session-logs/runtime.log"),
    ).toBe(false);
    expect(isTuiArchiveLogPath("")).toBe(false);
    expect(isTuiArchiveLogPath(null)).toBe(false);
  });
});

describe("prepareTuiArchiveMarkdownForRender", () => {
  it("去掉 issue-comment 标签并将列表前缀标题收成 ATX", () => {
    const input = `› 使用 skill 重构

• ## 结果

  **完成** 拆分，见 [文档](https://example.com)。

  <issue-comment>
  交付摘要
  </issue-comment>
`;
    const got = prepareTuiArchiveMarkdownForRender(input);
    expect(got).toContain("## 结果");
    expect(got).not.toMatch(/^•\s*##/m);
    expect(got).toContain("**完成**");
    expect(got).toContain("[文档](https://example.com)");
    expect(got).toContain("交付摘要");
    expect(got).not.toContain("<issue-comment>");
    expect(got).not.toContain("</issue-comment>");
  });
});
