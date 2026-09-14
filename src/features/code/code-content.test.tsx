import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import {
  readEditorReadingPosition,
  resetEditorReadingPositionsForTests,
  writeEditorReadingPosition,
  type EditorReadingPosition,
} from "../../shared/workspace/editor-reading-position";
import {
  codeEditorReadingPositionKey,
  type CodeFileTab,
} from "./code-workspace-cache";
import { CodeContent } from "./code-content";

const monacoEditorApi = vi.hoisted(() => ({
  layoutHeight: 600,
  layoutListeners: [] as Array<() => void>,
  restoreViewState: vi.fn(),
  saveViewState: vi.fn(() => ({ scrollTop: 120 })),
  revealLineInCenter: vi.fn(),
  setPosition: vi.fn(),
  focus: vi.fn(),
  getLayoutInfo: vi.fn(() => ({ height: monacoEditorApi.layoutHeight })),
  onDidLayoutChange: vi.fn((listener: () => void) => {
    monacoEditorApi.layoutListeners.push(listener);
    return {
      dispose: vi.fn(() => {
        monacoEditorApi.layoutListeners =
          monacoEditorApi.layoutListeners.filter((item) => item !== listener);
      }),
    };
  }),
  onDidScrollChange: vi.fn((_listener: () => void) => ({
    dispose: vi.fn(),
  })),
  onDidDispose: vi.fn((_listener: () => void) => undefined),
  addAction: vi.fn((_descriptor: unknown) => ({ dispose: vi.fn() })),
  getAction: vi.fn((_id: string) => ({ run: vi.fn() })),
  /** 模拟容器由 display:none（高度 0）变为真实高度时 Monaco 的布局事件。 */
  setLayoutHeight(height: number) {
    monacoEditorApi.layoutHeight = height;
    for (const listener of [...monacoEditorApi.layoutListeners]) {
      listener();
    }
  },
  lastScrollListener() {
    const calls = monacoEditorApi.onDidScrollChange.mock.calls;
    return calls[calls.length - 1]?.[0];
  },
  reset() {
    this.restoreViewState.mockClear();
    this.saveViewState.mockClear();
    this.saveViewState.mockReturnValue({ scrollTop: 120 });
    this.revealLineInCenter.mockClear();
    this.setPosition.mockClear();
    this.focus.mockClear();
    this.getLayoutInfo.mockClear();
    this.onDidLayoutChange.mockClear();
    this.onDidScrollChange.mockClear();
    this.onDidDispose.mockClear();
    this.addAction.mockClear();
    this.getAction.mockClear();
    this.layoutHeight = 600;
    this.layoutListeners = [];
  },
}));

const lastEditorOptions = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

