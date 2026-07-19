import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import {
  getProjectWorktreeChanges,
  getProjectWorktreeFileTree,
  listCodeWorkspaceRoots,
  readProjectWorktreeFile,
} from "../../shared/workspace/workspace-commands";
import {
  codeWorkspaceCache,
  resetCodeWorkspaceCacheForTests,
} from "./code-workspace-cache";
import { CodeActivity } from "./code-activity";

// 捕获 Monaco Editor 实际接收到的 theme prop，用于断言代码浏览器跟随应用明暗主题。
const { editorThemeProp } = vi.hoisted(() => ({
  editorThemeProp: { current: undefined as string | undefined },
}));

vi.mock("@monaco-editor/react", () => ({
  DiffEditor: () => null,
  Editor: ({ theme }: { theme?: string }) => {
    editorThemeProp.current = theme;
    return null;
  },
}));

vi.mock("../../shared/workspace/workspace-commands", () => ({
  CODE_WORKSPACE_ROOTS_UPDATED_EVENT: "code-workspace-roots-updated",
  getProjectWorktreeChanges: vi.fn(),
  getProjectWorktreeFileTree: vi.fn(),
  listCodeWorkspaceRoots: vi.fn(),
  readProjectWorktreeFile: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(vi.fn())),
}));

vi.mock("../../shared/workspace/file-tree-panel", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../shared/workspace/file-tree-panel")
    >();
  return {
    ...actual,
    FileTreePanel: ({
      onOpenFile,
    }: {
      onOpenFile: (file: {
        id: string;
        kind: "file";
        name: string;
        path: string;
      }) => void;
    }) => (
      <button
        type="button"
        onClick={() =>
          onOpenFile({
            id: "src/file.ts",
            kind: "file",
            name: "file.ts",
            path: "src/file.ts",
          })
        }
      >
        Open file
      </button>
    ),
  };
});

const roots = [
  {
    branch: "main",
    path: "/tmp/redwhisk",
    isProjectRoot: true,
  },
];

const fileContent = {
  content: "export const value = 1;\n",
  filePath: "src/file.ts",
  isBinary: false,
  isTooLarge: false,
  language: "typescript",
  modifiedAt: 1,
  sizeBytes: 24,
};

