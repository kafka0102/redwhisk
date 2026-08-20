import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(vi.fn())),
}));

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
    getModel: () => null,
    getModels: () => [],
    setModelMarkers: vi.fn(),
  },
}));

import type { CodeFileTab } from "./code-workspace-cache";
import type {
  CodeLanguageDiagnosticsEvent,
  CodeLanguageDocumentInput,
  CodeLanguageHostStatus,
} from "./code-language-commands";
import type { CodeLanguageHostPort } from "./code-language-host-port";
import {
  getAppliedCodeLanguageMarkers,
  resetCodeLanguageMarkersForTests,
} from "./code-language-markers";
import { toCodeLanguageFileUri } from "./code-language-uri";
import { useCodeLanguageIntelligence } from "./use-code-language-intelligence";

function createTab(overrides: Partial<CodeFileTab> = {}): CodeFileTab {
  return {
    fileName: "file.ts",
    filePath: "src/file.ts",
    errorMessage: null,
    isDirty: false,
    isEditable: false,
    isLoading: false,
    lastActiveAt: 1,
    savedContent: "const foo = bar;\n",
    content: {
      content: "const foo = bar;\n",
      filePath: "src/file.ts",
      isBinary: false,
      isTooLarge: false,
      language: "typescript",
      modifiedAt: 1,
      sizeBytes: 16,
    },
    ...overrides,
  };
}

