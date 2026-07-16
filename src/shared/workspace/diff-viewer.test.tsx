import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { I18nProvider } from "../i18n/i18n";
import { DiffViewer, type WorkspaceDiffTab } from "./diff-viewer";

// 捕获 Monaco DiffEditor 实际接收到的 theme prop，用于断言 diff 查看器跟随应用明暗主题。
const { editorThemeProp } = vi.hoisted(() => ({
  editorThemeProp: { current: undefined as string | undefined },
}));

vi.mock("@monaco-editor/react", () => ({
  DiffEditor: ({ theme }: { theme?: string }) => {
    editorThemeProp.current = theme;
    return null;
  },
}));

const diffTab: WorkspaceDiffTab = {
  fileName: "a.ts",
  filePath: "a.ts",
  diff: {
    filePath: "a.ts",
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
});