vi.mock("monaco-editor", () => ({
  KeyMod: { Shift: 1024 },
  KeyCode: { F12: 70 },
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
    addKeybindingRule: vi.fn(() => ({ dispose: vi.fn() })),
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
      getLayoutInfo: () => { height: number };
      onDidLayoutChange: (listener: () => void) => { dispose: () => void };
      onDidScrollChange: (listener: () => void) => { dispose: () => void };
      onDidDispose: (listener: () => void) => void;
      addAction: (descriptor: unknown) => { dispose: () => void };
      getAction: (id: string) => { run: () => void } | null;
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
        getLayoutInfo: () => monacoEditorApi.getLayoutInfo(),
        onDidLayoutChange: (listener) =>
          monacoEditorApi.onDidLayoutChange(listener),
        onDidScrollChange: (listener) =>
          monacoEditorApi.onDidScrollChange(listener),
        onDidDispose: (listener) => monacoEditorApi.onDidDispose(listener),
        addAction: (descriptor) => monacoEditorApi.addAction(descriptor),
        getAction: (id) => monacoEditorApi.getAction(id),
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
    resetEditorReadingPositionsForTests();
    monacoEditorApi.reset();
    lastEditorOptions.current = null;
  });

  it("does not restore view state when only the local buffer content changes", async () => {
    const user = userEvent.setup();
    writeEditorReadingPosition(codeEditorReadingPositionKey(1, "src/file.ts"), {
      scrollTop: 420,
    } as unknown as EditorReadingPosition);
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
    writeEditorReadingPosition(codeEditorReadingPositionKey(1, "src/file.ts"), {
      scrollTop: 420,
    } as unknown as EditorReadingPosition);
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
      expect(monacoEditorApi.restoreViewState).toHaveBeenCalledWith({
        scrollTop: 420,
      });
    });
  });

  it("waits for a non-zero layout height before restoring the reading position", async () => {
    monacoEditorApi.layoutHeight = 0;
    writeEditorReadingPosition(codeEditorReadingPositionKey(1, "src/file.ts"), {
      scrollTop: 420,
    } as unknown as EditorReadingPosition);

    render(
      <CodeContent
        projectId={1}
        tab={buildTab()}
        contentFontSize={14}
        messages={messages}
        theme="light"
      />,
    );

    await waitFor(() => {
      expect(monacoEditorApi.onDidLayoutChange).toHaveBeenCalled();
    });
    expect(monacoEditorApi.restoreViewState).not.toHaveBeenCalled();

    act(() => {
      monacoEditorApi.setLayoutHeight(600);
    });

    expect(monacoEditorApi.restoreViewState).toHaveBeenCalledTimes(1);
    expect(monacoEditorApi.restoreViewState).toHaveBeenCalledWith({
      scrollTop: 420,
    });
  });

  it("keeps the saved reading position when a zero-height container reports a scroll", async () => {
    monacoEditorApi.layoutHeight = 0;
    monacoEditorApi.saveViewState.mockReturnValue({ scrollTop: 0 });
    const readingKey = codeEditorReadingPositionKey(1, "src/file.ts");
    writeEditorReadingPosition(readingKey, {
      scrollTop: 420,
    } as unknown as EditorReadingPosition);

    render(
      <CodeContent
        projectId={1}
        tab={buildTab()}
        contentFontSize={14}
        messages={messages}
        theme="light"
      />,
    );

    await waitFor(() => {
      expect(monacoEditorApi.onDidScrollChange).toHaveBeenCalled();
    });
    act(() => {
      monacoEditorApi.lastScrollListener()?.();
    });
    expect(readEditorReadingPosition(readingKey)).toEqual({ scrollTop: 420 });

    act(() => {
      monacoEditorApi.setLayoutHeight(600);
    });
    expect(monacoEditorApi.restoreViewState).toHaveBeenCalledWith({
      scrollTop: 420,
    });
  });

  it("restores the reading position once per load identity", async () => {
    writeEditorReadingPosition(codeEditorReadingPositionKey(1, "src/file.ts"), {
      scrollTop: 420,
    } as unknown as EditorReadingPosition);

    render(
      <CodeContent
        projectId={1}
        tab={buildTab()}
        contentFontSize={14}
        messages={messages}
        theme="light"
      />,
    );

    await waitFor(() => {
      expect(monacoEditorApi.restoreViewState).toHaveBeenCalledTimes(1);
    });
    act(() => {
      monacoEditorApi.setLayoutHeight(700);
      monacoEditorApi.setLayoutHeight(800);
    });

    expect(monacoEditorApi.restoreViewState).toHaveBeenCalledTimes(1);
  });

  it("keeps the reading position when the layout collapses and becomes visible again", async () => {
    const readingKey = codeEditorReadingPositionKey(1, "src/file.ts");
    writeEditorReadingPosition(readingKey, {
      scrollTop: 420,
    } as unknown as EditorReadingPosition);

    render(
      <CodeContent
        projectId={1}
        tab={buildTab()}
        contentFontSize={14}
        messages={messages}
        theme="light"
      />,
    );

    await waitFor(() => {
      expect(monacoEditorApi.restoreViewState).toHaveBeenCalledTimes(1);
    });

    // 容器塌陷：布局尺寸先变 0，Monaco 把滚动位置裁剪到顶部并触发一次滚动事件，
    // 此时布局变更事件可能尚未送达，缓存不得被这次噪声覆盖。
    monacoEditorApi.saveViewState.mockReturnValue({ scrollTop: 0 });
    monacoEditorApi.layoutHeight = 0;
    act(() => {
      monacoEditorApi.lastScrollListener()?.();
    });
    expect(readEditorReadingPosition(readingKey)).toEqual({ scrollTop: 420 });

    act(() => {
      monacoEditorApi.setLayoutHeight(0);
    });
    expect(monacoEditorApi.restoreViewState).toHaveBeenCalledTimes(1);

    // 重新可见：布局高度恢复后补做一次恢复。
    act(() => {
      monacoEditorApi.setLayoutHeight(600);
    });
    expect(monacoEditorApi.restoreViewState).toHaveBeenCalledTimes(2);
    expect(monacoEditorApi.restoreViewState).toHaveBeenLastCalledWith({
      scrollTop: 420,
    });
  });

  it("keeps a revealed line instead of the cached position on a zero-height mount", async () => {
    monacoEditorApi.layoutHeight = 0;
    writeEditorReadingPosition(codeEditorReadingPositionKey(1, "src/file.ts"), {
      scrollTop: 420,
    } as unknown as EditorReadingPosition);

    render(
      <CodeContent
        projectId={1}
        tab={buildTab()}
        contentFontSize={14}
        messages={messages}
        theme="light"
        revealRequest={{ filePath: "src/file.ts", lineNumber: 120, token: 1 }}
      />,
    );

    await waitFor(() => {
      expect(monacoEditorApi.onDidLayoutChange).toHaveBeenCalled();
    });
    expect(monacoEditorApi.revealLineInCenter).toHaveBeenCalledWith(120);

    act(() => {
      monacoEditorApi.setLayoutHeight(600);
    });

    expect(monacoEditorApi.restoreViewState).not.toHaveBeenCalled();
  });

  it("restores the top position when the user left the file at the top", async () => {
    const readingKey = codeEditorReadingPositionKey(1, "src/file.ts");

    const view = render(
      <CodeContent
        projectId={1}
        tab={buildTab()}
        contentFontSize={14}
        messages={messages}
        theme="light"
      />,
    );

    await waitFor(() => {
      expect(monacoEditorApi.onDidScrollChange).toHaveBeenCalled();
    });
    // 用户滚到顶部：滚动事件把顶部位置写回缓存。
    monacoEditorApi.saveViewState.mockReturnValue({ scrollTop: 0 });
    act(() => {
      monacoEditorApi.lastScrollListener()?.();
    });
    expect(readEditorReadingPosition(readingKey)).toEqual({ scrollTop: 0 });

    view.unmount();
    monacoEditorApi.restoreViewState.mockClear();
    render(
      <CodeContent
        projectId={1}
        tab={buildTab()}
        contentFontSize={14}
        messages={messages}
        theme="light"
      />,
    );

    await waitFor(() => {
      expect(monacoEditorApi.restoreViewState).toHaveBeenCalledWith({
        scrollTop: 0,
      });
    });
  });

  it("does not restore a reading position for another file", async () => {
    writeEditorReadingPosition(
      codeEditorReadingPositionKey(1, "src/other.ts"),
      { scrollTop: 420 } as unknown as EditorReadingPosition,
    );

    render(
      <CodeContent
        projectId={1}
        tab={buildTab()}
        contentFontSize={14}
        messages={messages}
        theme="light"
      />,
    );

    await waitFor(() => {
      expect(monacoEditorApi.onDidScrollChange).toHaveBeenCalled();
    });
    expect(monacoEditorApi.restoreViewState).not.toHaveBeenCalled();
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
      gotoLocation: {
        multiple: "peek",
        multipleDefinitions: "peek",
        multipleReferences: "peek",
      },
    });
    await waitFor(() => {
      expect(monacoEditorApi.addAction).toHaveBeenCalled();
    });
    expect(monacoEditorApi.addAction.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "codeLanguage.goToDefinition",
          contextMenuGroupId: "navigation",
        }),
        expect.objectContaining({
          id: "codeLanguage.findReferences",
          contextMenuGroupId: "navigation",
        }),
      ]),
    );
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
