import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { listen } from "@tauri-apps/api/event";
import { I18nProvider } from "../../shared/i18n/i18n";
import { getProjectIssueSourceSettings } from "../settings/issue-source-commands";
import { IssuesActivity } from "./issues-activity";
import { resetIssuePageStateCacheForTests } from "./issues-activity-cache";
import { ISSUE_PAGE_SIZE } from "./issue-activity-types";
import { getIssueTimeline, listIssues } from "./issue-commands";
import { type IssueBoardRecord } from "./issue-mirror-commands";
import { listProjectChangeRequests } from "./change-request-commands";
import {
  getIssueSyncStatus,
  ISSUE_SYNC_CHANGED_EVENT,
  syncProjectIssues,
  type IssueSyncChangedEvent,
} from "./issue-mirror-commands";

const eventHandlers = vi.hoisted(
  () => new Map<string, (event: { payload: unknown }) => void>(),
);
const eventUnlisten = vi.hoisted(() => vi.fn());

vi.mock("./issue-commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./issue-commands")>();
  return {
    ...actual,
    getIssueTimeline: vi.fn(),
    listIssues: vi.fn(),
    updateIssue: vi.fn(),
  };
});

vi.mock("./issue-mirror-commands", () => ({
  ISSUE_SYNC_CHANGED_EVENT: "issue-sync-changed",
  getIssueSyncStatus: vi.fn(),
  syncProjectIssues: vi.fn(),
}));

vi.mock("./change-request-commands", () => ({
  CHANGE_REQUEST_SYNC_CHANGED_EVENT: "change-request-sync-changed",
  listProjectChangeRequests: vi.fn(),
  syncProjectChangeRequests: vi.fn(async () => ({
    outcome: "skipped",
    errorCode: null,
  })),
}));

vi.mock("../settings/issue-source-commands", () => ({
  getProjectIssueSourceSettings: vi.fn(),
  updateProjectIssueSourceSettings: vi.fn(),
}));

vi.mock("../settings/settings-commands", () => ({
  isGlobalLabelOverridden: () => false,
  listProjectLabels: vi.fn(async () => ({ labels: [] })),
  listSavedAgentSkills: vi.fn(async () => ({ skills: [] })),
}));

