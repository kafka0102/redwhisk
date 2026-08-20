import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import type { CodeFileTab } from "./code-workspace-cache";
import { CodeContent } from "./code-content";

const monacoEditorApi = vi.hoisted(() => ({
  restoreViewState: vi.fn(),
  saveViewState: vi.fn(() => ({ scrollTop: 120 })),
  revealLineInCenter: vi.fn(),
  setPosition: vi.fn(),
  focus: vi.fn(),
  onDidScrollChange: vi.fn((_listener: () => void) => ({
    dispose: vi.fn(),
  })),
  onDidDispose: vi.fn((_listener: () => void) => undefined),
  reset() {
    this.restoreViewState.mockClear();
    this.saveViewState.mockClear();
    this.revealLineInCenter.mockClear();
    this.setPosition.mockClear();
    this.focus.mockClear();
    this.onDidScrollChange.mockClear();
    this.onDidDispose.mockClear();
  },
}));

const lastEditorOptions = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
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

vi.mock("../../shared/use-monaco-editor-ready", () => ({
  useMonacoEditorReady: () => true,
}));

vi.mock("@monaco-editor/react", () => ({
  Editor: ({
    value,
    path,
    options,
    onChange,
    onMount,
  }: {
    value?: string;
    path?: string;
    options?: Record<string, unknown>;
    onChange?: (value: string | undefined) => void;
    onMount?: (editor: {
      revealLineInCenter: (line: number) => void;
      setPosition: (pos: { lineNumber: number; column: number }) => void;
      focus: () => void;
      saveViewState: () => unknown;
      restoreViewState: (state: unknown) => void;
      onDidScrollChange: (listener: () => void) => { dispose: () => void };
      onDidDispose: (listener: () => void) => void;
    }) => void;
  }) => {
    const didMountRef = useRef(false);
    lastEditorOptions.current = options ?? null;
    useEffect(() => {
      if (didMountRef.current) {
        return;
      }
      didMountRef.current = true;
      onMount?.({
        revealLineInCenter: (...args) =>
          monacoEditorApi.revealLineInCenter(...args),
        setPosition: (...args) => monacoEditorApi.setPosition(...args),
        focus: (...args) => monacoEditorApi.focus(...args),
        saveViewState: () => monacoEditorApi.saveViewState(),
        restoreViewState: (state) => monacoEditorApi.restoreViewState(state),
        onDidScrollChange: (listener) =>
          monacoEditorApi.onDidScrollChange(listener),
        onDidDispose: (listener) => monacoEditorApi.onDidDispose(listener),
      });
    }, [onMount]);
    return (
      <div
        data-testid="monaco-editor"
        data-path={path ?? ""}
        data-value={value ?? ""}
      >
        <button
          type="button"
          data-testid="monaco-edit"
          onClick={() => onChange?.(`${value ?? ""}x`)}
        >
          edit
        </button>
      </div>
    );
  },
}));

function buildTab(overrides: Partial<CodeFileTab> = {}): CodeFileTab {
  return {
    filePath: "src/file.ts",
    fileName: "file.ts",
    isLoading: false,
    errorMessage: null,
    isDirty: false,
    isEditable: true,
    lastActiveAt: 1,
    savedContent: "export const value = 1;\n",
    content: {
      filePath: "src/file.ts",
      language: "typescript",
      content: "export const value = 1;\n",
      modifiedAt: 1000,
      sizeBytes: 24,
      isBinary: false,
      isTooLarge: false,
    },
    ...overrides,
  };
}

const messages = {
  agentsFeature: {
    loadingFile: "Loading",
    binaryPreviewUnavailable: "Binary",
    largeFilePreviewUnavailable: "Too large",
  },
} as never;

