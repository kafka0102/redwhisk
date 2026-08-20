import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const referenceProviders: Array<{
  language: string;
  provider: {
    provideReferences: (
      model: { uri: { toString(): string } },
      position: { lineNumber: number; column: number },
    ) => Promise<Array<{ uri: { toString(): string }; range: unknown }> | []>;
  };
}> = [];
const editorOpeners: Array<{
  openCodeEditor: (
    source: unknown,
    resource: { toString(): string },
    selectionOrPosition?: { startLineNumber?: number; lineNumber?: number },
  ) => boolean;
}> = [];
const {
  registerCompletionItemProvider,
  registerHoverProvider,
  registerCodeActionProvider,
} = vi.hoisted(() => ({
  registerCompletionItemProvider: vi.fn(),
  registerHoverProvider: vi.fn(),
  registerCodeActionProvider: vi.fn(),
}));

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
      registerReferenceProvider: (
        language: string,
        provider: (typeof referenceProviders)[number]["provider"],
      ) => {
        referenceProviders.push({ language, provider });
        return { dispose: vi.fn() };
      },
      registerCompletionItemProvider,
      registerHoverProvider,
      registerCodeActionProvider,
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
import { useCodeLanguageReferences } from "./use-code-language-references";

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
  referenceRequests: unknown[];
} {
  return {
    referenceRequests: [],
    async ensure() {
      return { status: "ready" };
    },
    async stop() {
      return undefined;
    },
    async notifyDocument() {
      return undefined;
    },
    async requestDefinition() {
      return { locations: [] };
    },
    async requestReferences(input) {
      this.referenceRequests.push(input);
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

describe("useCodeLanguageReferences", () => {
  beforeEach(() => {
    referenceProviders.length = 0;
    editorOpeners.length = 0;
    registerCompletionItemProvider.mockClear();
    registerHoverProvider.mockClear();
    registerCodeActionProvider.mockClear();
  });

  it("lists in-root references, opens a peek match, and ignores out-of-root targets", async () => {
    const host = createFakeHost([
      {
        filePath: "src/usage.ts",
        range: {
          start: { line: 2, character: 4 },
          end: { line: 2, character: 7 },
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
      useCodeLanguageReferences({
        projectId: 7,
        workspacePath,
        onOpenMatch: openMatch,
        port: host,
      }),
    );
    await settle();

    expect(referenceProviders.map((item) => item.language)).toEqual([
      "typescript",
      "javascript",
    ]);
    const locations = await referenceProviders[0]?.provider.provideReferences(
      { uri: { toString: () => "file:///tmp/redwhisk/src/file.ts" } },
      { lineNumber: 1, column: 7 },
    );
    expect(host.referenceRequests).toEqual([
      {
        projectId: 7,
        workspacePath,
        uri: "file:///tmp/redwhisk/src/file.ts",
        position: { line: 0, character: 6 },
      },
    ]);
    expect(locations?.map((location) => location.uri.toString())).toEqual([
      "file:///tmp/redwhisk/src/usage.ts",
    ]);

    expect(
      editorOpeners[0]?.openCodeEditor(
        null,
        { toString: () => "file:///tmp/redwhisk/src/usage.ts" },
        { startLineNumber: 3 },
      ),
    ).toBe(true);
    expect(openMatch).toHaveBeenCalledWith({
      fileName: "usage.ts",
      filePath: "src/usage.ts",
      lineNumber: 3,
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
    expect(registerCompletionItemProvider).not.toHaveBeenCalled();
    expect(registerHoverProvider).not.toHaveBeenCalled();
    expect(registerCodeActionProvider).not.toHaveBeenCalled();
  });

  it("does not query the host for models outside the current code root", async () => {
    const host = createFakeHost();
    renderHook(() =>
      useCodeLanguageReferences({
        projectId: 7,
        workspacePath,
        onOpenMatch: vi.fn(),
        port: host,
      }),
    );
    await settle();

    const locations = await referenceProviders[0]?.provider.provideReferences(
      { uri: { toString: () => "file:///tmp/session/file.ts" } },
      { lineNumber: 1, column: 1 },
    );
    expect(locations).toEqual([]);
    expect(host.referenceRequests).toEqual([]);
  });
});
