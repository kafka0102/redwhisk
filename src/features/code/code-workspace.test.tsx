import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import {
  getProjectWorktreeFileTree,
  listCodeWorkspaceRoots,
  readProjectWorktreeFile,
} from "../../shared/workspace/workspace-commands";
import { resetCodeWorkspaceStateCacheForTests } from "./code-workspace-cache";
import { CodeWorkspace } from "./code-workspace";

// 捕获 Monaco Editor 实际接收到的 theme prop，用于断言代码浏览器跟随应用明暗主题。
const { editorThemeProp } = vi.hoisted(() => ({
  editorThemeProp: { current: undefined as string | undefined },
}));

vi.mock("@monaco-editor/react", () => ({
  Editor: ({ theme }: { theme?: string }) => {
    editorThemeProp.current = theme;
    return null;
  },
}));

vi.mock("../../shared/workspace/workspace-commands", () => ({
  CODE_WORKSPACE_ROOTS_UPDATED_EVENT: "code-workspace-roots-updated",
  getProjectWorktreeFileTree: vi.fn(),
  listCodeWorkspaceRoots: vi.fn(),
  readProjectWorktreeFile: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(vi.fn())),
}));

vi.mock("../../shared/workspace/file-tree-panel", () => ({
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
}));

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

describe("CodeWorkspace", () => {
  beforeEach(() => {
    resetCodeWorkspaceStateCacheForTests();
    editorThemeProp.current = undefined;
    window.localStorage.clear();
    vi.mocked(getProjectWorktreeFileTree).mockReset();
    vi.mocked(getProjectWorktreeFileTree).mockResolvedValue({
      nodes: [],
      signature: "empty",
    });
    vi.mocked(readProjectWorktreeFile).mockReset();
    vi.mocked(readProjectWorktreeFile).mockResolvedValue(fileContent);
  });

  it("uses the workspace snapshot returned when the project opened", () => {
    render(
      <I18nProvider initialLocale="en">
        <CodeWorkspace projectId={1} roots={roots} />
      </I18nProvider>,
    );

    expect(screen.getByText("main")).toBeInTheDocument();
    expect(listCodeWorkspaceRoots).not.toHaveBeenCalled();
  });

  it("keeps the content area empty when no file is open", () => {
    render(
      <I18nProvider initialLocale="en">
        <CodeWorkspace projectId={1} roots={roots} />
      </I18nProvider>,
    );

    expect(screen.queryByText("Select a file.")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("renders the code editor with the light Monaco theme by default", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <CodeWorkspace projectId={1} roots={roots} />
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
        <CodeWorkspace projectId={1} roots={roots} />
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
        <CodeWorkspace projectId={1} roots={roots} />
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
        <CodeWorkspace projectId={1} roots={roots} />
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
        <CodeWorkspace projectId={1} roots={roots} />
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
        <CodeWorkspace projectId={1} roots={roots} />
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
        <CodeWorkspace projectId={1} roots={roots} />
      </I18nProvider>,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("文件不存在");
    expect(alert).toHaveClass("code-workspace__file-error");
  });

  it("reuses the cached file tree after remounting without refetching", async () => {
    const treeNodes = [
      {
        id: "src",
        name: "src",
        path: "src",
        kind: "directory" as const,
        children: [],
      },
    ];
    vi.mocked(getProjectWorktreeFileTree).mockResolvedValue({
      nodes: treeNodes,
      signature: "sig-1",
    });

    const view = render(
      <I18nProvider initialLocale="en">
        <CodeWorkspace projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(getProjectWorktreeFileTree).toHaveBeenCalled();
    });
    // 等待首轮加载结束，确保 treeLoaded 写入缓存。
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Refresh file tree" }),
      ).toBeEnabled();
    });

    view.unmount();
    vi.mocked(getProjectWorktreeFileTree).mockClear();

    render(
      <I18nProvider initialLocale="en">
        <CodeWorkspace projectId={1} roots={roots} />
      </I18nProvider>,
    );

    expect(getProjectWorktreeFileTree).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Refresh file tree" }),
    ).toBeEnabled();
  });

  it("refetches the file tree when the refresh button is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(getProjectWorktreeFileTree).mockResolvedValue({
      nodes: [
        {
          id: "src",
          name: "src",
          path: "src",
          kind: "directory",
          children: [],
        },
      ],
      signature: "sig-1",
    });

    render(
      <I18nProvider initialLocale="en">
        <CodeWorkspace projectId={1} roots={roots} />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Refresh file tree" }),
      ).toBeEnabled();
    });

    vi.mocked(getProjectWorktreeFileTree).mockClear();
    vi.mocked(getProjectWorktreeFileTree).mockResolvedValue({
      nodes: [
        {
          id: "lib",
          name: "lib",
          path: "lib",
          kind: "directory",
          children: [],
        },
      ],
      signature: "sig-2",
    });

    await user.click(screen.getByRole("button", { name: "Refresh file tree" }));

    await waitFor(() => {
      expect(getProjectWorktreeFileTree).toHaveBeenCalledTimes(1);
    });
    expect(getProjectWorktreeFileTree).toHaveBeenCalledWith({
      projectId: 1,
      workspacePath: "/tmp/redwhisk",
    });
  });
});
