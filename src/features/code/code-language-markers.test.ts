import { beforeEach, describe, expect, it, vi } from "vitest";

const setModelMarkers = vi.fn();
const getModel = vi.fn();

vi.mock("monaco-editor", () => ({
  MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
  Uri: {
    parse: (value: string) => ({
      toString: () => value,
      path: value,
      fsPath: value,
    }),
  },
  editor: {
    getModel: (...args: unknown[]) => getModel(...args),
    getModels: () => [],
    setModelMarkers: (...args: unknown[]) => setModelMarkers(...args),
  },
}));

import {
  applyCodeLanguageMarkers,
  clearCodeLanguageMarkersForRoot,
  clearCodeLanguageMarkersForUri,
  getAppliedCodeLanguageMarkers,
  resetCodeLanguageMarkersForTests,
  syncCodeLanguageMarkersToModel,
} from "./code-language-markers";
import type { CodeLanguageDiagnostic } from "./code-language-commands";

const uri = "file:///tmp/redwhisk/src/file.ts";

function diagnostic(message: string): CodeLanguageDiagnostic {
  return {
    message,
    range: {
      start: { line: 0, character: 12 },
      end: { line: 0, character: 15 },
    },
    severity: 1,
  };
}

describe("code language markers", () => {
  beforeEach(() => {
    resetCodeLanguageMarkersForTests();
    setModelMarkers.mockReset();
    getModel.mockReset();
    getModel.mockReturnValue(null);
  });

  it("stores markers so they can be applied when a model appears", () => {
    applyCodeLanguageMarkers(uri, [diagnostic("Cannot find name 'bar'.")]);
    expect(getAppliedCodeLanguageMarkers(uri)[0]?.message).toBe(
      "Cannot find name 'bar'.",
    );
    expect(setModelMarkers).not.toHaveBeenCalled();

    const model = { uri: { toString: () => uri } };
    getModel.mockReturnValue(model);
    syncCodeLanguageMarkersToModel(uri);
    expect(setModelMarkers).toHaveBeenCalledWith(
      model,
      "redwhisk-code-language",
      [
        expect.objectContaining({
          message: "Cannot find name 'bar'.",
          startLineNumber: 1,
          startColumn: 13,
          endLineNumber: 1,
          endColumn: 16,
        }),
      ],
    );
  });

  it("clears markers for a uri and a workspace root", () => {
    applyCodeLanguageMarkers(uri, [diagnostic("Cannot find name 'bar'.")]);
    applyCodeLanguageMarkers("file:///tmp/other/src/file.ts", [
      diagnostic("other"),
    ]);
    clearCodeLanguageMarkersForUri(uri);
    expect(getAppliedCodeLanguageMarkers(uri)).toEqual([]);

    applyCodeLanguageMarkers(uri, [diagnostic("Cannot find name 'bar'.")]);
    clearCodeLanguageMarkersForRoot("/tmp/redwhisk");
    expect(getAppliedCodeLanguageMarkers(uri)).toEqual([]);
    expect(
      getAppliedCodeLanguageMarkers("file:///tmp/other/src/file.ts")[0]
        ?.message,
    ).toBe("other");
  });
});
