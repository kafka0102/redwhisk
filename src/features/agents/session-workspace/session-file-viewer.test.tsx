import { act, render, waitFor } from "@testing-library/react";
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
    return null;
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

  it("does not restore a position cached for another project", async () => {
    seedReadingPosition(420, { projectId: 2 });

    render(renderViewer());

    await waitFor(() => {
      expect(monacoEditorApi.onDidScrollChange).toHaveBeenCalled();
    });
    expect(monacoEditorApi.restoreViewState).not.toHaveBeenCalled();
  });
});
