import { describe, expect, it } from "vitest";

import {
  canEditCodeFileTab,
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
            language: null,
            modifiedAt: 1,
            sizeBytes: 9,
          },
        }),
      ),
    ).toBe(false);
  });
});
