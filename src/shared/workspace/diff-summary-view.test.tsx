import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n/i18n";
import { DiffSummaryView } from "./diff-summary-view";
import type { WorkspaceDiffContent } from "./workspace-commands";

vi.mock("@monaco-editor/react", () => ({
  DiffEditor: () => null,
}));

vi.mock("../use-monaco-editor-ready", () => ({
  useMonacoEditorReady: () => true,
}));

function makeDiff(
  overrides: Partial<WorkspaceDiffContent>,
): WorkspaceDiffContent {
  return {
    filePath: "src/a.ts",
    oldPath: null,
    kind: "modified",
    language: "typescript",
    originalContent: "",
    modifiedContent: "",
    isBinary: false,
    isTooLarge: false,
    ...overrides,
  };
}

function renderSummary(diff: WorkspaceDiffContent) {
  return render(
    <I18nProvider initialLocale="en">
      <DiffSummaryView
        tab={{
          fileName: "a.ts",
          filePath: "src/a.ts",
          diff,
          isLoading: false,
          errorMessage: null,
        }}
      />
    </I18nProvider>,
  );
}

const thirtyLines = Array.from({ length: 30 }, (_, index) => `l${index + 1}`);
const insertedLines = [
  ...thirtyLines.slice(0, 15),
  "added1",
  "added2",
  ...thirtyLines.slice(15),
];

const insertionDiff = makeDiff({
  originalContent: `${thirtyLines.join("\n")}\n`,
  modifiedContent: `${insertedLines.join("\n")}\n`,
});

describe("DiffSummaryView", () => {
  it("labels a hunk with the new-side range and the original range when it deletes lines", () => {
    renderSummary(
      makeDiff({
        originalContent: "l1\nl2\nl3\nl4\nl5\nl6\n",
        modifiedContent: "l1\nl2\nl3\nl4\n",
      }),
    );

    expect(screen.getByText("Lines 2-4")).toBeInTheDocument();
    expect(screen.getByText("Original lines 2-6")).toBeInTheDocument();
  });

  it("shows the original range as the only label for a pure deletion", () => {
    renderSummary(
      makeDiff({
        kind: "deleted",
        originalContent: "a\nb\nc\n",
        modifiedContent: "",
      }),
    );

    expect(screen.getByText("Original lines 1-3")).toBeInTheDocument();
    expect(screen.queryByText("Lines 1-3")).toBeNull();
  });

  it("renders a single-line range without a range dash", () => {
    renderSummary(
      makeDiff({ originalContent: "only", modifiedContent: "ONLY" }),
    );

    expect(screen.getByText("Line 1")).toBeInTheDocument();
    expect(screen.getByText("Original line 1")).toBeInTheDocument();
  });

  it("renders every hunk line with both line numbers, the marker and the text", () => {
    renderSummary(insertionDiff);

    expect(screen.getByText("Lines 13-20")).toBeInTheDocument();
    // 纯插入 hunk 没有删除行，不附原文件范围。
    expect(screen.queryByText("Original lines 13-18")).toBeNull();

    const contextLine = screen.getByText("l13").closest("div");
    expect(contextLine).toHaveClass("diff-summary__line--context");
    expect(contextLine?.textContent).toBe("1313l13");

    const addedLine = screen.getByText("added1").closest("div");
    expect(addedLine).toHaveClass("diff-summary__line--added");
    expect(addedLine?.textContent).toBe("16+added1");
  });

  it("expands hunks by default and toggles them with the header button", async () => {
    const user = userEvent.setup();
    renderSummary(insertionDiff);

    const collapseButton = screen.getByRole("button", {
      name: "Collapse Lines 13-20",
    });
    expect(collapseButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("l13")).toBeInTheDocument();

    await user.click(collapseButton);

    expect(
      screen.getByRole("button", { name: "Expand Lines 13-20" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("l13")).toBeNull();
    expect(screen.getByText("Lines 13-20")).toBeInTheDocument();
  });

  it("reports a file without content changes", () => {
    renderSummary(
      makeDiff({
        kind: "renamed",
        originalContent: "same\n",
        modifiedContent: "same\n",
      }),
    );

    expect(screen.getByText("No content changes")).toBeInTheDocument();
  });

  it("keeps the unavailable states of the details view", () => {
    renderSummary(makeDiff({ kind: "binary", isBinary: true }));
    expect(
      screen.getByText("Binary files cannot be previewed."),
    ).toBeInTheDocument();
  });

  it("keeps the too-large state of the details view", () => {
    renderSummary(makeDiff({ isTooLarge: true }));
    expect(
      screen.getByText("This file is too large to preview."),
    ).toBeInTheDocument();
  });
});
