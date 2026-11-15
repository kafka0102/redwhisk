import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../shared/i18n/i18n";
import { resumeAgentSession } from "../../agents/agent-session-commands";
import { advanceIssueStatus, listIssues } from "../issue-commands";
import type { IssueRecord } from "../issue-commands";
import { getIssueDetail } from "./issue-detail-commands";
import {
  getIssueSyncStatus,
  syncProjectIssues,
} from "../issue-mirror-commands";
import type { IssueBoardRecord } from "../issue-mirror-commands";
import { getProjectIssueSourceSettings } from "../../settings/issue-source-commands";
import { listProjectLabels } from "../../settings/settings-commands";
import { IssuesActivity } from "../issues-activity";
import { resetIssuePageStateCacheForTests } from "../issues-activity-cache";
import { IssueDetailSideCards } from "./issue-detail-side-cards";
import type {
  IssueDetailProjection,
  LinkedChangeRequestSummary,
} from "./issue-detail-commands";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
  invoke: vi.fn(),
}));

vi.mock("../issue-commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../issue-commands")>();
  return {
    ...actual,
    advanceIssueStatus: vi.fn(),
    listIssues: vi.fn(),
  };
});

vi.mock("./issue-detail-commands", () => ({
  applyIssueRecovery: vi.fn(),
  getIssueDetail: vi.fn(),
  refreshIssueRemoteAvailability: vi.fn(() => new Promise(() => {})),
  retryIssueCompletionWriteback: vi.fn(),
}));

vi.mock("../issue-mirror-commands", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../issue-mirror-commands")>();
  return {
    ...actual,
    getIssueSyncStatus: vi.fn(),
    syncProjectIssues: vi.fn(),
  };
});

vi.mock("../../settings/issue-source-commands", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../settings/issue-source-commands")
    >();
  return {
    ...actual,
    getProjectIssueSourceSettings: vi.fn(),
  };
});

vi.mock("../../settings/settings-commands", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../settings/settings-commands")>();
  return {
    ...actual,
    listAgentProfiles: vi.fn(async () => ({ profiles: [] })),
    listProjectLabels: vi.fn(async () => ({ labels: [] })),
    listSavedAgentSkills: vi.fn(async () => ({ skills: [] })),
  };
});

vi.mock("../../agents/agent-session-commands", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../agents/agent-session-commands")
    >();
  return {
    ...actual,
    listAgentSessions: vi.fn(async () => ({ sessions: [] })),
    resumeAgentSession: vi.fn(),
  };
});

const advanceIssueStatusMock = vi.mocked(advanceIssueStatus);
const listIssuesMock = vi.mocked(listIssues);
const getIssueDetailMock = vi.mocked(getIssueDetail);
const getIssueSyncStatusMock = vi.mocked(getIssueSyncStatus);
const syncProjectIssuesMock = vi.mocked(syncProjectIssues);
const getProjectIssueSourceSettingsMock = vi.mocked(
  getProjectIssueSourceSettings,
);
const listProjectLabelsMock = vi.mocked(listProjectLabels);
const resumeAgentSessionMock = vi.mocked(resumeAgentSession);

function projection(): IssueDetailProjection {
  return {
    provider: "github",
    repo: "acme/redwhisk",
    externalUrl: "https://github.com/acme/redwhisk/issues/128",
    remoteState: "open",
    authorLogin: "lin",
    assignees: [],
    labels: [],
  };
}

function linkedRequest(
  state: LinkedChangeRequestSummary["state"],
): LinkedChangeRequestSummary {
  return {
    provider: "github",
    url: "https://github.com/acme/redwhisk/pull/12",
    number: 12,
    state,
    checksOk: null,
    checksFailed: null,
    checksPending: null,
    title: "Fix login",
    sourceBranch: "feat/login",
    targetBranch: "main",
  };
}

function renderCards(
  state: LinkedChangeRequestSummary["state"],
  issueStatus: string,
): void {
  render(
    <I18nProvider fixedLocale="zh">
      <IssueDetailSideCards
        canOpenSession={false}
        issueStatus={issueStatus}
        linkedChangeRequests={[linkedRequest(state)]}
        linkedSessionId={null}
        projectId={1}
        projection={projection()}
        writebackError={null}
        writebackPending={false}
        onOpenSession={vi.fn()}
        onRetryWriteback={vi.fn()}
      />
    </I18nProvider>,
  );
}

