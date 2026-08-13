import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n/i18n";
import { toast } from "../toast";
import { openCommitOnGithub } from "./open-commit-on-github";
import {
  ChangedFileRow,
  CommittedChangesTimeline,
} from "./workspace-changes-view";
import type {
  WorkspaceChangedFile,
  WorkspaceCommitChangedFile,
  WorkspaceCommitRecord,
} from "./workspace-commands";

vi.mock("../toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    message: vi.fn(),
    dismiss: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("./open-commit-on-github", () => ({
  openCommitOnGithub: vi.fn(),
}));

const toastSuccessMock = vi.mocked(toast.success);
const toastErrorMock = vi.mocked(toast.error);

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider initialLocale="en">{children}</I18nProvider>;
}

function makeCommit(
  overrides: Partial<WorkspaceCommitRecord>,
): WorkspaceCommitRecord {
  return {
    hash: overrides.hash ?? "h",
    shortHash: overrides.shortHash ?? "h",
    message: overrides.message ?? "msg",
    authorName: overrides.authorName ?? "Alice",
    committedAt: overrides.committedAt ?? 0,
    files: overrides.files ?? [],
    isPushed: overrides.isPushed ?? false,
    pushedTo: overrides.pushedTo ?? null,
    isCreatedInWorktree: overrides.isCreatedInWorktree ?? false,
  };
}

const noop = () => {};
const baseProps = {
  errorMessage: null,
  expandedCommitHashes: new Set<string>(),
  isLoading: false,
  onOpenCommittedChangedFile: noop,
  onToggleCommit: noop,
};

describe("CommittedChangesTimeline base branch tag", () => {
  it("renders base tag on the first yellow commit when baseBranch is provided in worktree mode", () => {
    // newest-first：idx0 黄色（fork point）、idx1 新增（蓝）。
    const commits = [
      makeCommit({
        hash: "base",
        message: "base commit",
        isCreatedInWorktree: false,
      }),
      makeCommit({
        hash: "new",
        message: "new commit",
        isCreatedInWorktree: true,
      }),
    ];

    render(
      <CommittedChangesTimeline
        {...baseProps}
        commits={commits}
        isWorktree={true}
        baseBranch="main"
      />,
      { wrapper },
    );

    const baseRow = screen.getByText("base commit").closest("button");
    expect(baseRow).not.toBeNull();
    expect(
      baseRow?.querySelector(".session-commit-row__base-tag"),
    ).not.toBeNull();
    expect(
      baseRow?.querySelector(".session-commit-row__base-tag"),
    ).toHaveTextContent("main");

    // 新增 commit 不渲染 base tag。
    const newRow = screen.getByText("new commit").closest("button");
    expect(newRow?.querySelector(".session-commit-row__base-tag")).toBeNull();
  });

  it("defers pushed tag to the next pushed commit when base and pushed land on the same commit", () => {
    // idx0：同时是首条黄色 + 首条已 push（fork point 已 push）-> base 占位，pushed 顺延。
    // idx1：新增 + 已 push -> pushed Tag 落此。
    const commits = [
      makeCommit({
        hash: "base",
        isCreatedInWorktree: false,
        isPushed: true,
        pushedTo: "origin/main",
      }),
      makeCommit({
        hash: "new",
        isCreatedInWorktree: true,
        isPushed: true,
        pushedTo: "origin/main",
      }),
    ];

    render(
      <CommittedChangesTimeline
        {...baseProps}
        commits={commits}
        isWorktree={true}
        baseBranch="main"
      />,
      { wrapper },
    );

    const rows = screen.getAllByRole("button");
    const baseRow = rows[0];
    const pushedRow = rows[1];

    // 首条 commit：显示 base tag，不显示 pushed tag。
    expect(
      baseRow.querySelector(".session-commit-row__base-tag"),
    ).not.toBeNull();
    expect(baseRow.querySelector(".session-commit-row__remote-tag")).toBeNull();

    // 顺延后：第二条 commit 显示 pushed tag，不显示 base tag。
    expect(
      pushedRow.querySelector(".session-commit-row__remote-tag"),
    ).not.toBeNull();
    expect(pushedRow.querySelector(".session-commit-row__base-tag")).toBeNull();
  });

  it("renders base and pushed tags on their respective commits when they differ", () => {
    // idx0：首条黄色、未 push -> base Tag。
    // idx1：新增、已 push -> pushed Tag。
    const commits = [
      makeCommit({
        hash: "base",
        isCreatedInWorktree: false,
        isPushed: false,
        pushedTo: null,
      }),
      makeCommit({
        hash: "new",
        isCreatedInWorktree: true,
        isPushed: true,
        pushedTo: "origin/main",
      }),
    ];

    render(
      <CommittedChangesTimeline
        {...baseProps}
        commits={commits}
        isWorktree={true}
        baseBranch="main"
      />,
      { wrapper },
    );

    const rows = screen.getAllByRole("button");
    expect(
      rows[0].querySelector(".session-commit-row__base-tag"),
    ).not.toBeNull();
    expect(rows[0].querySelector(".session-commit-row__remote-tag")).toBeNull();
    expect(
      rows[1].querySelector(".session-commit-row__remote-tag"),
    ).not.toBeNull();
    expect(rows[1].querySelector(".session-commit-row__base-tag")).toBeNull();
  });

  it("does not render base tag and keeps pushed tag behavior when baseBranch is absent", () => {
    // 非 worktree（baseBranch 缺省）：不渲染 base Tag；首条已 push commit 显示 pushed Tag。
    const commits = [
      makeCommit({
        hash: "p",
        isPushed: true,
        pushedTo: "origin/main",
      }),
      makeCommit({ hash: "n", isPushed: false, pushedTo: null }),
    ];

    const { container } = render(
      <CommittedChangesTimeline
        {...baseProps}
        commits={commits}
        isWorktree={false}
      />,
      { wrapper },
    );

    expect(container.querySelector(".session-commit-row__base-tag")).toBeNull();

    const rows = screen.getAllByRole("button");
    expect(
      rows[0].querySelector(".session-commit-row__remote-tag"),
    ).not.toBeNull();
    expect(rows[1].querySelector(".session-commit-row__remote-tag")).toBeNull();
  });
});

