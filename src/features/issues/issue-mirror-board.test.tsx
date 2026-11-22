import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { listen } from "@tauri-apps/api/event";
import { I18nProvider } from "../../shared/i18n/i18n";
import {
  openShadcnSelect,
  selectShadcnOption,
} from "../../test/select-helpers";
import {
  getProjectIssueSourceSettings,
  updateProjectIssueSourceSettings,
} from "../settings/issue-source-commands";
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

import "../../shared/styles/issues-board.css";
import "../../shared/styles/workbench-shell.css";

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
const updateProjectIssueSourceSettingsMock = vi.mocked(
  updateProjectIssueSourceSettings,
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

async function expectSyncToolbar(
  text: string,
  tone?: "success" | "error",
): Promise<void> {
  await waitFor(() => {
    expect(
      document.querySelector(".issue-sync-status__text")?.textContent,
    ).toBe(text);
    if (tone) {
      expect(
        document.querySelector(`.issue-sync-status__dot[data-tone="${tone}"]`),
      ).not.toBeNull();
    }
  });
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
    updateProjectIssueSourceSettingsMock.mockReset();
    updateProjectIssueSourceSettingsMock.mockImplementation(async (input) => ({
      ...sourceSettings(input.issueSourceMode ?? "mixed"),
      issueDisplayMode: input.issueDisplayMode ?? "board",
    }));
    getIssueTimelineMock.mockReset();
    getIssueTimelineMock.mockResolvedValue({ entries: [] });
    listProjectChangeRequestsMock.mockReset();
    listProjectChangeRequestsMock.mockResolvedValue({
      rows: [],
      tabCount: 0,
      counts: {
        open: 0,
        closed: 0,
      },
      pullRequestRefs: [],
    });
    getProjectIssueSourceSettingsMock.mockResolvedValue({
      projectId: 1,
      issueSourceMode: "mixed",
      issueDisplayMode: "board",
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
    expect(screen.getByText("#128")).toBeInTheDocument();
    expect(
      screen.getAllByRole("img", { name: "GitHub" }).length,
    ).toBeGreaterThan(0);
    expect(document.querySelector(".issue-card__forge")).toBeNull();
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

  it("shows project labels on a remote issue card", async () => {
    listIssuesMock.mockResolvedValue({
      issues: [
        boardIssue({
          id: 8,
          number: 18,
          title: "Remote labeled",
          externalNumber: 200,
          source: "remote",
          provider: "github",
          labels: [
            {
              id: 1,
              name: "bug",
              scope: "project",
              projectId: 1,
              color: "#2563EB",
              workflowSkill: null,
            },
            {
              id: 2,
              name: "absent",
              scope: "project",
              projectId: 1,
              color: "#16A34A",
              workflowSkill: null,
            },
          ],
          remoteLabels: ["Bug"],
        }),
      ],
      statusTotals: { backlog: 1, running: 0, review: 0, completed: 0 },
    });

    renderBoard();

    const card = (await screen.findByText("Remote labeled")).closest(
      ".issue-card__shell",
    );
    expect(card).not.toBeNull();
    const chips = Array.from(card!.querySelectorAll(".issue-card__label-chip"));
    expect(chips.map((chip) => chip.textContent)).toEqual(["bug", "absent"]);
    expect(chips[0]).toHaveStyle({ backgroundColor: "#2563EB" });
    expect(chips[1]).toHaveStyle({ backgroundColor: "#16A34A" });
    expect(card!.querySelector(".sr-only")?.textContent).toBe(
      "标签: bug, absent",
    );
  });

  it("omits the label row when a remote issue has no labels", async () => {
    listIssuesMock.mockResolvedValue({
      issues: [
        boardIssue({
          id: 9,
          number: 19,
          title: "Remote unlabeled",
          externalNumber: 201,
          source: "remote",
          provider: "github",
          labels: [],
          remoteLabels: [],
        }),
      ],
      statusTotals: { backlog: 1, running: 0, review: 0, completed: 0 },
    });

    renderBoard();

    const card = (await screen.findByText("Remote unlabeled")).closest(
      ".issue-card__shell",
    );
    expect(card).not.toBeNull();
    expect(card!.querySelector(".issue-card__labels")).toBeNull();
  });

  it("keeps a single project label chip on a local issue card", async () => {
    listIssuesMock.mockResolvedValue({
      issues: [
        boardIssue({
          id: 10,
          number: 20,
          title: "Local labeled",
          source: "local",
          labels: [
            {
              id: 3,
              name: "local-bug",
              scope: "project",
              projectId: 1,
              color: "#E11D48",
              workflowSkill: null,
            },
          ],
          remoteLabels: [],
        }),
      ],
      statusTotals: { backlog: 1, running: 0, review: 0, completed: 0 },
    });

    renderBoard();

    const card = (await screen.findByText("Local labeled")).closest(
      ".issue-card__shell",
    );
    expect(card).not.toBeNull();
    const chips = Array.from(card!.querySelectorAll(".issue-card__label-chip"));
    expect(chips.map((chip) => chip.textContent)).toEqual(["local-bug"]);
    expect(chips[0]).toHaveStyle({ backgroundColor: "#E11D48" });
    expect(chips[0]?.classList.contains("issue-card__label-chip--remote")).toBe(
      false,
    );
  });

  it("shows a host label when a remote issue has no project labels", async () => {
    listIssuesMock.mockResolvedValue({
      issues: [
        boardIssue({
          id: 11,
          number: 21,
          title: "Host labeled",
          externalNumber: 202,
          source: "remote",
          provider: "github",
          labels: [],
          remoteLabels: ["bug"],
        }),
      ],
      statusTotals: { backlog: 1, running: 0, review: 0, completed: 0 },
    });

    renderBoard();

    const card = (await screen.findByText("Host labeled")).closest(
      ".issue-card__shell",
    );
    expect(card).not.toBeNull();
    const chips = Array.from(card!.querySelectorAll(".issue-card__label-chip"));
    expect(chips.map((chip) => chip.textContent)).toEqual(["bug"]);
  });

  it("shows relative sync status and an icon-only refresh button", async () => {
    const now = Date.now();
    getIssueSyncStatusMock.mockResolvedValue({
      lastSyncedAt: now - 120_000,
      syncError: null,
    });
    const view = renderBoard();
    await expectSyncToolbar("已同步 2 分钟前", "success");
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
    await expectSyncToolbar("已同步 2 小时前", "success");
  });

  it("shows credential and cache failures without painting every card", async () => {
    getIssueSyncStatusMock.mockResolvedValue({
      lastSyncedAt: 1,
      syncError: "credential_expired",
    });
    const view = renderBoard();
    await expectSyncToolbar("GitHub 凭据已过期", "error");
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
    await expectSyncToolbar("同步失败，已保留缓存", "error");
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

  it("opens a remote backlog card in the edit form", async () => {
    const user = userEvent.setup();
    renderBoard();
    await user.click(
      await screen.findByRole("button", { name: "Remote issue" }),
    );
    expect(
      await screen.findByRole("form", { name: "编辑 Issue" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByPlaceholderText("Issue 标题"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Issue 详情" }),
    ).not.toBeInTheDocument();
  });

  it("reloads the current project after issue-sync-changed and unsubscribes", async () => {
    const view = renderBoard();
    await screen.findByText("#128");
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
    expect(screen.getByText("#128")).toBeInTheDocument();
    expect(screen.getByText("#130")).toBeInTheDocument();
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

    await openShadcnSelect(user, screen, "来源");
    expect(
      await screen.findByRole("option", { name: "GitHub" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "GitHub 或 GitLab" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "仅本地" }));
    expect(
      await screen.findByRole("tab", { name: "Issues" }),
    ).toHaveTextContent("1");
    expect(screen.getByText("#12")).toBeInTheDocument();
    expect(screen.queryByText("#128")).not.toBeInTheDocument();
    expect(screen.queryByText("#130")).not.toBeInTheDocument();
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

    await selectShadcnOption(user, screen, "来源", "GitHub");
    expect(
      await screen.findByRole("tab", { name: "Issues" }),
    ).toHaveTextContent("2");
    expect(screen.queryByText("#12")).not.toBeInTheDocument();
    expect(screen.getByText("#128")).toBeInTheDocument();
    expect(screen.getByText("#130")).toBeInTheDocument();
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
    const user = userEvent.setup();
    renderBoard();
    await screen.findByRole("combobox", { name: "来源" });
    await openShadcnSelect(user, screen, "来源");
    expect(
      await screen.findByRole("option", { name: "GitLab" }),
    ).toBeInTheDocument();
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
      screen.getByRole("button", { name: "新建 Issue" }),
    ).toBeInTheDocument();

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
    expect(
      await screen.findByText(/已同步/, {
        selector: ".issue-sync-status__text",
      }),
    ).toBeInTheDocument();
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
      screen.getByRole("button", { name: "新建 Issue" }),
    ).toBeInTheDocument();

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

  it("opens a remote create form without a source picker when the connection is ready", async () => {
    const user = userEvent.setup();
    getProjectIssueSourceSettingsMock.mockResolvedValue({
      ...sourceSettings("remote"),
      connection: {
        ...sourceSettings("remote").connection,
        authStatus: "expired",
        cliAuthenticated: false,
      },
    });
    const view = renderBoard();
    expect(
      await screen.findByRole("button", { name: "刷新" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "新建 Issue" }),
    ).not.toBeInTheDocument();

    getProjectIssueSourceSettingsMock.mockResolvedValue(
      sourceSettings("remote"),
    );
    view.rerender(
      <I18nProvider fixedLocale="zh">
        <IssuesActivity projectId={2} />
      </I18nProvider>,
    );
    await user.click(await screen.findByRole("button", { name: "新建 Issue" }));
    expect(
      await screen.findByRole("form", { name: "新建 Issue" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "来源" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "创建 Issue" }),
    ).toBeEnabled();
  });

  it("keeps the pull request tab empty", async () => {
    const user = userEvent.setup();
    renderBoard();
    const tab = await screen.findByRole("tab", { name: /Pull requests/ });
    await waitFor(() => expect(tab).toHaveTextContent("0"));
    await user.click(tab);
    expect(screen.getByText("没有打开的 Pull request")).toBeInTheDocument();
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
    expect(screen.getByText("No open pull requests")).toBeInTheDocument();
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
    expect(screen.getByText("#128")).toBeInTheDocument();
    expect(screen.getByText("#7")).toBeInTheDocument();
    expect(screen.getByText("PR #124")).toBeInTheDocument();
    expect(screen.getByText("MR #41")).toBeInTheDocument();
    expect(
      screen.getByText("Plain remote").closest(".issue-card__shell"),
    ).not.toHaveTextContent(/PR #|MR #/);
    expect(screen.queryByText(/通过|失败|已合并/)).not.toBeInTheDocument();
    const githubRow = screen.getByText("#128").closest(".issue-card__meta-row");
    const gitlabRow = screen.getByText("#7").closest(".issue-card__meta-row");
    const localRow = screen.getByText("#12").closest(".issue-card__meta-row");
    expect(githubRow?.querySelector('[data-kind="github"]')).not.toBeNull();
    expect(gitlabRow?.querySelector('[data-kind="gitlab"]')).not.toBeNull();
    expect(localRow?.querySelector('[data-kind="local"]')).not.toBeNull();
    expect(githubRow?.textContent).not.toMatch(/GitHub|GitLab|本地/);
    expect(gitlabRow?.textContent).not.toMatch(/GitHub|GitLab|本地/);
    expect(localRow?.textContent).not.toMatch(/GitHub|GitLab|本地/);
    const githubId = githubRow?.querySelector(".issue-card__id-line");
    expect(githubId?.innerHTML.indexOf("issue-source-mark")).toBeLessThan(
      githubId?.innerHTML.indexOf("#128") ?? -1,
    );
    expect(screen.queryByText(/GH #|GL #/)).not.toBeInTheDocument();

    await selectShadcnOption(user, screen, "来源", "GitHub");
    await waitFor(() => {
      expect(screen.queryByText("Local card")).not.toBeInTheDocument();
    });
    expect(screen.getByText("#128")).toBeInTheDocument();
    expect(screen.getByText("#7")).toBeInTheDocument();
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
    await expectSyncToolbar("GitLab 凭据已过期", "error");
    expect(screen.getByText("#128")).toBeInTheDocument();

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
    expect(screen.getByText("#128")).toBeInTheDocument();
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

  it("uses Merge requests for a GitLab project and keeps Pull requests for GitHub", async () => {
    const user = userEvent.setup();
    const gitlabSettings = sourceSettings("mixed");
    getProjectIssueSourceSettingsMock.mockResolvedValue({
      ...gitlabSettings,
      connection: { ...gitlabSettings.connection, provider: "gitlab" },
    });
    const view = renderBoard();
    const gitlabTab = await screen.findByRole("tab", {
      name: "Merge requests",
    });
    await user.click(gitlabTab);
    expect(screen.getByText("没有打开的 Merge request")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Merge requests" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Merge request 筛选")).toBeInTheDocument();

    getProjectIssueSourceSettingsMock.mockResolvedValue(
      sourceSettings("mixed"),
    );
    view.rerender(
      <I18nProvider fixedLocale="zh">
        <IssuesActivity projectId={2} />
      </I18nProvider>,
    );
    const githubTab = await screen.findByRole("tab", {
      name: "Pull requests",
    });
    await user.click(githubTab);
    expect(screen.getByText("没有打开的 Pull request")).toBeInTheDocument();
  });

  it("centers the local connection button in the kanban area without a title", async () => {
    const user = userEvent.setup();
    getProjectIssueSourceSettingsMock.mockResolvedValue(
      sourceSettings("local"),
    );
    renderBoard();
    await user.click(await screen.findByRole("tab", { name: "Pull requests" }));
    expect(screen.queryByText("Pull requests 还没有连接")).toBeNull();
    const empty = screen
      .getByRole("button", { name: "去设置连接" })
      .closest("section");
    expect(empty?.querySelector("h3")).toBeNull();
    expect(window.getComputedStyle(empty!).gridArea).toBe("kanban");
    expect(window.getComputedStyle(empty!).placeItems).toBe("center");
  });

  it("does not render the connection empty state before source mode is known", async () => {
    const user = userEvent.setup();
    getProjectIssueSourceSettingsMock.mockImplementation(
      () => new Promise(() => undefined),
    );
    renderBoard();
    const tab = await screen.findByRole("tab", { name: "Pull requests" });
    expect(tab.querySelector(".issue-board-tab__count")).toBeNull();
    await user.click(tab);
    expect(screen.queryByRole("button", { name: "去设置连接" })).toBeNull();
    expect(screen.queryByText("Pull requests 还没有连接")).toBeNull();
  });

  it("centers the backlog run button beside the title, summary, and labels", async () => {
    const user = userEvent.setup();
    renderBoard();
    const run = await screen.findByRole("button", {
      name: "运行 Local issue",
    });
    const shell = run.closest(".issue-card__shell");
    const bodyRow = shell?.querySelector(".issue-card__body-row");
    const body = shell?.querySelector(".issue-card__body");
    const metaRow = shell?.querySelector(".issue-card__meta-row");
    const labels = shell?.querySelector(".issue-card__labels");
    const icon = run.querySelector("svg");
    expect(shell).not.toBeNull();
    expect(bodyRow).not.toBeNull();
    expect(body).not.toBeNull();
    expect(metaRow).not.toBeNull();
    expect(metaRow?.contains(run)).toBe(false);
    expect(body?.contains(run)).toBe(false);
    expect(labels?.contains(run)).toBe(false);
    expect(bodyRow?.contains(run)).toBe(true);
    expect(bodyRow?.contains(body ?? null)).toBe(true);
    expect(window.getComputedStyle(bodyRow!).alignItems).toBe("center");
    expect(window.getComputedStyle(run).position).not.toBe("absolute");
    expect(icon?.getAttribute("fill")).toBe("none");
    expect(window.getComputedStyle(icon!).fill).toBe("rgba(0, 0, 0, 0)");
    await user.click(run);

    const runningShell = screen
      .getByRole("button", { name: "Running remote" })
      .closest(".issue-card__shell");
    expect(runningShell?.querySelector(".issue-card__run")).toBeNull();
  });

  it("switches the issue board to a title-filtered open list", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({
      issues: [
        boardIssue({
          id: 1,
          number: 12,
          title: "Open local alpha",
          status: "backlog",
          source: "local",
        }),
        boardIssue({
          id: 2,
          number: 4,
          title: "Closed local alpha",
          status: "completed",
          source: "local",
        }),
        boardIssue({
          id: 3,
          number: 40,
          title: "Open remote alpha",
          externalNumber: 128,
          source: "remote",
          provider: "github",
          remoteState: "open",
          status: "completed",
        }),
        boardIssue({
          id: 4,
          number: 41,
          title: "Closed remote alpha",
          externalNumber: 129,
          source: "remote",
          provider: "github",
          remoteState: "closed",
          status: "running",
        }),
        boardIssue({
          id: 5,
          number: 13,
          title: "Open local beta",
          status: "review",
          source: "local",
          description: "alpha lives in the summary",
        }),
      ],
      statusTotals: { backlog: 1, running: 1, review: 1, completed: 2 },
    });

    renderBoard();
    expect(
      await screen.findByRole("region", { name: "待办" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "按标题搜索" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Open \d+$/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "看板模式" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "列表模式" }));

    expect(
      screen.queryByRole("region", { name: "待办" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Open \d+$/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("textbox", { name: "按标题搜索" })).toHaveStyle({
      width: "240px",
    });
    expect(
      screen.queryByRole("button", { name: "运行 Open local alpha" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("#12")).toBeInTheDocument();
    expect(screen.getByText("#128")).toBeInTheDocument();
    expect(screen.queryByText(/GH #|GL #/)).not.toBeInTheDocument();
    expect(screen.getByText("Open local alpha")).toBeInTheDocument();
    expect(screen.getByText("Open remote alpha")).toBeInTheDocument();
    expect(screen.getByText("Open local beta")).toBeInTheDocument();
    expect(screen.queryByText("Closed local alpha")).not.toBeInTheDocument();
    expect(screen.queryByText("Closed remote alpha")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "看板模式" }));
    expect(
      screen.getByRole("textbox", { name: "按标题搜索" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Open \d+$/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "列表模式" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("region", { name: "待办" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "列表模式" }));

    await user.type(
      screen.getByRole("textbox", { name: "按标题搜索" }),
      "alpha",
    );

    expect(screen.getByText("Open local alpha")).toBeInTheDocument();
    expect(screen.getByText("Open remote alpha")).toBeInTheDocument();
    expect(screen.queryByText("Open local beta")).not.toBeInTheDocument();
    expect(screen.queryByText("Closed local alpha")).not.toBeInTheDocument();
    expect(screen.queryByText("Closed remote alpha")).not.toBeInTheDocument();
  });

  it("counts a title-filtered open and closed list without matching summaries", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({
      issues: [
        boardIssue({
          id: 1,
          number: 1,
          title: "列表模式",
          description: "摘要没有关键词",
          status: "backlog",
          source: "local",
          labels: [
            {
              id: 1,
              name: "Intent",
              scope: "project",
              projectId: 1,
              color: "#2563EB",
              workflowSkill: null,
            },
          ],
        }),
        boardIssue({
          id: 2,
          number: 2,
          title: "另一个列表",
          status: "running",
          source: "local",
        }),
        boardIssue({
          id: 3,
          number: 3,
          title: "第三条列表",
          status: "review",
          source: "local",
        }),
        boardIssue({
          id: 4,
          number: 4,
          title: "已完成列表",
          status: "completed",
          source: "local",
        }),
        boardIssue({
          id: 5,
          number: 5,
          title: "摘要命中",
          description: "这里有列表两个字",
          status: "backlog",
          source: "local",
        }),
      ],
      statusTotals: { backlog: 2, running: 1, review: 1, completed: 1 },
    });

    renderBoard();
    await user.click(await screen.findByRole("button", { name: "列表模式" }));
    await user.type(
      screen.getByRole("textbox", { name: "按标题搜索" }),
      "列表",
    );

    expect(screen.getByRole("button", { name: "Open 3" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Closed 1" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByText("列表模式")).toBeInTheDocument();
    expect(screen.getByText("另一个列表")).toBeInTheDocument();
    expect(screen.getByText("第三条列表")).toBeInTheDocument();
    expect(screen.getByText("摘要没有关键词")).toBeInTheDocument();
    expect(screen.getByText("Intent")).toBeInTheDocument();
    expect(screen.queryByText("已完成列表")).not.toBeInTheDocument();
    expect(screen.queryByText("摘要命中")).not.toBeInTheDocument();
    expect(screen.queryByText("这里有列表两个字")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "运行 列表模式" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Closed 1" }));
    expect(screen.getByText("已完成列表")).toBeInTheDocument();
    expect(screen.queryByText("列表模式")).not.toBeInTheDocument();
  });

  it("buckets local workflow and remote state into open and closed lists", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({
      issues: [
        boardIssue({
          id: 1,
          number: 1,
          title: "本地待办",
          status: "backlog",
          source: "local",
        }),
        boardIssue({
          id: 2,
          number: 2,
          title: "本地进行",
          status: "running",
          source: "local",
        }),
        boardIssue({
          id: 3,
          number: 3,
          title: "本地验收",
          status: "review",
          source: "local",
        }),
        boardIssue({
          id: 4,
          number: 4,
          title: "本地完成",
          status: "completed",
          source: "local",
        }),
        boardIssue({
          id: 5,
          number: 5,
          title: "远程仍打开",
          status: "completed",
          source: "remote",
          provider: "github",
          externalNumber: 10,
          remoteState: "open",
        }),
        boardIssue({
          id: 6,
          number: 6,
          title: "远程已关闭",
          status: "running",
          source: "remote",
          provider: "github",
          externalNumber: 7,
          remoteState: "closed",
        }),
        boardIssue({
          id: 7,
          number: 7,
          title: "远程状态空",
          status: "backlog",
          source: "remote",
          provider: "gitlab",
          externalNumber: 3,
          remoteState: null,
        }),
      ],
      statusTotals: { backlog: 2, running: 2, review: 1, completed: 2 },
    });

    renderBoard();
    await user.click(await screen.findByRole("button", { name: "列表模式" }));
    expect(screen.getByText("本地待办")).toBeInTheDocument();
    expect(screen.getByText("本地进行")).toBeInTheDocument();
    expect(screen.getByText("本地验收")).toBeInTheDocument();
    expect(screen.getByText("远程仍打开")).toBeInTheDocument();
    expect(screen.getByText("#10")).toBeInTheDocument();
    expect(screen.queryByText("本地完成")).not.toBeInTheDocument();
    expect(screen.queryByText("远程已关闭")).not.toBeInTheDocument();
    expect(screen.queryByText("远程状态空")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Closed/ }));
    expect(screen.getByText("本地完成")).toBeInTheDocument();
    expect(screen.getByText("远程已关闭")).toBeInTheDocument();
    expect(screen.getByText("远程状态空")).toBeInTheDocument();
    expect(screen.getByText("#3")).toBeInTheDocument();
    expect(screen.queryByText("远程仍打开")).not.toBeInTheDocument();
    expect(screen.queryByText("本地待办")).not.toBeInTheDocument();
    expect(screen.queryByText(/GH #|GL #/)).not.toBeInTheDocument();
  });

  it("shows a local assign-to-me avatar and remote avatar fallback", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({
      issues: [
        boardIssue({
          id: 1,
          number: 1,
          title: "本地头像",
          status: "backlog",
          source: "local",
          remoteAssignee: {
            login: "ghost",
            name: "Ghost",
            avatarUrl: "https://example.com/ghost.png",
          },
        }),
        boardIssue({
          id: 2,
          number: 2,
          title: "未指派",
          status: "backlog",
          source: "remote",
          provider: "github",
          externalNumber: 20,
          remoteState: "open",
          remoteAssignee: null,
        }),
        boardIssue({
          id: 3,
          number: 3,
          title: "空头像",
          status: "running",
          source: "remote",
          provider: "gitlab",
          externalNumber: 21,
          remoteState: "open",
          remoteAssignee: {
            login: "wsg",
            name: "王颂歌",
            avatarUrl: null,
          },
        }),
        boardIssue({
          id: 4,
          number: 4,
          title: "有头像",
          status: "review",
          source: "remote",
          provider: "github",
          externalNumber: 22,
          remoteState: "open",
          remoteAssignee: {
            login: "lin",
            name: "",
            avatarUrl: "https://example.com/lin.png",
          },
        }),
      ],
      statusTotals: { backlog: 2, running: 1, review: 1, completed: 0 },
    });

    renderBoard();
    const localCard = (
      await screen.findByRole("button", { name: "本地头像" })
    ).closest(".issue-card__shell");
    const unassigned = screen
      .getByRole("button", { name: "未指派" })
      .closest(".issue-card__shell");
    const emptyAvatar = screen
      .getByRole("button", { name: "空头像" })
      .closest(".issue-card__shell");
    const photo = screen
      .getByRole("button", { name: "有头像" })
      .closest(".issue-card__shell");
    expect(
      localCard?.querySelector('[role="img"][aria-label="指派给 me"]'),
    ).not.toBeNull();
    expect(localCard?.textContent).not.toContain("Ghost");
    expect(localCard?.textContent).not.toContain("Assignee");
    expect(localCard?.querySelector("img")).toBeNull();
    expect(unassigned?.querySelector(".issue-assignee")).toBeNull();
    expect(emptyAvatar?.querySelector("img")).toBeNull();
    expect(emptyAvatar?.querySelector(".issue-assignee__glyph")).not.toBeNull();
    expect(emptyAvatar?.textContent).toContain("Assignee");
    expect(emptyAvatar?.textContent).toContain("王颂歌 @wsg");
    expect(photo?.querySelector("img")).toHaveAttribute(
      "src",
      "https://example.com/lin.png",
    );
    expect(photo?.textContent).toContain("lin @lin");

    await user.click(screen.getByRole("button", { name: "列表模式" }));
    const listRow = screen.getByText("空头像").closest(".issue-list-row");
    expect(listRow?.querySelector("img")).toBeNull();
    expect(listRow?.querySelector(".issue-assignee__glyph")).not.toBeNull();
    expect(listRow?.textContent).toContain("Assignee");
    expect(listRow?.textContent).toContain("王颂歌 @wsg");
    expect(
      screen.getByText("本地头像").closest(".issue-list-row")?.textContent,
    ).not.toContain("Ghost");
  });

  it("shows an empty open list message in both locales", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({
      issues: [
        boardIssue({
          id: 1,
          number: 4,
          title: "Done only",
          status: "completed",
          source: "local",
        }),
      ],
      statusTotals: { backlog: 0, running: 0, review: 0, completed: 1 },
    });
    const view = renderBoard();
    await user.click(await screen.findByRole("button", { name: "列表模式" }));
    expect(screen.getByText("没有符合的 Open Issue")).toBeInTheDocument();

    view.unmount();
    render(
      <I18nProvider fixedLocale="en">
        <IssuesActivity projectId={1} />
      </I18nProvider>,
    );
    await user.click(await screen.findByRole("button", { name: "List view" }));
    expect(
      await screen.findByText("No matching Open issues"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Board view" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Search by title" }),
    ).toBeInTheDocument();
  });

  it("filters each board lane by title and restores hidden cards", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({
      issues: [
        boardIssue({
          id: 1,
          number: 1,
          title: "待办残句",
          status: "backlog",
          source: "local",
        }),
        boardIssue({
          id: 2,
          number: 2,
          title: "待办其它",
          description: "正文里的残句不算",
          status: "backlog",
          source: "local",
        }),
        boardIssue({
          id: 3,
          number: 3,
          title: "验收残句",
          status: "review",
          source: "local",
        }),
        boardIssue({
          id: 4,
          number: 4,
          title: "进行中的其它",
          status: "running",
          source: "local",
        }),
      ],
      statusTotals: { backlog: 2, running: 1, review: 1, completed: 0 },
    });

    renderBoard();
    const search = await screen.findByRole("textbox", { name: "按标题搜索" });
    expect(screen.getByRole("button", { name: "看板模式" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const backlog = screen.getByRole("region", { name: "待办" });
    const review = screen.getByRole("region", { name: "待验收" });
    const running = screen.getByRole("region", { name: "进行中" });
    expect(backlog).toHaveTextContent("待办残句");
    expect(backlog).toHaveTextContent("待办其它");
    expect(review).toHaveTextContent("验收残句");

    await user.type(search, "残句");

    expect(backlog).toHaveTextContent("待办残句");
    expect(backlog).not.toHaveTextContent("待办其它");
    expect(review).toHaveTextContent("验收残句");
    expect(running).toBeInTheDocument();
    expect(running).not.toHaveTextContent("进行中的其它");
    expect(screen.queryByText("正文里的残句不算")).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "   ");

    expect(backlog).toHaveTextContent("待办残句");
    expect(backlog).toHaveTextContent("待办其它");
    expect(review).toHaveTextContent("验收残句");
    expect(running).toHaveTextContent("进行中的其它");
  });

  it("filters the open or closed list by title and keeps the query on the board", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({
      issues: [
        boardIssue({
          id: 1,
          number: 1,
          title: "待办残句",
          status: "backlog",
          source: "local",
        }),
        boardIssue({
          id: 2,
          number: 2,
          title: "待办其它",
          description: "正文里的残句不算",
          status: "backlog",
          source: "local",
        }),
        boardIssue({
          id: 3,
          number: 3,
          title: "验收残句",
          status: "review",
          source: "local",
        }),
        boardIssue({
          id: 4,
          number: 4,
          title: "已完成残句",
          status: "completed",
          source: "local",
        }),
      ],
      statusTotals: { backlog: 2, running: 0, review: 1, completed: 1 },
    });

    renderBoard();
    await user.click(await screen.findByRole("button", { name: "列表模式" }));
    const search = screen.getByRole("textbox", { name: "按标题搜索" });
    await user.type(search, "残句");

    expect(screen.getByRole("button", { name: "Open 2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Closed 1" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByText("待办残句")).toBeInTheDocument();
    expect(screen.getByText("验收残句")).toBeInTheDocument();
    expect(screen.queryByText("待办其它")).not.toBeInTheDocument();
    expect(screen.queryByText("正文里的残句不算")).not.toBeInTheDocument();
    expect(screen.queryByText("已完成残句")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Closed 1" }));
    expect(screen.getByText("已完成残句")).toBeInTheDocument();
    expect(screen.queryByText("待办残句")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "看板模式" }));
    expect(search).toHaveValue("残句");
    expect(screen.getByRole("region", { name: "待办" })).toHaveTextContent(
      "待办残句",
    );
    expect(screen.getByRole("region", { name: "待办" })).not.toHaveTextContent(
      "待办其它",
    );
    expect(screen.getByRole("region", { name: "已完成" })).toHaveTextContent(
      "已完成残句",
    );

    await user.clear(search);
    await user.type(search, "   ");
    expect(screen.getByRole("region", { name: "待办" })).toHaveTextContent(
      "待办其它",
    );
    await user.click(screen.getByRole("button", { name: "列表模式" }));
    expect(search).toHaveValue("   ");
    expect(screen.getByRole("button", { name: "Open 3" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Closed 1" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open 3" }));
    expect(screen.getByText("待办其它")).toBeInTheDocument();
    expect(screen.getByText("正文里的残句不算")).toBeInTheDocument();
  });

  it("uses compact row gaps without reserving an empty status row", async () => {
    const user = userEvent.setup();
    renderBoard();
    const surface = document.querySelector(".activity-surface--issues");
    expect(surface).not.toBeNull();
    await screen.findByRole("region", { name: "待办" });
    const boardIcon = screen.getByRole("button", { name: "看板模式" });
    const listIcon = screen.getByRole("button", { name: "列表模式" });

    expect(window.getComputedStyle(surface!).rowGap).toBe("6px");
    expect(window.getComputedStyle(surface!).gridTemplateAreas).not.toContain(
      "status",
    );
    expect(
      document.querySelector(".activity-surface--issues > .issues-status"),
    ).toBeNull();
    expect(window.getComputedStyle(boardIcon)).toMatchObject({
      width: "28px",
      height: "28px",
    });
    expect(window.getComputedStyle(listIcon)).toMatchObject({
      width: "28px",
      height: "28px",
    });

    await user.click(listIcon);
    expect(window.getComputedStyle(surface!).rowGap).toBe("6px");
    expect(window.getComputedStyle(surface!).gridTemplateAreas).not.toContain(
      "status",
    );
    expect(
      document.querySelector(".activity-surface--issues > .issues-status"),
    ).toBeNull();
    expect(window.getComputedStyle(boardIcon)).toMatchObject({
      width: "28px",
      height: "28px",
    });
    expect(window.getComputedStyle(listIcon)).toMatchObject({
      width: "28px",
      height: "28px",
    });
  });

  it("shows a page error in the status row without replacing issue content", async () => {
    listIssuesMock.mockRejectedValueOnce(new Error("Issue mirror unavailable"));

    renderBoard();

    const status = await screen.findByRole("status", {
      name: "Issues 状态",
    });
    expect(status).toHaveClass("issues-status");
    const surface = document.querySelector(".activity-surface--issues");
    expect(surface).not.toBeNull();
    expect(window.getComputedStyle(surface!).gridTemplateAreas).toContain(
      "status",
    );
    expect(
      screen.getByRole("region", { name: "Issues 看板" }),
    ).toBeInTheDocument();
  });

  it("draws one top border on the first list issue and one border between rows", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({
      issues: [
        boardIssue({
          id: 1,
          number: 1,
          title: "第一条",
          status: "backlog",
          source: "local",
        }),
        boardIssue({
          id: 2,
          number: 2,
          title: "第二条",
          status: "running",
          source: "local",
        }),
      ],
      statusTotals: { backlog: 1, running: 1, review: 0, completed: 0 },
    });

    renderBoard();
    document.documentElement.style.setProperty(
      "--color-border",
      "rgb(1, 2, 3)",
    );
    await user.click(await screen.findByRole("button", { name: "列表模式" }));
    const first = screen.getByText("第一条").closest(".issue-list-row");
    const second = screen.getByText("第二条").closest(".issue-list-row");
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    const firstStyle = window.getComputedStyle(first!);
    const secondStyle = window.getComputedStyle(second!);
    expect(firstStyle.borderTopWidth).toBe("1px");
    expect(firstStyle.borderTopStyle).toBe("solid");
    expect(firstStyle.borderTopColor).toBe(firstStyle.borderBottomColor);
    expect(secondStyle.borderTopStyle).toBe("none");
    expect(secondStyle.borderBottomWidth).toBe("1px");
    expect(secondStyle.borderBottomColor).toBe(firstStyle.borderBottomColor);
  });

  it("puts New Issue to the right of the view icons and opens the create page", async () => {
    const user = userEvent.setup();
    renderBoard();
    const backlog = await screen.findByRole("region", { name: "待办" });
    expect(
      within(backlog).queryByRole("button", { name: "新建 Issue" }),
    ).not.toBeInTheDocument();
    expect(modeToolLabels()).toEqual([
      "按标题搜索",
      "看板模式",
      "列表模式",
      "新建 Issue",
    ]);

    await user.click(screen.getByRole("button", { name: "列表模式" }));
    expect(
      screen.queryByRole("region", { name: "待办" }),
    ).not.toBeInTheDocument();
    expect(modeToolLabels()).toEqual([
      "按标题搜索",
      "看板模式",
      "列表模式",
      "新建 Issue",
    ]);

    await user.click(screen.getByRole("button", { name: "新建 Issue" }));
    expect(
      await screen.findByRole("form", { name: "新建 Issue" }),
    ).toBeInTheDocument();
  });

  it("drops the issue search row from the pull request tab", async () => {
    const user = userEvent.setup();
    renderBoard();
    await user.click(await screen.findByRole("tab", { name: /Pull requests/ }));
    const surface = document.querySelector(".activity-surface--issues");
    expect(surface).not.toBeNull();
    const areas = window.getComputedStyle(surface!).gridTemplateAreas;
    expect(areas).not.toContain("mode");
    expect(areas).not.toContain("status");
    expect(areas).toContain("header");
    expect(areas).toContain("kanban");
    expect(
      screen.queryByRole("textbox", { name: "按标题搜索" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "看板模式" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "列表模式" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "新建 Issue" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("没有打开的 Pull request")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Issues" }));
    expect(
      screen.getByRole("textbox", { name: "按标题搜索" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "看板模式" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "列表模式" }),
    ).toBeInTheDocument();
    expect(window.getComputedStyle(surface!).gridTemplateAreas).toContain(
      "mode",
    );
  });

  it("shows New Issue on both views only when the board can create", async () => {
    const user = userEvent.setup();
    getProjectIssueSourceSettingsMock.mockResolvedValue({
      ...sourceSettings("remote"),
      connection: {
        ...sourceSettings("remote").connection,
        authStatus: "expired",
        cliAuthenticated: false,
      },
    });
    const view = renderBoard();
    await screen.findByRole("button", { name: "看板模式" });
    expect(
      screen.queryByRole("button", { name: "新建 Issue" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "列表模式" }));
    expect(
      screen.queryByRole("button", { name: "新建 Issue" }),
    ).not.toBeInTheDocument();

    for (const mode of ["local", "mixed", "remote"] as const) {
      getProjectIssueSourceSettingsMock.mockResolvedValue(sourceSettings(mode));
      view.rerender(
        <I18nProvider fixedLocale="zh">
          <IssuesActivity
            projectId={mode === "local" ? 2 : mode === "mixed" ? 3 : 4}
          />
        </I18nProvider>,
      );
      expect(
        await screen.findByRole("button", { name: "新建 Issue" }),
      ).toBeInTheDocument();
      const listLabel = screen.getByRole("button", { name: "列表模式" });
      const boardLabel = screen.getByRole("button", { name: "看板模式" });
      if (listLabel.getAttribute("aria-pressed") !== "true") {
        await user.click(listLabel);
      }
      expect(
        screen.getByRole("button", { name: "新建 Issue" }),
      ).toBeInTheDocument();
      await user.click(boardLabel);
      expect(
        screen.getByRole("button", { name: "新建 Issue" }),
      ).toBeInTheDocument();
    }
  });

  it("centers the default avatar in the circle and still covers photo avatars", async () => {
    listIssuesMock.mockResolvedValue({
      issues: [
        boardIssue({
          id: 1,
          number: 1,
          title: "空头像",
          status: "backlog",
          source: "remote",
          provider: "github",
          externalNumber: 21,
          remoteState: "open",
          remoteAssignee: {
            login: "wsg",
            name: "王颂歌",
            avatarUrl: null,
          },
        }),
        boardIssue({
          id: 2,
          number: 2,
          title: "有头像",
          status: "running",
          source: "remote",
          provider: "github",
          externalNumber: 22,
          remoteState: "open",
          remoteAssignee: {
            login: "lin",
            name: "",
            avatarUrl: "https://example.com/lin.png",
          },
        }),
      ],
      statusTotals: { backlog: 1, running: 1, review: 0, completed: 0 },
    });

    renderBoard();
    const emptyCard = (
      await screen.findByRole("button", { name: "空头像" })
    ).closest(".issue-card__shell");
    const glyph = emptyCard?.querySelector(".issue-assignee__glyph");
    expect(glyph).not.toBeNull();
    const bounds = svgGlyphBounds(glyph!);
    expect(
      Math.hypot(
        bounds.center.x - bounds.circle.cx,
        bounds.center.y - bounds.circle.cy,
      ),
    ).toBeLessThanOrEqual(0.4);
    for (const point of bounds.points) {
      expect(
        Math.hypot(point.x - bounds.circle.cx, point.y - bounds.circle.cy),
      ).toBeLessThanOrEqual(bounds.circle.r);
    }

    const photoCard = screen
      .getByRole("button", { name: "有头像" })
      .closest(".issue-card__shell");
    const image = photoCard?.querySelector("img");
    expect(image).toHaveAttribute("src", "https://example.com/lin.png");
    expect(photoCard?.querySelector(".issue-assignee__glyph")).toBeNull();
    expect(window.getComputedStyle(image!).objectFit).toBe("cover");
  });
});

function svgGlyphBounds(svg: Element): {
  center: { x: number; y: number };
  circle: { cx: number; cy: number; r: number };
  points: Array<{ x: number; y: number }>;
} {
  const [minX, minY, width, height] = (
    svg.getAttribute("viewBox") ?? "0 0 16 16"
  )
    .split(/[\s,]+/)
    .map(Number);
  const points: Array<{ x: number; y: number }> = [];
  for (const node of svg.querySelectorAll("circle")) {
    const cx = Number(node.getAttribute("cx"));
    const cy = Number(node.getAttribute("cy"));
    const radius = Number(node.getAttribute("r"));
    points.push(
      { x: cx - radius, y: cy },
      { x: cx + radius, y: cy },
      { x: cx, y: cy - radius },
      { x: cx, y: cy + radius },
    );
  }
  for (const node of svg.querySelectorAll("path")) {
    points.push(...svgPathPoints(node.getAttribute("d") ?? ""));
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    center: {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
    },
    circle: {
      cx: minX + width / 2,
      cy: minY + height / 2,
      r: Math.min(width, height) / 2,
    },
    points,
  };
}

function svgPathPoints(path: string): Array<{ x: number; y: number }> {
  const tokens = path.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const points: Array<{ x: number; y: number }> = [];
  let index = 0;
  let command = "";
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let previousControl: { x: number; y: number } | null = null;
  const read = (): number => Number(tokens[index++]);
  while (index < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[index] ?? "")) {
      command = tokens[index++] ?? "";
    }
    const relative = command === command.toLowerCase();
    if (command === "M" || command === "m") {
      x = relative ? x + read() : read();
      y = relative ? y + read() : read();
      startX = x;
      startY = y;
      points.push({ x, y });
      previousControl = null;
      continue;
    }
    if (command === "H" || command === "h") {
      x = relative ? x + read() : read();
      points.push({ x, y });
      previousControl = null;
      continue;
    }
    if (
      command === "C" ||
      command === "c" ||
      command === "S" ||
      command === "s"
    ) {
      const originX = x;
      const originY = y;
      const reflected =
        previousControl == null
          ? { x: originX, y: originY }
          : {
              x: originX * 2 - previousControl.x,
              y: originY * 2 - previousControl.y,
            };
      const first =
        command === "S" || command === "s"
          ? reflected
          : {
              x: relative ? originX + read() : read(),
              y: relative ? originY + read() : read(),
            };
      const second = {
        x: relative ? originX + read() : read(),
        y: relative ? originY + read() : read(),
      };
      x = relative ? originX + read() : read();
      y = relative ? originY + read() : read();
      points.push(first, second, { x, y });
      previousControl = second;
      continue;
    }
    if (command === "Z" || command === "z") {
      x = startX;
      y = startY;
      previousControl = null;
      continue;
    }
    throw new Error(`unsupported svg command ${command}`);
  }
  return points;
}

function modeToolLabels(): string[] {
  const tools = document.querySelector(".issue-board-mode__tools");
  return [...(tools?.querySelectorAll("button, input") ?? [])].map(
    (node) => node.getAttribute("aria-label") ?? "",
  );
}

function sourceSettings(mode: "local" | "remote" | "mixed") {
  return {
    projectId: 1,
    issueSourceMode: mode,
    issueDisplayMode: "board" as const,
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
