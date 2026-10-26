const { openPath } = vi.hoisted(() => ({
  openPath: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: (...args: unknown[]) => openPath(...args),
}));

const mermaidMock = vi.hoisted(() => {
  return {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string, _source: string) => ({
      svg: '<svg data-testid="mermaid-svg"><text>diagram</text></svg>',
    })),
  };
});

vi.mock("mermaid", () => ({
  default: mermaidMock,
}));

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
    openPath.mockReset();
    mermaidMock.initialize.mockClear();
    mermaidMock.render.mockReset();
    mermaidMock.render.mockImplementation(
      async (_id: string, _source: string) => ({
        svg: '<svg data-testid="mermaid-svg"><text>diagram</text></svg>',
      }),
    );
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

  it("shows Open in browser on the path row for html", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <SessionFileViewer
          projectId={projectId}
          sessionId={sessionId}
          workspacePath="/repo"
          tab={{
            fileName: "index.html",
            filePath: "docs/index.html",
            content: {
              ...fileTab.content!,
              content: "<!doctype html><html></html>\n",
              filePath: "docs/index.html",
              language: "html",
            },
            isLoading: false,
            errorMessage: null,
          }}
        />
      </I18nProvider>,
    );

    const pathText = screen.getByText("docs/index.html");
    const pathRow = pathText.parentElement;
    expect(pathRow).not.toBeNull();
    const controls = [...pathRow!.querySelectorAll("button, a")];
    const lastControl = controls[controls.length - 1];
    expect(lastControl).toBe(
      screen.getByRole("button", { name: "Open in browser" }),
    );
    expect(
      pathText.compareDocumentPosition(lastControl!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Open in browser" }));
    expect(openPath).toHaveBeenCalledWith("/repo/docs/index.html");
  });

  it("shows Open in browser for htm files regardless of case", () => {
    render(htmlViewerElement({ fileName: "page.HTM", filePath: "page.HTM" }));

    expect(
      screen.getByRole("button", { name: "Open in browser" }),
    ).toBeInTheDocument();
  });

  it.each([
    "readme.md",
    "photo.png",
    "notes.pdf",
    "mark.svg",
    "index.xhtml",
    "html",
  ])("does not show Open in browser for %s", (fileName) => {
    render(htmlViewerElement({ fileName, filePath: fileName }));

    expect(screen.getByText(fileName)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open in browser" }),
    ).not.toBeInTheDocument();
  });

  it("hides the path row and Open in browser while loading, failed, empty, or too large", () => {
    const { rerender } = render(htmlViewerElement({ isLoading: true }));
    expect(screen.queryByText("docs/index.html")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open in browser" }),
    ).not.toBeInTheDocument();

    rerender(htmlViewerElement({ errorMessage: "read failed" }));
    expect(screen.queryByText("docs/index.html")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open in browser" }),
    ).not.toBeInTheDocument();

    rerender(htmlViewerElement({ content: null }));
    expect(screen.queryByText("docs/index.html")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open in browser" }),
    ).not.toBeInTheDocument();

    rerender(
      htmlViewerElement({
        content: {
          ...fileTab.content!,
          content: "",
          filePath: "docs/index.html",
          language: "html",
          isTooLarge: true,
        },
      }),
    );
    expect(screen.queryByText("docs/index.html")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open in browser" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("This file is too large to preview."),
    ).toBeInTheDocument();
  });

  it("does not show Open in browser when the workspace root is empty", () => {
    const { rerender } = render(htmlViewerElement({}, ""));

    expect(screen.getByText("docs/index.html")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open in browser" }),
    ).not.toBeInTheDocument();

    rerender(htmlViewerElement({}, null));
    expect(
      screen.queryByRole("button", { name: "Open in browser" }),
    ).not.toBeInTheDocument();
  });

  it("alerts with the existing browser failure message when opening fails", async () => {
    openPath.mockRejectedValue(new Error("blocked"));
    const user = userEvent.setup();
    render(htmlViewerElement());

    await user.click(screen.getByRole("button", { name: "Open in browser" }));

    expect(
      await screen.findByText("Could not open this file in the browser."),
    ).toBeInTheDocument();
  });

  it("toggles markdown preview from the right side of the path row", async () => {
    const user = userEvent.setup();
    render(markdownViewerElement());

    const pathText = screen.getByText("docs/readme.md");
    const pathRow = pathText.parentElement;
    expect(pathRow).not.toBeNull();
    const controls = [...pathRow!.querySelectorAll("button, a")];
    const toggle = screen.getByRole("button", { name: "Markdown preview" });
    expect(controls[controls.length - 1]).toBe(toggle);
    expect(toggle).toHaveAttribute("aria-label", "Markdown preview");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Hello" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open in browser" }),
    ).not.toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Hello" })).toBeInTheDocument();
    expect(screen.queryByTestId("monaco-editor")).not.toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.queryByRole("heading", { name: "Hello" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
  });

  it("names the markdown preview toggle in Chinese", () => {
    render(markdownViewerElement({}, "zh"));

    expect(
      screen.getByRole("button", { name: "Markdown 预览" }),
    ).toHaveAttribute("aria-label", "Markdown 预览");
  });

  it.each([
    ["mdx", "note.mdx"],
    ["html", "page.html"],
    ["", "notes.txt"],
    [null, "notes.txt"],
  ] as const)(
    "does not show Markdown preview when language is %s",
    (language, fileName) => {
      render(
        markdownViewerElement({
          fileName,
          filePath: fileName,
          content: {
            ...fileTab.content!,
            content: "# Hello\n",
            filePath: fileName,
            language,
          },
        }),
      );

      expect(screen.getByText(fileName)).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Markdown preview" }),
      ).not.toBeInTheDocument();
    },
  );

  it("keeps only the browser action for html and htm files", () => {
    const { rerender } = render(htmlViewerElement());

    expect(
      screen.getByRole("button", { name: "Open in browser" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Markdown preview" }),
    ).not.toBeInTheDocument();

    rerender(htmlViewerElement({ fileName: "page.HTM", filePath: "page.HTM" }));
    expect(
      screen.getByRole("button", { name: "Open in browser" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Markdown preview" }),
    ).not.toBeInTheDocument();
  });

  it("shows neither preview nor browser action for page.vue", () => {
    render(
      htmlViewerElement({
        fileName: "page.vue",
        filePath: "page.vue",
        content: {
          ...fileTab.content!,
          content: "<template></template>\n",
          filePath: "page.vue",
          language: "html",
        },
      }),
    );

    expect(screen.getByText("page.vue")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Markdown preview" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open in browser" }),
    ).not.toBeInTheDocument();
  });

  it("hides both path actions when a markdown file is unavailable", () => {
    const unavailableContent = {
      ...fileTab.content!,
      content: "# Hello\n",
      filePath: "docs/readme.md",
      language: "markdown" as const,
    };
    const { rerender } = render(markdownViewerElement({ isLoading: true }));
    expect(
      screen.queryByRole("button", { name: "Markdown preview" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open in browser" }),
    ).not.toBeInTheDocument();

    rerender(markdownViewerElement({ errorMessage: "read failed" }));
    expect(
      screen.queryByRole("button", { name: "Markdown preview" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open in browser" }),
    ).not.toBeInTheDocument();

    rerender(markdownViewerElement({ content: null }));
    expect(
      screen.queryByRole("button", { name: "Markdown preview" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open in browser" }),
    ).not.toBeInTheDocument();

    rerender(
      markdownViewerElement({
        content: { ...unavailableContent, isTooLarge: true },
      }),
    );
    expect(
      screen.queryByRole("button", { name: "Markdown preview" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open in browser" }),
    ).not.toBeInTheDocument();

    rerender(
      markdownViewerElement({
        content: { ...unavailableContent, isBinary: true },
      }),
    );
    expect(
      screen.queryByRole("button", { name: "Markdown preview" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open in browser" }),
    ).not.toBeInTheDocument();
  });

  it("returns to source when the open markdown file changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      markdownViewerElement({
        fileName: "a.md",
        filePath: "a.md",
        content: {
          ...fileTab.content!,
          content: "# Hello\n",
          filePath: "a.md",
          language: "markdown",
        },
      }),
    );
    await user.click(screen.getByRole("button", { name: "Markdown preview" }));
    expect(screen.getByRole("heading", { name: "Hello" })).toBeInTheDocument();

    rerender(
      markdownViewerElement({
        fileName: "b.md",
        filePath: "b.md",
        content: {
          ...fileTab.content!,
          content: "# Other\n",
          filePath: "b.md",
          language: "markdown",
        },
      }),
    );

    expect(
      screen.getByRole("button", { name: "Markdown preview" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.queryByRole("heading", { name: "Hello" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Other" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
  });

  it("returns to source after the markdown viewer is closed and opened again", async () => {
    const user = userEvent.setup();
    const view = render(markdownViewerElement());
    await user.click(screen.getByRole("button", { name: "Markdown preview" }));
    expect(screen.getByRole("heading", { name: "Hello" })).toBeInTheDocument();

    view.unmount();
    render(markdownViewerElement());

    expect(
      screen.getByRole("button", { name: "Markdown preview" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.queryByRole("heading", { name: "Hello" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
  });

  it("renders a mermaid fence with the code workspace preview", async () => {
    const user = userEvent.setup();
    render(
      markdownViewerElement({
        content: {
          ...fileTab.content!,
          content: "```mermaid\nflowchart TD\n  A --> B\n```\n",
          filePath: "docs/readme.md",
          language: "markdown",
        },
      }),
    );

    await user.click(screen.getByRole("button", { name: "Markdown preview" }));

    expect(
      await screen.findByTestId("code-mermaid-diagram"),
    ).toBeInTheDocument();
  });
});

function htmlViewerElement(
  tabOverrides: Partial<SessionWorkspaceFileTab> = {},
  workspacePath: string | null = "/repo",
) {
  return (
    <I18nProvider initialLocale="en">
      <SessionFileViewer
        projectId={projectId}
        sessionId={sessionId}
        workspacePath={workspacePath}
        tab={{
          fileName: "index.html",
          filePath: "docs/index.html",
          content: {
            ...fileTab.content!,
            content: "<!doctype html><html></html>\n",
            filePath: "docs/index.html",
            language: "html",
          },
          isLoading: false,
          errorMessage: null,
          ...tabOverrides,
        }}
      />
    </I18nProvider>
  );
}

function markdownViewerElement(
  tabOverrides: Partial<SessionWorkspaceFileTab> = {},
  locale: "en" | "zh" = "en",
) {
  return (
    <I18nProvider initialLocale={locale}>
      <SessionFileViewer
        projectId={projectId}
        sessionId={sessionId}
        workspacePath="/repo"
        tab={{
          fileName: "readme.md",
          filePath: "docs/readme.md",
          content: {
            ...fileTab.content!,
            content: "# Hello\n",
            filePath: "docs/readme.md",
            language: "markdown",
          },
          isLoading: false,
          errorMessage: null,
          ...tabOverrides,
        }}
      />
    </I18nProvider>
  );
}