function completedIssue(): IssueBoardRecord {
  return {
    id: 70,
    number: 70,
    projectId: 1,
    title: "关闭未合并",
    description: "正文还在",
    attachments: [],
    labels: [],
    status: "completed",
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
    updatedAt: 1,
    statusChangedAt: 1,
    source: "remote",
    provider: "github",
    externalNumber: 128,
    remoteState: "open",
    remoteLabels: [],
    syncStatus: "synced",
    remoteClosedWhileRunning: false,
    remoteReopened: false,
    pullRequestUrl: "https://github.com/acme/redwhisk/pull/12",
  } as IssueBoardRecord;
}

function issueRecord(
  issue: IssueBoardRecord,
  status: IssueRecord["status"],
): IssueRecord {
  return {
    id: issue.id,
    number: issue.number,
    projectId: issue.projectId,
    title: issue.title,
    description: issue.description,
    attachments: [],
    labels: [],
    status,
    linkedSessionId: null,
    linkedSessionStatus: null,
    linkedSessionAttention: null,
    linkedSessionLogPath: null,
    linkedSessionLatestOutput: null,
    linkedSessionAgentProfileId: null,
    linkedSessionDisplayMode: null,
    linkedSessionProviderSessionId: null,
    linkedSessionAgentType: null,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    statusChangedAt: 2,
  };
}

describe("closed unmerged reopen", () => {
  beforeEach(() => {
    advanceIssueStatusMock.mockReset();
    listIssuesMock.mockReset();
    getIssueDetailMock.mockReset();
    getIssueSyncStatusMock.mockReset();
    syncProjectIssuesMock.mockReset();
    getProjectIssueSourceSettingsMock.mockReset();
    listProjectLabelsMock.mockReset();
    resumeAgentSessionMock.mockReset();
    resetIssuePageStateCacheForTests();
    syncProjectIssuesMock.mockResolvedValue({ outcome: "skipped" });
    getIssueSyncStatusMock.mockResolvedValue({
      lastSyncedAt: 1,
      syncError: null,
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
      remoteIssueCount: 1,
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
    listProjectLabelsMock.mockResolvedValue({ labels: [] });
  });

  it("关联变更请求为 closed 且不是 merged、本地 Issue 为 completed 时，卡片显示「PR/MR 已关闭未合并」和「重新打开 Issue」", () => {
    renderCards("closed", "completed");

    expect(screen.getByText("PR/MR 已关闭未合并")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重新打开 Issue" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "GitHub" })).toHaveTextContent(
      "open",
    );
  });

  it("关联状态为 merged 时不显示「已关闭未合并」", () => {
    renderCards("merged", "completed");

    expect(screen.queryByText("PR/MR 已关闭未合并")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "重新打开 Issue" }),
    ).not.toBeInTheDocument();
  });

  it("点击「重新打开 Issue」后本地状态变为 backlog，不启动会话也不变成 running，远程 Issue 仍是 open", async () => {
    const user = userEvent.setup();
    const issue = completedIssue();
    listIssuesMock.mockResolvedValue({
      issues: [issue],
      statusTotals: { backlog: 0, running: 0, review: 0, completed: 1 },
    });
    getIssueDetailMock.mockResolvedValue({
      projection: projection(),
      linkedChangeRequests: [linkedRequest("closed")],
      writebackPending: false,
      writebackError: null,
      unavailableBanner: null,
    });
    advanceIssueStatusMock.mockResolvedValue(issueRecord(issue, "backlog"));

    render(
      <I18nProvider fixedLocale="zh">
        <IssuesActivity projectId={1} onOpenAgentsActivity={vi.fn()} />
      </I18nProvider>,
    );

    await user.click(await screen.findByRole("button", { name: issue.title }));
    const host = await screen.findByRole("region", { name: "GitHub" });
    expect(host).toHaveTextContent("open");
    expect(screen.getByText("PR/MR 已关闭未合并")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重新打开 Issue" }));

    expect(advanceIssueStatusMock).toHaveBeenCalledWith({
      projectId: 1,
      issueId: issue.id,
      targetStatus: "backlog",
    });
    expect(advanceIssueStatusMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ targetStatus: "running" }),
    );
    expect(resumeAgentSessionMock).not.toHaveBeenCalled();
    expect(withinBacklog(issue.title)).toBeInTheDocument();
    expect(
      screen
        .getByRole("region", { name: "进行中" })
        .querySelector(`[aria-label="${issue.title}"]`),
    ).toBeNull();
  });
});

function withinBacklog(title: string): HTMLElement {
  const backlog = screen.getByRole("region", { name: "待办" });
  const match = backlog.querySelector(`[aria-label="${title}"]`);
  if (!(match instanceof HTMLElement)) {
    throw new Error(`missing backlog issue ${title}`);
  }
  return match;
}
