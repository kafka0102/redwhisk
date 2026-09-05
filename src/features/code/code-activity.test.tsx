import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import {
  getProjectWorktreeChanges,
  getProjectWorktreeFileTree,
  listCodeWorkspaceRoots,
  readProjectWorktreeFile,
  searchProjectWorktreeContent,
  statProjectWorktreeFile,
  writeProjectWorktreeFile,
} from "../../shared/workspace/workspace-commands";
import {
  codeWorkspaceCache,
  resetCodeWorkspaceCacheForTests,
} from "./code-workspace-cache";
import { CodeActivity } from "./code-activity";

// 捕获 Monaco Editor 实际接收到的 theme prop，并模拟 view state 读写。
const { editorThemeProp, monacoEditorApi } = vi.hoisted(() => {
  const viewState = { scrollTop: 420 };
  return {
    editorThemeProp: { current: undefined as string | undefined },
    monacoEditorApi: {
      lastRestoredViewState: null as unknown,
      saveViewState: vi.fn(() => viewState),
      restoreViewState: vi.fn((_state: unknown) => {
        monacoEditorApi.lastRestoredViewState = _state;
      }),
      revealLineInCenter: vi.fn((_line: number) => undefined),
      setPosition: vi.fn(
        (_pos: { lineNumber: number; column: number }) => undefined,
      ),
      focus: vi.fn(() => undefined),
      onDidScrollChange: vi.fn((_listener: () => void) => ({
        dispose: vi.fn(),
      })),
      onDidDispose: vi.fn((_listener: () => void) => undefined),
      addAction: vi.fn((_descriptor: unknown) => ({ dispose: vi.fn() })),
      getAction: vi.fn((_id: string) => ({ run: vi.fn() })),
      reset() {
        this.lastRestoredViewState = null;
        this.saveViewState.mockClear();
        this.restoreViewState.mockClear();
        this.revealLineInCenter.mockClear();
        this.setPosition.mockClear();
        this.focus.mockClear();
        this.onDidScrollChange.mockClear();
        this.onDidDispose.mockClear();
        this.addAction.mockClear();
        this.getAction.mockClear();
      },
    },
  };
});

vi.mock("monaco-editor", () => ({
  MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
  Range: class Range {
    constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number,
    ) {}
  },
  Uri: {
    parse: (value: string) => ({
      toString: () => value,
      path: value,
      fsPath: value,
    }),
  },
  KeyMod: { Shift: 1024 },
  KeyCode: { F12: 70 },
  languages: {
    registerDefinitionProvider: () => ({ dispose: vi.fn() }),
    registerReferenceProvider: () => ({ dispose: vi.fn() }),
  },
  editor: {
    getModel: () => null,
    getModels: () => [],
    setModelMarkers: vi.fn(),
    registerEditorOpener: () => ({ dispose: vi.fn() }),
    addKeybindingRule: () => ({ dispose: vi.fn() }),
  },
}));

vi.mock("../../shared/use-monaco-editor-ready", () => ({
  useMonacoEditorReady: () => true,
}));

vi.mock("@monaco-editor/react", () => ({
  DiffEditor: () => null,
  Editor: ({
    theme,
    language,
    value,
    options,
    onChange,
    onMount,
  }: {
    theme?: string;
    language?: string;
    value?: string;
    options?: { readOnly?: boolean };
    onChange?: (value: string | undefined) => void;
    onMount?: (editor: {
      revealLineInCenter: (line: number) => void;
      setPosition: (pos: { lineNumber: number; column: number }) => void;
      focus: () => void;
      saveViewState: () => unknown;
      restoreViewState: (state: unknown) => void;
      onDidScrollChange: (listener: () => void) => { dispose: () => void };
      onDidDispose: (listener: () => void) => void;
      addAction: (descriptor: unknown) => { dispose: () => void };
      getAction: (id: string) => { run: () => void } | null;
    }) => void;
  }) => {
    editorThemeProp.current = theme;
    onMount?.({
      revealLineInCenter: (...args) =>
        monacoEditorApi.revealLineInCenter(...args),
      setPosition: (...args) => monacoEditorApi.setPosition(...args),
      focus: (...args) => monacoEditorApi.focus(...args),
      saveViewState: () => monacoEditorApi.saveViewState(),
      restoreViewState: (state) => monacoEditorApi.restoreViewState(state),
      onDidScrollChange: (listener) =>
        monacoEditorApi.onDidScrollChange(listener),
      onDidDispose: (listener) => monacoEditorApi.onDidDispose(listener),
      addAction: (descriptor) => monacoEditorApi.addAction(descriptor),
      getAction: (id) => monacoEditorApi.getAction(id),
    });
    return (
      <div
        data-testid="monaco-editor"
        data-language={language ?? ""}
        data-readonly={String(options?.readOnly ?? false)}
        data-value={value ?? ""}
      >
        <button
          type="button"
          data-testid="monaco-edit"
          onClick={() => onChange?.("export const value = 2;\n")}
        >
          Simulate edit
        </button>
      </div>
    );
  },
}));

const {
  ensureCodeLanguageHost,
  stopCodeLanguageHost,
  notifyCodeLanguageDocument,
  requestCodeLanguageDefinition,
  requestCodeLanguageReferences,
} = vi.hoisted(() => ({
  ensureCodeLanguageHost: vi.fn(),
  stopCodeLanguageHost: vi.fn(),
  notifyCodeLanguageDocument: vi.fn(),
  requestCodeLanguageDefinition: vi.fn(),
  requestCodeLanguageReferences: vi.fn(),
}));

vi.mock("./code-language-commands", () => ({
  CODE_LANGUAGE_DIAGNOSTICS_EVENT: "code-language-diagnostics",
  ensureCodeLanguageHost,
  stopCodeLanguageHost,
  notifyCodeLanguageDocument,
  requestCodeLanguageDefinition,
  requestCodeLanguageReferences,
}));

