import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import en from "../../shared/i18n/locales/en.json";
import zh from "../../shared/i18n/locales/zh.json";
import {
  openShadcnSelect,
  selectShadcnOption,
} from "../../test/select-helpers";
import { updateProjectSettings } from "../project/project-commands";
import { inspectProjectForge } from "../project/project-forge-commands";
import {
  getProjectIssueSourceSettings,
  inspectProjectIssueConnection,
  updateProjectIssueSourceSettings,
  type ForgeAuthStatus,
  type ForgeProvider,
  type IssueSourceMode,
  type ProjectIssueConnection,
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
const inspectForgeMock = vi.mocked(inspectProjectForge);
const updateProjectMock = vi.mocked(updateProjectSettings);

function forgeInspection(
  overrides: Partial<Awaited<ReturnType<typeof inspectProjectForge>>> = {},
) {
  return {
    host: "github" as const,
    remoteLabel: "acme/app",
    cliInstalled: true,
    cliAuthenticated: true,
    repoDefaultBranch: "main",
    completionAction: "merge_to_base" as const,
    prTarget: "issue_base" as const,
    prDraft: true,
    confirmCompletionAction: true,
    ...overrides,
  };
}

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
      <IssuesSettingsPanel
        projectId={7}
        projectName="App"
        projectPath="/tmp/app"
        worktreeLocation="repo_sibling"
        worktreeSetupCommand=""
      />
    </I18nProvider>,
  );
}

function renderWith(
  locale: "en" | "zh",
  overrides: Partial<ProjectIssueSourceSettings>,
) {
  const value = settings(overrides);
  getSettingsMock.mockResolvedValue(value);
  inspectConnectionMock.mockResolvedValue(value);
  return renderPanel(locale);
}

function connectionFor(
  authStatus: ForgeAuthStatus,
  provider: ForgeProvider | null,
): ProjectIssueConnection {
  return {
    provider,
    hostUrl:
      provider === "gitlab"
        ? "https://gitlab.example.com"
        : provider
          ? "https://github.com"
          : null,
    repoPath: provider ? "acme/redwhisk" : null,
    login: authStatus === "ready" ? "yujianjia" : null,
    cliInstalled: authStatus !== "cli_missing" && authStatus !== "not_forge",
    cliAuthenticated: authStatus === "ready",
    authStatus,
    checkedAt: 11,
  };
}

function gitlabConnection(authStatus: ForgeAuthStatus): ProjectIssueConnection {
  return {
    provider: "gitlab",
    hostUrl: "https://gitlab.example.com",
    repoPath: "group/sub/repo",
    login: authStatus === "ready" ? "yujianjia" : null,
    cliInstalled: true,
    cliAuthenticated: authStatus === "ready",
    authStatus,
    checkedAt: 14,
  };
}

function modeCard(radio: HTMLElement): HTMLElement {
  const card = radio.closest("[data-mode-card]");
  if (!(card instanceof HTMLElement)) {
    throw new Error("mode card missing");
  }
  return card;
}

function rowOf(element: HTMLElement, name: string): HTMLElement {
  const row = element.closest(`[data-row="${name}"]`);
  if (!(row instanceof HTMLElement)) {
    throw new Error(`row ${name} missing`);
  }
  return row;
}

function localeKeyPaths(value: unknown, prefix = ""): string[] {
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, child]) =>
        localeKeyPaths(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [prefix];
}

function exactText(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}

