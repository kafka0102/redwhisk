import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const definitionProviders: Array<{
  language: string;
  provider: {
    provideDefinition: (
      model: { uri: { toString(): string } },
      position: { lineNumber: number; column: number },
    ) => Promise<
      Array<{
        uri: { toString(): string };
        range: {
          startLineNumber: number;
          startColumn: number;
          endLineNumber: number;
          endColumn: number;
        };
      }>
    >;
  };
}> = [];
const editorOpeners: Array<{
  openCodeEditor: (
    source: unknown,
    resource: { toString(): string },
    selectionOrPosition?: { startLineNumber?: number; lineNumber?: number },
  ) => boolean;
}> = [];

vi.mock("monaco-editor", () => {
  class Range {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;

    constructor(
      startLineNumber: number,
      startColumn: number,
      endLineNumber: number,
      endColumn: number,
    ) {
      this.startLineNumber = startLineNumber;
      this.startColumn = startColumn;
      this.endLineNumber = endLineNumber;
      this.endColumn = endColumn;
    }
  }

  return {
    Range,
    Uri: {
      parse: (value: string) => ({
        toString: () => value,
        path: value.replace(/^file:\/\//, ""),
      }),
    },
    languages: {
      registerDefinitionProvider: (
        language: string,
        provider: (typeof definitionProviders)[number]["provider"],
      ) => {
        definitionProviders.push({ language, provider });
        return { dispose: vi.fn() };
      },
    },
    editor: {
      registerEditorOpener: (opener: (typeof editorOpeners)[number]) => {
        editorOpeners.push(opener);
        return { dispose: vi.fn() };
      },
    },
  };
});

import type { CodeLanguageHostPort } from "./code-language-host-port";
import { useCodeLanguageDefinition } from "./use-code-language-definition";

const workspacePath = "/tmp/redwhisk";

function createFakeHost(
  locations: Array<{
    filePath: string;
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  }> = [],
): CodeLanguageHostPort & {
  definitionRequests: unknown[];
} {
  return {
    definitionRequests: [],
    async ensure() {
      return { status: "ready" };
    },
    async stop() {
      return undefined;
    },
    async notifyDocument() {
      return undefined;
    },
    async requestDefinition(input) {
      this.definitionRequests.push(input);
      return { locations };
    },
    subscribeDiagnostics() {
      return () => undefined;
    },
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useCodeLanguageDefinition", () => {
  beforeEach(() => {
    definitionProviders.length = 0;
    editorOpeners.length = 0;
  });

  it("opens an in-root definition and ignores out-of-root targets", async () => {
    const host = createFakeHost([
      {
        filePath: "src/lib.ts",
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 3 },
        },
      },
      {
        filePath: "/tmp/outside/lib.ts",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
      },
    ]);
    const openMatch = vi.fn();
    renderHook(() =>
      useCodeLanguageDefinition({
        projectId: 7,
        workspacePath,
        onOpenMatch: openMatch,
        port: host,
      }),
    );
    await settle();

    expect(definitionProviders.map((item) => item.language)).toEqual([
      "typescript",
      "javascript",
    ]);
    const locations = await definitionProviders[0]?.provider.provideDefinition(
      { uri: { toString: () => "file:///tmp/redwhisk/src/file.ts" } },
      { lineNumber: 1, column: 7 },
    );
    expect(host.definitionRequests).toEqual([
      {
        projectId: 7,
        workspacePath,
        uri: "file:///tmp/redwhisk/src/file.ts",
        position: { line: 0, character: 6 },
      },
    ]);
    expect(locations?.map((location) => location.uri.toString())).toEqual([
      "file:///tmp/redwhisk/src/lib.ts",
    ]);
    expect(locations?.[0]?.range).toMatchObject({
      startLineNumber: 2,
      startColumn: 1,
    });

    expect(
      editorOpeners[0]?.openCodeEditor(
        null,
        { toString: () => "file:///tmp/redwhisk/src/lib.ts" },
        { startLineNumber: 2 },
      ),
    ).toBe(true);
    expect(openMatch).toHaveBeenCalledWith({
      fileName: "lib.ts",
      filePath: "src/lib.ts",
      lineNumber: 2,
    });

    openMatch.mockClear();
    expect(
      editorOpeners[0]?.openCodeEditor(
        null,
        { toString: () => "file:///tmp/outside/lib.ts" },
        { startLineNumber: 1 },
      ),
    ).toBe(false);
    expect(openMatch).not.toHaveBeenCalled();
  });

  it("does not query the host for models outside the current code root", async () => {
    const host = createFakeHost();
    renderHook(() =>
      useCodeLanguageDefinition({
        projectId: 7,
        workspacePath,
        onOpenMatch: vi.fn(),
        port: host,
      }),
    );
    await settle();

    const locations = await definitionProviders[0]?.provider.provideDefinition(
      { uri: { toString: () => "file:///tmp/session/file.ts" } },
      { lineNumber: 1, column: 1 },
    );
    expect(locations).toEqual([]);
    expect(host.definitionRequests).toEqual([]);
  });
});
