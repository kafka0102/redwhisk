import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import type { WorkspaceFileTreeNode } from "../../shared/workspace/workspace-commands";
import { searchProjectWorktreeContent } from "../../shared/workspace/workspace-commands";
import { CodeSearchPanel } from "./code-search-panel";
import {
  DEFAULT_CODE_CONTENT_SEARCH_STATE,
  type CodeContentSearchState,
} from "./code-search-state";
import "../../shared/styles/code-workspace.css";

vi.mock("../../shared/workspace/workspace-commands", () => ({
  searchProjectWorktreeContent: vi.fn(),
}));

const SAMPLE_TREE: WorkspaceFileTreeNode[] = [
  {
    id: "src",
    name: "src",
    path: "src",
    kind: "directory",
    isIgnored: false,
    children: [
      {
        id: "src/a.ts",
        name: "a.ts",
        path: "src/a.ts",
        kind: "file",
        isIgnored: false,
      },
      {
        id: "src/b.ts",
        name: "b.ts",
        path: "src/b.ts",
        kind: "file",
        isIgnored: false,
      },
      {
        id: "src/c.rs",
        name: "c.rs",
        path: "src/c.rs",
        kind: "file",
        isIgnored: false,
      },
    ],
  },
  {
    id: "readme.md",
    name: "readme.md",
    path: "readme.md",
    kind: "file",
    isIgnored: false,
  },
];

function StatefulPanel({
  initial = DEFAULT_CODE_CONTENT_SEARCH_STATE,
  fileTree = SAMPLE_TREE,
  onOpenMatch = vi.fn(),
  onChangeSpy,
}: {
  initial?: CodeContentSearchState;
  fileTree?: readonly WorkspaceFileTreeNode[];
  onOpenMatch?: (match: {
    fileName: string;
    filePath: string;
    lineNumber: number;
  }) => void;
  onChangeSpy?: (next: CodeContentSearchState) => void;
}) {
  const [state, setState] = useState(initial);
  return (
    <CodeSearchPanel
      state={state}
      onChange={(next) => {
        onChangeSpy?.(next);
        setState(next);
      }}
      projectId={1}
      workspacePath="/tmp/root"
      fileTree={fileTree}
      onOpenMatch={onOpenMatch}
    />
  );
}

