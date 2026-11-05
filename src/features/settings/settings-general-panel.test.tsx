import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import { updateProjectSettings } from "../project/project-commands";
import { inspectProjectForge } from "../project/project-forge-commands";
import { GeneralSettingsPanel } from "./settings-general-panel";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("../project/project-commands", () => ({
  updateProjectSettings: vi.fn(),
  validateProjectRepoPath: vi.fn(),
}));

vi.mock("../project/project-forge-commands", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../project/project-forge-commands")>();
  return {
    ...actual,
    inspectProjectForge: vi.fn(),
  };
});

const inspectProjectForgeMock = vi.mocked(inspectProjectForge);
const updateProjectSettingsMock = vi.mocked(updateProjectSettings);

describe("general settings", () => {
  beforeEach(() => {
    inspectProjectForgeMock.mockReset();
    updateProjectSettingsMock.mockReset();
    updateProjectSettingsMock.mockResolvedValue({
      id: 1,
      name: "Renamed",
      repoPath: "/tmp/app",
      worktreeLocation: "repo_sibling",
      worktreeSetupCommand: "",
      completionAction: "merge_to_base",
      prTarget: "issue_base",
      prDraft: true,
      confirmCompletionAction: false,
      createdAt: 1,
      lastOpenedAt: 2,
      codeWorkspaces: [],
    });
  });

  it("does not show completion fields that moved to Issues", () => {
    render(
      <I18nProvider initialLocale="zh">
        <GeneralSettingsPanel
          projectId={1}
          projectName="App"
          projectPath="/tmp/app"
          worktreeLocation="repo_sibling"
          worktreeSetupCommand=""
        />
      </I18nProvider>,
    );

    expect(screen.queryByText("完成后")).not.toBeInTheDocument();
    expect(screen.queryByText("完成后动作")).not.toBeInTheDocument();
    expect(
      screen.queryByText("完成后是否确认合并方式"),
    ).not.toBeInTheDocument();
    expect(inspectProjectForgeMock).not.toHaveBeenCalled();
  });

  it("saves the project identity without completion fields", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="zh">
        <GeneralSettingsPanel
          projectId={1}
          projectName="App"
          projectPath="/tmp/app"
          worktreeLocation="repo_sibling"
          worktreeSetupCommand=""
        />
      </I18nProvider>,
    );

    await user.clear(screen.getByLabelText("项目名称"));
    await user.type(screen.getByLabelText("项目名称"), "Renamed");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(updateProjectSettingsMock).toHaveBeenCalledWith({
        projectId: 1,
        name: "Renamed",
        repoPath: "/tmp/app",
        worktreeLocation: "repo_sibling",
        worktreeSetupCommand: "",
      });
    });
    const payload = updateProjectSettingsMock.mock.calls[0]?.[0];
    expect(payload).not.toHaveProperty("completionAction");
    expect(payload).not.toHaveProperty("confirmCompletionAction");
  });
});
