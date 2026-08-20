import { describe, expect, it } from "vitest";

import { isCodeLanguageFile } from "./is-code-language-file";

describe("isCodeLanguageFile", () => {
  it("accepts typescript and javascript language ids", () => {
    expect(isCodeLanguageFile({ language: "typescript" })).toBe(true);
    expect(isCodeLanguageFile({ language: "javascript" })).toBe(true);
  });

  it("rejects non-ts/js, binary, and too-large files", () => {
    expect(isCodeLanguageFile({ language: "markdown" })).toBe(false);
    expect(isCodeLanguageFile({ language: "rust" })).toBe(false);
    expect(isCodeLanguageFile({ language: "typescript", isBinary: true })).toBe(
      false,
    );
    expect(
      isCodeLanguageFile({ language: "javascript", isTooLarge: true }),
    ).toBe(false);
    expect(isCodeLanguageFile({ language: null })).toBe(false);
  });
});