vi.mock("../agents/agent-session-commands", () => ({
  listAgentProfiles: vi.fn(async () => ({ profiles: [] })),
  listAgentSessions: vi.fn(async () => ({ sessions: [] })),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (name: string, handler: (event: { payload: unknown }) => void) => {
      eventHandlers.set(name, handler);
      return eventUnlisten;
    },
  ),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

const listIssuesMock = vi.mocked(listIssues);
const syncProjectIssuesMock = vi.mocked(syncProjectIssues);
const getIssueSyncStatusMock = vi.mocked(getIssueSyncStatus);
const getProjectIssueSourceSettingsMock = vi.mocked(
  getProjectIssueSourceSettings,
);
const getIssueTimelineMock = vi.mocked(getIssueTimeline);
const listenMock = vi.mocked(listen);
const listProjectChangeRequestsMock = vi.mocked(listProjectChangeRequests);

function boardIssue(
  partial: Partial<IssueBoardRecord> & { id: number },
): IssueBoardRecord {
  return {
    number: partial.number ?? partial.id,
    projectId: 1,
    title: partial.title ?? "Issue",
    description: "",
    attachments: [],
    labels: partial.labels ?? [],
    status: partial.status ?? "backlog",
    linkedSessionId: null,
    linkedSessionStatus: null,
    linkedSessionAttention: null,
    linkedSessionLogPath: null,
    linkedSessionLatestOutput: null,
    linkedSessionAgentProfileId: null,
    linkedSessionDisplayMode: null,
    linkedSessionProviderSessionId: null,
    linkedSessionAgentType: null,
    createdAt: 1,
    updatedAt: partial.updatedAt ?? 1,
    statusChangedAt: 1,
    source: "local",
    provider: null,
    externalNumber: null,
    remoteState: null,
    remoteLabels: [],
    syncStatus: null,
    remoteClosedWhileRunning: false,
    remoteReopened: false,
    pullRequestUrl: null,
    ...partial,
  };
}

function renderBoard(projectId = 1) {
  return render(
    <I18nProvider fixedLocale="zh">
      <IssuesActivity projectId={projectId} />
    </I18nProvider>,
  );
}

describe("GitHub issue mirror board", () => {
  beforeAll(async () => {
    await import("./issue-detail/issue-read-only-page");
    await import("./issue-detail/issue-editable-page");
  });

  beforeEach(() => {
    eventHandlers.clear();
    eventUnlisten.mockReset();
    listenMock.mockClear();
    resetIssuePageStateCacheForTests();
    listIssuesMock.mockReset();
    syncProjectIssuesMock.mockReset();
    getIssueSyncStatusMock.mockReset();
    getProjectIssueSourceSettingsMock.mockReset();
    getIssueTimelineMock.mockReset();
    getIssueTimelineMock.mockResolvedValue({ entries: [] });
    listProjectChangeRequestsMock.mockReset();
    listProjectChangeRequestsMock.mockResolvedValue({
      rows: [],
      tabCount: 0,
      counts: {
        reviewRequested: 0,
        createdByMe: 0,
        allOpen: 0,
        recentlyMerged: 0,
      },
      pullRequestRefs: [],
    });
    getProjectIssueSourceSettingsMock.mockResolvedValue({
      projectId: 1,
      issueSourceMode: "mixed",
      issueSyncScope: "all_open",
      issueSyncLabel: null,
      issueSyncEnabled: true,
      issueSyncIntervalSeconds: 90,
      issueWritebackCloseOnComplete: false,
      issueWritebackCloseOnPrMerge: false,
      issueWritebackComment: false,
      issueCreateSource: "local",
      localIssueCount: 0,
      remoteIssueCount: 0,
      connection: {
        provider: "github",
        hostUrl: "https://github.com",
        repoPath: "acme/redwhisk",
        login: "octocat",
        cliInstalled: true,
        cliAuthenticated: true,
        authStatus: "ready",
        checkedAt: 1,
      },
    });
    getIssueSyncStatusMock.mockResolvedValue({
      lastSyncedAt: null,
      syncError: null,
    });
    listIssuesMock.mockResolvedValue({
      issues: [
        boardIssue({
          id: 1,
          number: 12,
          title: "Local issue",
          labels: [
            {
              id: 7,
              name: "local-bug",
              scope: "project",
              projectId: 1,
              color: "#E11D48",
              workflowSkill: null,
            },
          ],
          source: "local",
        }),
        boardIssue({
          id: 2,
          number: 4,
          title: "Remote issue",
          externalNumber: 128,
          source: "remote",
          provider: "github",
          remoteLabels: ["bug"],
          syncStatus: "synced",
          updatedAt: Date.now() - 7_200_000,
        }),
        boardIssue({
          id: 3,
          number: 5,
          title: "Running remote",
          status: "running",
          externalNumber: 130,
          source: "remote",
          remoteClosedWhileRunning: true,
        }),
        boardIssue({
          id: 4,
          number: 6,
          title: "Done remote",
          status: "completed",
          externalNumber: 131,
          source: "remote",
          remoteReopened: true,
        }),
      ],
      statusTotals: { backlog: 2, running: 1, review: 0, completed: 1 },
    });
  });

  it("shows local and GitHub cards with remote notes", async () => {
    renderBoard();
    expect(await screen.findByText("#12")).toBeInTheDocument();
    expect(screen.getByText("GH #128")).toBeInTheDocument();
    expect(screen.getAllByText("GitHub").length).toBeGreaterThan(0);
    expect(
      document.querySelector(".issue-card__label-chip--remote")?.textContent,
    ).toBe("bug");
    expect(
      document.querySelector(
        ".issue-card__label-chip:not(.issue-card__label-chip--remote)",
      ),
    ).toHaveStyle({ backgroundColor: "#E11D48" });
    expect(document.querySelector('[data-tone="info"]')).not.toBeNull();
    expect(screen.getByText("2 小时前")).toBeInTheDocument();
    expect(screen.getByText("远端已关闭")).toBeInTheDocument();
    expect(screen.getByText("远端已重开")).toBeInTheDocument();
  });

  it("shows relative sync status and an icon-only refresh button", async () => {
    const now = Date.now();
    getIssueSyncStatusMock.mockResolvedValue({
      lastSyncedAt: now - 120_000,
      syncError: null,
    });
    const view = renderBoard();
    expect(await screen.findByText("已同步 2 分钟前")).toBeInTheDocument();
    expect(
      document.querySelector('.issue-sync-status__dot[data-tone="success"]'),
    ).not.toBeNull();
    const refresh = screen.getByRole("button", { name: "刷新" });
    expect(refresh.textContent?.trim()).toBe("");

    getIssueSyncStatusMock.mockResolvedValue({
      lastSyncedAt: now - 7_200_000,
      syncError: null,
    });
    view.rerender(
      <I18nProvider fixedLocale="zh">
        <IssuesActivity projectId={2} />
      </I18nProvider>,
    );
    expect(await screen.findByText("已同步 2 小时前")).toBeInTheDocument();
  });

  it("shows credential and cache failures without painting every card", async () => {
    getIssueSyncStatusMock.mockResolvedValue({
      lastSyncedAt: 1,
      syncError: "credential_expired",
    });
    const view = renderBoard();
    expect(await screen.findByText("GitHub 凭据已过期")).toBeInTheDocument();
    expect(
      document.querySelector('.issue-sync-status__dot[data-tone="error"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('.issue-card__shell[data-tone="error"]'),
    ).toBeNull();

    getIssueSyncStatusMock.mockResolvedValue({
      lastSyncedAt: 1,
      syncError: "cache_failed",
    });
    view.rerender(
      <I18nProvider fixedLocale="zh">
        <IssuesActivity projectId={3} />
      </I18nProvider>,
    );
    expect(await screen.findByText("同步失败，已保留缓存")).toBeInTheDocument();
  });

  it("marks only the failed card and keeps cards while syncing", async () => {
    const user = userEvent.setup();
    let resolveSync: (value: { outcome: "synced" }) => void = () => undefined;
    syncProjectIssuesMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSync = resolve;
        }),
    );
    listIssuesMock.mockResolvedValue({
      issues: [
        boardIssue({
          id: 2,
          number: 4,
          title: "Broken mirror",
          externalNumber: 128,
          source: "remote",
          syncStatus: "error",
          remoteLabels: [],
        }),
        boardIssue({ id: 3, number: 9, title: "Still fine", source: "local" }),
      ],
      statusTotals: { backlog: 2, running: 0, review: 0, completed: 0 },
    });
    renderBoard();
    const failed = await screen.findByRole("button", { name: "Broken mirror" });
    expect(failed.closest(".issue-card__shell")).toHaveAttribute(
      "data-tone",
      "error",
    );
    expect(screen.getByText("同步失败")).toBeInTheDocument();
    expect(
      screen
        .getByRole("button", { name: "Still fine" })
        .closest(".issue-card__shell"),
    ).not.toHaveAttribute("data-tone", "error");
    await user.click(screen.getByRole("button", { name: "刷新" }));
    expect(await screen.findByText("同步中")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Still fine" }),
    ).toBeInTheDocument();
    resolveSync({ outcome: "synced" });
    await waitFor(() =>
      expect(screen.queryByText("同步中")).not.toBeInTheDocument(),
    );
  });

  it("opens a remote backlog card read-only and edits the local copy", async () => {
    const user = userEvent.setup();
    renderBoard();
    await user.click(
      await screen.findByRole("button", { name: "Remote issue" }),
    );
    expect(
      await screen.findByRole("region", { name: "Issue 详情" }),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Issue 标题")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "更多 issue 操作" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "编辑 Issue" }),
    );
    expect(
      await screen.findByPlaceholderText("Issue 标题"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Issue 详情" }),
    ).not.toBeInTheDocument();
  });

  it("reloads the current project after issue-sync-changed and unsubscribes", async () => {
    const view = renderBoard();
    await screen.findByText("GH #128");
    await waitFor(() =>
      expect(eventHandlers.has(ISSUE_SYNC_CHANGED_EVENT)).toBe(true),
    );
    expect(listIssuesMock).toHaveBeenCalledTimes(1);
    const handler = eventHandlers.get(ISSUE_SYNC_CHANGED_EVENT);
    handler?.({
      payload: {
        projectId: 9,
        outcome: "synced",
      } satisfies IssueSyncChangedEvent,
    });
    expect(listIssuesMock).toHaveBeenCalledTimes(1);
    handler?.({
      payload: {
        projectId: 1,
        outcome: "synced",
      } satisfies IssueSyncChangedEvent,
    });
    await waitFor(() => expect(listIssuesMock).toHaveBeenCalledTimes(2));
    view.unmount();
    expect(eventUnlisten).toHaveBeenCalled();
  });

  it("filters mixed issues from the backend and updates counts", async () => {
    const user = userEvent.setup();
    const local = boardIssue({
      id: 12,
      number: 12,
      title: "Local twelve",
      source: "local",
      status: "backlog",
    });
    const githubBacklog = boardIssue({
      id: 128,
      number: 40,
      title: "Github backlog",
      externalNumber: 128,
      source: "remote",
      status: "backlog",
    });
    const githubRunning = boardIssue({
      id: 130,
      number: 41,
      title: "Github running",
      externalNumber: 130,
      source: "remote",
      status: "running",
    });
    listIssuesMock.mockImplementation(async (input) => {
      if (input.sourceFilter === "local") {
        return {
          issues: [local],
          statusTotals: { backlog: 1, running: 0, review: 0, completed: 0 },
        };
      }
      if (input.sourceFilter === "remote") {
        return {
          issues: [githubBacklog, githubRunning],
          statusTotals: { backlog: 1, running: 1, review: 0, completed: 0 },
        };
      }
      return {
        issues: [local, githubBacklog, githubRunning],
        statusTotals: { backlog: 2, running: 1, review: 0, completed: 0 },
      };
    });

    renderBoard();
    expect(
      await screen.findByRole("tab", { name: "Issues" }),
    ).toHaveTextContent("3");
    expect(screen.getByText("#12")).toBeInTheDocument();
    expect(screen.getByText("GH #128")).toBeInTheDocument();
    expect(screen.getByText("GH #130")).toBeInTheDocument();
    expect(
      screen
        .getByRole("region", { name: "待办" })
        .querySelector(".issue-lane__count"),
    ).toHaveTextContent("2");
    expect(
      screen
        .getByRole("region", { name: "进行中" })
        .querySelector(".issue-lane__count"),
    ).toHaveTextContent("1");

    expect(screen.getByRole("option", { name: "GitHub" })).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "GitHub 或 GitLab" }),
    ).not.toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "来源" }),
      "local",
    );
    expect(
      await screen.findByRole("tab", { name: "Issues" }),
    ).toHaveTextContent("1");
    expect(screen.getByText("#12")).toBeInTheDocument();
    expect(screen.queryByText("GH #128")).not.toBeInTheDocument();
    expect(screen.queryByText("GH #130")).not.toBeInTheDocument();
    expect(
      screen
        .getByRole("region", { name: "待办" })
        .querySelector(".issue-lane__count"),
    ).toHaveTextContent("1");
    expect(
      screen
        .getByRole("region", { name: "进行中" })
        .querySelector(".issue-lane__count"),
    ).toHaveTextContent("0");
    expect(listIssuesMock).toHaveBeenCalledWith({
      projectId: 1,
      perStatusLimit: ISSUE_PAGE_SIZE,
      sourceFilter: "local",
    });

    await user.selectOptions(
      screen.getByRole("combobox", { name: "来源" }),
      "remote",
    );
    expect(
      await screen.findByRole("tab", { name: "Issues" }),
    ).toHaveTextContent("2");
    expect(screen.queryByText("#12")).not.toBeInTheDocument();
    expect(screen.getByText("GH #128")).toBeInTheDocument();
    expect(screen.getByText("GH #130")).toBeInTheDocument();
    expect(listIssuesMock).toHaveBeenCalledWith({
      projectId: 1,
      perStatusLimit: ISSUE_PAGE_SIZE,
      sourceFilter: "remote",
    });
  });

  it("names the remote filter after the connected forge", async () => {
    const gitlabSettings = sourceSettings("mixed");
    getProjectIssueSourceSettingsMock.mockResolvedValue({
      ...gitlabSettings,
      connection: {
        ...gitlabSettings.connection,
        provider: "gitlab",
        hostUrl: "https://gitlab.com",
      },
    });
    renderBoard();
    await screen.findByRole("combobox", { name: "来源" });
    expect(screen.getByRole("option", { name: "GitLab" })).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "GitHub" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the backlog column total when the page is shorter", async () => {
    listIssuesMock.mockResolvedValue({
      issues: Array.from({ length: 5 }, (_, index) =>
        boardIssue({
          id: index + 1,
          number: index + 1,
          title: `Local ${index + 1}`,
          source: "local",
          status: "backlog",
        }),
      ),
      statusTotals: { backlog: 6, running: 0, review: 0, completed: 0 },
    });
    renderBoard();
    const backlog = await screen.findByRole("region", { name: "待办" });
    expect(backlog.querySelector(".issue-lane__count")).toHaveTextContent("6");
    expect(backlog.querySelectorAll(".issue-card")).toHaveLength(5);
    expect(screen.getByRole("tab", { name: "Issues" })).toHaveTextContent("6");
  });

  it("hides source chrome until the source mode is known", async () => {
    const user = userEvent.setup();
    getIssueSyncStatusMock.mockResolvedValue({
      lastSyncedAt: Date.now() - 120_000,
      syncError: null,
    });
    getProjectIssueSourceSettingsMock.mockImplementation(
      () => new Promise(() => undefined),
    );

    const view = renderBoard();
    expect(
      await screen.findByRole("region", { name: "待办" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(getIssueSyncStatusMock).toHaveBeenCalled();
    });
    expect(
      screen.queryByRole("combobox", { name: "来源" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/已同步/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "刷新" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "新建 Issue" }),
    ).not.toBeInTheDocument();

    getProjectIssueSourceSettingsMock.mockResolvedValue(
      sourceSettings("local"),
    );
    view.rerender(
      <I18nProvider fixedLocale="zh">
        <IssuesActivity projectId={2} />
      </I18nProvider>,
    );
    expect(
      await screen.findByRole("button", { name: "新建 Issue" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "来源" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/已同步/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "刷新" }),
    ).not.toBeInTheDocument();

    getProjectIssueSourceSettingsMock.mockResolvedValue(
      sourceSettings("remote"),
    );
    view.rerender(
      <I18nProvider fixedLocale="zh">
        <IssuesActivity projectId={3} />
      </I18nProvider>,
    );
    expect(
      await screen.findByRole("button", { name: "刷新" }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/已同步/)).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "来源" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "新建 Issue" }),
    ).not.toBeInTheDocument();

    getProjectIssueSourceSettingsMock.mockResolvedValue(
      sourceSettings("mixed"),
    );
    view.rerender(
      <I18nProvider fixedLocale="zh">
        <IssuesActivity projectId={4} />
      </I18nProvider>,
    );
    expect(
      await screen.findByRole("combobox", { name: "来源" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新" })).toBeInTheDocument();
    expect(screen.getByText(/已同步/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "新建 Issue" }));
    expect(
      await screen.findByRole("form", { name: "新建 Issue" }),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Issue 标题")).toBeInTheDocument();
  });

  it("shows source controls only in the modes that use them", async () => {
    const user = userEvent.setup();
    getProjectIssueSourceSettingsMock.mockResolvedValue({
      ...(await sourceSettings("local")),
    });
    const view = renderBoard();
    expect(
      await screen.findByRole("button", { name: "新建 Issue" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "来源" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "刷新" }),
    ).not.toBeInTheDocument();

    getProjectIssueSourceSettingsMock.mockResolvedValue(
      await sourceSettings("remote"),
    );
    view.rerender(
      <I18nProvider fixedLocale="zh">
        <IssuesActivity projectId={2} />
      </I18nProvider>,
    );
    expect(
      await screen.findByRole("button", { name: "刷新" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "来源" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "新建 Issue" }),
    ).not.toBeInTheDocument();

    getProjectIssueSourceSettingsMock.mockResolvedValue(
      await sourceSettings("mixed"),
    );
    view.rerender(
      <I18nProvider fixedLocale="zh">
        <IssuesActivity projectId={3} />
      </I18nProvider>,
    );
    expect(
      await screen.findByRole("combobox", { name: "来源" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "新建 Issue" }));
    expect(
      await screen.findByPlaceholderText("Issue 标题"),
    ).toBeInTheDocument();
  });

  it("keeps the pull request tab empty", async () => {
    const user = userEvent.setup();
    renderBoard();
    const tab = await screen.findByRole("tab", { name: /Pull requests/ });
    await waitFor(() => expect(tab).toHaveTextContent("0"));
    await user.click(tab);
    expect(
      screen.getByText("没有需要你审阅的 Pull request"),
    ).toBeInTheDocument();
  });

  it("uses the english credential, cache, and empty pull request copy", async () => {
    getIssueSyncStatusMock.mockResolvedValue({
      lastSyncedAt: 1,
      syncError: "credential_expired",
    });
    const view = render(
      <I18nProvider fixedLocale="en">
        <IssuesActivity projectId={1} />
      </I18nProvider>,
    );
    expect(
      await screen.findByText("GitHub credentials expired"),
    ).toBeInTheDocument();
    getIssueSyncStatusMock.mockResolvedValue({
      lastSyncedAt: 1,
      syncError: "cache_failed",
    });
    view.rerender(
      <I18nProvider fixedLocale="en">
        <IssuesActivity projectId={4} />
      </I18nProvider>,
    );
    expect(
      await screen.findByText("Sync failed. Cached issues kept."),
    ).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Pull requests/ }));
    expect(
      screen.getByText("No pull requests need your review"),
    ).toBeInTheDocument();
  });

  it("does not send a second sync while one is in flight", async () => {
    const user = userEvent.setup();
    let resolveSync: (value: { outcome: "synced" }) => void = () => undefined;
    syncProjectIssuesMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSync = resolve;
        }),
    );
    renderBoard();
    expect(await screen.findByText("#12")).toBeInTheDocument();
    await waitFor(() => expect(syncProjectIssuesMock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "刷新" }));
    await user.click(screen.getByRole("button", { name: "刷新" }));
    expect(syncProjectIssuesMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("#12")).toBeInTheDocument();
    resolveSync({ outcome: "synced" });
  });

  it("shows GitHub, GitLab, and local badges on one mixed board", async () => {
    const user = userEvent.setup();
    const local = boardIssue({
      id: 1,
      number: 12,
      title: "Local card",
      source: "local",
    });
    const github = boardIssue({
      id: 2,
      number: 4,
      title: "GitHub card",
      source: "remote",
      provider: "github",
      externalNumber: 128,
      pullRequestUrl: "https://github.com/acme/redwhisk/pull/124",
    });
    const gitlab = boardIssue({
      id: 3,
      number: 5,
      title: "GitLab card",
      source: "remote",
      provider: "gitlab",
      externalNumber: 7,
      pullRequestUrl:
        "https://gitlab.example.com/acme/redwhisk/-/merge_requests/41",
    });
    const plain = boardIssue({
      id: 4,
      number: 6,
      title: "Plain remote",
      source: "remote",
      provider: "github",
      externalNumber: 9,
    });
    listIssuesMock.mockImplementation(async (input) => {
      const issues =
        input.sourceFilter === "remote"
          ? [github, gitlab]
          : [local, github, gitlab, plain];
      return {
        issues,
        statusTotals: {
          backlog: issues.length,
          running: 0,
          review: 0,
          completed: 0,
        },
      };
    });

    renderBoard();
    expect(await screen.findByText("#12")).toBeInTheDocument();
    expect(screen.getByText("GH #128")).toBeInTheDocument();
    expect(screen.getByText("GL #7")).toBeInTheDocument();
    expect(screen.getByText("PR #124")).toBeInTheDocument();
    expect(screen.getByText("MR #41")).toBeInTheDocument();
    expect(
      screen.getByText("Plain remote").closest(".issue-card"),
    ).not.toHaveTextContent(/PR #|MR #/);
    expect(screen.queryByText(/通过|失败|已合并/)).not.toBeInTheDocument();
    const githubRow = screen
      .getByText("GH #128")
      .closest(".issue-card__meta-row");
    const gitlabRow = screen
      .getByText("GL #7")
      .closest(".issue-card__meta-row");
    const localRow = screen.getByText("#12").closest(".issue-card__meta-row");
    expect(githubRow?.querySelector(".issue-card__forge")).toHaveTextContent(
      "GitHub",
    );
    expect(gitlabRow?.querySelector(".issue-card__forge")).toHaveTextContent(
      "GitLab",
    );
    expect(localRow?.querySelector(".issue-card__forge")).toHaveTextContent(
      "本地",
    );
    expect(githubRow?.innerHTML.indexOf("GH #128")).toBeLessThan(
      githubRow?.innerHTML.indexOf("issue-card__forge") ?? -1,
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: "来源" }),
      "remote",
    );
    await waitFor(() => {
      expect(screen.queryByText("Local card")).not.toBeInTheDocument();
    });
    expect(screen.getByText("GH #128")).toBeInTheDocument();
    expect(screen.getByText("GL #7")).toBeInTheDocument();
    expect(listIssuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ sourceFilter: "remote" }),
    );
  });

  it("shows a GitLab credential error without dropping cached cards", async () => {
    const gitlabSettings = sourceSettings("mixed");
    getProjectIssueSourceSettingsMock.mockResolvedValue({
      ...gitlabSettings,
      connection: { ...gitlabSettings.connection, provider: "gitlab" },
    });
    getIssueSyncStatusMock.mockResolvedValue({
      lastSyncedAt: 1,
      syncError: "credential_expired",
    });
    const view = renderBoard();
    expect(await screen.findByText("GitLab 凭据已过期")).toBeInTheDocument();
    expect(
      document.querySelector('.issue-sync-status__dot[data-tone="error"]'),
    ).not.toBeNull();
    expect(screen.getByText("GH #128")).toBeInTheDocument();

    getIssueSyncStatusMock.mockResolvedValue({
      lastSyncedAt: 1,
      syncError: "offline",
    });
    getProjectIssueSourceSettingsMock.mockResolvedValue(
      sourceSettings("mixed"),
    );
    view.rerender(
      <I18nProvider fixedLocale="zh">
        <IssuesActivity projectId={2} />
      </I18nProvider>,
    );
    expect(await screen.findByText("GitHub 当前离线")).toBeInTheDocument();

    getIssueSyncStatusMock.mockResolvedValue({
      lastSyncedAt: 1,
      syncError: "rate_limited",
    });
    getProjectIssueSourceSettingsMock.mockResolvedValue({
      ...gitlabSettings,
      connection: { ...gitlabSettings.connection, provider: "gitlab" },
    });
    view.rerender(
      <I18nProvider fixedLocale="zh">
        <IssuesActivity projectId={3} />
      </I18nProvider>,
    );
    expect(await screen.findByText("GitLab 请求过于频繁")).toBeInTheDocument();

    getIssueSyncStatusMock.mockResolvedValue({
      lastSyncedAt: 1,
      syncError: "cli_missing",
    });
    view.rerender(
      <I18nProvider fixedLocale="zh">
        <IssuesActivity projectId={4} />
      </I18nProvider>,
    );
    expect(
      await screen.findByText("未找到 GitLab 命令行，已保留缓存"),
    ).toBeInTheDocument();
    expect(screen.getByText("GH #128")).toBeInTheDocument();
  });

  it("uses the english GitLab credential sentence", async () => {
    const gitlabSettings = sourceSettings("mixed");
    getProjectIssueSourceSettingsMock.mockResolvedValue({
      ...gitlabSettings,
      connection: { ...gitlabSettings.connection, provider: "gitlab" },
    });
    getIssueSyncStatusMock.mockResolvedValue({
      lastSyncedAt: 1,
      syncError: "credential_expired",
    });
    render(
      <I18nProvider fixedLocale="en">
        <IssuesActivity projectId={1} />
      </I18nProvider>,
    );
    expect(
      await screen.findByText("GitLab credentials expired"),
    ).toBeInTheDocument();
  });

  it("does not read issues.githubCredentialExpired", () => {
    const toolbar = readFileSync(
      resolve(process.cwd(), "src/features/issues/issue-sync-toolbar.tsx"),
      "utf8",
    );
    expect(toolbar).not.toContain("githubCredentialExpired");
    expect(toolbar).toContain('t("issues.credentialExpired"');
  });
});

function sourceSettings(mode: "local" | "remote" | "mixed") {
  return {
    projectId: 1,
    issueSourceMode: mode,
    issueSyncScope: "all_open" as const,
    issueSyncLabel: null,
    issueSyncEnabled: true,
    issueSyncIntervalSeconds: 90,
    issueWritebackCloseOnComplete: false,
    issueWritebackCloseOnPrMerge: false,
    issueWritebackComment: false,
    issueCreateSource: "local" as const,
    localIssueCount: 0,
    remoteIssueCount: 0,
    connection: {
      provider: "github" as const,
      hostUrl: "https://github.com",
      repoPath: "acme/redwhisk",
      login: "octocat",
      cliInstalled: true,
      cliAuthenticated: true,
      authStatus: "ready" as const,
      checkedAt: 1,
    },
  };
}
