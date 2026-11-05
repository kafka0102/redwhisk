import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { listen } from "@tauri-apps/api/event";
import { I18nProvider } from "../../shared/i18n/i18n";
import { getProjectIssueSourceSettings } from "../settings/issue-source-commands";
import { IssuesActivity } from "./issues-activity";
import { resetIssuePageStateCacheForTests } from "./issues-activity-cache";
import {
  getIssueTimeline,
  listIssues,
  type IssueRecord,
} from "./issue-commands";
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

vi.mock("../settings/issue-source-commands", () => ({
  getProjectIssueSourceSettings: vi.fn(),
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

function boardIssue(
  partial: Partial<IssueRecord> & { id: number } & Record<string, unknown>,
): IssueRecord {
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

  it("opens a remote backlog card read-only and ignores edit", async () => {
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
    expect(screen.queryByPlaceholderText("Issue 标题")).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Issue 详情" }),
    ).toBeInTheDocument();
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
});
