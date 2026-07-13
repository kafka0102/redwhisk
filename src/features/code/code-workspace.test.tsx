import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import {
  getProjectWorktreeFileTree,
  listCodeWorkspaceRoots,
  readProjectWorktreeFile,
} from "../agents/session-workspace-commands";
import { resetCodeWorkspaceStateCacheForTests } from "./code-workspace-cache";
import { CodeWorkspace } from "./code-workspace";

vi.mock("../agents/session-workspace-commands", () => ({
  CODE_WORKSPACE_ROOTS_UPDATED_EVENT: "code-workspace-roots-updated",
  getProjectWorktreeFileTree: vi.fn(),
  listCodeWorkspaceRoots: vi.fn(),
  readProjectWorktreeFile: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(vi.fn())),
}));

vi.mock("../agents/session-file-tree-panel", () => ({
  SessionFileTreePanel: ({
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
    vi.mocked(getProjectWorktreeFileTree).mockResolvedValue({
      nodes: [],
      signature: "empty",
    });
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
});
