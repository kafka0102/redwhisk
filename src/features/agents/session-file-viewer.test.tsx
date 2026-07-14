import { render } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import type { SessionWorkspaceFileTab } from "./session-workspace-types";
import { SessionFileViewer } from "./session-file-viewer";

// 捕获 Monaco Editor 实际接收到的 theme prop，用于断言文件查看器跟随应用明暗主题。
const { editorThemeProp } = vi.hoisted(() => ({
  editorThemeProp: { current: undefined as string | undefined },
}));

vi.mock("@monaco-editor/react", () => ({
  Editor: ({ theme }: { theme?: string }) => {
    editorThemeProp.current = theme;
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
    sizeBytes: 24,
  },
  isLoading: false,
  errorMessage: null,
};

describe("SessionFileViewer", () => {
  beforeEach(() => {
    editorThemeProp.current = undefined;
    window.localStorage.clear();
  });

  it("renders the editor with the light Monaco theme by default", () => {
    render(
      <I18nProvider initialLocale="en">
        <SessionFileViewer tab={fileTab} />
      </I18nProvider>,
    );

    expect(editorThemeProp.current).toBe("light");
  });

  it("renders the editor with the vs-dark Monaco theme under dark mode", () => {
    window.localStorage.setItem("redwhisk.theme", "dark");
    render(
      <I18nProvider initialLocale="en">
        <SessionFileViewer tab={fileTab} />
      </I18nProvider>,
    );

    expect(editorThemeProp.current).toBe("vs-dark");
  });
});
