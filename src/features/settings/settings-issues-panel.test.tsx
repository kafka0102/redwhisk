import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import { selectShadcnOption } from "../../test/select-helpers";
import {
  getProjectIssueSourceSettings,
  inspectProjectIssueConnection,
  updateProjectIssueSourceSettings,
  type ProjectIssueSourceSettings,
} from "./issue-source-commands";
import { IssuesSettingsPanel } from "./settings-issues-panel";

vi.mock("./settings-commands", () => ({
  deleteAgentProfile: vi.fn(),
  deleteProjectLabel: vi.fn(),
  deleteSavedAgentSkill: vi.fn(),
  detectCodexCommand: vi.fn(async () => ({ command: "codex" })),
  listAgentProfiles: vi.fn(async () => ({ profiles: [] })),
  listAgentSkills: vi.fn(async () => ({ skills: [] })),
  listProjectLabels: vi.fn(async () => ({ labels: [] })),
  listSavedAgentSkills: vi.fn(async () => ({ skills: [] })),
  previewAgentCommandArgs: vi.fn(async () => []),
  reconcileSavedAgentSkills: vi.fn(async () => ({ changedCount: 0 })),
  refreshAgentSkills: vi.fn(async () => ({ changedCount: 0 })),
  saveAgentDisplayOrder: vi.fn(),
  saveAgentProfile: vi.fn(),
  saveProjectLabel: vi.fn(),
  testAgentCommand: vi.fn(),
  detectTuiHookRegistration: vi.fn(async () => ({
    codexRegistered: false,
    grokRegistered: false,
    codexHooksOutdated: false,
    grokHooksOutdated: false,
    codexHooksFeatureEnabled: true,
    channelAvailable: true,
    registrationAllowed: false,
  })),
}));

vi.mock("../project/project-commands", () => ({
  updateProjectSettings: vi.fn(),
  validateProjectRepoPath: vi.fn(),
}));

vi.mock("../project/project-forge-commands", () => ({
  inspectProjectForge: vi.fn(async () => ({
    host: "github",
    remoteLabel: "acme/app",
    cliInstalled: true,
    cliAuthenticated: true,
    repoDefaultBranch: "main",
    completionAction: "merge_to_base",
    prTarget: "issue_base",
    prDraft: true,
    confirmCompletionAction: true,
  })),
}));

vi.mock("./issue-source-commands", () => ({
  getProjectIssueSourceSettings: vi.fn(),
  updateProjectIssueSourceSettings: vi.fn(),
  inspectProjectIssueConnection: vi.fn(),
}));

const getSettingsMock = vi.mocked(getProjectIssueSourceSettings);
const updateSettingsMock = vi.mocked(updateProjectIssueSourceSettings);
const inspectConnectionMock = vi.mocked(inspectProjectIssueConnection);

function settings(
  overrides: Partial<ProjectIssueSourceSettings> = {},
): ProjectIssueSourceSettings {
  return {
    projectId: 7,
    issueSourceMode: "local",
    issueSyncScope: "assigned_to_me",
    issueSyncLabel: null,
    issueSyncEnabled: true,
    issueSyncIntervalSeconds: 90,
    issueWritebackCloseOnComplete: true,
    issueWritebackCloseOnPrMerge: true,
    issueWritebackComment: true,
    issueCreateSource: "local",
    connection: {
      provider: "github",
      hostUrl: "https://github.com",
      repoPath: "acme/redwhisk",
      login: "yujianjia",
      cliInstalled: true,
      cliAuthenticated: true,
      authStatus: "ready",
      checkedAt: 10,
    },
    ...overrides,
  };
}

function renderPanel(locale: "en" | "zh" = "en") {
  return render(
    <I18nProvider initialLocale={locale}>
      <IssuesSettingsPanel projectId={7} />
    </I18nProvider>,
  );
}

