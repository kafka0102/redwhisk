import { describe, expect, it } from "vitest";

import { toCodeLanguageFileUri } from "./code-language-uri";

describe("toCodeLanguageFileUri", () => {
  it("joins a posix workspace and relative file path", () => {
    expect(toCodeLanguageFileUri("/tmp/redwhisk", "src/file.ts")).toBe(
      "file:///tmp/redwhisk/src/file.ts",
    );
  });

  it("returns the workspace uri when the relative path is empty", () => {
    expect(toCodeLanguageFileUri("/tmp/redwhisk", "")).toBe(
      "file:///tmp/redwhisk",
    );
  });
});