describe("CommittedChangesTimeline commit context menu", () => {
  const writeTextMock = vi.fn();

  beforeEach(() => {
    toastSuccessMock.mockReset();
    writeTextMock.mockReset();
    writeTextMock.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: writeTextMock },
    });
  });

  function renderTimeline(
    overrides: Partial<Parameters<typeof CommittedChangesTimeline>[0]> = {},
  ) {
    const commits = [
      makeCommit({
        hash: "abcdef1234567890",
        shortHash: "abcdef1",
        message: "fix: timeline menu",
      }),
    ];
    return render(
      <CommittedChangesTimeline
        {...baseProps}
        commits={commits}
        isWorktree={false}
        {...overrides}
      />,
      { wrapper },
    );
  }

  function openContextMenuOnCommit() {
    const row = screen.getByRole("button", { name: /fix: timeline menu/i });
    fireEvent.contextMenu(row, { clientX: 40, clientY: 80 });
    return row;
  }

  it("opens menu on right-click with open / copy id / copy message in order", async () => {
    renderTimeline();
    openContextMenuOnCommit();

    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Open Changes",
      "Copy Commit ID",
      "Copy Commit Message",
    ]);
  });

  it("does not toggle expand on right-click", () => {
    const onToggleCommit = vi.fn();
    renderTimeline({ onToggleCommit });
    openContextMenuOnCommit();
    expect(onToggleCommit).not.toHaveBeenCalled();
  });

  it("still toggles expand on left-click", () => {
    const onToggleCommit = vi.fn();
    renderTimeline({ onToggleCommit });
    fireEvent.click(
      screen.getByRole("button", { name: /fix: timeline menu/i }),
    );
    expect(onToggleCommit).toHaveBeenCalledWith("abcdef1234567890");
  });

  it("copies full commit hash and toasts on success", async () => {
    renderTimeline();
    openContextMenuOnCommit();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Copy Commit ID" }),
    );
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("abcdef1234567890");
      expect(toastSuccessMock).toHaveBeenCalledWith("Copied to clipboard");
    });
  });

  it("copies commit subject message and toasts on success", async () => {
    renderTimeline();
    openContextMenuOnCommit();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Copy Commit Message" }),
    );
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("fix: timeline menu");
      expect(toastSuccessMock).toHaveBeenCalledWith("Copied to clipboard");
    });
  });

  it("silently ignores clipboard write failure", async () => {
    writeTextMock.mockRejectedValue(new Error("denied"));
    renderTimeline();
    openContextMenuOnCommit();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Copy Commit ID" }),
    );
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalled();
    });
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it("calls onOpenCommitChanges and expands collapsed commit", async () => {
    const onOpenCommitChanges = vi.fn();
    const onToggleCommit = vi.fn();
    renderTimeline({
      onOpenCommitChanges,
      onToggleCommit,
      expandedCommitHashes: new Set(),
    });
    openContextMenuOnCommit();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Open Changes" }),
    );

    expect(onOpenCommitChanges).toHaveBeenCalledTimes(1);
    expect(onOpenCommitChanges.mock.calls[0][0]).toMatchObject({
      hash: "abcdef1234567890",
      message: "fix: timeline menu",
    });
    expect(onToggleCommit).toHaveBeenCalledWith("abcdef1234567890");
  });

  it("calls onOpenCommitChanges without collapsing an already expanded commit", async () => {
    const onOpenCommitChanges = vi.fn();
    const onToggleCommit = vi.fn();
    renderTimeline({
      onOpenCommitChanges,
      onToggleCommit,
      expandedCommitHashes: new Set(["abcdef1234567890"]),
    });
    openContextMenuOnCommit();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Open Changes" }),
    );

    expect(onOpenCommitChanges).toHaveBeenCalledTimes(1);
    expect(onToggleCommit).not.toHaveBeenCalled();
  });

  it("hides Open on GitHub when githubRemote is absent regardless of isPushed", async () => {
    renderTimeline({
      commits: [
        makeCommit({
          hash: "abcdef1234567890",
          shortHash: "abcdef1",
          message: "fix: timeline menu",
          isPushed: true,
          pushedTo: "origin/main",
        }),
      ],
      githubRemote: null,
    });
    openContextMenuOnCommit();
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Open Changes",
      "Copy Commit ID",
      "Copy Commit Message",
    ]);
  });

  it("shows Open on GitHub between open and copy when githubRemote is set", async () => {
    renderTimeline({
      commits: [
        makeCommit({
          hash: "abcdef1234567890",
          shortHash: "abcdef1",
          message: "fix: timeline menu",
          isPushed: false,
          pushedTo: null,
        }),
      ],
      githubRemote: { owner: "acme", repo: "widgets" },
    });
    openContextMenuOnCommit();
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Open Changes",
      "Open on GitHub",
      "Copy Commit ID",
      "Copy Commit Message",
    ]);
  });

  it("opens on github and toasts not_found / network_error outcomes", async () => {
    const openOnGithubMock = vi.mocked(openCommitOnGithub);
    openOnGithubMock.mockReset();
    toastErrorMock.mockReset();

    openOnGithubMock.mockResolvedValueOnce("not_found");
    renderTimeline({
      githubRemote: { owner: "acme", repo: "widgets" },
    });
    openContextMenuOnCommit();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Open on GitHub" }),
    );
    await waitFor(() => {
      expect(openOnGithubMock).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        commitHash: "abcdef1234567890",
      });
      expect(toastErrorMock).toHaveBeenCalledWith("Commit not found on GitHub");
    });

    openOnGithubMock.mockResolvedValueOnce("network_error");
    toastErrorMock.mockReset();
    openContextMenuOnCommit();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Open on GitHub" }),
    );
    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Could not reach GitHub");
    });
  });
});