vi.mock("../../shared/workspace/workspace-commands", () => ({
  CODE_WORKSPACE_ROOTS_UPDATED_EVENT: "code-workspace-roots-updated",
  getProjectWorktreeChanges: vi.fn(),
  getProjectWorktreeFileTree: vi.fn(),
  listCodeWorkspaceRoots: vi.fn(),
  readProjectWorktreeFile: vi.fn(),
  searchProjectWorktreeContent: vi.fn(),
  statProjectWorktreeFile: vi.fn(),
  writeProjectWorktreeFile: vi.fn(),
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
      <>
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
        <button
          type="button"
          onClick={() =>
            onOpenFile({
              id: "docs/readme.md",
              kind: "file",
              name: "readme.md",
              path: "docs/readme.md",
            })
          }
        >
          Open markdown
        </button>
        {Array.from({ length: 12 }, (_, index) => {
          const n = index + 1;
          const path = `src/file-${n}.ts`;
          return (
            <button
              key={path}
              type="button"
              onClick={() =>
                onOpenFile({
                  id: path,
                  kind: "file",
                  name: `file-${n}.ts`,
                  path,
                })
              }
            >
              {`Open file ${n}`}
            </button>
          );
        })}
      </>
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

const markdownContent = {
  content: "# Hello Markdown\n\nA [link](https://example.com).\n",
  filePath: "docs/readme.md",
  isBinary: false,
  isTooLarge: false,
  language: "markdown",
  modifiedAt: 1,
  sizeBytes: 48,
};

function setDocumentVisibility(visible: boolean): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (visible ? "visible" : "hidden"),
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function settleMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("CodeActivity", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setDocumentVisibility(true);
    resetCodeWorkspaceCacheForTests();
    editorThemeProp.current = undefined;
    monacoEditorApi.reset();
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
    vi.mocked(searchProjectWorktreeContent).mockReset();
    vi.mocked(statProjectWorktreeFile).mockReset();
    vi.mocked(readProjectWorktreeFile).mockResolvedValue(fileContent);
    vi.mocked(statProjectWorktreeFile).mockResolvedValue({
      filePath: fileContent.filePath,
      sizeBytes: fileContent.sizeBytes,
      modifiedAt: fileContent.modifiedAt,
    });
    vi.mocked(writeProjectWorktreeFile).mockReset();
    ensureCodeLanguageHost.mockReset();
    stopCodeLanguageHost.mockReset();
    notifyCodeLanguageDocument.mockReset();
    requestCodeLanguageDefinition.mockReset();
    requestCodeLanguageReferences.mockReset();
    ensureCodeLanguageHost.mockResolvedValue({ status: "ready" });
    stopCodeLanguageHost.mockResolvedValue(undefined);
    notifyCodeLanguageDocument.mockResolvedValue(undefined);
    requestCodeLanguageDefinition.mockResolvedValue({ locations: [] });
    requestCodeLanguageReferences.mockResolvedValue({ locations: [] });
    vi.mocked(writeProjectWorktreeFile).mockImplementation(async (input) => ({
      ...fileContent,
      content: input.content,
      filePath: input.filePath,
      modifiedAt: 99,
      sizeBytes: input.content.length,
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it("restores the Monaco editor scroll position after remounting", async () => {
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
    await waitFor(() => {
      expect(monacoEditorApi.onDidScrollChange).toHaveBeenCalled();
    });

    const scrollListener = monacoEditorApi.onDidScrollChange.mock
      .calls[0]?.[0] as (() => void) | undefined;
    expect(scrollListener).toEqual(expect.any(Function));
    scrollListener?.();

    view.unmount();
    monacoEditorApi.reset();
    vi.mocked(readProjectWorktreeFile).mockClear();
    vi.mocked(readProjectWorktreeFile).mockResolvedValue(fileContent);

    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(monacoEditorApi.restoreViewState).toHaveBeenCalledWith({
        scrollTop: 420,
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
        collapsedFiles: {},
        errorMessage: null,
        excludeTags: [],
        includeTags: [],
        isSearching: false,
        matchCase: false,
        matchWholeWord: false,
        query: "",
        results: null,
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
    const srcNode = {
      id: "src",
      name: "src",
      path: "src",
      kind: "directory" as const,
      isIgnored: false,
    };
    const subNode = {
      id: "src/sub",
      name: "sub",
      path: "src/sub",
      kind: "directory" as const,
      isIgnored: false,
    };
    const deepNode = {
      id: "src/sub/deep.ts",
      name: "deep.ts",
      path: "src/sub/deep.ts",
      kind: "file" as const,
      isIgnored: false,
    };
    vi.mocked(getProjectWorktreeFileTree).mockImplementation(async (input) => {
      if (input.directoryPath === "src/sub") {
        return { nodes: [deepNode], signature: "sub" };
      }
      if (input.directoryPath === "src") {
        return { nodes: [subNode], signature: "src" };
      }
      return { nodes: [srcNode], signature: "root" };
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

    // 按层加载：展开 src 后出现 sub，再展开 sub 后出现孙级文件。
    await waitFor(() => {
      expect(
        within(tree).getByRole("button", { name: "sub" }),
      ).toBeInTheDocument();
    });
    await user.click(within(tree).getByRole("button", { name: "sub" }));
    await waitFor(() => {
      expect(within(tree).getByText("deep.ts")).toBeInTheDocument();
    });

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
    const includeInput = screen
      .getAllByLabelText("files to include")
      .find((el) => el.tagName === "INPUT");
    expect(includeInput).toBeTruthy();
    await user.type(includeInput!, "*.ts{Enter}");

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
    expect(screen.getByText("*.ts")).toBeInTheDocument();
  });

  it("runs content search on Enter and opens a match at line", async () => {
    const user = userEvent.setup();
    vi.mocked(searchProjectWorktreeContent).mockResolvedValue({
      fileCount: 1,
      matchCount: 1,
      truncated: false,
      files: [
        {
          filePath: "src/file.ts",
          fileName: "file.ts",
          matchCount: 1,
          matches: [
            {
              lineNumber: 2,
              lineText: "export const value = 1;",
              matchStart: 0,
              matchEnd: 6,
            },
          ],
        },
      ],
    });

    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Search in files" }));
    const searchInput = screen.getByLabelText("Search");
    await user.type(searchInput, "export");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(searchProjectWorktreeContent).toHaveBeenCalledWith({
        projectId: 1,
        workspacePath: "/tmp/redwhisk",
        query: "export",
        matchCase: false,
        matchWholeWord: false,
        useRegex: false,
        include: [],
        exclude: [],
      });
    });

    expect(await screen.findByText("1 files · 1 matches")).toBeInTheDocument();
    expect(screen.getByText("export const value = 1;")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Open file.ts at line 2" }),
    );
    await waitFor(() => {
      expect(readProjectWorktreeFile).toHaveBeenCalledWith({
        projectId: 1,
        workspacePath: "/tmp/redwhisk",
        filePath: "src/file.ts",
      });
    });
    expect(screen.getByRole("tab", { name: /file.ts/ })).toBeInTheDocument();
    // 侧栏仍保持搜索模式
    expect(
      screen.getByRole("button", { name: "Search in files" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("clears content search results when Enter is pressed on empty query", async () => {
    const user = userEvent.setup();
    vi.mocked(searchProjectWorktreeContent).mockResolvedValue({
      fileCount: 1,
      matchCount: 1,
      truncated: false,
      files: [
        {
          filePath: "src/file.ts",
          fileName: "file.ts",
          matchCount: 1,
          matches: [{ lineNumber: 1, lineText: "foo" }],
        },
      ],
    });

    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Search in files" }));
    await user.type(screen.getByLabelText("Search"), "foo");
    await user.keyboard("{Enter}");
    expect(await screen.findByText("1 files · 1 matches")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Search"));
    await user.keyboard("{Enter}");
    expect(
      await screen.findByText("No results yet. Press Enter to search."),
    ).toBeInTheDocument();
    expect(searchProjectWorktreeContent).toHaveBeenCalledTimes(1);
  });

  it("opens content search and focuses the query on Cmd/Ctrl+Shift+F", async () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "platform",
    );
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      get: () => "MacIntel",
    });

    try {
      render(
        <I18nProvider initialLocale="en">
          <CodeActivity projectId={1} roots={roots} />
        </I18nProvider>,
      );

      expect(
        screen.getByRole("button", { name: "Open file" }),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText("Content search")).not.toBeInTheDocument();

      const prevented = window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "f",
          metaKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(prevented).toBe(false);

      const searchInput = await screen.findByLabelText("Search");
      expect(screen.getByLabelText("Content search")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Search in files" }),
      ).toHaveAttribute("aria-pressed", "true");
      await waitFor(() => {
        expect(searchInput).toHaveFocus();
      });
    } finally {
      if (platformDescriptor) {
        Object.defineProperty(navigator, "platform", platformDescriptor);
      } else {
        // @ts-expect-error restore deleted platform in jsdom
        delete navigator.platform;
      }
    }
  });

  it("focuses and selects existing query text when the shortcut is pressed again", async () => {
    const user = userEvent.setup();
    const platformDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "platform",
    );
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      get: () => "Win32",
    });

    try {
      render(
        <I18nProvider initialLocale="en">
          <CodeActivity projectId={1} roots={roots} />
        </I18nProvider>,
      );

      await user.click(screen.getByRole("button", { name: "Search in files" }));
      const searchInput = screen.getByLabelText("Search") as HTMLInputElement;
      await user.type(searchInput, "workspace");
      searchInput.blur();
      expect(searchInput).not.toHaveFocus();

      const prevented = window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "f",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(prevented).toBe(false);

      expect(screen.getByLabelText("Content search")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Search in files" }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(
        screen.queryByRole("button", { name: "Open file" }),
      ).not.toBeInTheDocument();

      await waitFor(() => {
        expect(searchInput).toHaveFocus();
        expect(searchInput.selectionStart).toBe(0);
        expect(searchInput.selectionEnd).toBe("workspace".length);
      });
    } finally {
      if (platformDescriptor) {
        Object.defineProperty(navigator, "platform", platformDescriptor);
      } else {
        // @ts-expect-error restore deleted platform in jsdom
        delete navigator.platform;
      }
    }
  });

  it("shows a markdown source/preview toggle on the breadcrumb and switches views", async () => {
    const user = userEvent.setup();
    vi.mocked(readProjectWorktreeFile).mockImplementation(
      async ({ filePath }) => {
        if (filePath === "docs/readme.md") return markdownContent;
        return fileContent;
      },
    );

    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open markdown" }));
    await waitFor(() => {
      expect(
        screen.getByRole("tab", { name: /readme.md/ }),
      ).toBeInTheDocument();
    });

    const toggle = await screen.findByRole("button", {
      name: "Markdown preview",
    });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("monaco-editor")).toHaveAttribute(
      "data-language",
      "markdown",
    );
    expect(
      screen.queryByRole("heading", { name: "Hello Markdown" }),
    ).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("monaco-editor")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Hello Markdown" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "link" })).toHaveAttribute(
      "target",
      "_blank",
    );

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Hello Markdown" }),
    ).not.toBeInTheDocument();
  });

  it("hides the markdown preview toggle for non-markdown and unloadable content", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open file" }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /file.ts/ })).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: "Markdown preview" }),
    ).not.toBeInTheDocument();
  });

  it("resets markdown preview to source after closing the tab and reopening", async () => {
    const user = userEvent.setup();
    vi.mocked(readProjectWorktreeFile).mockImplementation(
      async ({ filePath }) => {
        if (filePath === "docs/readme.md") return markdownContent;
        return fileContent;
      },
    );

    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open markdown" }));
    const toggle = await screen.findByRole("button", {
      name: "Markdown preview",
    });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("heading", { name: "Hello Markdown" }),
    ).toBeInTheDocument();

    await user.click(screen.getByLabelText("Close readme.md"));
    await waitFor(() => {
      expect(
        screen.queryByRole("tab", { name: /readme.md/ }),
      ).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Open markdown" }));
    const toggleAgain = await screen.findByRole("button", {
      name: "Markdown preview",
    });
    expect(toggleAgain).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Hello Markdown" }),
    ).not.toBeInTheDocument();
  });

  it("resets markdown preview to source when switching to another file", async () => {
    const user = userEvent.setup();
    vi.mocked(readProjectWorktreeFile).mockImplementation(
      async ({ filePath }) => {
        if (filePath === "docs/readme.md") return markdownContent;
        return fileContent;
      },
    );

    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open markdown" }));
    const toggle = await screen.findByRole("button", {
      name: "Markdown preview",
    });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Open file" }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /file.ts/ })).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: "Markdown preview" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /readme.md/ }));
    const toggleAgain = await screen.findByRole("button", {
      name: "Markdown preview",
    });
    expect(toggleAgain).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
  });

  it("does not re-read the active file when its metadata signature is unchanged", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open file" }));
    await waitFor(() => {
      expect(screen.getByTestId("monaco-editor")).toHaveAttribute(
        "data-value",
        fileContent.content,
      );
    });

    const readCallsAfterOpen = vi.mocked(readProjectWorktreeFile).mock.calls
      .length;
    vi.mocked(statProjectWorktreeFile).mockClear();
    vi.mocked(readProjectWorktreeFile).mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await settleMicrotasks();

    expect(statProjectWorktreeFile).toHaveBeenCalledWith({
      projectId: 1,
      workspacePath: "/tmp/redwhisk",
      filePath: "src/file.ts",
    });
    expect(readProjectWorktreeFile).not.toHaveBeenCalled();
    expect(screen.getByTestId("monaco-editor")).toHaveAttribute(
      "data-value",
      fileContent.content,
    );
    // 基线：打开时至少读过一次；本轮签名未变不应新增 read。
    expect(readCallsAfterOpen).toBeGreaterThan(0);
  });

  it("silently reloads the active file content when the metadata signature changes", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open file" }));
    await waitFor(() => {
      expect(screen.getByTestId("monaco-editor")).toHaveAttribute(
        "data-value",
        fileContent.content,
      );
    });

    const updatedContent = {
      ...fileContent,
      content: "export const value = 2;\n",
      modifiedAt: 2,
      sizeBytes: 25,
    };
    vi.mocked(statProjectWorktreeFile).mockResolvedValue({
      filePath: updatedContent.filePath,
      sizeBytes: updatedContent.sizeBytes,
      modifiedAt: updatedContent.modifiedAt,
    });
    vi.mocked(readProjectWorktreeFile).mockResolvedValue(updatedContent);
    vi.mocked(readProjectWorktreeFile).mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await settleMicrotasks();

    await waitFor(() => {
      expect(readProjectWorktreeFile).toHaveBeenCalledWith({
        projectId: 1,
        workspacePath: "/tmp/redwhisk",
        filePath: "src/file.ts",
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId("monaco-editor")).toHaveAttribute(
        "data-value",
        updatedContent.content,
      );
    });
    expect(screen.queryByText("Loading file…")).not.toBeInTheDocument();
  });

  it("shows the existing file-missing error state when active-file refresh fails", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <I18nProvider initialLocale="zh">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open file" }));
    await waitFor(() => {
      expect(screen.getByTestId("monaco-editor")).toHaveAttribute(
        "data-value",
        fileContent.content,
      );
    });

    vi.mocked(statProjectWorktreeFile).mockRejectedValue({
      code: "AGENT_SESSION_VALIDATION_FAILED",
      message: "工作区文件读取失败。",
      reason: "workspaceFileReadFailed",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await settleMicrotasks();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("文件不存在");
    expect(alert).toHaveClass("code-workspace__file-error");
    expect(screen.queryByTestId("monaco-editor")).not.toBeInTheDocument();
  });

  it("shows a disabled edit toggle until a text file is ready", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let resolveRead: ((value: typeof fileContent) => void) | undefined;
    vi.mocked(readProjectWorktreeFile).mockImplementation(
      () =>
        new Promise<typeof fileContent>((resolve) => {
          resolveRead = resolve;
        }),
    );

    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open file" }));
    const editWhileLoading = await screen.findByRole("button", {
      name: "Edit file",
    });
    expect(editWhileLoading).toBeDisabled();
    expect(editWhileLoading).toHaveAttribute("aria-pressed", "false");
    expect(editWhileLoading).toHaveAttribute("data-state", "readonly");

    resolveRead!(fileContent);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Edit file" })).toBeEnabled();
    });
    expect(screen.getByRole("button", { name: "Edit file" })).toHaveAttribute(
      "data-state",
      "readonly",
    );
    expect(screen.getByTestId("monaco-editor")).toHaveAttribute(
      "data-readonly",
      "true",
    );
  });

  it("marks the tab dirty while editable and saves with Cmd/Ctrl+S", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      get: () => "MacIntel",
    });
    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open file" }));
    const editButton = await screen.findByRole("button", { name: "Edit file" });
    await waitFor(() => {
      expect(editButton).toBeEnabled();
    });
    await user.click(editButton);
    expect(editButton).toHaveAttribute("aria-pressed", "true");
    expect(editButton).toHaveAttribute("data-state", "editing");
    expect(screen.getByTestId("monaco-editor")).toHaveAttribute(
      "data-readonly",
      "false",
    );

    await user.click(screen.getByTestId("monaco-edit"));
    const fileTab = screen.getByRole("tab", { name: /file\.ts/ });
    expect(within(fileTab).getByLabelText("Unsaved changes")).toHaveClass(
      "code-workspace__tab-dirty",
    );
    expect(screen.getByTestId("monaco-editor")).toHaveAttribute(
      "data-value",
      "export const value = 2;\n",
    );

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    await waitFor(() => {
      expect(writeProjectWorktreeFile).toHaveBeenCalledWith({
        projectId: 1,
        workspacePath: "/tmp/redwhisk",
        filePath: "src/file.ts",
        content: "export const value = 2;\n",
      });
    });
    await waitFor(() => {
      expect(
        within(screen.getByRole("tab", { name: /file\.ts/ })).queryByLabelText(
          "Unsaved changes",
        ),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Edit file" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("monaco-editor")).toHaveAttribute(
      "data-readonly",
      "false",
    );
  });

  it("keeps dirty buffer and shows an alert when save fails", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      get: () => "MacIntel",
    });
    vi.mocked(writeProjectWorktreeFile).mockRejectedValue({
      code: "AGENT_SESSION_VALIDATION_FAILED",
      message: "disk full",
      reason: "workspaceFileWriteFailed",
    });

    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open file" }));
    await user.click(await screen.findByRole("button", { name: "Edit file" }));
    await user.click(screen.getByTestId("monaco-edit"));
    expect(
      within(screen.getByRole("tab", { name: /file\.ts/ })).getByLabelText(
        "Unsaved changes",
      ),
    ).toBeInTheDocument();

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    await waitFor(() => {
      expect(writeProjectWorktreeFile).toHaveBeenCalled();
    });
    expect(await screen.findByText("disk full")).toBeInTheDocument();
    // AlertDialog 打开时主区可能 aria-hidden；用 querySelector 断言 dirty 保留。
    const dirty = document.querySelector(
      ".code-workspace__tab .code-workspace__tab-dirty",
    );
    expect(dirty).not.toBeNull();
    expect(dirty).toHaveAttribute("aria-label", "Unsaved changes");
    expect(screen.getByTestId("monaco-editor")).toHaveAttribute(
      "data-value",
      "export const value = 2;\n",
    );
  });

  it("remembers editable state and dirty buffer per tab", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.mocked(readProjectWorktreeFile).mockImplementation(async (input) => {
      if (input.filePath.endsWith(".md")) {
        return markdownContent;
      }
      return fileContent;
    });

    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open file" }));
    await user.click(await screen.findByRole("button", { name: "Edit file" }));
    await user.click(screen.getByTestId("monaco-edit"));
    const dirtyFileTab = screen.getByRole("tab", { name: /file\.ts/ });
    expect(
      within(dirtyFileTab).getByLabelText("Unsaved changes"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open markdown" }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /readme\.md/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
    expect(screen.getByRole("button", { name: "Edit file" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(
      within(screen.getByRole("tab", { name: /readme\.md/ })).queryByLabelText(
        "Unsaved changes",
      ),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("tab", { name: /file\.ts/ })).getByLabelText(
        "Unsaved changes",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /file\.ts/ }));
    expect(screen.getByRole("button", { name: "Edit file" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      within(screen.getByRole("tab", { name: /file\.ts/ })).getByLabelText(
        "Unsaved changes",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("monaco-editor")).toHaveAttribute(
      "data-value",
      "export const value = 2;\n",
    );
    expect(screen.getByTestId("monaco-editor")).toHaveAttribute(
      "data-readonly",
      "false",
    );
  });

  it("disables the edit toggle for binary content", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.mocked(readProjectWorktreeFile).mockResolvedValue({
      ...fileContent,
      content: "",
      isBinary: true,
    });

    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open file" }));
    const editButton = await screen.findByRole("button", { name: "Edit file" });
    await waitFor(() => {
      expect(editButton).toBeDisabled();
    });
  });

  async function makeActiveTabDirty(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Open file" }));
    const editButton = await screen.findByRole("button", { name: "Edit file" });
    await waitFor(() => {
      expect(editButton).toBeEnabled();
    });
    await user.click(editButton);
    await user.click(screen.getByTestId("monaco-edit"));
    expect(
      within(screen.getByRole("tab", { name: /file\.ts/ })).getByLabelText(
        "Unsaved changes",
      ),
    ).toBeInTheDocument();
  }

  it("asks Save / Don't Save / Cancel before closing a dirty tab", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await makeActiveTabDirty(user);
    await user.click(screen.getByLabelText("Close file.ts"));

    const dialog = await screen.findByRole("dialog", {
      name: "Unsaved Changes",
    });
    expect(dialog).toHaveTextContent(
      "Do you want to save the changes you made to file.ts?",
    );
    expect(
      within(dialog).getByRole("button", { name: "Save" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Don't Save" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("tab", { name: /file\.ts/ })).toBeInTheDocument();
    expect(
      within(screen.getByRole("tab", { name: /file\.ts/ })).getByLabelText(
        "Unsaved changes",
      ),
    ).toBeInTheDocument();
    expect(writeProjectWorktreeFile).not.toHaveBeenCalled();
  });

  it("closes a dirty tab without writing when Don't Save is chosen", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await makeActiveTabDirty(user);
    await user.click(screen.getByLabelText("Close file.ts"));
    const dialog = await screen.findByRole("dialog", {
      name: "Unsaved Changes",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Don't Save" }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("tab", { name: /file\.ts/ }),
      ).not.toBeInTheDocument();
    });
    expect(writeProjectWorktreeFile).not.toHaveBeenCalled();
  });

  it("saves then closes a dirty tab when Save is chosen", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await makeActiveTabDirty(user);
    await user.click(screen.getByLabelText("Close file.ts"));
    const dialog = await screen.findByRole("dialog", {
      name: "Unsaved Changes",
    });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(writeProjectWorktreeFile).toHaveBeenCalledWith({
        projectId: 1,
        workspacePath: "/tmp/redwhisk",
        filePath: "src/file.ts",
        content: "export const value = 2;\n",
      });
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("tab", { name: /file\.ts/ }),
      ).not.toBeInTheDocument();
    });
  });

  it("keeps a dirty tab open when Save fails from the close confirm", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.mocked(writeProjectWorktreeFile).mockRejectedValue({
      code: "AGENT_SESSION_VALIDATION_FAILED",
      message: "disk full",
      reason: "workspaceFileWriteFailed",
    });
    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await makeActiveTabDirty(user);
    await user.click(screen.getByLabelText("Close file.ts"));
    const dialog = await screen.findByRole("dialog", {
      name: "Unsaved Changes",
    });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("disk full")).toBeInTheDocument();
    // AlertDialog 打开时主区可能 aria-hidden。
    expect(
      document.querySelector(".code-workspace__tab span")?.textContent,
    ).toBe("file.ts");
    const dirty = document.querySelector(
      ".code-workspace__tab .code-workspace__tab-dirty",
    );
    expect(dirty).not.toBeNull();
  });

  it("asks before leaving edit mode while dirty and can discard local edits", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await makeActiveTabDirty(user);
    const editButton = screen.getByRole("button", { name: "Edit file" });
    await user.click(editButton);

    const dialog = await screen.findByRole("dialog", {
      name: "Unsaved Changes",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Don't Save" }),
    );

    await waitFor(() => {
      expect(editButton).toHaveAttribute("aria-pressed", "false");
    });
    expect(screen.getByTestId("monaco-editor")).toHaveAttribute(
      "data-readonly",
      "true",
    );
    expect(screen.getByTestId("monaco-editor")).toHaveAttribute(
      "data-value",
      "export const value = 1;\n",
    );
    expect(
      within(screen.getByRole("tab", { name: /file\.ts/ })).queryByLabelText(
        "Unsaved changes",
      ),
    ).not.toBeInTheDocument();
    expect(writeProjectWorktreeFile).not.toHaveBeenCalled();
  });

  it("saves then exits edit mode when Save is chosen on the exit confirm", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await makeActiveTabDirty(user);
    await user.click(screen.getByRole("button", { name: "Edit file" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Unsaved Changes",
    });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(writeProjectWorktreeFile).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Edit file" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });
    expect(
      within(screen.getByRole("tab", { name: /file\.ts/ })).queryByLabelText(
        "Unsaved changes",
      ),
    ).not.toBeInTheDocument();
  });

  it("asks Save All / Don't Save All / Cancel before switching roots with dirty tabs", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const multiRoots = [
      { branch: "main", path: "/tmp/redwhisk", isProjectRoot: true },
      {
        branch: "feature",
        path: "/tmp/redwhisk-feature",
        isProjectRoot: false,
      },
    ];
    vi.mocked(listCodeWorkspaceRoots).mockResolvedValue({ roots: multiRoots });

    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={multiRoots} />
      </I18nProvider>,
    );

    await makeActiveTabDirty(user);
    await user.click(screen.getByText("main"));
    await user.click(await screen.findByRole("menuitem", { name: "feature" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Unsaved Changes",
    });
    expect(dialog).toHaveTextContent(
      "You have unsaved changes in open files. What do you want to do?",
    );
    expect(
      within(dialog).getByRole("button", { name: "Save All" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Don't Save All" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("tab", { name: /file\.ts/ })).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(writeProjectWorktreeFile).not.toHaveBeenCalled();
  });

  it("clears tabs after Don't Save All when switching roots", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const multiRoots = [
      { branch: "main", path: "/tmp/redwhisk", isProjectRoot: true },
      {
        branch: "feature",
        path: "/tmp/redwhisk-feature",
        isProjectRoot: false,
      },
    ];
    vi.mocked(listCodeWorkspaceRoots).mockResolvedValue({ roots: multiRoots });

    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={multiRoots} />
      </I18nProvider>,
    );

    await makeActiveTabDirty(user);
    await user.click(screen.getByText("main"));
    await user.click(await screen.findByRole("menuitem", { name: "feature" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Unsaved Changes",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Don't Save All" }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("tab", { name: /file\.ts/ }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText("feature")).toBeInTheDocument();
    expect(writeProjectWorktreeFile).not.toHaveBeenCalled();
  });

  it("saves all dirty tabs before switching roots when Save All succeeds", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const multiRoots = [
      { branch: "main", path: "/tmp/redwhisk", isProjectRoot: true },
      {
        branch: "feature",
        path: "/tmp/redwhisk-feature",
        isProjectRoot: false,
      },
    ];
    vi.mocked(listCodeWorkspaceRoots).mockResolvedValue({ roots: multiRoots });
    vi.mocked(readProjectWorktreeFile).mockImplementation(async (input) => {
      if (input.filePath.endsWith(".md")) {
        return markdownContent;
      }
      return fileContent;
    });

    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={multiRoots} />
      </I18nProvider>,
    );

    await makeActiveTabDirty(user);
    await user.click(screen.getByRole("button", { name: "Open markdown" }));
    await user.click(await screen.findByRole("button", { name: "Edit file" }));
    await user.click(screen.getByTestId("monaco-edit"));

    await user.click(screen.getByText("main"));
    await user.click(await screen.findByRole("menuitem", { name: "feature" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Unsaved Changes",
    });
    await user.click(within(dialog).getByRole("button", { name: "Save All" }));

    await waitFor(() => {
      expect(writeProjectWorktreeFile).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    });
    expect(screen.getByText("feature")).toBeInTheDocument();
  });

  it("stops Save All on first failure and keeps remaining dirty tabs", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const multiRoots = [
      { branch: "main", path: "/tmp/redwhisk", isProjectRoot: true },
      {
        branch: "feature",
        path: "/tmp/redwhisk-feature",
        isProjectRoot: false,
      },
    ];
    vi.mocked(listCodeWorkspaceRoots).mockResolvedValue({ roots: multiRoots });
    vi.mocked(readProjectWorktreeFile).mockImplementation(async (input) => {
      if (input.filePath.endsWith(".md")) {
        return markdownContent;
      }
      return fileContent;
    });
    vi.mocked(writeProjectWorktreeFile).mockImplementation(async (input) => {
      if (input.filePath.endsWith(".md")) {
        throw {
          code: "AGENT_SESSION_VALIDATION_FAILED",
          message: "readme write failed",
          reason: "workspaceFileWriteFailed",
        };
      }
      return {
        ...fileContent,
        content: input.content,
        filePath: input.filePath,
        modifiedAt: 99,
        sizeBytes: input.content.length,
      };
    });

    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={multiRoots} />
      </I18nProvider>,
    );

    await makeActiveTabDirty(user);
    await user.click(screen.getByRole("button", { name: "Open markdown" }));
    await user.click(await screen.findByRole("button", { name: "Edit file" }));
    await user.click(screen.getByTestId("monaco-edit"));

    await user.click(screen.getByText("main"));
    await user.click(await screen.findByRole("menuitem", { name: "feature" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Unsaved Changes",
    });
    await user.click(within(dialog).getByRole("button", { name: "Save All" }));

    expect(await screen.findByText("readme write failed")).toBeInTheDocument();
    // Root switch aborted; tabs remain (Alert 可能让 role 查询失败，改查 DOM)。
    const tabLabels = Array.from(
      document.querySelectorAll(".code-workspace__tab span"),
    ).map((node) => node.textContent);
    expect(tabLabels).toEqual(expect.arrayContaining(["file.ts", "readme.md"]));
    expect(
      document.querySelector(".code-workspace__branch")?.textContent,
    ).toContain("main");
    // First dirty may have been saved; second failed. At least one write attempted.
    expect(writeProjectWorktreeFile).toHaveBeenCalled();
    // Remaining dirty for the failed file.
    expect(document.querySelector(".code-workspace__tab-dirty")).not.toBeNull();
  });

  it("asks before LRU eviction when any tab is dirty", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.mocked(readProjectWorktreeFile).mockImplementation(async (input) => ({
      ...fileContent,
      filePath: input.filePath,
      content: `// ${input.filePath}\n`,
    }));

    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    // Open 10 files (max), dirty the active one, then open an 11th to force LRU.
    for (let n = 1; n <= 10; n += 1) {
      await user.click(screen.getByRole("button", { name: `Open file ${n}` }));
      await waitFor(() => {
        expect(
          screen.getByRole("tab", { name: new RegExp(`file-${n}\\.ts`) }),
        ).toBeInTheDocument();
      });
    }
    const editButton = await screen.findByRole("button", { name: "Edit file" });
    await waitFor(() => {
      expect(editButton).toBeEnabled();
    });
    await user.click(editButton);
    await user.click(screen.getByTestId("monaco-edit"));

    await user.click(screen.getByRole("button", { name: "Open file 11" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Unsaved Changes",
    });
    expect(
      within(dialog).getByRole("button", { name: "Save All" }),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(
      screen.queryByRole("tab", { name: /file-11\.ts/ }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(10);
  });

  it("proceeds with LRU eviction after Don't Save All", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.mocked(readProjectWorktreeFile).mockImplementation(async (input) => ({
      ...fileContent,
      filePath: input.filePath,
      content: `// ${input.filePath}\n`,
    }));

    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    for (let n = 1; n <= 10; n += 1) {
      await user.click(screen.getByRole("button", { name: `Open file ${n}` }));
      await waitFor(() => {
        expect(
          screen.getByRole("tab", { name: new RegExp(`file-${n}\\.ts`) }),
        ).toBeInTheDocument();
      });
    }
    await user.click(await screen.findByRole("button", { name: "Edit file" }));
    await user.click(screen.getByTestId("monaco-edit"));

    await user.click(screen.getByRole("button", { name: "Open file 11" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Unsaved Changes",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Don't Save All" }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("tab", { name: /file-11\.ts/ }),
      ).toBeInTheDocument();
    });
    expect(screen.getAllByRole("tab")).toHaveLength(10);
  });

  it("prompts to use disk or keep local when dirty file changes externally", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open file" }));
    await user.click(await screen.findByRole("button", { name: "Edit file" }));
    await user.click(screen.getByTestId("monaco-edit"));
    expect(
      within(screen.getByRole("tab", { name: /file\.ts/ })).getByLabelText(
        "Unsaved changes",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("monaco-editor")).toHaveAttribute(
      "data-value",
      "export const value = 2;\n",
    );

    const updatedContent = {
      ...fileContent,
      content: "export const value = 99;\n",
      modifiedAt: 2,
      sizeBytes: 26,
    };
    vi.mocked(statProjectWorktreeFile).mockResolvedValue({
      filePath: updatedContent.filePath,
      sizeBytes: updatedContent.sizeBytes,
      modifiedAt: updatedContent.modifiedAt,
    });
    vi.mocked(readProjectWorktreeFile).mockResolvedValue(updatedContent);
    vi.mocked(readProjectWorktreeFile).mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await settleMicrotasks();

    const dialog = await screen.findByRole("dialog", {
      name: "File Changed on Disk",
    });
    expect(dialog).toHaveTextContent("file.ts has changed on disk");
    expect(screen.getByTestId("monaco-editor")).toHaveAttribute(
      "data-value",
      "export const value = 2;\n",
    );

    await user.click(
      within(dialog).getByRole("button", { name: "Keep Local Version" }),
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("monaco-editor")).toHaveAttribute(
      "data-value",
      "export const value = 2;\n",
    );
    expect(
      within(screen.getByRole("tab", { name: /file\.ts/ })).getByLabelText(
        "Unsaved changes",
      ),
    ).toBeInTheDocument();
  });

  it("loads the disk version when choosing Use Disk Version on conflict", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open file" }));
    await user.click(await screen.findByRole("button", { name: "Edit file" }));
    await user.click(screen.getByTestId("monaco-edit"));

    const updatedContent = {
      ...fileContent,
      content: "export const value = 99;\n",
      modifiedAt: 2,
      sizeBytes: 26,
    };
    vi.mocked(statProjectWorktreeFile).mockResolvedValue({
      filePath: updatedContent.filePath,
      sizeBytes: updatedContent.sizeBytes,
      modifiedAt: updatedContent.modifiedAt,
    });
    vi.mocked(readProjectWorktreeFile).mockResolvedValue(updatedContent);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await settleMicrotasks();

    const dialog = await screen.findByRole("dialog", {
      name: "File Changed on Disk",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Use Disk Version" }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId("monaco-editor")).toHaveAttribute(
        "data-value",
        updatedContent.content,
      );
    });
    expect(
      within(screen.getByRole("tab", { name: /file\.ts/ })).queryByLabelText(
        "Unsaved changes",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit file" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("switches markdown preview back to source when entering edit mode", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.mocked(readProjectWorktreeFile).mockImplementation(
      async ({ filePath }) => {
        if (filePath === "docs/readme.md") return markdownContent;
        return fileContent;
      },
    );

    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open markdown" }));
    await waitFor(() => {
      expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Markdown preview" }));
    expect(
      screen.getByRole("heading", { name: "Hello Markdown" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("monaco-editor")).not.toBeInTheDocument();

    const editButton = screen.getByRole("button", { name: "Edit file" });
    await user.click(editButton);
    expect(editButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
    expect(screen.getByTestId("monaco-editor")).toHaveAttribute(
      "data-readonly",
      "false",
    );
    expect(
      screen.queryByRole("heading", { name: "Hello Markdown" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Markdown preview" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("renders the current unsaved markdown buffer in preview mode", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.mocked(readProjectWorktreeFile).mockImplementation(
      async ({ filePath }) => {
        if (filePath === "docs/readme.md") return markdownContent;
        return fileContent;
      },
    );

    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open markdown" }));
    await user.click(await screen.findByRole("button", { name: "Edit file" }));
    await user.click(screen.getByTestId("monaco-edit"));
    expect(
      within(screen.getByRole("tab", { name: /readme\.md/ })).getByLabelText(
        "Unsaved changes",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Markdown preview" }));
    // mock edit writes typescript-like buffer; preview still reflects current buffer text.
    expect(screen.queryByTestId("monaco-editor")).not.toBeInTheDocument();
    expect(screen.getByText("export const value = 2;")).toBeInTheDocument();
    expect(
      within(screen.getByRole("tab", { name: /readme\.md/ })).getByLabelText(
        "Unsaved changes",
      ),
    ).toBeInTheDocument();
  });

  it("exposes disabled edit reasons for loading and binary files", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let resolveRead: ((value: typeof fileContent) => void) | undefined;
    vi.mocked(readProjectWorktreeFile).mockImplementation(
      () =>
        new Promise<typeof fileContent>((resolve) => {
          resolveRead = resolve;
        }),
    );

    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open file" }));
    const loadingEdit = await screen.findByRole("button", {
      name: "Edit file",
    });
    expect(loadingEdit).toBeDisabled();
    expect(loadingEdit).toHaveAttribute(
      "title",
      "Edit unavailable while the file is loading",
    );

    resolveRead!({
      ...fileContent,
      content: "",
      isBinary: true,
      language: "plaintext",
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Edit file" })).toBeDisabled();
    });
    expect(screen.getByRole("button", { name: "Edit file" })).toHaveAttribute(
      "title",
      "Binary files cannot be edited",
    );
  });

  it("ensures the language host when opening a typescript file", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open file" }));
    await waitFor(() => {
      expect(ensureCodeLanguageHost).toHaveBeenCalledWith({
        projectId: 1,
        workspacePath: "/tmp/redwhisk",
      });
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not ensure the language host for markdown files", async () => {
    const user = userEvent.setup();
    vi.mocked(readProjectWorktreeFile).mockResolvedValue(markdownContent);
    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open markdown" }));
    await waitFor(() => {
      expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
    });
    expect(ensureCodeLanguageHost).not.toHaveBeenCalled();
  });

  it("does not ensure the language host for binary files", async () => {
    const user = userEvent.setup();
    vi.mocked(readProjectWorktreeFile).mockResolvedValue({
      ...fileContent,
      content: "",
      isBinary: true,
    });
    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open file" }));
    await waitFor(() => {
      expect(
        screen.getByText("Binary files cannot be previewed."),
      ).toBeInTheDocument();
    });
    expect(ensureCodeLanguageHost).not.toHaveBeenCalled();
  });

  it("stops the language host when the code activity unmounts", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open file" }));
    await waitFor(() => {
      expect(ensureCodeLanguageHost).toHaveBeenCalled();
    });
    unmount();
    expect(stopCodeLanguageHost).toHaveBeenCalledWith({
      projectId: 1,
      workspacePath: "/tmp/redwhisk",
    });
  });

  it("shows an in-editor unavailable hint when node is missing", async () => {
    const user = userEvent.setup();
    ensureCodeLanguageHost.mockResolvedValue({
      status: "unavailable",
      reason: "nodeNotFound",
    });
    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open file" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Node.js was not found, so TS/JS language intelligence is unavailable.",
    );
    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
  });

  it("opens the typescript buffer with the language host", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open file" }));
    await waitFor(() => {
      expect(notifyCodeLanguageDocument).toHaveBeenCalledWith({
        projectId: 1,
        workspacePath: "/tmp/redwhisk",
        uri: "file:///tmp/redwhisk/src/file.ts",
        kind: "didOpen",
        languageId: "typescript",
        version: 1,
        text: fileContent.content,
      });
    });
  });

  it("closes the language document when the tab is closed", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open file" }));
    await waitFor(() => {
      expect(notifyCodeLanguageDocument).toHaveBeenCalled();
    });
    await user.click(screen.getByLabelText("Close file.ts"));
    await waitFor(() => {
      expect(notifyCodeLanguageDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "didClose",
          uri: "file:///tmp/redwhisk/src/file.ts",
        }),
      );
    });
  });
});
