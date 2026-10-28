import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import {
  openShadcnSelect,
  selectShadcnOption,
} from "../../test/select-helpers";
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

function inspection(
  host: "github" | "gitlab" | "none",
  confirmCompletionAction = false,
) {
  return {
    host,
    remoteLabel: host === "none" ? null : "acme/app",
    cliInstalled: true,
    cliAuthenticated: true,
    repoDefaultBranch: "main",
    completionAction: "open_pull_request" as const,
    prTarget: "issue_base" as const,
    prDraft: true,
    confirmCompletionAction,
  };
}

describe("general settings completion confirmation", () => {
  beforeEach(() => {
    inspectProjectForgeMock.mockReset();
    updateProjectSettingsMock.mockReset();
  });

  it("shows the confirm select under after completion and above the target for GitHub", async () => {
    inspectProjectForgeMock.mockResolvedValue(inspection("github"));
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

    const afterCompletion = await screen.findByText("完成后");
    const confirm = screen.getByText("完成后是否确认合并方式");
    const target = screen.getByText("Pull Request 目标");
    expect(
      afterCompletion.compareDocumentPosition(confirm) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      confirm.compareDocumentPosition(target) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "完成后是否确认合并方式" }),
    ).toHaveTextContent("否");
  });

  it("uses the english confirm completion action labels", async () => {
    inspectProjectForgeMock.mockResolvedValue(inspection("gitlab", true));
    render(
      <I18nProvider initialLocale="en">
        <GeneralSettingsPanel
          projectId={1}
          projectName="App"
          projectPath="/tmp/app"
          worktreeLocation="repo_sibling"
          worktreeSetupCommand=""
        />
      </I18nProvider>,
    );

    const user = userEvent.setup();
    await screen.findByText("Confirm completion action");
    await openShadcnSelect(user, screen, "Confirm completion action");
    expect(
      await screen.findByRole("option", { name: "No" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Yes" })).toBeInTheDocument();
  });

  it("hides the select when the host is not GitHub or GitLab", async () => {
    inspectProjectForgeMock.mockResolvedValue(inspection("none"));
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
    await waitFor(() => expect(inspectProjectForgeMock).toHaveBeenCalled());
    expect(
      screen.queryByText("完成后是否确认合并方式"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("完成后")).not.toBeInTheDocument();
  });

  it("saves when only the confirm choice changes and keeps the other completion values", async () => {
    inspectProjectForgeMock.mockResolvedValue(inspection("github", false));
    updateProjectSettingsMock.mockResolvedValue({
      id: 1,
      name: "App",
      repoPath: "/tmp/app",
      worktreeLocation: "repo_sibling",
      worktreeSetupCommand: "",
      completionAction: "open_pull_request",
      prTarget: "issue_base",
      prDraft: true,
      confirmCompletionAction: true,
      createdAt: 1,
      lastOpenedAt: 2,
      codeWorkspaces: [],
    });
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
    const user = userEvent.setup();
    await screen.findByText("完成后是否确认合并方式");
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    await selectShadcnOption(user, screen, "完成后是否确认合并方式", "是");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(updateProjectSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 1,
          completionAction: "open_pull_request",
          prTarget: "issue_base",
          prDraft: true,
          confirmCompletionAction: true,
        }),
      ),
    );
  });
});
