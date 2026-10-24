import { describe, expect, it } from "vitest";

import {
  parseFileReference,
  resolveWorkspaceRelativePath,
} from "./session-file-links";

const WORKSPACE_PATH = "/Users/tester/repo";
const HOME_PATH = "/Users/tester";

describe("parseFileReference", () => {
  it("把 http(s) 链接识别为外部链接", () => {
    expect(parseFileReference("https://example.com/docs")).toEqual({
      kind: "external",
      href: "https://example.com/docs",
    });
    expect(parseFileReference("http://example.com/docs").kind).toBe("external");
    expect(parseFileReference("HTTPS://EXAMPLE.COM").kind).toBe("external");
  });

  it("把工作区绝对路径、file URL、~ 与相对路径识别为本地文件", () => {
    expect(parseFileReference("/Users/tester/repo/src/app/a.ts")).toEqual({
      kind: "local",
      href: "/Users/tester/repo/src/app/a.ts",
      path: "/Users/tester/repo/src/app/a.ts",
      line: null,
      column: null,
    });
    expect(
      parseFileReference("file:///Users/tester/repo/src/app/a.ts").kind,
    ).toBe("local");
    expect(parseFileReference("~/repo/src/app/a.ts").kind).toBe("local");
    expect(parseFileReference("./src/app/a.ts").kind).toBe("local");
    expect(parseFileReference("src/app/a.ts").kind).toBe("local");
  });

  it("剥离行号后缀并保留行号信息", () => {
    expect(parseFileReference("src/app/a.ts:12:3")).toEqual({
      kind: "local",
      href: "src/app/a.ts:12:3",
      path: "src/app/a.ts",
      line: 12,
      column: 3,
    });
    expect(parseFileReference("src/app/a.ts:12")).toMatchObject({
      path: "src/app/a.ts",
      line: 12,
      column: null,
    });
    expect(parseFileReference("src/app/a.ts#L12")).toMatchObject({
      path: "src/app/a.ts",
      line: 12,
      column: null,
    });
    expect(parseFileReference("src/app/a.ts#L12C3")).toMatchObject({
      path: "src/app/a.ts",
      line: 12,
      column: 3,
    });
  });

  it("不把 UNC、网络共享、其他协议或纯锚点识别为本地文件", () => {
    const unresolvedHrefs = [
      "\\\\server\\share\\a.ts",
      "//server/share/a.ts",
      "mailto:someone@example.com",
      "vscode://file/Users/tester/repo/src/app/a.ts",
      "#details",
      "#L12",
      "src/app a.ts",
      "",
    ];

    for (const href of unresolvedHrefs) {
      expect(parseFileReference(href).kind, href).toBe("unresolved");
    }
  });
});

describe("resolveWorkspaceRelativePath", () => {
  it("把工作区内绝对路径收成相对路径", () => {
    expect(
      resolveWorkspaceRelativePath(
        "/Users/tester/repo/src/app/a.ts",
        WORKSPACE_PATH,
        HOME_PATH,
      ),
    ).toBe("src/app/a.ts");
  });

  it("剥掉 file:// 前缀后再相对化", () => {
    expect(
      resolveWorkspaceRelativePath(
        "file:///Users/tester/repo/src/app/a.ts",
        WORKSPACE_PATH,
        HOME_PATH,
      ),
    ).toBe("src/app/a.ts");
  });

  it("剥掉行号后缀后再相对化", () => {
    expect(
      resolveWorkspaceRelativePath(
        "src/app/a.ts:12:3",
        WORKSPACE_PATH,
        HOME_PATH,
      ),
    ).toBe("src/app/a.ts");
    expect(
      resolveWorkspaceRelativePath(
        "src/app/a.ts#L12",
        WORKSPACE_PATH,
        HOME_PATH,
      ),
    ).toBe("src/app/a.ts");
    expect(
      resolveWorkspaceRelativePath(
        "src/app/a.ts#L12C3",
        WORKSPACE_PATH,
        HOME_PATH,
      ),
    ).toBe("src/app/a.ts");
  });

  it("解码 %20 还原带空格的文件名", () => {
    expect(
      resolveWorkspaceRelativePath("src/app%20a.ts", WORKSPACE_PATH, HOME_PATH),
    ).toBe("src/app a.ts");
  });

  it("用 homePath 展开 ~ 后相对化", () => {
    expect(
      resolveWorkspaceRelativePath(
        "~/repo/src/app/a.ts",
        WORKSPACE_PATH,
        HOME_PATH,
      ),
    ).toBe("src/app/a.ts");
  });

  it("homePath 缺失时 ~ 无法解析", () => {
    expect(
      resolveWorkspaceRelativePath("~/repo/src/app/a.ts", WORKSPACE_PATH, null),
    ).toBeNull();
  });

  it("只去掉 ./ 前缀，不折叠内部 . 与 ..", () => {
    expect(
      resolveWorkspaceRelativePath("./src/app/a.ts", WORKSPACE_PATH, HOME_PATH),
    ).toBe("src/app/a.ts");
    expect(
      resolveWorkspaceRelativePath(
        "src/../app/a.ts",
        WORKSPACE_PATH,
        HOME_PATH,
      ),
    ).toBe("src/../app/a.ts");
  });

  it("越界、不可解析与无法相对化的输入返回 null", () => {
    const unresolvableInputs = [
      "/Users/tester/other/a.ts",
      // 前缀相同但不在工作区内（边界匹配不能只看 startsWith）。
      "/Users/tester/repository/a.ts",
      "/Users/tester/repo",
      "../outside.ts",
      "..",
      "//server/share/a.ts",
      "\\\\server\\share\\a.ts",
      "https://example.com/a.ts",
      "#details",
      "src/%ZZ.ts",
      "",
    ];

    for (const input of unresolvableInputs) {
      expect(
        resolveWorkspaceRelativePath(input, WORKSPACE_PATH, HOME_PATH),
        input,
      ).toBeNull();
    }
  });

  it("workspacePath 缺失时无法相对化绝对路径", () => {
    expect(
      resolveWorkspaceRelativePath(
        "/Users/tester/repo/src/app/a.ts",
        null,
        HOME_PATH,
      ),
    ).toBeNull();
  });
});
