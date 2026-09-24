import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n/i18n";
import { estimateDiffEditorContentHeightPx } from "./estimate-diff-editor-content-height";
import type { MultiDiffViewState } from "./multi-diff-types";
import { MultiDiffViewer } from "./multi-diff-viewer";

const { multiDiffEditorHeightProp } = vi.hoisted(() => ({
  multiDiffEditorHeightProp: {
    current: undefined as string | number | undefined,
  },
}));

vi.mock("@monaco-editor/react", () => ({
  DiffEditor: ({ height }: { height?: string | number }) => {
    multiDiffEditorHeightProp.current = height;
    return null;
  },
}));

vi.mock("../use-monaco-editor-ready", () => ({
  useMonacoEditorReady: () => true,
}));

const loadedState: MultiDiffViewState = {
  commitHash: "abc",
  mode: "details",
  files: [
    {
      fileName: "a.ts",
      filePath: "src/a.ts",
      status: "M",
      kind: "modified",
      diff: {
        filePath: "src/a.ts",
        oldPath: null,
        kind: "modified",
        language: "typescript",
        originalContent: "old\nline2\nline3\nline4",
        modifiedContent: "new\nline2\nline3",
        isBinary: false,
        isTooLarge: false,
      },
      isLoading: false,
      errorMessage: null,
    },
    {
      fileName: "b.ts",
      filePath: "src/b.ts",
      status: "A",
      kind: "added",
      diff: null,
      isLoading: true,
      errorMessage: null,
    },
  ],
};

describe("MultiDiffViewer", () => {
  it("renders empty state when the commit has no files", () => {
    render(
      <I18nProvider initialLocale="en">
        <MultiDiffViewer
          state={{ commitHash: "empty", mode: "details", files: [] }}
        />
      </I18nProvider>,
    );

    expect(
      screen.getByText("This commit has no file changes."),
    ).toBeInTheDocument();
  });

  it("renders sticky panel headers with filename and full relative path", () => {
    render(
      <I18nProvider initialLocale="en">
        <MultiDiffViewer state={loadedState} />
      </I18nProvider>,
    );

    expect(screen.getByLabelText("Commit all changes")).toBeInTheDocument();
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("b.ts")).toBeInTheDocument();
    expect(screen.getByText("src/b.ts")).toBeInTheDocument();
    expect(screen.getAllByText("Loading diff...").length).toBeGreaterThan(0);

    const headers = document.querySelectorAll(".multi-diff-panel__header");
    expect(headers).toHaveLength(2);
    for (const header of headers) {
      expect(header).toHaveClass("multi-diff-panel__header");
    }
  });

  it("collapses a panel body by default-expanded toggle", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <MultiDiffViewer state={loadedState} />
      </I18nProvider>,
    );

    const collapseA = screen.getByRole("button", { name: "Collapse a.ts" });
    expect(collapseA).toHaveAttribute("aria-expanded", "true");
    await user.click(collapseA);
    expect(screen.getByRole("button", { name: "Expand a.ts" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    // b still loading visible; a collapsed so only one Loading if b still loading
    expect(screen.getAllByText("Loading diff...").length).toBeGreaterThan(0);
  });

  it("shows per-file error without a page-level summary bar", () => {
    const errorState: MultiDiffViewState = {
      commitHash: "err",
      mode: "details",
      files: [
        {
          fileName: "a.ts",
          filePath: "src/a.ts",
          status: "M",
          kind: "modified",
          diff: null,
          isLoading: false,
          errorMessage: "diff failed",
        },
      ],
    };
    render(
      <I18nProvider initialLocale="en">
        <MultiDiffViewer state={errorState} />
      </I18nProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("diff failed");
    expect(
      document.querySelector(".session-diff-viewer__status"),
    ).not.toBeInTheDocument();
  });

  it("uses content-height Monaco panes so outer multi-diff is the only scroller", () => {
    multiDiffEditorHeightProp.current = undefined;
    render(
      <I18nProvider initialLocale="en">
        <MultiDiffViewer state={loadedState} />
      </I18nProvider>,
    );

    expect(document.querySelector(".multi-diff-viewer")).toBeInTheDocument();
    const body = document.querySelector(".multi-diff-panel__body");
    expect(body).toBeInTheDocument();
    // body is a layout shell, not an inline fixed 360px window
    expect((body as HTMLElement).style.height).not.toBe("360px");

    const expected = estimateDiffEditorContentHeightPx(
      "old\nline2\nline3\nline4",
      "new\nline2\nline3",
      14,
    );
    expect(multiDiffEditorHeightProp.current).toBe(`${expected}px`);
    expect(multiDiffEditorHeightProp.current).not.toBe("100%");
  });

  it("keeps sticky panel headers for VSCode-style top replacement", () => {
    render(
      <I18nProvider initialLocale="en">
        <MultiDiffViewer state={loadedState} />
      </I18nProvider>,
    );

    const headers = document.querySelectorAll(".multi-diff-panel__header");
    expect(headers.length).toBe(2);
    headers.forEach((header) => {
      expect(header).toHaveClass("multi-diff-panel__header");
    });
  });

  it("renders hunks instead of the whole-file diff in summary mode", () => {
    multiDiffEditorHeightProp.current = undefined;
    const summaryState: MultiDiffViewState = {
      commitHash: "sum",
      mode: "summary",
      files: [
        {
          fileName: "a.ts",
          filePath: "src/a.ts",
          status: "M",
          kind: "modified",
          diff: {
            filePath: "src/a.ts",
            oldPath: null,
            kind: "modified",
            language: "typescript",
            originalContent: "l1\nl2\nl3\nl4\nl5\nl6\n",
            modifiedContent: "l1\nl2\nL3\nl4\nl5\nl6\n",
            isBinary: false,
            isTooLarge: false,
          },
          isLoading: false,
          errorMessage: null,
        },
      ],
    };
    render(
      <I18nProvider initialLocale="en">
        <MultiDiffViewer state={summaryState} />
      </I18nProvider>,
    );

    expect(screen.getByLabelText("Commit change summary")).toBeInTheDocument();
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(document.querySelectorAll(".diff-summary__hunk")).toHaveLength(1);
    expect(screen.getByText("Lines 1-6")).toBeInTheDocument();
    expect(screen.getByText("Original lines 1-6")).toBeInTheDocument();
    // 摘要模式不再渲染整文件 Monaco 对比
    expect(multiDiffEditorHeightProp.current).toBeUndefined();
  });

  it("keeps the details label in details mode", () => {
    render(
      <I18nProvider initialLocale="en">
        <MultiDiffViewer state={loadedState} />
      </I18nProvider>,
    );

    expect(screen.getByLabelText("Commit all changes")).toBeInTheDocument();
    expect(screen.queryByLabelText("Commit change summary")).toBeNull();
  });
});