describe("CodeActivity", () => {
  beforeEach(() => {
    resetCodeWorkspaceCacheForTests();
    editorThemeProp.current = undefined;
    window.localStorage.clear();
    vi.mocked(listCodeWorkspaceRoots).mockReset();
    vi.mocked(listCodeWorkspaceRoots).mockResolvedValue({ roots });
    vi.mocked(getProjectWorktreeFileTree).mockReset();
    vi.mocked(getProjectWorktreeFileTree).mockResolvedValue({
      nodes: [],
      signature: "empty",
    });
    vi.mocked(getProjectWorktreeChanges).mockReset();
    vi.mocked(getProjectWorktreeChanges).mockResolvedValue({
      files: [],
      signature: "empty",
    });
    vi.mocked(readProjectWorktreeFile).mockReset();
    vi.mocked(readProjectWorktreeFile).mockResolvedValue(fileContent);
  });

  it("renders the workspace snapshot immediately and refreshes roots on mount", () => {
    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    // 首帧用 roots 快照立即渲染当前分支，消除等待 IPC 的空窗。
    expect(screen.getByText("main")).toBeInTheDocument();
    // 挂载即主动拉取最新 roots，修正其它 Activity 期间 worktree 增删导致的快照过期。
    expect(listCodeWorkspaceRoots).toHaveBeenCalledTimes(1);
  });

  it("keeps the content area empty when no file is open", () => {
    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    expect(screen.queryByText("Select a file.")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("renders the code editor with the light Monaco theme by default", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open file" }));

    await waitFor(() => {
      expect(editorThemeProp.current).toBe("light");
    });
  });

  it("renders the code editor with the vs-dark Monaco theme under dark mode", async () => {
    window.localStorage.setItem("redwhisk.theme", "dark");
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open file" }));

    await waitFor(() => {
      expect(editorThemeProp.current).toBe("vs-dark");
    });
  });

  it("avoids duplicate file reads while a selected file is still loading", async () => {
    const user = userEvent.setup();
    vi.mocked(readProjectWorktreeFile).mockReturnValue(new Promise(() => {}));

    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    const openFile = screen.getByRole("button", { name: "Open file" });
    await user.click(openFile);
    await user.click(openFile);

    expect(readProjectWorktreeFile).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("tab", { name: /file.ts/ })).toBeInTheDocument();
  });

  it("restores open tabs after remounting the code activity", async () => {
    const user = userEvent.setup();
    const view = render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open file" }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /file.ts/ })).toBeInTheDocument();
    });

    view.unmount();
    vi.mocked(readProjectWorktreeFile).mockClear();
    vi.mocked(readProjectWorktreeFile).mockResolvedValue(fileContent);

    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    expect(screen.getByRole("tab", { name: /file.ts/ })).toBeInTheDocument();
    await waitFor(() => {
      expect(readProjectWorktreeFile).toHaveBeenCalledWith({
        projectId: 1,
        workspacePath: "/tmp/redwhisk",
        filePath: "src/file.ts",
      });
    });
  });

  it("shows a red missing-file error when a restored tab no longer exists", async () => {
    const user = userEvent.setup();
    const view = render(
      <I18nProvider initialLocale="zh">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open file" }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /file.ts/ })).toBeInTheDocument();
    });

    view.unmount();
    vi.mocked(readProjectWorktreeFile).mockRejectedValue({
      code: "AGENT_SESSION_VALIDATION_FAILED",
      message: "工作区文件读取失败。",
      reason: "workspaceFileReadFailed",
    });

    render(
      <I18nProvider initialLocale="zh">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("文件不存在");
    expect(alert).toHaveClass("code-workspace__file-error");
  });

  it("fetches the file tree and change badges on mount via auto-refresh", async () => {
    vi.mocked(getProjectWorktreeFileTree).mockResolvedValue({
      nodes: [
        {
          id: "src",
          name: "src",
          path: "src",
          kind: "directory" as const,
          children: [],
          isIgnored: false,
        },
      ],
      signature: "sig-1",
    });

    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    // 代码 Activity 挂载即自动拉取文件树与变更（徽标数据），替代手动刷新。
    await waitFor(() => {
      expect(getProjectWorktreeFileTree).toHaveBeenCalledWith({
        projectId: 1,
        workspacePath: "/tmp/redwhisk",
      });
    });
    await waitFor(() => {
      expect(getProjectWorktreeChanges).toHaveBeenCalledWith({
        projectId: 1,
        workspacePath: "/tmp/redwhisk",
      });
    });
  });

  it("switches to the default branch when the selected worktree disappears", async () => {
    const allRoots = [
      { branch: "main", path: "/tmp/redwhisk", isProjectRoot: true },
      {
        branch: "issue-1",
        path: "/tmp/redwhisk.wt/issue-1",
        isProjectRoot: false,
      },
    ];
    // 预设缓存：用户上次选中的是 issue-1 worktree。
    codeWorkspaceCache.set(1, {
      activePath: null,
      contentSearch: {
        excludeText: "",
        includeText: "",
        matchCase: false,
        matchWholeWord: false,
        query: "",
        useRegex: false,
      },
      openFolders: {},
      selectedRootPath: "/tmp/redwhisk.wt/issue-1",
      sidebarMode: "fileTree",
      sidebarWidth: 400,
      tabs: [],
    });
    // 挂载时 roots hook 拉回的 roots 已不含 issue-1（worktree 被删除）。
    vi.mocked(listCodeWorkspaceRoots).mockResolvedValue({
      roots: [allRoots[0]],
    });

    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={allRoots} />
      </I18nProvider>,
    );

    // 选中分支被删 → 自动切到默认分支（项目根 main），下拉显示 main。
    await waitFor(() => {
      expect(screen.getByText("main")).toBeInTheDocument();
    });
    // 文件树按切换后的 workspacePath（项目根）重新拉取。
    await waitFor(() => {
      expect(getProjectWorktreeFileTree).toHaveBeenCalledWith({
        projectId: 1,
        workspacePath: "/tmp/redwhisk",
      });
    });
  });

  it("opens a 500px nested tree menu from a breadcrumb folder", async () => {
    const user = userEvent.setup();
    vi.mocked(getProjectWorktreeFileTree).mockResolvedValue({
      nodes: [
        {
          id: "src",
          name: "src",
          path: "src",
          kind: "directory",
          isIgnored: false,
          children: [
            {
              id: "src/sub",
              name: "sub",
              path: "src/sub",
              kind: "directory",
              isIgnored: false,
              children: [
                {
                  id: "src/sub/deep.ts",
                  name: "deep.ts",
                  path: "src/sub/deep.ts",
                  kind: "file",
                  isIgnored: false,
                },
              ],
            },
          ],
        },
      ],
      signature: "sig-tree",
    });

    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    // 通过 mock 的 FileTreePanel 打开 src/file.ts，让面包屑出现 src 目录段。
    await user.click(screen.getByRole("button", { name: "Open file" }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /file.ts/ })).toBeInTheDocument();
    });

    // 点击面包屑 src 目录段，弹层以 500px 宽打开树形菜单。
    await user.click(screen.getByRole("button", { name: "src" }));
    const tree = await screen.findByRole("tree");
    const popup = document.querySelector('[data-slot="dropdown-menu-content"]');
    expect(popup?.className).toContain("w-[500px]");

    // 子目录默认收起；点击展开后出现孙级文件，支持多级展开。
    await user.click(within(tree).getByRole("button", { name: "sub" }));
    expect(within(tree).getByText("deep.ts")).toBeInTheDocument();

    // 点击文件打开并关闭弹层。
    vi.mocked(readProjectWorktreeFile).mockClear();
    await user.click(within(tree).getByRole("button", { name: "deep.ts" }));
    expect(readProjectWorktreeFile).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: "src/sub/deep.ts" }),
    );
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
  });

  it("renders the file tree without a manual refresh button", () => {
    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    expect(
      screen.getByRole("button", { name: "Open file" }),
    ).toBeInTheDocument();
    // 刷新按钮已移除：文件树由 VS Code 式自动检测轮询维护。
    expect(
      screen.queryByRole("button", { name: "Refresh file tree" }),
    ).not.toBeInTheDocument();
  });

  it("toggles the content search sidebar from the branch bar and restores the file tree", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    expect(
      screen.getByRole("button", { name: "Open file" }),
    ).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Search in files" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await user.click(toggle);

    expect(
      screen.queryByRole("button", { name: "Open file" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Content search")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    await user.click(toggle);

    expect(
      screen.getByRole("button", { name: "Open file" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Content search")).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("preserves search query and match options when toggling tree and search", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    const toggle = screen.getByRole("button", { name: "Search in files" });
    await user.click(toggle);
    await user.type(screen.getByLabelText("Search"), "workspace");
    await user.click(screen.getByLabelText("Match Case"));
    await user.type(screen.getByLabelText("files to include"), "*.ts");

    await user.click(toggle);
    expect(
      screen.getByRole("button", { name: "Open file" }),
    ).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByLabelText("Search")).toHaveValue("workspace");
    expect(screen.getByLabelText("Match Case")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("files to include")).toHaveValue("*.ts");
  });
});
