import { describe, expect, it, vi } from "vitest";

import {
  openCodeLanguageDefinitionMatch,
  selectWorkspaceDefinitionLocations,
  toRevealLineNumber,
  toWorkspaceRelativeFilePath,
} from "./code-language-definition";

const workspacePath = "/tmp/redwhisk";

describe("code language definition helpers", () => {
  it("keeps in-root relative paths and node_modules", () => {
    expect(toWorkspaceRelativeFilePath(workspacePath, "src/lib.ts")).toBe(
      "src/lib.ts",
    );
    expect(
      toWorkspaceRelativeFilePath(
        workspacePath,
        "file:///tmp/redwhisk/node_modules/foo/index.d.ts",
      ),
    ).toBe("node_modules/foo/index.d.ts");
  });

  it("drops locations outside the current code root", () => {
    expect(
      toWorkspaceRelativeFilePath(workspacePath, "file:///tmp/outside/lib.ts"),
    ).toBeNull();
    expect(
      toWorkspaceRelativeFilePath(workspacePath, "/tmp/outside/lib.ts"),
    ).toBeNull();
    expect(
      toWorkspaceRelativeFilePath(workspacePath, "../secret.ts"),
    ).toBeNull();
  });

  it("selects only in-root definition locations", () => {
    const range = {
      start: { line: 1, character: 0 },
      end: { line: 1, character: 3 },
    };
    expect(
      selectWorkspaceDefinitionLocations(workspacePath, [
        { filePath: "src/lib.ts", range },
        { filePath: "/tmp/outside/lib.ts", range },
        {
          filePath: "file:///tmp/redwhisk/node_modules/foo/index.d.ts",
          range,
        },
      ]).map((location) => location.filePath),
    ).toEqual(["src/lib.ts", "node_modules/foo/index.d.ts"]);
  });

  it("opens in-root matches and ignores out-of-root uris", () => {
    const openMatch = vi.fn();
    expect(
      openCodeLanguageDefinitionMatch({
        workspacePath,
        uri: "file:///tmp/redwhisk/src/lib.ts",
        lineNumber: 2,
        openMatch,
      }),
    ).toBe(true);
    expect(openMatch).toHaveBeenCalledWith({
      fileName: "lib.ts",
      filePath: "src/lib.ts",
      lineNumber: 2,
    });

    openMatch.mockClear();
    expect(
      openCodeLanguageDefinitionMatch({
        workspacePath,
        uri: "file:///tmp/outside/lib.ts",
        lineNumber: 4,
        openMatch,
      }),
    ).toBe(false);
    expect(openMatch).not.toHaveBeenCalled();
  });

  it("uses monaco one-based line numbers for reveal", () => {
    expect(toRevealLineNumber({ startLineNumber: 8, lineNumber: 1 })).toBe(8);
    expect(toRevealLineNumber({ lineNumber: 3 })).toBe(3);
    expect(toRevealLineNumber(null)).toBe(1);
  });
});
