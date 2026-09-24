import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { I18nProvider } from "../i18n/i18n";
import { getDiffAvailability } from "./diff-availability";
import { DiffViewer, type WorkspaceDiffTab } from "./diff-viewer";
import { estimateDiffEditorContentHeightPx } from "./estimate-diff-editor-content-height";

// 捕获 Monaco DiffEditor 实际接收到的 theme prop，用于断言 diff 查看器跟随应用明暗主题。
const { editorThemeProp, editorHeightProp } = vi.hoisted(() => ({
  editorThemeProp: { current: undefined as string | undefined },
  editorHeightProp: { current: undefined as string | number | undefined },
}));

vi.mock("@monaco-editor/react", () => ({
  DiffEditor: ({
    theme,
    height,
  }: {
    theme?: string;
    height?: string | number;
  }) => {
    editorThemeProp.current = theme;
    editorHeightProp.current = height;
    return null;
  },
}));

vi.mock("../use-monaco-editor-ready", () => ({
  useMonacoEditorReady: () => true,
}));

const diffTab: WorkspaceDiffTab = {
  fileName: "a.ts",
  filePath: "a.ts",
  diff: {
    filePath: "a.ts",
    oldPath: null,
    kind: "modified",
    language: "typescript",
    originalContent: "const value = 1;",
    modifiedContent: "const value = 2;",
    isBinary: false,
    isTooLarge: false,
  },
  isLoading: false,
  errorMessage: null,
};

describe("DiffViewer", () => {
  beforeEach(() => {
    editorThemeProp.current = undefined;
    editorHeightProp.current = undefined;
    window.localStorage.clear();
  });

  it("renders the empty state when no tab is selected", () => {
    render(
      <I18nProvider initialLocale="en">
        <DiffViewer tab={null} />
      </I18nProvider>,
    );

    expect(screen.getByText("Select a changed file.")).toBeInTheDocument();
  });

  it("renders the diff editor with the light Monaco theme by default", () => {
    render(
      <I18nProvider initialLocale="en">
        <DiffViewer tab={diffTab} />
      </I18nProvider>,
    );

    expect(editorThemeProp.current).toBe("light");
  });

  it("renders the diff editor with the vs-dark Monaco theme under dark mode", () => {
    window.localStorage.setItem("redwhisk.theme", "dark");
    render(
      <I18nProvider initialLocale="en">
        <DiffViewer tab={diffTab} />
      </I18nProvider>,
    );

    expect(editorThemeProp.current).toBe("vs-dark");
  });

  it("fills the parent with height 100% by default", () => {
    render(
      <I18nProvider initialLocale="en">
        <DiffViewer tab={diffTab} />
      </I18nProvider>,
    );

    expect(editorHeightProp.current).toBe("100%");
  });

  it("uses a content-derived pixel height in content height mode", () => {
    const multiLineTab: WorkspaceDiffTab = {
      ...diffTab,
      diff: {
        ...diffTab.diff!,
        originalContent: "line1\nline2\nline3",
        modifiedContent: "line1\nline2",
      },
    };

    render(
      <I18nProvider initialLocale="en">
        <DiffViewer tab={multiLineTab} heightMode="content" />
      </I18nProvider>,
    );

    const expected = estimateDiffEditorContentHeightPx(
      "line1\nline2\nline3",
      "line1\nline2",
      14,
    );
    expect(editorHeightProp.current).toBe(`${expected}px`);
    expect(expected).toBeGreaterThan(0);
  });

  it("estimateDiffEditorContentHeightPx takes the larger side line count", () => {
    // 3 vs 5 lines → 5; fontSize 14 → ceil(14 * 1.5)=21; +12 chrome
    expect(
      estimateDiffEditorContentHeightPx("a\nb\nc", "1\n2\n3\n4\n5", 14),
    ).toBe(5 * 21 + 12);
  });

  // 摘要视图靠 getDiffAvailability 决定是否切 hunk，这里把状态判定与详情视图实际
  // 渲染的状态绑定，避免两处状态语义漂移。
  it("keeps the rendered state ladder in sync with getDiffAvailability", () => {
    const cases: Array<{
      tab: WorkspaceDiffTab | null;
      kind: string;
      message: string | null;
    }> = [
      { tab: null, kind: "none", message: "Select a changed file." },
      {
        tab: { ...diffTab, isLoading: true },
        kind: "loading",
        message: "Loading diff...",
      },
      {
        tab: { ...diffTab, errorMessage: "boom" },
        kind: "error",
        message: "boom",
      },
      {
        tab: { ...diffTab, diff: null },
        kind: "none",
        message: "Select a changed file.",
      },
      {
        tab: { ...diffTab, diff: { ...diffTab.diff!, isBinary: true } },
        kind: "unavailable",
        message: "Binary files cannot be previewed.",
      },
      {
        tab: { ...diffTab, diff: { ...diffTab.diff!, isTooLarge: true } },
        kind: "unavailable",
        message: "This file is too large to preview.",
      },
      { tab: diffTab, kind: "content", message: null },
    ];

    for (const testCase of cases) {
      const { unmount } = render(
        <I18nProvider initialLocale="en">
          <DiffViewer tab={testCase.tab} />
        </I18nProvider>,
      );

      expect(getDiffAvailability(testCase.tab).kind).toBe(testCase.kind);
      if (testCase.message) {
        expect(screen.getByText(testCase.message)).toBeInTheDocument();
      } else {
        expect(document.querySelector(".session-viewer-state")).toBeNull();
      }

      unmount();
    }
  });
});
