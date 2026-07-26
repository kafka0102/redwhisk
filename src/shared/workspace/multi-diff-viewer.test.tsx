import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n/i18n";
import type { MultiDiffViewState } from "./multi-diff-types";
import { MultiDiffViewer } from "./multi-diff-viewer";

vi.mock("@monaco-editor/react", () => ({
  DiffEditor: () => null,
}));

vi.mock("../use-monaco-editor-ready", () => ({
  useMonacoEditorReady: () => true,
}));

const loadedState: MultiDiffViewState = {
  commitHash: "abc",
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
        originalContent: "old",
        modifiedContent: "new",
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
        <MultiDiffViewer state={{ commitHash: "empty", files: [] }} />
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
});