describe("Issues settings panel", () => {
  beforeEach(() => {
    getSettingsMock.mockReset();
    updateSettingsMock.mockReset();
    inspectConnectionMock.mockReset();
    getSettingsMock.mockResolvedValue(settings());
    inspectConnectionMock.mockResolvedValue(settings());
    updateSettingsMock.mockImplementation(async (input) =>
      settings({
        issueSourceMode: input.issueSourceMode,
        issueSyncScope: input.issueSyncScope,
        issueSyncLabel: input.issueSyncLabel ?? null,
        issueSyncEnabled: input.issueSyncEnabled,
        issueSyncIntervalSeconds: input.issueSyncIntervalSeconds,
        issueWritebackCloseOnComplete: input.issueWritebackCloseOnComplete,
        issueWritebackCloseOnPrMerge: input.issueWritebackCloseOnPrMerge,
        issueWritebackComment: input.issueWritebackComment,
      }),
    );
  });

  it("saves the selected mode, scope, sync, interval, and writeback switches", async () => {
    const user = userEvent.setup();
    renderPanel("en");

    expect(await screen.findByRole("radio", { name: "Local" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "Remote" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Mixed" })).toBeInTheDocument();
    expect(
      screen.getByText("Local-only mode does not sync remote issues."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Close the remote issue when the pull request merges"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/last sync/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /refresh/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Remote" }));
    await selectShadcnOption(user, screen, "Sync scope", "All open");
    await user.click(
      screen.getByRole("checkbox", {
        name: "Sync automatically while this page is visible",
      }),
    );
    await selectShadcnOption(user, screen, "Interval", "5 minutes");
    await user.click(
      screen.getByRole("checkbox", {
        name: "Close the remote issue when work is complete",
      }),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: "Write the delivery summary back to the remote issue",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith({
        projectId: 7,
        issueSourceMode: "remote",
        issueSyncScope: "all_open",
        issueSyncEnabled: false,
        issueSyncIntervalSeconds: 300,
        issueWritebackCloseOnComplete: false,
        issueWritebackCloseOnPrMerge: true,
        issueWritebackComment: false,
      });
    });
    expect(getSettingsMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["en", "cli_missing", "github", "Not installed"],
    ["en", "unauthenticated", "github", "gh auth login"],
    ["en", "unauthenticated", "gitlab", "glab auth login"],
    ["en", "not_forge", null, "not on GitHub or GitLab"],
    ["zh", "cli_missing", "github", "未安装"],
    ["zh", "unauthenticated", "github", "gh auth login"],
    ["zh", "unauthenticated", "gitlab", "glab auth login"],
    ["zh", "not_forge", null, "不是 GitHub 或 GitLab"],
  ] as const)(
    "shows %s copy for %s on %s",
    async (locale, authStatus, provider, text) => {
      const connection = {
        provider,
        hostUrl:
          provider === "gitlab"
            ? "https://gitlab.example.com"
            : provider
              ? "https://github.com"
              : null,
        repoPath: provider ? "acme/redwhisk" : null,
        login: null,
        cliInstalled:
          authStatus !== "cli_missing" && authStatus !== "not_forge",
        cliAuthenticated: false,
        authStatus,
        checkedAt: 11,
      } as const;
      getSettingsMock.mockResolvedValue(settings({ connection }));
      inspectConnectionMock.mockResolvedValue(settings({ connection }));
      renderPanel(locale);
      expect(
        await screen.findByTestId("issue-source-status"),
      ).toHaveTextContent(text);
    },
  );

  it("re-login only inspects the connection again", async () => {
    const user = userEvent.setup();
    renderPanel("en");
    await screen.findByRole("button", { name: "Sign in again" });
    await user.click(screen.getByRole("button", { name: "Sign in again" }));
    await waitFor(() => {
      expect(inspectConnectionMock).toHaveBeenCalledTimes(2);
    });
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it("uses MR for GitLab, PR for GitHub, and shows the label field only for label scope", async () => {
    const user = userEvent.setup();
    inspectConnectionMock.mockResolvedValue(
      settings({
        connection: {
          provider: "gitlab",
          hostUrl: "https://gitlab.example.com",
          repoPath: "group/sub/repo",
          login: "yujianjia",
          cliInstalled: true,
          cliAuthenticated: false,
          authStatus: "unauthenticated",
          checkedAt: 14,
        },
      }),
    );
    renderPanel("en");
    expect(
      await screen.findByText(
        "Close the remote issue when the merge request merges",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("issue-source-status")).toHaveTextContent(
      "glab auth login",
    );
    expect(screen.queryByLabelText("Label")).not.toBeInTheDocument();
    await selectShadcnOption(user, screen, "Sync scope", "Label");
    expect(screen.getByLabelText("Label")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.type(screen.getByLabelText("Label"), "bug");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});
