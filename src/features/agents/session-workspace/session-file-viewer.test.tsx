import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../shared/i18n/i18n";
import {
  readEditorReadingPosition,
  resetEditorReadingPositionsForTests,
  writeEditorReadingPosition,
  type EditorReadingPosition,
} from "../../../shared/workspace/editor-reading-position";
import { sessionFileReadingPositionKey } from "./session-file-reading-position";
import type { SessionWorkspaceFileTab } from "./session-workspace-types";
import { SessionFileViewer } from "./session-file-viewer";

// 捕获 Monaco Editor 实际接收到的 theme prop，用于断言文件查看器跟随应用明暗主题。
const { editorThemeProp } = vi.hoisted(() => ({
  editorThemeProp: { current: undefined as string | undefined },
}));

/** 假编辑器：只提供阅读位置保持用到的公开契约。 */
const monacoEditorApi = vi.hoisted(() => ({
  layoutHeight: 600,
  layoutListeners: [] as Array<() => void>,
  scrollListeners: [] as Array<() => void>,
  restoreViewState: vi.fn(),
  saveViewState: vi.fn(() => ({ scrollTop: 120 })),
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
  onDidScrollChange: vi.fn((listener: () => void) => {
    monacoEditorApi.scrollListeners.push(listener);
    return {
      dispose: vi.fn(() => {
        monacoEditorApi.scrollListeners =
          monacoEditorApi.scrollListeners.filter((item) => item !== listener);
      }),
    };
  }),
  onDidDispose: vi.fn((_listener: () => void) => undefined),
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
    this.getLayoutInfo.mockClear();
    this.onDidLayoutChange.mockClear();
    this.onDidScrollChange.mockClear();
    this.onDidDispose.mockClear();
    this.layoutHeight = 600;
    this.layoutListeners = [];
    this.scrollListeners = [];
  },
}));

vi.mock("../../../shared/use-monaco-editor-ready", () => ({
  useMonacoEditorReady: () => true,
}));

vi.mock("@monaco-editor/react", () => ({
  Editor: ({
    theme,
    onMount,
  }: {
    theme?: string;
    onMount?: (editor: {
      saveViewState: () => unknown;
      restoreViewState: (state: unknown) => void;
      getLayoutInfo: () => { height: number };
      onDidLayoutChange: (listener: () => void) => { dispose: () => void };
      onDidScrollChange: (listener: () => void) => { dispose: () => void };
      onDidDispose: (listener: () => void) => void;
    }) => void;
  }) => {
    const didMountRef = useRef(false);
    editorThemeProp.current = theme;
    useEffect(() => {
      if (didMountRef.current) {
        return;
      }
      didMountRef.current = true;
      onMount?.({
        saveViewState: () => monacoEditorApi.saveViewState(),
        restoreViewState: (state) => monacoEditorApi.restoreViewState(state),
        getLayoutInfo: () => monacoEditorApi.getLayoutInfo(),
        onDidLayoutChange: (listener) =>
          monacoEditorApi.onDidLayoutChange(listener),
        onDidScrollChange: (listener) =>
          monacoEditorApi.onDidScrollChange(listener),
        onDidDispose: (listener) => monacoEditorApi.onDidDispose(listener),
      });
    }, [onMount]);
    return <div data-testid="monaco-editor" />;
  },
}));

const fileTab: SessionWorkspaceFileTab = {
  fileName: "file.ts",
  filePath: "src/file.ts",
  content: {
    content: "export const value = 1;\n",
    filePath: "src/file.ts",
    isBinary: false,
    isTooLarge: false,
    previewKind: null,
    previewBytesBase64: "",
    language: "typescript",
    modifiedAt: null,
    sizeBytes: 24,
  },
  isLoading: false,
  errorMessage: null,
};

const projectId = 1;
const sessionId = 7;
const readingKey = sessionFileReadingPositionKey(
  projectId,
  sessionId,
  fileTab.filePath,
);

function seedReadingPosition(
  scrollTop: number,
  options: { projectId?: number; sessionId?: number; filePath?: string } = {},
): void {
  writeEditorReadingPosition(
    sessionFileReadingPositionKey(
      options.projectId ?? projectId,
      options.sessionId ?? sessionId,
      options.filePath ?? fileTab.filePath,
    ),
    { scrollTop } as unknown as EditorReadingPosition,
  );
}

