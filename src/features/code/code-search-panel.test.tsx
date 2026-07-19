import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import { searchProjectWorktreeContent } from "../../shared/workspace/workspace-commands";
import { CodeSearchPanel } from "./code-search-panel";
import {
  DEFAULT_CODE_CONTENT_SEARCH_STATE,
  type CodeContentSearchState,
} from "./code-search-state";

vi.mock("../../shared/workspace/workspace-commands", () => ({
  searchProjectWorktreeContent: vi.fn(),
}));

function StatefulPanel({
  initial = DEFAULT_CODE_CONTENT_SEARCH_STATE,
  onOpenMatch = vi.fn(),
}: {
  initial?: CodeContentSearchState;
  onOpenMatch?: (match: {
    fileName: string;
    filePath: string;
    lineNumber: number;
  }) => void;
}) {
  const [state, setState] = useState(initial);
  return (
    <CodeSearchPanel
      state={state}
      onChange={setState}
      projectId={1}
      workspacePath="/tmp/root"
      onOpenMatch={onOpenMatch}
    />
  );
}

describe("CodeSearchPanel", () => {
  beforeEach(() => {
    vi.mocked(searchProjectWorktreeContent).mockReset();
  });

  it("renders query, match options, include/exclude rows and empty results", () => {
    render(
      <I18nProvider initialLocale="en">
        <StatefulPanel />
      </I18nProvider>,
    );

    expect(screen.getByLabelText("Search")).toBeInTheDocument();
    expect(screen.getByLabelText("Match Case")).toBeInTheDocument();
    expect(screen.getByLabelText("Match Whole Word")).toBeInTheDocument();
    expect(screen.getByLabelText("Use Regular Expression")).toBeInTheDocument();
    expect(screen.getByLabelText("files to include")).toBeInTheDocument();
    expect(screen.getByLabelText("files to exclude")).toBeInTheDocument();
    expect(screen.getByLabelText("Search results")).toBeInTheDocument();
    expect(
      screen.getByText("No results yet. Press Enter to search."),
    ).toBeInTheDocument();
  });

  it("keeps query and match option state while editing", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <StatefulPanel />
      </I18nProvider>,
    );

    await user.type(screen.getByLabelText("Search"), "foo");
    expect(screen.getByLabelText("Search")).toHaveValue("foo");

    await user.click(screen.getByLabelText("Match Case"));
    expect(screen.getByLabelText("Match Case")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.type(screen.getByLabelText("files to include"), "*.ts");
    expect(screen.getByLabelText("files to include")).toHaveValue("*.ts");
  });

  it("searches on Enter, renders stats and groups, and opens a match", async () => {
    const user = userEvent.setup();
    const onOpenMatch = vi.fn();
    vi.mocked(searchProjectWorktreeContent).mockResolvedValue({
      fileCount: 1,
      matchCount: 2,
      truncated: true,
      files: [
        {
          filePath: "src/app.ts",
          fileName: "app.ts",
          matchCount: 2,
          matches: [
            { lineNumber: 3, lineText: "  const foo = 1;" },
            { lineNumber: 8, lineText: "return foo;" },
          ],
        },
      ],
    });

    render(
      <I18nProvider initialLocale="en">
        <StatefulPanel onOpenMatch={onOpenMatch} />
      </I18nProvider>,
    );

    await user.type(screen.getByLabelText("Search"), "foo");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(searchProjectWorktreeContent).toHaveBeenCalled();
    });
    expect(
      await screen.findByText("1 files · 2 matches (truncated)"),
    ).toBeInTheDocument();
    expect(screen.getByText("app.ts")).toBeInTheDocument();
    expect(screen.getByText("src/app.ts")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Open app.ts at line 3" }),
    );
    expect(onOpenMatch).toHaveBeenCalledWith({
      fileName: "app.ts",
      filePath: "src/app.ts",
      lineNumber: 3,
    });
  });

  it("shows invalid regex errors from the command", async () => {
    const user = userEvent.setup();
    vi.mocked(searchProjectWorktreeContent).mockRejectedValue({
      code: "AGENT_SESSION_VALIDATION_FAILED",
      message: "搜索正则无效。",
      reason: "invalidSearchRegex",
    });

    render(
      <I18nProvider initialLocale="en">
        <StatefulPanel />
      </I18nProvider>,
    );

    await user.click(screen.getByLabelText("Use Regular Expression"));
    await user.type(screen.getByLabelText("Search"), "(");
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid search regular expression.",
    );
  });
});