describe("CodeContent edit interactions", () => {
  beforeEach(() => {
    monacoEditorApi.reset();
    lastEditorOptions.current = null;
  });

  it("does not restore view state when only the local buffer content changes", async () => {
    const user = userEvent.setup();
    let tab = buildTab();
    const onContentChange = vi.fn((value: string) => {
      tab = {
        ...tab,
        content: tab.content
          ? {
              ...tab.content,
              content: value,
            }
          : null,
        isDirty: true,
      };
      rerender(
        <CodeContent
          projectId={1}
          tab={tab}
          contentFontSize={14}
          messages={messages}
          theme="light"
          onContentChange={onContentChange}
        />,
      );
    });

    const { rerender } = render(
      <CodeContent
        projectId={1}
        tab={tab}
        contentFontSize={14}
        messages={messages}
        theme="light"
        onContentChange={onContentChange}
      />,
    );

    await waitFor(() => {
      expect(monacoEditorApi.onDidScrollChange).toHaveBeenCalled();
    });
    monacoEditorApi.restoreViewState.mockClear();

    await user.click(screen.getByTestId("monaco-edit"));

    expect(onContentChange).toHaveBeenCalled();
    expect(monacoEditorApi.restoreViewState).not.toHaveBeenCalled();
  });

  it("restores view state after an external disk reload of the same file", async () => {
    let tab = buildTab();
    const { rerender } = render(
      <CodeContent
        projectId={1}
        tab={tab}
        contentFontSize={14}
        messages={messages}
        theme="light"
      />,
    );

    await waitFor(() => {
      expect(monacoEditorApi.onDidScrollChange).toHaveBeenCalled();
    });
    monacoEditorApi.restoreViewState.mockClear();

    tab = {
      ...tab,
      content: {
        ...tab.content!,
        content: "export const value = 99;\n",
        modifiedAt: 2000,
        sizeBytes: 25,
      },
      savedContent: "export const value = 99;\n",
      isDirty: false,
    };
    rerender(
      <CodeContent
        projectId={1}
        tab={tab}
        contentFontSize={14}
        messages={messages}
        theme="light"
      />,
    );

    await waitFor(() => {
      expect(monacoEditorApi.restoreViewState).toHaveBeenCalled();
    });
  });

  it("keeps occurrence highlighting off and enables validation decorations for typescript", async () => {
    render(
      <CodeContent
        projectId={1}
        tab={buildTab()}
        contentFontSize={14}
        messages={messages}
        theme="dark"
      />,
    );

    await waitFor(() => {
      expect(lastEditorOptions.current).not.toBeNull();
    });
    expect(lastEditorOptions.current).toMatchObject({
      occurrencesHighlight: "off",
      selectionHighlight: false,
      renderValidationDecorations: "on",
    });
  });

  it("keeps validation decorations off for markdown", async () => {
    render(
      <CodeContent
        projectId={1}
        tab={buildTab({
          fileName: "readme.md",
          filePath: "docs/readme.md",
          content: {
            filePath: "docs/readme.md",
            language: "markdown",
            content: "# hi\n",
            modifiedAt: 1000,
            sizeBytes: 5,
            isBinary: false,
            isTooLarge: false,
          },
        })}
        contentFontSize={14}
        messages={messages}
        theme="dark"
      />,
    );

    await waitFor(() => {
      expect(lastEditorOptions.current).not.toBeNull();
    });
    expect(lastEditorOptions.current).toMatchObject({
      renderValidationDecorations: "off",
    });
  });

  it("uses a stable file uri as the editor path", async () => {
    render(
      <CodeContent
        projectId={1}
        tab={buildTab()}
        contentFontSize={14}
        messages={messages}
        theme="light"
        workspacePath="/tmp/redwhisk"
      />,
    );

    expect(screen.getByTestId("monaco-editor")).toHaveAttribute(
      "data-path",
      "file:///tmp/redwhisk/src/file.ts",
    );
  });

  it("shows a lightweight unavailable hint above the editor", async () => {
    render(
      <I18nProvider initialLocale="en">
        <CodeContent
          projectId={1}
          tab={buildTab()}
          contentFontSize={14}
          messages={messages}
          theme="light"
          unavailableReason="nodeNotFound"
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Node.js was not found, so TS/JS language intelligence is unavailable.",
    );
    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
  });
});