function makeChangedFile(
  overrides: Partial<WorkspaceChangedFile> = {},
): WorkspaceChangedFile {
  return {
    filePath: overrides.filePath ?? "src/app.ts",
    oldPath: overrides.oldPath ?? null,
    fileName: overrides.fileName ?? "app.ts",
    kind: overrides.kind ?? "modified",
    status: overrides.status ?? "M",
    additions: overrides.additions ?? 1,
    deletions: overrides.deletions ?? 0,
    isBinary: overrides.isBinary ?? false,
    contentHash: overrides.contentHash ?? "hash",
    metadataSignature: overrides.metadataSignature ?? "sig",
  };
}

describe("ChangedFileRow workspace path context menu", () => {
  const writeTextMock = vi.fn();

  beforeEach(() => {
    toastSuccessMock.mockReset();
    writeTextMock.mockReset();
    writeTextMock.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: writeTextMock },
    });
  });

  function renderChangedRow(
    file: WorkspaceChangedFile = makeChangedFile(),
    workspacePath: string | null = "/repo",
  ): HTMLElement {
    const view = render(
      <ChangedFileRow
        file={file}
        onOpenChangedFile={noop}
        workspacePath={workspacePath}
      />,
      { wrapper },
    );
    return view.getByRole("button");
  }

  it("copies file name, relative path, and absolute path from an uncommitted file row", async () => {
    const row = renderChangedRow();
    fireEvent.contextMenu(row, { clientX: 40, clientY: 80 });

    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Copy file name",
      "Copy relative path",
      "Copy absolute path",
    ]);

    fireEvent.click(items[0]);
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("app.ts");
      expect(toastSuccessMock).toHaveBeenCalledWith("Copied to clipboard");
    });

    fireEvent.contextMenu(row, { clientX: 40, clientY: 80 });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Copy relative path" }),
    );
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("src/app.ts");
      expect(toastSuccessMock).toHaveBeenCalledWith("Copied to clipboard");
    });

    fireEvent.contextMenu(row, { clientX: 40, clientY: 80 });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Copy absolute path" }),
    );
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("/repo/src/app.ts");
      expect(toastSuccessMock).toHaveBeenCalledWith("Copied to clipboard");
    });
  });

  it("copies the new filePath for a renamed file, not oldPath", async () => {
    const row = renderChangedRow(
      makeChangedFile({
        fileName: "next.ts",
        filePath: "src/next.ts",
        oldPath: "src/old.ts",
        kind: "renamed",
      }),
    );
    fireEvent.contextMenu(row, { clientX: 40, clientY: 80 });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Copy relative path" }),
    );
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("src/next.ts");
    });
    expect(writeTextMock).not.toHaveBeenCalledWith("src/old.ts");
  });

  it("still copies the recorded filePath for a deleted file", async () => {
    const row = renderChangedRow(
      makeChangedFile({
        fileName: "gone.ts",
        filePath: "src/gone.ts",
        kind: "deleted",
      }),
    );
    fireEvent.contextMenu(row, { clientX: 40, clientY: 80 });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Copy relative path" }),
    );
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("src/gone.ts");
    });
  });

  it("hides copy absolute path when workspacePath is missing", async () => {
    const row = renderChangedRow(makeChangedFile(), null);
    fireEvent.contextMenu(row, { clientX: 40, clientY: 80 });

    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Copy file name",
      "Copy relative path",
    ]);
    expect(
      screen.queryByRole("menuitem", { name: "Copy absolute path" }),
    ).toBeNull();
  });
});