describe("Issues settings panel", () => {
  beforeEach(() => {
    getSettingsMock.mockReset();
    updateSettingsMock.mockReset();
    inspectConnectionMock.mockReset();
    inspectForgeMock.mockReset();
    updateProjectMock.mockReset();
    inspectForgeMock.mockResolvedValue(forgeInspection());
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

  it("lays out Chinese GitHub settings as source and connection cards", async () => {
    renderWith("zh", { issueSourceMode: "mixed" });

    const modeRegion = await screen.findByRole("region", { name: "来源模式" });
    const remoteRegion = screen.getByRole("region", { name: "远程连接" });
    expect(screen.getByRole("region", { name: "完成后" })).toBeInTheDocument();
    expect(modeRegion).toHaveClass("settings-card");
    expect(remoteRegion).toHaveClass("settings-card");
    expect(modeRegion.closest("form")).not.toHaveClass("settings-card");

    const radios = ["仅本地", "仅远程", "混合"].map((name) =>
      within(modeRegion).getByRole("radio", { name }),
    );
    for (const radio of radios) {
      expect(radio).toHaveAttribute("type", "radio");
      expect(radio).toBeVisible();
    }
    expect(modeCard(radios[0])).not.toHaveAttribute("data-selected", "true");
    expect(modeCard(radios[1])).not.toHaveAttribute("data-selected", "true");
    expect(modeCard(radios[2])).toHaveAttribute("data-selected", "true");
    expect(within(modeRegion).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(modeRegion).queryByText("宿主")).not.toBeInTheDocument();
    expect(
      screen.queryByText("仅本地模式不会同步远程 Issue。"),
    ).not.toBeInTheDocument();

    await waitFor(() => {
      expect(
        within(remoteRegion).getByRole("combobox", { name: "宿主" }),
      ).toHaveTextContent("GitHub");
    });
    const host = within(remoteRegion).getByRole("combobox", { name: "宿主" });
    const repository = within(remoteRegion).getByLabelText("仓库");
    const hostRow = rowOf(host, "host-repository");
    expect(hostRow).toHaveClass("grid-cols-2");
    expect(hostRow).toContainElement(repository);
    expect(host).toHaveClass("w-full");
    expect(host).not.toBeDisabled();
    expect(host).not.toHaveClass("opacity-50");
    expect(host).not.toHaveTextContent("https://github.com");

    const account = within(remoteRegion).getByLabelText("账号");
    const status = within(remoteRegion).getByTestId("issue-source-status");
    const relogin = within(remoteRegion).getByRole("button", {
      name: "重新登录",
    });
    const accountRow = rowOf(account, "account");
    expect(accountRow).toContainElement(status);
    expect(accountRow).toContainElement(relogin);
    expect(accountRow.classList.contains("flex")).toBe(true);
    expect(
      account.classList.contains("flex-1") ||
        account.parentElement?.classList.contains("flex-1"),
    ).toBe(true);
    expect(status).toHaveTextContent(/^已登录$/);
    expect(status).toHaveAttribute("data-tone", "ready");

    const separator = within(remoteRegion).getByRole("separator");
    expect(
      account.compareDocumentPosition(separator) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const scope = within(remoteRegion).getByRole("combobox", {
      name: "拉取范围",
    });
    expect(
      separator.compareDocumentPosition(scope) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(scope).toHaveTextContent("分配给我");
    expect(scope).not.toHaveTextContent("assigned_to_me");
    expect(scope).toHaveClass("w-full");

    const autoSync = within(remoteRegion).getByRole("checkbox", {
      name: "页面可见时自动同步",
    });
    const interval = within(remoteRegion).getByRole("combobox", {
      name: "间隔",
    });
    const syncRow = rowOf(autoSync, "sync-interval");
    expect(syncRow).toHaveClass("grid-cols-2");
    expect(syncRow).toContainElement(interval);
    expect(syncRow).not.toContainElement(scope);
    expect(within(syncRow).getByText(/^自动同步$/)).toBeInTheDocument();
    expect(interval).toHaveTextContent("90 秒");
    expect(interval).not.toHaveTextContent(/^90$/);
    expect(interval).toHaveClass("w-full");

    expect(within(remoteRegion).getByText(/^写回$/)).toBeInTheDocument();
    expect(
      within(remoteRegion).getByRole("checkbox", {
        name: "本地完成且合并到 base 时，关闭远程 Issue",
      }),
    ).toBeInTheDocument();
    expect(
      within(remoteRegion).getByRole("checkbox", {
        name: "PR 合并后关闭关联的远程 Issue",
      }),
    ).toBeInTheDocument();
    expect(
      within(remoteRegion).getByRole("checkbox", {
        name: "完成后把交付摘要评论回写远程",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "刷新" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/已同步/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
  });

  it("uses English labels for the same GitHub layout when signed in", async () => {
    renderWith("en", { issueSourceMode: "mixed" });

    const modeRegion = await screen.findByRole("region", {
      name: "Source mode",
    });
    const remoteRegion = screen.getByRole("region", {
      name: "Remote connection",
    });
    expect(
      screen.getByRole("region", { name: "After completion" }),
    ).toBeInTheDocument();
    expect(
      within(modeRegion).getByRole("radio", { name: "Mixed" }),
    ).toBeChecked();
    expect(
      screen.queryByText("Local-only mode does not sync remote issues."),
    ).not.toBeInTheDocument();

    const host = within(remoteRegion).getByRole("combobox", { name: "Host" });
    await waitFor(() => {
      expect(host).toHaveTextContent("GitHub");
    });
    expect(host).not.toHaveTextContent("https://github.com");
    expect(host).toHaveClass("w-full");
    const status = within(remoteRegion).getByTestId("issue-source-status");
    expect(status).toHaveTextContent(/^Signed in$/);
    expect(status).toHaveAttribute("data-tone", "ready");
    expect(status.className).not.toContain("border-[rgba(36,148,71");

    const scope = within(remoteRegion).getByRole("combobox", {
      name: "Sync scope",
    });
    expect(scope).toHaveTextContent("Assigned to me");
    expect(scope).not.toHaveTextContent("assigned_to_me");
    expect(scope).toHaveClass("w-full");
    const interval = within(remoteRegion).getByRole("combobox", {
      name: "Interval",
    });
    expect(interval).toHaveTextContent("90 seconds");
    expect(interval).toHaveClass("w-full");
    const syncRow = rowOf(
      within(remoteRegion).getByRole("checkbox", {
        name: "Sync automatically while this page is visible",
      }),
      "sync-interval",
    );
    expect(within(syncRow).getByText(/^Auto sync$/)).toBeInTheDocument();
    expect(within(remoteRegion).getByText(/^Write-back$/)).toBeInTheDocument();
    expect(
      within(remoteRegion).getByRole("checkbox", {
        name: "Close the remote issue when local work is complete and merged into base",
      }),
    ).toBeInTheDocument();
    expect(
      within(remoteRegion).getByRole("checkbox", {
        name: "Close the linked remote issue after the pull request merges",
      }),
    ).toBeInTheDocument();
    expect(
      within(remoteRegion).getByRole("checkbox", {
        name: "Comment the delivery summary back to the remote issue after completion",
      }),
    ).toBeInTheDocument();
  });

  it.each(["local", "remote", "mixed"] as const)(
    "shows the cards that belong to source mode %s",
    async (mode: IssueSourceMode) => {
      renderWith("zh", { issueSourceMode: mode });
      expect(
        await screen.findByRole("region", { name: "来源模式" }),
      ).toBeInTheDocument();
      expect(
        await screen.findByRole("region", { name: "完成后" }),
      ).toBeInTheDocument();
      if (mode === "local") {
        expect(
          screen.queryByRole("region", { name: "远程连接" }),
        ).not.toBeInTheDocument();
      } else {
        expect(
          screen.getByRole("region", { name: "远程连接" }),
        ).toBeInTheDocument();
      }
      const selectedName = {
        local: "仅本地",
        remote: "仅远程",
        mixed: "混合",
      }[mode];
      expect(
        modeCard(screen.getByRole("radio", { name: selectedName })),
      ).toHaveAttribute("data-selected", "true");
    },
  );

  it.each([
    ["zh", "全部未关闭", "拉取范围"],
    ["en", "All open", "Sync scope"],
  ] as const)(
    "shows the %s all-open scope label instead of the raw value",
    async (locale, label, scopeName) => {
      renderWith(locale, {
        issueSourceMode: "mixed",
        issueSyncScope: "all_open",
      });
      const scope = await screen.findByRole("combobox", { name: scopeName });
      await waitFor(() => {
        expect(scope).toHaveTextContent(label);
      });
      expect(scope).not.toHaveTextContent("all_open");
      expect(scope).toHaveClass("w-full");
    },
  );

  it("shows GitLab as the host and the signed-out tag in Chinese", async () => {
    renderWith("zh", {
      issueSourceMode: "mixed",
      connection: gitlabConnection("unauthenticated"),
    });
    const host = await screen.findByRole("combobox", { name: "宿主" });
    await waitFor(() => {
      expect(host).toHaveTextContent("GitLab");
    });
    expect(host).not.toHaveTextContent("https://gitlab.example.com");
    const status = screen.getByTestId("issue-source-status");
    expect(status).toHaveTextContent(/^未登录$/);
    expect(status).toHaveAttribute("data-tone", "signed-out");
    expect(screen.queryByText(/glab auth login/)).not.toBeInTheDocument();
    expect(screen.queryByText(/gh auth login/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", {
        name: "MR 合并后关闭关联的远程 Issue",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", {
        name: "PR 合并后关闭关联的远程 Issue",
      }),
    ).not.toBeInTheDocument();
  });

  it("uses merge request copy for an English GitLab connection", async () => {
    renderWith("en", {
      issueSourceMode: "mixed",
      connection: gitlabConnection("unauthenticated"),
    });
    const host = await screen.findByRole("combobox", { name: "Host" });
    await waitFor(() => {
      expect(host).toHaveTextContent("GitLab");
    });
    expect(screen.getByTestId("issue-source-status")).toHaveTextContent(
      /^Not signed in$/,
    );
    expect(screen.getByTestId("issue-source-status")).toHaveAttribute(
      "data-tone",
      "signed-out",
    );
    expect(screen.queryByText(/glab auth login/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", {
        name: "Close the linked remote issue after the merge request merges",
      }),
    ).toBeInTheDocument();
  });

  it("does not preselect a host when the provider is empty", async () => {
    renderWith("en", {
      issueSourceMode: "mixed",
      connection: connectionFor("not_forge", null),
    });
    const host = await screen.findByRole("combobox", { name: "Host" });
    await waitFor(() => {
      expect(screen.getByTestId("issue-source-status")).toHaveTextContent(
        "not on GitHub or GitLab",
      );
    });
    expect(host).not.toHaveTextContent("GitHub");
    expect(host).not.toHaveTextContent("GitLab");
    expect(host).not.toHaveTextContent("http");
  });

  it("keeps the detected host and omits it from the save payload", async () => {
    const user = userEvent.setup();
    renderWith("en", { issueSourceMode: "mixed" });

    const host = await screen.findByRole("combobox", { name: "Host" });
    await waitFor(() => {
      expect(host).toHaveTextContent("GitHub");
    });
    await openShadcnSelect(user, screen, "Host");
    expect(
      (await screen.findAllByRole("option")).map((option) =>
        option.textContent?.replace(/\s+/g, " ").trim(),
      ),
    ).toEqual(["GitHub", "GitLab"]);
    await user.click(screen.getByRole("option", { name: "GitLab" }));
    expect(screen.getByRole("combobox", { name: "Host" })).toHaveTextContent(
      "GitHub",
    );
    expect(
      screen.getByRole("combobox", { name: "Host" }),
    ).not.toHaveTextContent(/^GitLab/);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalled();
    });
    const payload = updateSettingsMock.mock.calls[0]?.[0];
    expect(payload).not.toHaveProperty("provider");
    expect(payload).not.toHaveProperty("hostUrl");
    expect(payload).not.toHaveProperty("connection");
  });

  it("saves the selected mode, scope, sync, interval, and writeback switches", async () => {
    const user = userEvent.setup();
    renderPanel("en");

    expect(await screen.findByRole("radio", { name: "Local" })).toBeChecked();
    expect(
      screen.queryByText("Local-only mode does not sync remote issues."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/last sync/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /refresh/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Repository")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Remote" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Repository")).toHaveValue("acme/redwhisk");
    });
    await selectShadcnOption(user, screen, "Sync scope", "All open");
    await user.click(
      screen.getByRole("checkbox", {
        name: "Sync automatically while this page is visible",
      }),
    );
    await selectShadcnOption(user, screen, "Interval", "5 minutes");
    await user.click(
      screen.getByRole("checkbox", {
        name: "Close the remote issue when local work is complete and merged into base",
      }),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: "Comment the delivery summary back to the remote issue after completion",
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
    expect(getSettingsMock).toHaveBeenCalledTimes(1);
    const payload = updateSettingsMock.mock.calls[0]?.[0];
    expect(payload).not.toHaveProperty("provider");
    expect(payload).not.toHaveProperty("hostUrl");
    expect(payload).not.toHaveProperty("connection");
  });

  it.each([
    ["en", "ready", "github", "Signed in", "ready", true],
    ["en", "cli_missing", "github", "Not installed", "muted", true],
    ["en", "unauthenticated", "github", "Not signed in", "signed-out", true],
    ["en", "unauthenticated", "gitlab", "Not signed in", "signed-out", true],
    ["en", "expired", "github", "Sign-in expired.", "muted", true],
    ["en", "unknown", "github", "Not checked", "muted", true],
    ["en", "not_forge", null, "not on GitHub or GitLab", "muted", false],
    ["zh", "ready", "github", "已登录", "ready", true],
    ["zh", "cli_missing", "github", "未安装", "muted", true],
    ["zh", "unauthenticated", "github", "未登录", "signed-out", true],
    ["zh", "unauthenticated", "gitlab", "未登录", "signed-out", true],
    ["zh", "expired", "github", "登录已过期。", "muted", true],
    ["zh", "unknown", "github", "尚未检查", "muted", true],
    ["zh", "not_forge", null, "不是 GitHub 或 GitLab", "muted", false],
  ] as const)(
    "shows %s %s copy on %s",
    async (locale, authStatus, provider, text, tone, exact) => {
      renderWith(locale, {
        issueSourceMode: "mixed",
        connection: connectionFor(authStatus, provider),
      });
      const status = await screen.findByTestId("issue-source-status");
      expect(status).toHaveTextContent(exact ? exactText(text) : text);
      expect(status).toHaveAttribute("data-tone", tone);
      expect(screen.queryByText(/gh auth login/)).not.toBeInTheDocument();
      expect(screen.queryByText(/glab auth login/)).not.toBeInTheDocument();
    },
  );

  it("re-login only inspects the connection again", async () => {
    const user = userEvent.setup();
    renderWith("en", { issueSourceMode: "mixed" });
    await screen.findByRole("button", { name: "Sign in again" });
    await user.click(screen.getByRole("button", { name: "Sign in again" }));
    await waitFor(() => {
      expect(inspectConnectionMock).toHaveBeenCalledTimes(2);
    });
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it("shows the label field only for label scope and disables save while it is empty", async () => {
    const user = userEvent.setup();
    renderWith("en", {
      issueSourceMode: "mixed",
      connection: gitlabConnection("unauthenticated"),
    });
    expect(
      await screen.findByRole("checkbox", {
        name: "Close the linked remote issue after the merge request merges",
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("issue-source-status")).toHaveTextContent(
      /^Not signed in$/,
    );
    expect(screen.queryByLabelText("Label")).not.toBeInTheDocument();
    await selectShadcnOption(user, screen, "Sync scope", "Label");
    expect(screen.getByLabelText("Label")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.type(screen.getByLabelText("Label"), "bug");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("hides remote connection in local mode and shows completion from general", async () => {
    const user = userEvent.setup();
    renderPanel("zh");

    expect(
      await screen.findByRole("region", { name: "完成后" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "远程连接" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "完成后动作" }),
    ).toHaveTextContent("合并到 base 分支");
    expect(
      screen.queryByRole("combobox", { name: "PR 目标" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "完成时再次确认动作" }),
    ).toBeChecked();

    await user.click(screen.getByRole("radio", { name: "混合" }));
    expect(
      screen.getByRole("region", { name: "远程连接" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(
      screen.queryByRole("region", { name: "远程连接" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "仅本地" })).toBeChecked();
  });

  it("saves the migrated completion fields when the action opens a pull request", async () => {
    const user = userEvent.setup();
    inspectForgeMock.mockResolvedValue(
      forgeInspection({
        completionAction: "open_pull_request",
        confirmCompletionAction: false,
      }),
    );
    renderWith("zh", { issueSourceMode: "mixed" });

    expect(
      await screen.findByRole("combobox", { name: "完成后动作" }),
    ).toHaveTextContent("提交 Pull Request");
    expect(screen.getByRole("combobox", { name: "PR 目标" })).toHaveTextContent(
      "Issue 的 base 分支（main）",
    );
    expect(screen.getByRole("combobox", { name: "PR 目标" })).toHaveClass(
      "w-full",
    );
    expect(screen.getByRole("checkbox", { name: "创建为草稿" })).toBeChecked();
    await user.click(
      screen.getByRole("checkbox", { name: "完成时再次确认动作" }),
    );
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(updateProjectMock).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 7,
          name: "App",
          repoPath: "/tmp/app",
          worktreeLocation: "repo_sibling",
          worktreeSetupCommand: "",
          completionAction: "open_pull_request",
          prTarget: "issue_base",
          prDraft: true,
          confirmCompletionAction: true,
        }),
      );
    });
  });

  it("uses the merge request target label for GitLab", async () => {
    inspectForgeMock.mockResolvedValue(
      forgeInspection({
        host: "gitlab",
        completionAction: "open_pull_request",
      }),
    );
    renderWith("zh", { issueSourceMode: "local" });

    expect(
      await screen.findByRole("combobox", { name: "完成后动作" }),
    ).toHaveTextContent("提交 Merge Request");
    expect(
      screen.getByRole("combobox", { name: "MR 目标" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "远程连接" }),
    ).not.toBeInTheDocument();
  });

  it("hides completion when the repository is not GitHub or GitLab", async () => {
    inspectForgeMock.mockResolvedValue(
      forgeInspection({
        host: "none",
        remoteLabel: null,
        cliInstalled: false,
        cliAuthenticated: false,
        repoDefaultBranch: null,
      }),
    );
    renderWith("zh", { issueSourceMode: "mixed" });

    expect(
      await screen.findByRole("region", { name: "远程连接" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("完成后")).not.toBeInTheDocument();
    expect(screen.queryByText("完成后动作")).not.toBeInTheDocument();
  });

  it("keeps the issue source locale key trees aligned", () => {
    expect(localeKeyPaths(zh.settings.issueSource).sort()).toEqual(
      localeKeyPaths(en.settings.issueSource).sort(),
    );
  });
});
