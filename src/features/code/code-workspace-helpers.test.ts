import { describe, expect, it } from "vitest";

import {
  canEditCodeFileTab,
  getCodeFileEditBlockReason,
  isHtmlFile,
  isMarkdownPreviewable,
} from "./code-workspace-helpers";
import type { CodeFileTab } from "./code-workspace-cache";

function tab(partial: Partial<CodeFileTab> = {}): CodeFileTab {
  return {
    content: {
      content: "# Title\n",
      filePath: "docs/readme.md",
      isBinary: false,
      isTooLarge: false,
      previewKind: null,
      previewBytesBase64: "",
      language: "markdown",
      modifiedAt: 1,
      sizeBytes: 8,
    },
    errorMessage: null,
    fileName: "readme.md",
    filePath: "docs/readme.md",
    isDirty: false,
    isEditable: false,
    isLoading: false,
    lastActiveAt: 1,
    savedContent: "# Title\n",
    ...partial,
  };
}

describe("isHtmlFile", () => {
  it("matches html and htm extensions case-insensitively", () => {
    expect(isHtmlFile("index.html")).toBe(true);
    expect(isHtmlFile("page.HTM")).toBe(true);
    expect(isHtmlFile("src/view.HTML")).toBe(true);
  });

  it("rejects other extensions and names without an extension", () => {
    expect(isHtmlFile("index.xhtml")).toBe(false);
    expect(isHtmlFile("readme.md")).toBe(false);
    expect(isHtmlFile("html")).toBe(false);
  });
});

describe("isMarkdownPreviewable", () => {
  it("returns true for successfully loaded markdown text", () => {
    expect(isMarkdownPreviewable(tab())).toBe(true);
  });

  it("returns false while loading", () => {
    expect(isMarkdownPreviewable(tab({ isLoading: true }))).toBe(false);
  });

  it("returns false when load failed", () => {
    expect(
      isMarkdownPreviewable(
        tab({ content: null, errorMessage: "File does not exist" }),
      ),
    ).toBe(false);
  });

  it("returns false for binary or oversized content", () => {
    expect(
      isMarkdownPreviewable(
        tab({
          content: {
            content: "",
            filePath: "docs/readme.md",
            isBinary: true,
            isTooLarge: false,
            previewKind: null,
            previewBytesBase64: "",
            language: "markdown",
            modifiedAt: 1,
            sizeBytes: 8,
          },
        }),
      ),
    ).toBe(false);
    expect(
      isMarkdownPreviewable(
        tab({
          content: {
            content: "# big",
            filePath: "docs/readme.md",
            isBinary: false,
            isTooLarge: true,
            previewKind: null,
            previewBytesBase64: "",
            language: "markdown",
            modifiedAt: 1,
            sizeBytes: 8,
          },
        }),
      ),
    ).toBe(false);
  });

  it("returns false for non-markdown languages including mdx", () => {
    expect(
      isMarkdownPreviewable(
        tab({
          content: {
            content: "export const x = 1;",
            filePath: "src/file.ts",
            isBinary: false,
            isTooLarge: false,
            previewKind: null,
            previewBytesBase64: "",
            language: "typescript",
            modifiedAt: 1,
            sizeBytes: 18,
          },
        }),
      ),
    ).toBe(false);
    expect(
      isMarkdownPreviewable(
        tab({
          content: {
            content: "# MDX",
            filePath: "docs/page.mdx",
            isBinary: false,
            isTooLarge: false,
            previewKind: null,
            previewBytesBase64: "",
            language: "mdx",
            modifiedAt: 1,
            sizeBytes: 5,
          },
        }),
      ),
    ).toBe(false);
  });
});

describe("canEditCodeFileTab", () => {
  it("returns true for loaded text files", () => {
    expect(canEditCodeFileTab(tab())).toBe(true);
  });

  it("returns false while loading, failed, binary, or too large", () => {
    expect(canEditCodeFileTab(tab({ isLoading: true }))).toBe(false);
    expect(
      canEditCodeFileTab(
        tab({ content: null, errorMessage: "File does not exist" }),
      ),
    ).toBe(false);
    expect(
      canEditCodeFileTab(
        tab({
          content: {
            content: "",
            filePath: "a.bin",
            isBinary: true,
            isTooLarge: false,
            previewKind: null,
            previewBytesBase64: "",
            language: null,
            modifiedAt: 1,
            sizeBytes: 3,
          },
        }),
      ),
    ).toBe(false);
    expect(
      canEditCodeFileTab(
        tab({
          content: {
            content: "",
            filePath: "big.txt",
            isBinary: false,
            isTooLarge: true,
            previewKind: null,
            previewBytesBase64: "",
            language: null,
            modifiedAt: 1,
            sizeBytes: 9,
          },
        }),
      ),
    ).toBe(false);
  });
});

describe("getCodeFileEditBlockReason", () => {
  it("returns null when the tab is editable", () => {
    expect(getCodeFileEditBlockReason(tab())).toBeNull();
  });

  it("maps loading, binary, too-large, and unavailable states", () => {
    expect(getCodeFileEditBlockReason(tab({ isLoading: true }))).toBe(
      "loading",
    );
    expect(
      getCodeFileEditBlockReason(
        tab({
          content: {
            content: "",
            filePath: "docs/readme.md",
            isBinary: true,
            isTooLarge: false,
            previewKind: null,
            previewBytesBase64: "",
            language: "markdown",
            modifiedAt: 1,
            sizeBytes: 8,
          },
        }),
      ),
    ).toBe("binary");
    expect(
      getCodeFileEditBlockReason(
        tab({
          content: {
            content: "# big",
            filePath: "docs/readme.md",
            isBinary: false,
            isTooLarge: true,
            previewKind: null,
            previewBytesBase64: "",
            language: "markdown",
            modifiedAt: 1,
            sizeBytes: 8,
          },
        }),
      ),
    ).toBe("tooLarge");
    expect(
      getCodeFileEditBlockReason(
        tab({ content: null, errorMessage: "File does not exist" }),
      ),
    ).toBe("unavailable");
  });
});