function makeCommittedFile(
  overrides: Partial<WorkspaceCommitChangedFile> = {},
): WorkspaceCommitChangedFile {
  return {
    filePath: overrides.filePath ?? "src/app.ts",
    oldPath: overrides.oldPath ?? null,
    fileName: overrides.fileName ?? "app.ts",
    kind: overrides.kind ?? "modified",
    status: overrides.status ?? "M",
  };
}

describe("CommittedFileRow workspace path context menu", () => {
  const writeTextMock = vi.fn();

  beforeEach(() => {
    toastSuccessMock.mockReset();
    writeTextMock.mockReset();
    writeTextMock.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: writeTextMock },
    });
  });

  function renderExpandedTimeline(
    files: WorkspaceCommitChangedFile[] = [makeCommittedFile()],
    workspacePath: string | null = "/repo",
  ) {
    return render(
      <CommittedChangesTimeline
        {...baseProps}
        commits={[
          makeCommit({
            hash: "abcdef1234567890",
            shortHash: "abcdef1",
            message: "fix: timeline menu",
            files,
          }),
        ]}
        expandedCommitHashes={new Set(["abcdef1234567890"])}
        isWorktree={false}
        workspacePath={workspacePath}
      />,
      { wrapper },
    );
  }

  it("copies file name, relative path, and absolute path from a committed file row", async () => {
    renderExpandedTimeline();
    const fileRow = screen.getByRole("button", { name: "app.ts src M" });
    fireEvent.contextMenu(fileRow, { clientX: 40, clientY: 80 });

    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Copy file name",
      "Copy relative path",
      "Copy absolute path",
    ]);
    expect(screen.queryByRole("menuitem", { name: "Open Changes" })).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: "Copy Commit ID" }),
    ).toBeNull();

    fireEvent.click(items[0]);
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("app.ts");
      expect(toastSuccessMock).toHaveBeenCalledWith("Copied to clipboard");
    });

    fireEvent.contextMenu(fileRow, { clientX: 40, clientY: 80 });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Copy relative path" }),
    );
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("src/app.ts");
    });

    fireEvent.contextMenu(fileRow, { clientX: 40, clientY: 80 });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Copy absolute path" }),
    );
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("/repo/src/app.ts");
    });
  });

  it("copies the new filePath for a renamed committed file", async () => {
    renderExpandedTimeline([
      makeCommittedFile({
        fileName: "next.ts",
        filePath: "src/next.ts",
        oldPath: "src/old.ts",
        kind: "renamed",
        status: "R",
      }),
    ]);
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "next.ts src R" }),
      { clientX: 40, clientY: 80 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Copy relative path" }),
    );
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("src/next.ts");
    });
    expect(writeTextMock).not.toHaveBeenCalledWith("src/old.ts");
  });

  it("hides copy absolute path when workspacePath is missing", async () => {
    renderExpandedTimeline([makeCommittedFile()], null);
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "app.ts src M" }),
      {
        clientX: 40,
        clientY: 80,
      },
    );

    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Copy file name",
      "Copy relative path",
    ]);
    expect(
      screen.queryByRole("menuitem", { name: "Copy absolute path" }),
    ).toBeNull();
  });

  it("still opens the commit context menu on the commit message row", async () => {
    renderExpandedTimeline();
    fireEvent.contextMenu(
      screen.getByRole("button", { name: /fix: timeline menu/i }),
      { clientX: 40, clientY: 80 },
    );

    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Open Changes",
      "Copy Commit ID",
      "Copy Commit Message",
    ]);
  });
});