function createFakeHost(
  status: CodeLanguageHostStatus = { status: "ready" },
): CodeLanguageHostPort & {
  documents: CodeLanguageDocumentInput[];
  emitDiagnostics(payload: CodeLanguageDiagnosticsEvent): void;
} {
  const listeners = new Set<(payload: CodeLanguageDiagnosticsEvent) => void>();
  return {
    documents: [],
    async ensure() {
      return status;
    },
    async stop() {
      return undefined;
    },
    async notifyDocument(input) {
      this.documents.push(input);
    },
    async requestDefinition() {
      return { locations: [] };
    },
    async requestReferences() {
      return { locations: [] };
    },
    subscribeDiagnostics(handler) {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
    emitDiagnostics(payload) {
      for (const listener of listeners) {
        listener(payload);
      }
    },
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const workspacePath = "/tmp/redwhisk";
const fileUri = toCodeLanguageFileUri(workspacePath, "src/file.ts");

describe("useCodeLanguageIntelligence", () => {
  beforeEach(() => {
    resetCodeLanguageMarkersForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens a typescript file and applies host diagnostics as markers", async () => {
    const host = createFakeHost();
    const tab = createTab();
    const { result } = renderHook(() =>
      useCodeLanguageIntelligence({
        projectId: 7,
        workspacePath,
        activeTab: tab,
        tabs: [tab],
        debounceMs: 0,
        port: host,
      }),
    );
    await settle();

    expect(result.current.unavailableReason).toBeNull();
    expect(host.documents).toEqual([
      expect.objectContaining({
        kind: "didOpen",
        uri: fileUri,
        languageId: "typescript",
        version: 1,
        text: "const foo = bar;\n",
      }),
    ]);

    act(() => {
      host.emitDiagnostics({
        projectId: 7,
        workspacePath,
        uri: fileUri,
        diagnostics: [
          {
            message: "Cannot find name 'bar'.",
            range: {
              start: { line: 0, character: 12 },
              end: { line: 0, character: 15 },
            },
            severity: 1,
          },
        ],
      });
    });
    expect(getAppliedCodeLanguageMarkers(fileUri)[0]?.message).toBe(
      "Cannot find name 'bar'.",
    );
  });

  it("syncs unsaved edits and still opens readonly files", async () => {
    const host = createFakeHost();
    const tab = createTab({ isEditable: true });
    const { rerender } = renderHook(
      ({ tabs }: { tabs: CodeFileTab[] }) =>
        useCodeLanguageIntelligence({
          projectId: 7,
          workspacePath,
          activeTab: tabs[0] ?? null,
          tabs,
          debounceMs: 0,
          port: host,
        }),
      { initialProps: { tabs: [tab] } },
    );
    await settle();
    expect(host.documents.some((item) => item.kind === "didOpen")).toBe(true);

    rerender({
      tabs: [
        createTab({
          isEditable: true,
          isDirty: true,
          content: {
            content: "const foo = 1;\n",
            filePath: "src/file.ts",
            isBinary: false,
            isTooLarge: false,
            language: "typescript",
            modifiedAt: 1,
            sizeBytes: 15,
          },
        }),
      ],
    });
    await settle();
    expect(host.documents.some((item) => item.kind === "didChange")).toBe(true);
    expect(host.documents.find((item) => item.kind === "didChange")?.text).toBe(
      "const foo = 1;\n",
    );
  });

  it("clears markers when the tab closes or the workspace changes", async () => {
    const host = createFakeHost();
    const tab = createTab();
    const { rerender, unmount } = renderHook(
      ({ tabs, workspace }: { tabs: CodeFileTab[]; workspace: string }) =>
        useCodeLanguageIntelligence({
          projectId: 7,
          workspacePath: workspace,
          activeTab: tabs[0] ?? null,
          tabs,
          debounceMs: 0,
          port: host,
        }),
      { initialProps: { tabs: [tab], workspace: workspacePath } },
    );
    await settle();
    act(() => {
      host.emitDiagnostics({
        projectId: 7,
        workspacePath,
        uri: fileUri,
        diagnostics: [
          {
            message: "Cannot find name 'bar'.",
            range: {
              start: { line: 0, character: 12 },
              end: { line: 0, character: 15 },
            },
          },
        ],
      });
    });
    expect(getAppliedCodeLanguageMarkers(fileUri)).toHaveLength(1);

    rerender({ tabs: [], workspace: workspacePath });
    await settle();
    expect(host.documents.some((item) => item.kind === "didClose")).toBe(true);
    expect(getAppliedCodeLanguageMarkers(fileUri)).toEqual([]);

    rerender({ tabs: [tab], workspace: workspacePath });
    await settle();
    act(() => {
      host.emitDiagnostics({
        projectId: 7,
        workspacePath,
        uri: fileUri,
        diagnostics: [
          {
            message: "Cannot find name 'bar'.",
            range: {
              start: { line: 0, character: 12 },
              end: { line: 0, character: 15 },
            },
          },
        ],
      });
    });
    rerender({ tabs: [tab], workspace: "/tmp/other" });
    await settle();
    expect(getAppliedCodeLanguageMarkers(fileUri)).toEqual([]);
    unmount();
  });

  it("replaces markers and ignores diagnostics after unmount", async () => {
    const host = createFakeHost();
    const tab = createTab();
    const { unmount } = renderHook(() =>
      useCodeLanguageIntelligence({
        projectId: 7,
        workspacePath,
        activeTab: tab,
        tabs: [tab],
        debounceMs: 0,
        port: host,
      }),
    );
    await settle();
    act(() => {
      host.emitDiagnostics({
        projectId: 7,
        workspacePath,
        uri: fileUri,
        diagnostics: [
          {
            message: "Cannot find name 'bar'.",
            range: {
              start: { line: 0, character: 12 },
              end: { line: 0, character: 15 },
            },
          },
        ],
      });
    });
    act(() => {
      host.emitDiagnostics({
        projectId: 7,
        workspacePath,
        uri: fileUri,
        diagnostics: [
          {
            message: "Type 'number' is not assignable to type 'string'.",
            range: {
              start: { line: 0, character: 6 },
              end: { line: 0, character: 9 },
            },
          },
        ],
      });
    });
    expect(getAppliedCodeLanguageMarkers(fileUri)[0]?.message).toBe(
      "Type 'number' is not assignable to type 'string'.",
    );
    unmount();
    expect(getAppliedCodeLanguageMarkers(fileUri)).toEqual([]);
    act(() => {
      host.emitDiagnostics({
        projectId: 7,
        workspacePath,
        uri: fileUri,
        diagnostics: [
          {
            message: "Should be ignored",
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 },
            },
          },
        ],
      });
    });
    expect(getAppliedCodeLanguageMarkers(fileUri)).toEqual([]);
  });

  it("does not open markdown files", async () => {
    const host = createFakeHost();
    const tab = createTab({
      fileName: "readme.md",
      filePath: "docs/readme.md",
      content: {
        content: "# hi\n",
        filePath: "docs/readme.md",
        isBinary: false,
        isTooLarge: false,
        language: "markdown",
        modifiedAt: 1,
        sizeBytes: 5,
      },
    });
    renderHook(() =>
      useCodeLanguageIntelligence({
        projectId: 7,
        workspacePath,
        activeTab: tab,
        tabs: [tab],
        debounceMs: 0,
        port: host,
      }),
    );
    await settle();
    expect(host.documents).toEqual([]);
  });
});