describe("CodeSearchPanel", () => {
  beforeEach(() => {
    vi.mocked(searchProjectWorktreeContent).mockReset();
  });

  it("renders query, match options, include/exclude tag rows and empty results", () => {
    render(
      <I18nProvider initialLocale="en">
        <StatefulPanel />
      </I18nProvider>,
    );

    expect(screen.getByLabelText("Search")).toBeInTheDocument();
    expect(screen.getByLabelText("Match Case")).toBeInTheDocument();
    expect(screen.getByLabelText("Match Whole Word")).toBeInTheDocument();
    expect(screen.getByLabelText("Use Regular Expression")).toBeInTheDocument();
    expect(screen.getAllByLabelText("files to include").length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByLabelText("files to exclude").length).toBeGreaterThan(
      0,
    );
    expect(screen.getByLabelText("Search results")).toBeInTheDocument();
    expect(
      screen.getByText("No results yet. Press Enter to search."),
    ).toBeInTheDocument();
  });

  it("adds include tags on Enter and does not auto-search", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <StatefulPanel />
      </I18nProvider>,
    );

    const includeInput = screen
      .getAllByLabelText("files to include")
      .find((el) => el.tagName === "INPUT");
    expect(includeInput).toBeTruthy();
    await user.type(includeInput!, "src/**{Enter}");
    expect(screen.getByText("src/**")).toBeInTheDocument();
    expect(searchProjectWorktreeContent).not.toHaveBeenCalled();
  });

  it("picks a suffix from the dropdown as **/*.<ext> tag", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <StatefulPanel />
      </I18nProvider>,
    );

    const pickers = screen.getAllByLabelText("Common file extensions");
    await user.click(pickers[0]);
    await user.click(await screen.findByRole("menuitem", { name: ".ts" }));
    expect(screen.getByText("**/*.ts")).toBeInTheDocument();
    expect(searchProjectWorktreeContent).not.toHaveBeenCalled();
  });

  it("removes a filter tag without searching", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <StatefulPanel
          initial={{
            ...DEFAULT_CODE_CONTENT_SEARCH_STATE,
            includeTags: ["**/*.ts"],
          }}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("**/*.ts")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Remove **/*.ts"));
    expect(screen.queryByText("**/*.ts")).not.toBeInTheDocument();
    expect(searchProjectWorktreeContent).not.toHaveBeenCalled();
  });

  it("searches on Enter with include/exclude tags, renders stats and opens a match", async () => {
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
        <StatefulPanel
          initial={{
            ...DEFAULT_CODE_CONTENT_SEARCH_STATE,
            includeTags: ["**/*.ts"],
            excludeTags: ["**/*.test.ts"],
          }}
          onOpenMatch={onOpenMatch}
        />
      </I18nProvider>,
    );

    await user.type(screen.getByLabelText("Search"), "foo");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(searchProjectWorktreeContent).toHaveBeenCalledWith({
        projectId: 1,
        workspacePath: "/tmp/root",
        query: "foo",
        matchCase: false,
        matchWholeWord: false,
        useRegex: false,
        include: ["**/*.ts"],
        exclude: ["**/*.test.ts"],
      });
    });
    expect(
      await screen.findByText("1 files · 2 matches (truncated)"),
    ).toBeInTheDocument();
    expect(screen.getByText("app.ts")).toBeInTheDocument();

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

  it("prioritizes full file name over path in result group headers", async () => {
    const user = userEvent.setup();
    vi.mocked(searchProjectWorktreeContent).mockResolvedValue({
      fileCount: 1,
      matchCount: 2,
      truncated: false,
      files: [
        {
          filePath: "src/features/code/very-long-module-name.ts",
          fileName: "very-long-module-name.ts",
          matchCount: 2,
          matches: [
            { lineNumber: 1, lineText: "const a = 1;" },
            { lineNumber: 2, lineText: "const b = 2;" },
          ],
        },
      ],
    });

    render(
      <I18nProvider initialLocale="en">
        <StatefulPanel />
      </I18nProvider>,
    );

    await user.type(screen.getByLabelText("Search"), "const");
    await user.keyboard("{Enter}");

    const name = await screen.findByText("very-long-module-name.ts");
    const pathEl = screen.getByTitle(
      "src/features/code/very-long-module-name.ts",
    );
    const header = name.closest(".code-workspace__search-file-header");
    expect(header).toBeTruthy();
    const count = header!.querySelector(".code-workspace__search-file-count");
    expect(count).toBeTruthy();
    expect(count).toHaveTextContent("2");

    expect(name).toHaveClass("code-workspace__search-file-name");
    expect(pathEl).toHaveClass("code-workspace__search-file-path");

    const nameStyle = window.getComputedStyle(name);
    const pathStyle = window.getComputedStyle(pathEl);
    const countStyle = window.getComputedStyle(count!);

    // 路径优先收缩并省略；计数永不收缩；文件名仅作最后手段可收缩。
    expect(Number.parseFloat(pathStyle.flexShrink)).toBeGreaterThan(
      Number.parseFloat(nameStyle.flexShrink),
    );
    expect(pathStyle.minWidth).toBe("0px");
    expect(pathStyle.textOverflow).toBe("ellipsis");
    expect(countStyle.flexShrink).toBe("0");
    expect(nameStyle.textOverflow).toBe("ellipsis");
    expect(nameStyle.whiteSpace).toBe("nowrap");
  });

  it("keeps match option toggles without auto-search", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <StatefulPanel />
      </I18nProvider>,
    );

    await user.click(screen.getByLabelText("Match Case"));
    expect(screen.getByLabelText("Match Case")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(searchProjectWorktreeContent).not.toHaveBeenCalled();
  });
});
