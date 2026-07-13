import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import { listCodeWorkspaceRoots } from "../agents/session-workspace-commands";
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

describe("CodeWorkspace", () => {
  it("uses the workspace snapshot returned when the project opened", () => {
    render(
      <I18nProvider initialLocale="en">
        <CodeWorkspace
          projectId={1}
          roots={[
            {
              branch: "main",
              path: "/tmp/redwhisk",
              isProjectRoot: true,
            },
          ]}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("main")).toBeInTheDocument();
    expect(listCodeWorkspaceRoots).not.toHaveBeenCalled();
  });

  it("avoids duplicate file reads while a selected file is still loading", async () => {
    const user = userEvent.setup();
    const { readProjectWorktreeFile } =
      await import("../agents/session-workspace-commands");
    vi.mocked(readProjectWorktreeFile).mockReturnValue(new Promise(() => {}));

    render(
      <I18nProvider initialLocale="en">
        <CodeWorkspace
          projectId={1}
          roots={[
            {
              branch: "main",
              path: "/tmp/redwhisk",
              isProjectRoot: true,
            },
          ]}
        />
      </I18nProvider>,
    );

    const openFile = screen.getByRole("button", { name: "Open file" });
    await user.click(openFile);
    await user.click(openFile);

    expect(readProjectWorktreeFile).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("tab", { name: /file.ts/ })).toBeInTheDocument();
  });
});