function renderViewer(overrides: Partial<SessionWorkspaceFileTab> = {}) {
  return (
    <I18nProvider initialLocale="en">
      <SessionFileViewer
        projectId={projectId}
        sessionId={sessionId}
        tab={{ ...fileTab, ...overrides }}
      />
    </I18nProvider>
  );
}

describe("SessionFileViewer", () => {
  beforeEach(() => {
    editorThemeProp.current = undefined;
    window.localStorage.clear();
    resetEditorReadingPositionsForTests();
    monacoEditorApi.reset();
  });

  it("renders the editor with the light Monaco theme by default", () => {
    render(renderViewer());

    expect(editorThemeProp.current).toBe("light");
  });

  it("renders the editor with the vs-dark Monaco theme under dark mode", () => {
    window.localStorage.setItem("redwhisk.theme", "dark");
    render(renderViewer());

    expect(editorThemeProp.current).toBe("vs-dark");
  });

  it("restores the reading position after the viewer is unmounted and mounted again", async () => {
    seedReadingPosition(420);
    const view = render(renderViewer());

    await waitFor(() => {
      expect(monacoEditorApi.restoreViewState).toHaveBeenCalledWith({
        scrollTop: 420,
      });
    });

    // 切走 Activity：卸载时写回当前位置；切回后停在原位置。
    monacoEditorApi.saveViewState.mockReturnValue({ scrollTop: 300 });
    monacoEditorApi.restoreViewState.mockClear();
    view.unmount();
    expect(readEditorReadingPosition(readingKey)).toEqual({ scrollTop: 300 });

    render(renderViewer());
    await waitFor(() => {
      expect(monacoEditorApi.restoreViewState).toHaveBeenCalledWith({
        scrollTop: 300,
      });
    });
  });

  it("restores the reading position when the hidden pane becomes visible again", async () => {
    seedReadingPosition(420);
    render(renderViewer());

    await waitFor(() => {
      expect(monacoEditorApi.restoreViewState).toHaveBeenCalledTimes(1);
    });

    // 同 Session 内被其它 Tab 遮蔽：布局归 0；期间 Monaco 报出的顶部滚动不得覆盖缓存。
    monacoEditorApi.saveViewState.mockReturnValue({ scrollTop: 0 });
    monacoEditorApi.layoutHeight = 0;
    act(() => {
      monacoEditorApi.lastScrollListener()?.();
    });
    expect(readEditorReadingPosition(readingKey)).toEqual({ scrollTop: 420 });
    act(() => {
      monacoEditorApi.setLayoutHeight(0);
    });

    act(() => {
      monacoEditorApi.setLayoutHeight(600);
    });
    expect(monacoEditorApi.restoreViewState).toHaveBeenCalledTimes(2);
    expect(monacoEditorApi.restoreViewState).toHaveBeenLastCalledWith({
      scrollTop: 420,
    });
  });

  it("waits for a non-zero layout height before restoring", async () => {
    monacoEditorApi.layoutHeight = 0;
    seedReadingPosition(420);

    render(renderViewer());

    await waitFor(() => {
      expect(monacoEditorApi.onDidLayoutChange).toHaveBeenCalled();
    });
    expect(monacoEditorApi.restoreViewState).not.toHaveBeenCalled();

    act(() => {
      monacoEditorApi.setLayoutHeight(600);
    });
    expect(monacoEditorApi.restoreViewState).toHaveBeenCalledWith({
      scrollTop: 420,
    });
  });

  it("keeps each session's reading position isolated for the same file", async () => {
    seedReadingPosition(420, { sessionId: 8 });

    render(renderViewer());

    await waitFor(() => {
      expect(monacoEditorApi.onDidScrollChange).toHaveBeenCalled();
    });
    expect(monacoEditorApi.restoreViewState).not.toHaveBeenCalled();
  });

  it("previews a bitmap and a PDF without an editor", () => {
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const { rerender } = render(
      renderViewer({
        fileName: "pixel.png",
        filePath: "assets/pixel.png",
        content: {
          ...fileTab.content!,
          filePath: "assets/pixel.png",
          language: null,
          content: "",
          isBinary: true,
          previewKind: "image",
          previewBytesBase64: png,
        },
      }),
    );

    expect(screen.getByRole("img", { name: "pixel.png" })).toHaveAttribute(
      "src",
      expect.stringMatching(/^blob:/),
    );
    expect(
      screen.queryByText("Binary files cannot be previewed."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit file" }),
    ).not.toBeInTheDocument();

    rerender(
      renderViewer({
        fileName: "notes.pdf",
        filePath: "docs/notes.pdf",
        content: {
          ...fileTab.content!,
          filePath: "docs/notes.pdf",
          language: null,
          content: "",
          isBinary: true,
          previewKind: "pdf",
          previewBytesBase64: btoa("%PDF-1.1\n"),
        },
      }),
    );

    expect(screen.getByTitle("notes.pdf").tagName).toBe("IFRAME");
  });

  it("toggles SVG text from the viewer header and resets when the file changes", async () => {
    const user = userEvent.setup();
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg>';
    const { rerender } = render(
      renderViewer({
        fileName: "mark.svg",
        filePath: "assets/mark.svg",
        content: {
          ...fileTab.content!,
          filePath: "assets/mark.svg",
          language: "xml",
          content: svg,
          isBinary: false,
          previewKind: "image",
          previewBytesBase64: btoa(svg),
        },
      }),
    );

    const toggle = screen.getByRole("button", { name: "SVG preview" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: "mark.svg" })).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();

    await user.click(toggle);
    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();

    rerender(
      renderViewer({
        fileName: "other.svg",
        filePath: "assets/other.svg",
        content: {
          ...fileTab.content!,
          filePath: "assets/other.svg",
          language: "xml",
          content: svg,
          isBinary: false,
          previewKind: "image",
          previewBytesBase64: btoa(svg),
        },
      }),
    );

    expect(screen.getByRole("button", { name: "SVG preview" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("img", { name: "other.svg" })).toBeInTheDocument();

    rerender(
      renderViewer({
        fileName: "mark.svg",
        filePath: "assets/mark.svg",
        content: {
          ...fileTab.content!,
          filePath: "assets/mark.svg",
          language: "xml",
          content: svg,
          isBinary: false,
          previewKind: "image",
          previewBytesBase64: btoa(svg),
        },
      }),
    );
    expect(screen.getByRole("button", { name: "SVG preview" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("img", { name: "mark.svg" })).toBeInTheDocument();
  });

  it("keeps binary and oversized files unavailable in the session viewer", () => {
    const { rerender } = render(
      renderViewer({
        content: {
          ...fileTab.content!,
          content: "",
          isBinary: true,
          previewKind: null,
          previewBytesBase64: "",
        },
      }),
    );
    expect(
      screen.getByText("Binary files cannot be previewed."),
    ).toBeInTheDocument();

    rerender(
      renderViewer({
        content: {
          ...fileTab.content!,
          isTooLarge: true,
          previewKind: null,
          previewBytesBase64: "",
        },
      }),
    );
    expect(
      screen.getByText("This file is too large to preview."),
    ).toBeInTheDocument();
  });

  it("shows a preview load failure for a corrupt PDF", () => {
    render(
      renderViewer({
        fileName: "broken.pdf",
        filePath: "docs/broken.pdf",
        content: {
          ...fileTab.content!,
          filePath: "docs/broken.pdf",
          language: null,
          content: "",
          isBinary: true,
          previewKind: "pdf",
          previewBytesBase64: "%%%",
        },
      }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Failed to load preview.",
    );
    expect(
      screen.queryByText("Binary files cannot be previewed."),
    ).not.toBeInTheDocument();
  });

  it("does not restore a position cached for another project", async () => {
    seedReadingPosition(420, { projectId: 2 });

    render(renderViewer());

    await waitFor(() => {
      expect(monacoEditorApi.onDidScrollChange).toHaveBeenCalled();
    });
    expect(monacoEditorApi.restoreViewState).not.toHaveBeenCalled();
  });
});
