import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { I18nProvider } from "../../../shared/i18n/i18n";
import { makeAgentSession } from "../../../test/agent-session-fixture";
import { listAgentSessions } from "../../agents/agent-session-commands";
import { getProjectIssueSourceSettings } from "../../settings/issue-source-commands";
import { listProjectLabels } from "../../settings/settings-commands";
import { IssuesActivity } from "../issues-activity";
import { resetIssuePageStateCacheForTests } from "../issues-activity-cache";
import {
  advanceIssueStatus,
  completeIssueFlow,
  deleteIssue,
  getIssueSummary,
  getIssueTimeline,
  getIssueWorktreeStatus,
  listIssues,
  updateIssue,
} from "../issue-commands";
import type { IssueRecord } from "../issue-commands";
import {
  getIssueDetail,
  retryIssueCompletionWriteback,
  type IssueDetailRecord,
} from "./issue-detail-commands";
import {
  getIssueSyncStatus,
  syncProjectIssues,
} from "../issue-mirror-commands";
import type { IssueBoardRecord } from "../issue-mirror-commands";

const invokeMock = vi.mocked(invoke);
const openUrlMock = vi.mocked(openUrl);

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("./issue-detail-commands", () => ({
  applyIssueRecovery: vi.fn(),
  getIssueDetail: vi.fn(),
  retryIssueCompletionWriteback: vi.fn(),
}));

vi.mock("../issue-commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../issue-commands")>();
  return {
    ...actual,
    advanceIssueStatus: vi.fn(),
    completeIssueFlow: vi.fn(),
    completeIssueManual: vi.fn(),
    deleteIssue: vi.fn(),
    deleteIssueWorktree: vi.fn(),
    detectAgentCommitCompletion: vi.fn(),
    getIssueSummary: vi.fn(),
    getIssueTimeline: vi.fn(),
    getIssueWorktreeStatus: vi.fn(),
    getProjectGitBranches: vi.fn(),
    listIssues: vi.fn(),
    markIssueReview: vi.fn(),
    prepareAgentCommitCompletion: vi.fn(),
    updateIssue: vi.fn(),
  };
});

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
    listAgentProfileModels: vi.fn(async () => ({ models: [] })),
    listAgentSessions: vi.fn(async () => ({ sessions: [] })),
    resumeAgentSession: vi.fn(),
  };
});

const listIssuesMock = vi.mocked(listIssues);
const updateIssueMock = vi.mocked(updateIssue);
const deleteIssueMock = vi.mocked(deleteIssue);
const advanceIssueStatusMock = vi.mocked(advanceIssueStatus);
const completeIssueFlowMock = vi.mocked(completeIssueFlow);
const getIssueSummaryMock = vi.mocked(getIssueSummary);
const getIssueTimelineMock = vi.mocked(getIssueTimeline);
const getIssueWorktreeStatusMock = vi.mocked(getIssueWorktreeStatus);
const getIssueDetailMock = vi.mocked(getIssueDetail);
const getIssueSyncStatusMock = vi.mocked(getIssueSyncStatus);
const syncProjectIssuesMock = vi.mocked(syncProjectIssues);
const getProjectIssueSourceSettingsMock = vi.mocked(
  getProjectIssueSourceSettings,
);
const listProjectLabelsMock = vi.mocked(listProjectLabels);
const listAgentSessionsMock = vi.mocked(listAgentSessions);

interface DetailProjection {
  provider: "github" | "gitlab";
  repo: string;
  externalUrl: string;
  remoteState: string;
  authorLogin: string | null;
  assignees: string[];
  labels: string[];
}

interface DetailChangeRequest {
  provider: string;
  url: string;
  number: number | null;
  state: "open" | "closed" | "merged" | null;
  checksOk: number | null;
  checksFailed: number | null;
  checksPending: number | null;
  title: string | null;
  sourceBranch: string | null;
  targetBranch: string | null;
}

interface DetailResponse {
  projection: DetailProjection | null;
  linkedChangeRequests: DetailChangeRequest[];
  writebackPending?: boolean;
  writebackError?: string | null;
  unavailableBanner?: IssueDetailRecord["unavailableBanner"];
}

const bugLabel = {
  id: 7,
  name: "bug",
  scope: "project" as const,
  projectId: 1,
  color: "#E11D48",
  workflowSkill: null,
};

function boardIssue(
  partial: Omit<Partial<IssueBoardRecord>, "source"> & {
    id: number;
    source?: string | null;
  },
): IssueBoardRecord {
  return {
    number: partial.number ?? partial.id,
    projectId: 1,
    title: partial.title ?? "完成流程",
    description: partial.description ?? "正文还在",
    attachments: [],
    labels: [],
    status: "backlog",
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
  } as IssueBoardRecord;
}

function hostProjection(
  partial: Partial<DetailProjection> = {},
): DetailProjection {
  return {
    provider: "github",
    repo: "acme/redwhisk",
    externalUrl: "https://github.com/acme/redwhisk/issues/128",
    remoteState: "open",
    authorLogin: "lin",
    assignees: ["yujianjia"],
    labels: [],
    ...partial,
  };
}

function changeRequest(
  partial: Partial<DetailChangeRequest> = {},
): DetailChangeRequest {
  return {
    provider: "github",
    url: "https://github.com/acme/redwhisk/pull/9",
    number: 9,
    state: null,
    checksOk: null,
    checksFailed: null,
    checksPending: null,
    title: null,
    sourceBranch: null,
    targetBranch: null,
    ...partial,
  };
}

function detailTitle(issue: IssueBoardRecord): string {
  if (issue.source === "remote" && issue.externalNumber != null) {
    const prefix = issue.provider === "gitlab" ? "GL" : "GH";
    return `${prefix} #${issue.externalNumber} · ${issue.title}`;
  }
  return `#${issue.number} · ${issue.title}`;
}

function issueRecordWithoutMirror(
  issue: IssueBoardRecord,
  saved: { title: string; description: string },
): IssueRecord {
  return {
    id: issue.id,
    number: issue.number,
    projectId: issue.projectId,
    title: saved.title,
    description: saved.description,
    attachments: issue.attachments,
    labels: issue.labels,
    status: issue.status,
    linkedSessionId: issue.linkedSessionId,
    linkedSessionStatus: issue.linkedSessionStatus,
    linkedSessionAttention: issue.linkedSessionAttention,
    linkedSessionLogPath: issue.linkedSessionLogPath,
    linkedSessionLatestOutput: issue.linkedSessionLatestOutput,
    linkedSessionAgentProfileId: issue.linkedSessionAgentProfileId,
    linkedSessionDisplayMode: issue.linkedSessionDisplayMode,
    linkedSessionProviderSessionId: issue.linkedSessionProviderSessionId,
    linkedSessionAgentType: issue.linkedSessionAgentType,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    statusChangedAt: issue.statusChangedAt,
  };
}

function hostCommands(): string[] {
  return invokeMock.mock.calls.map((call) => String(call[0]));
}

function expectNoHostMutation(pattern: RegExp): void {
  expect(
    hostCommands().some(
      (command) =>
        pattern.test(command) &&
        /github|gitlab|remote|host|forge/i.test(command),
    ),
  ).toBe(false);
}

function renderBoard(issue: IssueBoardRecord, detail: DetailResponse): void {
  listIssuesMock.mockResolvedValue({
    issues: [issue],
    statusTotals: { backlog: 1, running: 0, review: 0, completed: 0 },
  });
  listAgentSessionsMock.mockResolvedValue({
    sessions:
      issue.linkedSessionId == null
        ? []
        : [
            makeAgentSession({
              sessionId: issue.linkedSessionId,
              projectId: issue.projectId,
              issueId: issue.id,
              issueNumber: issue.number,
              issueTitle: issue.title,
              issueStatus: issue.status,
              status: issue.linkedSessionStatus ?? "closed",
            }),
          ],
  });
  getIssueDetailMock.mockResolvedValue({
    linkedChangeRequests: detail.linkedChangeRequests,
    projection: detail.projection,
    writebackError: detail.writebackError ?? null,
    writebackPending: detail.writebackPending ?? false,
    unavailableBanner: detail.unavailableBanner ?? null,
  });
  render(
    <I18nProvider fixedLocale="zh">
      <IssuesActivity projectId={1} onOpenAgentsActivity={vi.fn()} />
    </I18nProvider>,
  );
}

async function openFromBoard(
  issue: IssueBoardRecord,
  detail: DetailResponse,
): Promise<HTMLElement> {
  const user = userEvent.setup();
  renderBoard(issue, detail);
  await user.click(await screen.findByRole("button", { name: issue.title }));
  if (issue.source === "local" && issue.status === "backlog") {
    return screen.findByRole("form", { name: "编辑 Issue" });
  }
  return screen.findByRole("region", { name: "Issue 详情" });
}

describe("Issue 详情按状态与来源", () => {
  beforeAll(async () => {
    await import("../issue-detail/issue-editable-page");
    await import("../issue-detail/issue-read-only-page");
  });

  beforeEach(() => {
    invokeMock.mockReset();
    openUrlMock.mockReset();
    listIssuesMock.mockReset();
    updateIssueMock.mockReset();
    deleteIssueMock.mockReset();
    advanceIssueStatusMock.mockReset();
    completeIssueFlowMock.mockReset();
    getIssueSummaryMock.mockReset();
    getIssueTimelineMock.mockReset();
    getIssueWorktreeStatusMock.mockReset();
    getIssueDetailMock.mockReset();
    getIssueSyncStatusMock.mockReset();
    syncProjectIssuesMock.mockReset();
    getProjectIssueSourceSettingsMock.mockReset();
    listProjectLabelsMock.mockReset();
    listAgentSessionsMock.mockReset();
    resetIssuePageStateCacheForTests();
    getIssueTimelineMock.mockResolvedValue({ entries: [] });
    getIssueWorktreeStatusMock.mockResolvedValue({
      exists: false,
      canDelete: false,
      workspacePath: null,
      workspaceBranch: null,
    });
    getIssueSummaryMock.mockRejectedValue({
      code: "ISSUE_NOT_FOUND",
      message: "Issue not found.",
    });
    deleteIssueMock.mockResolvedValue({ issueId: 1, linkedSessionId: null });
    updateIssueMock.mockImplementation(async (input) =>
      boardIssue({
        id: input.issueId,
        projectId: input.projectId,
        title: input.title,
        description: input.description,
        status: "running",
        source: "remote",
        provider: "github",
        externalNumber: 128,
      }),
    );
    syncProjectIssuesMock.mockResolvedValue({ outcome: "skipped" });
    getIssueSyncStatusMock.mockResolvedValue({
      lastSyncedAt: Date.now(),
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
      localIssueCount: 1,
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
    listProjectLabelsMock.mockResolvedValue({
      labels: [{ ...bugLabel, del: 0 }],
    });
  });

  it.each([
    {
      name: "待办本地直接编辑且没有右侧栏",
      issue: boardIssue({ id: 12, number: 12, source: "local" }),
      detail: { projection: null, linkedChangeRequests: [] },
      actions: ["运行", "保存", "删除"],
      absent: ["打开状态选项", "更多 issue 操作", "完成", "查看回看"],
      cards: [] as Array<"host" | "pr" | "session">,
    },
    {
      name: "待办远程只读且只有宿主卡",
      issue: boardIssue({
        id: 43,
        number: 43,
        status: "backlog",
        source: "remote",
        provider: "github",
        externalNumber: 128,
      }),
      detail: {
        projection: hostProjection(),
        linkedChangeRequests: [],
      },
      actions: ["打开状态选项", "运行", "更多 issue 操作"],
      absent: ["保存", "删除", "完成", "查看回看"],
      statusText: "待办",
      cards: ["host"] as Array<"host" | "pr" | "session">,
    },
    {
      name: "进行中远程有宿主、会话和运行参数，没有 PR 卡",
      issue: boardIssue({
        id: 44,
        number: 44,
        status: "running",
        source: "remote",
        provider: "github",
        externalNumber: 130,
        linkedSessionId: 301,
        linkedSessionStatus: "closed",
      }),
      detail: { projection: hostProjection(), linkedChangeRequests: [] },
      actions: ["打开状态选项", "更多 issue 操作"],
      absent: ["运行", "保存", "删除", "完成", "查看回看"],
      statusText: "进行中",
      cards: ["host", "session"] as Array<"host" | "pr" | "session">,
    },
    {
      name: "进行中本地没有宿主卡",
      issue: boardIssue({
        id: 14,
        number: 14,
        status: "running",
        source: "local",
        linkedSessionId: 302,
        linkedSessionStatus: "closed",
      }),
      detail: { projection: null, linkedChangeRequests: [] },
      actions: ["打开状态选项", "更多 issue 操作"],
      absent: ["运行", "保存", "完成", "查看回看", "打开 GitHub"],
      statusText: "进行中",
      cards: ["session"] as Array<"host" | "pr" | "session">,
    },
    {
      name: "待审核远程四张卡都在",
      issue: boardIssue({
        id: 45,
        number: 45,
        status: "review",
        source: "remote",
        provider: "github",
        externalNumber: 126,
        linkedSessionId: 303,
        linkedSessionStatus: "closed",
        pullRequestUrl: "https://github.com/acme/redwhisk/pull/9",
      }),
      detail: {
        projection: hostProjection(),
        linkedChangeRequests: [
          changeRequest({
            state: "open",
            checksOk: 3,
            checksFailed: 1,
            checksPending: 0,
          }),
        ],
      },
      actions: ["打开状态选项", "更多 issue 操作"],
      absent: ["运行", "保存", "删除", "完成", "查看回看"],
      statusText: "待验收",
      cards: ["host", "pr", "session"] as Array<"host" | "pr" | "session">,
      prState: "open",
    },
    {
      name: "待审核本地没有宿主卡",
      issue: boardIssue({
        id: 15,
        number: 15,
        status: "review",
        source: "local",
        linkedSessionId: 304,
        linkedSessionStatus: "closed",
      }),
      detail: { projection: null, linkedChangeRequests: [] },
      actions: ["打开状态选项", "更多 issue 操作"],
      absent: ["运行", "保存", "完成", "查看回看", "打开 GitHub"],
      statusText: "待验收",
      cards: ["session"] as Array<"host" | "pr" | "session">,
    },
    {
      name: "已完成远程可以有已合并 PR 卡",
      issue: boardIssue({
        id: 46,
        number: 46,
        status: "completed",
        source: "remote",
        provider: "github",
        externalNumber: 121,
        linkedSessionId: 305,
        linkedSessionStatus: "closed",
        linkedSessionDisplayMode: "json",
        linkedSessionProviderSessionId: "thread-121",
        linkedSessionAgentType: "codex",
        pullRequestUrl: "https://github.com/acme/redwhisk/pull/124",
      }),
      detail: {
        projection: hostProjection({ remoteState: "closed" }),
        linkedChangeRequests: [
          changeRequest({
            url: "https://github.com/acme/redwhisk/pull/124",
            number: 124,
            state: "merged",
            checksOk: 4,
            checksFailed: 0,
            checksPending: 0,
          }),
        ],
      },
      actions: ["打开状态选项", "查看回看", "更多 issue 操作"],
      absent: ["运行", "保存", "完成", "删除"],
      statusText: "已完成",
      cards: ["host", "pr", "session"] as Array<"host" | "pr" | "session">,
      prState: "merged",
    },
    {
      name: "已完成本地没有宿主卡",
      issue: boardIssue({
        id: 9,
        number: 9,
        status: "completed",
        source: "local",
        linkedSessionId: 306,
        linkedSessionStatus: "closed",
        linkedSessionDisplayMode: "json",
        linkedSessionProviderSessionId: "thread-9",
        linkedSessionAgentType: "codex",
      }),
      detail: { projection: null, linkedChangeRequests: [] },
      actions: ["打开状态选项", "查看回看", "更多 issue 操作"],
      absent: ["运行", "保存", "完成", "打开 GitHub"],
      statusText: "已完成",
      cards: ["session"] as Array<"host" | "pr" | "session">,
    },
  ])(
    "$name",
    async ({ issue, detail, actions, absent, cards, statusText, prState }) => {
      const root = await openFromBoard(issue, detail);
      const title = detailTitle(issue);
      const heading = within(root).getByRole("heading", {
        level: 2,
        name: title,
      });
      const titleBlock = heading.parentElement;
      expect(titleBlock).not.toBeNull();
      expect(
        within(titleBlock as HTMLElement).getByRole("button", { name: "返回" }),
      ).toBeInTheDocument();
      expect(
        within(titleBlock as HTMLElement).queryByRole("button", {
          name: "打开状态选项",
        }),
      ).toBeNull();
      expect(screen.queryByRole("tab", { name: /Pull requests/ })).toBeNull();
      expect(screen.queryByRole("button", { name: "刷新" })).toBeNull();
      expect(screen.queryByText(/已同步/)).toBeNull();

      if (issue.source === "local" && issue.status === "backlog") {
        const titleInput = within(root).getByLabelText("标题");
        expect(titleInput.tagName).toBe("INPUT");
        expect(titleInput).toHaveValue(issue.title);
      } else {
        expect(within(root).queryByLabelText("标题")).toBeNull();
        expect(within(root).getByText(issue.description)).toBeInTheDocument();
        await waitFor(() => {
          expect(getIssueDetailMock).toHaveBeenCalledWith({
            projectId: 1,
            issueId: issue.id,
          });
        });
      }

      for (const name of actions) {
        expect(within(root).getByRole("button", { name })).toBeInTheDocument();
      }
      for (const name of absent) {
        expect(within(root).queryByRole("button", { name })).toBeNull();
      }
      if (statusText) {
        expect(
          within(root).getByRole("button", { name: "打开状态选项" }),
        ).toHaveTextContent(statusText);
      }

      if (cards.includes("host")) {
        const host = within(root).getByRole("region", { name: "GitHub" });
        expect(
          within(host).getByRole("button", { name: "打开 GitHub" }),
        ).toBeInTheDocument();
        const header = heading.closest("header");
        expect(header).not.toBeNull();
        expect(
          within(header as HTMLElement).queryByRole("button", {
            name: "打开 GitHub",
          }),
        ).toBeNull();
      } else {
        expect(
          within(root).queryByRole("region", { name: "GitHub" }),
        ).toBeNull();
        expect(
          within(root).queryByRole("button", { name: "打开 GitHub" }),
        ).toBeNull();
      }

      if (cards.includes("pr")) {
        const pullRequest = within(root).getByRole("region", {
          name: `关联 PR #${detail.linkedChangeRequests[0]?.number}`,
        });
        expect(
          within(pullRequest).getByText(prState ?? ""),
        ).toBeInTheDocument();
        expect(
          within(pullRequest).getByRole("button", { name: "查看详情" }),
        ).toBeInTheDocument();
      } else {
        expect(
          within(root).queryByRole("region", { name: /关联 PR/ }),
        ).toBeNull();
      }

      if (cards.includes("session")) {
        const sessionHeading = within(root).getByRole("heading", {
          name: "会话信息",
        });
        expect(
          sessionHeading.parentElement?.textContent?.replace(/\s+/g, ""),
        ).toBe("会话信息查看会话");
        expect(
          within(root).getByRole("heading", { name: "运行参数" }),
        ).toBeInTheDocument();
      } else {
        expect(
          within(root).queryByRole("heading", { name: "会话信息" }),
        ).toBeNull();
        expect(
          within(root).queryByRole("heading", { name: "运行参数" }),
        ).toBeNull();
        expect(
          within(root).queryByRole("complementary", { name: "会话信息" }),
        ).toBeNull();
      }
    },
  );

  it("来源为空或 null 时不进入编辑表单", async () => {
    const missingSource = boardIssue({
      id: 4,
      number: 4,
      title: "来源未定",
      source: "local",
    });
    Reflect.deleteProperty(missingSource, "source");
    const issues = [
      boardIssue({
        id: 3,
        number: 3,
        title: "来源未定",
        source: "",
      }),
      boardIssue({
        id: 3,
        number: 3,
        title: "来源未定",
        source: null,
      }),
      missingSource,
    ];
    for (const issue of issues) {
      const root = await openFromBoard(issue, {
        projection: null,
        linkedChangeRequests: [],
      });
      expect(
        within(root).getByRole("heading", {
          level: 2,
          name: `#${issue.number} · 来源未定`,
        }),
      ).toBeInTheDocument();
      expect(within(root).queryByLabelText("标题")).toBeNull();
      expect(screen.queryByRole("form", { name: "编辑 Issue" })).toBeNull();
      cleanupRenderedBoard();
    }
  });

  it("GitLab 远端编号显示在标题上，打开按钮在 GitLab 卡内", async () => {
    const issue = boardIssue({
      id: 7,
      number: 7,
      source: "remote",
      provider: "gitlab",
      externalNumber: 7,
    });
    const root = await openFromBoard(issue, {
      projection: hostProjection({
        provider: "gitlab",
        externalUrl: "https://gitlab.com/acme/redwhisk/-/issues/7",
      }),
      linkedChangeRequests: [],
    });
    expect(
      within(root).getByRole("heading", { level: 2, name: "GL #7 · 完成流程" }),
    ).toBeInTheDocument();
    const host = within(root).getByRole("region", { name: "GitLab" });
    await userEvent.click(
      within(host).getByRole("button", { name: "打开 GitLab" }),
    );
    expect(openUrlMock).toHaveBeenCalledWith(
      "https://gitlab.com/acme/redwhisk/-/issues/7",
    );
    expect(within(root).queryByRole("heading", { name: "待办" })).toBeNull();
  });

  it("只读标签在正文上方，零个标签没有标签行", async () => {
    const empty = boardIssue({
      id: 51,
      source: "remote",
      provider: "github",
      externalNumber: 51,
    });
    const emptyRoot = await openFromBoard(empty, {
      projection: hostProjection({ labels: [] }),
      linkedChangeRequests: [],
    });
    expect(within(emptyRoot).queryByRole("group", { name: "标签" })).toBeNull();
    cleanupRenderedBoard();

    const issue = boardIssue({
      id: 52,
      source: "remote",
      provider: "github",
      externalNumber: 52,
      description: "正文还在",
    });
    const root = await openFromBoard(issue, {
      projection: hostProjection({ labels: ["enhancement", "sync"] }),
      linkedChangeRequests: [],
    });
    const labels = await within(root).findByRole("group", { name: "标签" });
    expect(within(labels).getByText("enhancement")).toBeInTheDocument();
    expect(within(labels).getByText("sync")).toBeInTheDocument();
    const body = within(root).getByText("正文还在");
    expect(
      labels.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(labels.querySelector("[style*='background']")).toBeNull();
  });

  it("只有 PR URL 时仍可打开宿主，且没有状态胶囊", async () => {
    const issue = boardIssue({
      id: 53,
      status: "running",
      source: "remote",
      provider: "github",
      externalNumber: 53,
      linkedSessionId: 307,
      linkedSessionStatus: "closed",
      pullRequestUrl: "https://github.com/acme/redwhisk/pull/9",
    });
    const root = await openFromBoard(issue, {
      projection: hostProjection(),
      linkedChangeRequests: [changeRequest({ state: null })],
    });
    const pullRequest = within(root).getByRole("region", {
      name: "关联 PR #9",
    });
    expect(within(pullRequest).queryByText("open")).toBeNull();
    expect(within(pullRequest).queryByText("merged")).toBeNull();
    expect(within(pullRequest).queryByText("closed")).toBeNull();
    await userEvent.click(
      within(pullRequest).getByRole("button", { name: "打开 GitHub" }),
    );
    expect(openUrlMock).toHaveBeenCalledWith(
      "https://github.com/acme/redwhisk/pull/9",
    );
  });

  it("按关联创建时间展示每一条变更请求", async () => {
    const issue = boardIssue({
      id: 80,
      status: "review",
      source: "remote",
      provider: "github",
      externalNumber: 80,
    });
    const root = await openFromBoard(issue, {
      projection: hostProjection(),
      linkedChangeRequests: [
        changeRequest({
          state: "open",
          checksOk: 3,
          checksFailed: 1,
          checksPending: 0,
        }),
        changeRequest({
          number: 11,
          url: "https://github.com/acme/redwhisk/pull/11",
          state: "merged",
          checksOk: 4,
          checksFailed: 0,
          checksPending: 0,
        }),
      ],
    });
    const first = within(root).getByRole("region", { name: "关联 PR #9" });
    const second = within(root).getByRole("region", { name: "关联 PR #11" });
    expect(within(first).getByText("open")).toBeInTheDocument();
    expect(within(first).getByText("3/4 通过")).toBeInTheDocument();
    expect(within(second).getByText("merged")).toBeInTheDocument();
    expect(within(second).getByText("4/4 通过")).toBeInTheDocument();
    expect(
      within(first).getByRole("button", { name: "查看详情" }),
    ).toBeInTheDocument();
    expect(
      within(first).getByRole("button", { name: "打开 GitHub" }),
    ).toBeInTheDocument();
  });

  it("关联卡片可进入应用内详情", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "list_project_change_requests") {
        return {
          rows: [],
          tabCount: 0,
          counts: {
            reviewRequested: 0,
            createdByMe: 0,
            allOpen: 0,
            recentlyMerged: 0,
          },
          pullRequestRefs: [],
        };
      }
      if (command === "get_project_change_request") {
        return {
          id: 1,
          provider: "github",
          number: 9,
          title: "Remote issue sync",
          url: "https://github.com/acme/redwhisk/pull/9",
          state: "open",
          body: "body",
          authorLogin: "lin",
          sourceBranch: "feat/a",
          targetBranch: "main",
          commitCount: null,
          additions: null,
          deletions: null,
          labels: [],
          reviewers: [],
          mergeable: null,
          mergeStateStatus: null,
          reviewDecision: null,
          blockingReasons: [],
          mergeMethod: null,
          mergeCommitSha: null,
          detailStatus: "fresh",
          detailError: null,
          files: [],
          checks: [],
          reviews: [],
          comments: [],
          linkedIssues: [],
        };
      }
      return undefined;
    });
    const issue = boardIssue({
      id: 81,
      status: "review",
      source: "remote",
      provider: "github",
      externalNumber: 81,
    });
    const root = await openFromBoard(issue, {
      projection: hostProjection(),
      linkedChangeRequests: [
        changeRequest({
          state: "open",
          checksOk: 1,
          checksFailed: 0,
          checksPending: 0,
        }),
      ],
    });
    await userEvent.click(
      within(root).getByRole("button", { name: "查看详情" }),
    );
    expect(
      await screen.findByRole("heading", { name: /#9/ }),
    ).toBeInTheDocument();
  });

  it("投影为 null 时没有宿主卡和 PR 卡", async () => {
    const issue = boardIssue({
      id: 54,
      source: "remote",
      provider: "github",
      externalNumber: 54,
      pullRequestUrl: "https://github.com/acme/redwhisk/pull/9",
    });
    const root = await openFromBoard(issue, {
      projection: null,
      linkedChangeRequests: [],
    });
    await waitFor(() => expect(getIssueDetailMock).toHaveBeenCalled());
    expect(within(root).getByText("正文还在")).toBeInTheDocument();
    expect(within(root).queryByRole("region", { name: "GitHub" })).toBeNull();
    expect(within(root).queryByRole("region", { name: /关联 PR/ })).toBeNull();
  });

  it("投影命令失败时标题和正文仍在，不渲染空宿主卡", async () => {
    const issue = boardIssue({
      id: 55,
      source: "remote",
      provider: "github",
      externalNumber: 55,
    });
    renderBoard(issue, { projection: null, linkedChangeRequests: [] });
    getIssueDetailMock.mockRejectedValue(new Error("detail failed"));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: issue.title }));
    const root = await screen.findByRole("region", { name: "Issue 详情" });
    await waitFor(() => expect(getIssueDetailMock).toHaveBeenCalled());
    expect(
      within(root).getByRole("heading", {
        level: 2,
        name: "GH #55 · 完成流程",
      }),
    ).toBeInTheDocument();
    expect(within(root).getByText("正文还在")).toBeInTheDocument();
    expect(within(root).queryByRole("region", { name: "GitHub" })).toBeNull();
  });

  it("时间轴查询失败时标题和正文仍在", async () => {
    getIssueTimelineMock.mockRejectedValue(new Error("timeline failed"));
    const issue = boardIssue({
      id: 59,
      source: "remote",
      provider: "github",
      externalNumber: 59,
      description: "正文还在",
    });
    const root = await openFromBoard(issue, {
      projection: hostProjection(),
      linkedChangeRequests: [],
    });
    expect(
      within(root).getByRole("heading", {
        level: 2,
        name: "GH #59 · 完成流程",
      }),
    ).toBeInTheDocument();
    expect(within(root).getByText("正文还在")).toBeInTheDocument();
    expect(within(root).queryByRole("region", { name: "动态" })).toBeNull();
  });

  it("远端状态为空或未知时显示不可用，指派为空显示占位", async () => {
    for (const remoteState of ["", "bogus"]) {
      const issue = boardIssue({
        id: 56,
        source: "remote",
        provider: "github",
        externalNumber: 56,
      });
      const root = await openFromBoard(issue, {
        projection: hostProjection({
          remoteState,
          assignees: [],
          authorLogin: "lin",
        }),
        linkedChangeRequests: [],
      });
      const host = within(root).getByRole("region", { name: "GitHub" });
      expect(within(host).getByText("不可用")).toBeInTheDocument();
      expect(within(host).queryByText("open")).toBeNull();
      expect(within(host).getByText("lin")).toBeInTheDocument();
      expect(within(host).getByText("未指派")).toBeInTheDocument();
      expect(within(host).queryByText("ghost")).toBeNull();
      cleanupRenderedBoard();
    }
  });

  it("更多菜单可编辑和删除，远程删除只走本地删除", async () => {
    const user = userEvent.setup();
    const issue = boardIssue({
      id: 57,
      source: "remote",
      provider: "github",
      externalNumber: 57,
    });
    renderBoard(issue, {
      projection: hostProjection(),
      linkedChangeRequests: [],
    });
    await user.click(await screen.findByRole("button", { name: issue.title }));
    const root = await screen.findByRole("region", { name: "Issue 详情" });
    await user.click(
      within(root).getByRole("button", { name: "更多 issue 操作" }),
    );
    const menu = await screen.findByRole("menu");
    expect(
      within(menu).getByRole("menuitem", { name: "编辑 Issue" }),
    ).toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitem", { name: "删除" }));
    const dialog = await screen.findByRole("dialog");
    invokeMock.mockClear();
    await user.click(within(dialog).getByRole("button", { name: "删除" }));
    await waitFor(() =>
      expect(deleteIssueMock).toHaveBeenCalledWith({
        projectId: 1,
        issueId: 57,
      }),
    );
    expectNoHostMutation(/delete|close/);
  });

  it("远程编辑保存不写回宿主，待办编辑顶栏是运行保存删除", async () => {
    const user = userEvent.setup();
    const backlog = boardIssue({
      id: 58,
      source: "remote",
      provider: "github",
      externalNumber: 58,
    });
    const backlogRoot = await openFromBoard(backlog, {
      projection: hostProjection(),
      linkedChangeRequests: [],
    });
    await user.click(
      within(backlogRoot).getByRole("button", { name: "更多 issue 操作" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "编辑 Issue" }),
    );
    const editForm = await screen.findByRole("form", { name: "编辑 Issue" });
    expect(
      within(editForm).getByRole("button", { name: "运行" }),
    ).toBeInTheDocument();
    expect(
      within(editForm).getByRole("button", { name: "保存" }),
    ).toBeInTheDocument();
    expect(
      within(editForm).getByRole("button", { name: "删除" }),
    ).toBeInTheDocument();
    expect(
      within(editForm).queryByRole("button", { name: "打开状态选项" }),
    ).toBeNull();
    cleanupRenderedBoard();

    const running = boardIssue({
      id: 59,
      status: "running",
      source: "remote",
      provider: "github",
      externalNumber: 59,
      linkedSessionId: 309,
      linkedSessionStatus: "closed",
    });
    const root = await openFromBoard(running, {
      projection: hostProjection(),
      linkedChangeRequests: [],
    });
    await user.click(
      within(root).getByRole("button", { name: "更多 issue 操作" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "编辑 Issue" }),
    );
    const form = await screen.findByRole("form", { name: "编辑 Issue" });
    expect(within(form).queryByRole("button", { name: "运行" })).toBeNull();
    expect(within(form).queryByRole("button", { name: "删除" })).toBeNull();
    expect(
      within(form).getByRole("button", { name: "保存" }),
    ).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText("标题"), {
      target: { value: "只改本地" },
    });
    invokeMock.mockClear();
    await user.click(within(form).getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(updateIssueMock).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 1,
          issueId: 59,
          title: "只改本地",
        }),
      ),
    );
    expectNoHostMutation(/update|write|edit|close|delete/);
    expect(screen.queryByRole("form", { name: "编辑 Issue" })).toBeNull();
    expect(
      screen.getByRole("region", { name: "Issue 详情" }),
    ).toBeInTheDocument();
  });

  it("从只读进入编辑后返回只读详情", async () => {
    const user = userEvent.setup();
    const issue = boardIssue({
      id: 60,
      status: "review",
      source: "remote",
      provider: "github",
      externalNumber: 60,
      linkedSessionId: 310,
      linkedSessionStatus: "closed",
    });
    const root = await openFromBoard(issue, {
      projection: hostProjection(),
      linkedChangeRequests: [],
    });
    await user.click(
      within(root).getByRole("button", { name: "更多 issue 操作" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "编辑 Issue" }),
    );
    const form = await screen.findByRole("form", { name: "编辑 Issue" });
    await user.click(within(form).getByRole("button", { name: "返回" }));
    expect(screen.queryByRole("form", { name: "编辑 Issue" })).toBeNull();
    expect(
      within(screen.getByRole("region", { name: "Issue 详情" })).getByRole(
        "heading",
        { level: 2, name: "GH #60 · 完成流程" },
      ),
    ).toBeInTheDocument();
  });

  it("远程待办编辑本地副本保存后仍只读，标题保持 GH #128", async () => {
    const user = userEvent.setup();
    const issue = boardIssue({
      id: 128,
      number: 12,
      title: "原标题",
      source: "remote",
      provider: "github",
      externalNumber: 128,
    });
    updateIssueMock.mockImplementation(async (input) =>
      issueRecordWithoutMirror(issue, {
        title: input.title,
        description: input.description,
      }),
    );
    const root = await openFromBoard(issue, {
      projection: hostProjection(),
      linkedChangeRequests: [],
    });
    await user.click(
      within(root).getByRole("button", { name: "更多 issue 操作" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "编辑 Issue" }),
    );
    const form = await screen.findByRole("form", { name: "编辑 Issue" });
    await user.click(within(form).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(updateIssueMock).toHaveBeenCalled());
    const saved =
      await updateIssueMock.mock.results[
        updateIssueMock.mock.results.length - 1
      ]?.value;
    expect(saved).not.toHaveProperty("source");
    expect(saved).not.toHaveProperty("provider");
    expect(saved).not.toHaveProperty("externalNumber");
    expect(
      screen.getByRole("heading", { level: 2, name: "GH #128 · 原标题" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "编辑 Issue" })).toBeNull();
    expect(
      screen.queryByRole("heading", { level: 2, name: "#12 · 原标题" }),
    ).toBeNull();
  });

  it("推进状态后仍保留 GH 编号，不退回项目内编号", async () => {
    const user = userEvent.setup();
    const issue = boardIssue({
      id: 70,
      number: 12,
      title: "原标题",
      status: "running",
      source: "remote",
      provider: "github",
      externalNumber: 128,
      linkedSessionId: 370,
      linkedSessionStatus: "closed",
    });
    advanceIssueStatusMock.mockResolvedValue({
      ...issueRecordWithoutMirror(issue, {
        title: issue.title,
        description: issue.description,
      }),
      status: "review",
    });
    const root = await openFromBoard(issue, {
      projection: hostProjection(),
      linkedChangeRequests: [],
    });
    await user.click(
      within(root).getByRole("button", { name: "打开状态选项" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "待验收" }));
    await waitFor(() => expect(advanceIssueStatusMock).toHaveBeenCalled());
    const advanced =
      await advanceIssueStatusMock.mock.results[
        advanceIssueStatusMock.mock.results.length - 1
      ]?.value;
    expect(advanced).not.toHaveProperty("source");
    expect(advanced).not.toHaveProperty("provider");
    expect(advanced).not.toHaveProperty("externalNumber");
    expect(
      screen.getByRole("heading", { level: 2, name: "GH #128 · 原标题" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 2, name: "#12 · 原标题" }),
    ).toBeNull();
  });

  it("完成流程后仍保留 GH 编号，不退回项目内编号", async () => {
    const user = userEvent.setup();
    const issue = boardIssue({
      id: 71,
      number: 12,
      title: "原标题",
      status: "review",
      source: "remote",
      provider: "github",
      externalNumber: 128,
      linkedSessionId: 371,
      linkedSessionStatus: "closed",
    });
    completeIssueFlowMock.mockResolvedValue({
      action: "completed",
      issue: {
        ...issueRecordWithoutMirror(issue, {
          title: issue.title,
          description: issue.description,
        }),
        status: "completed",
      },
      flow: null,
      message: "Issue completed",
      mergeBlockReason: null,
      targetBranch: null,
      workspaceBranch: null,
      workspacePath: null,
      actualPath: null,
      drifted: false,
      sessionId: 371,
    });
    const root = await openFromBoard(issue, {
      projection: hostProjection(),
      linkedChangeRequests: [],
    });
    await user.click(
      within(root).getByRole("button", { name: "打开状态选项" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "已完成" }));
    await waitFor(() => expect(completeIssueFlowMock).toHaveBeenCalled());
    const completed =
      await completeIssueFlowMock.mock.results[
        completeIssueFlowMock.mock.results.length - 1
      ]?.value;
    expect(completed.issue).not.toHaveProperty("source");
    expect(completed.issue).not.toHaveProperty("provider");
    expect(completed.issue).not.toHaveProperty("externalNumber");
    expect(
      screen.getByRole("heading", { level: 2, name: "GH #128 · 原标题" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 2, name: "#12 · 原标题" }),
    ).toBeNull();
    expect(screen.queryByRole("form", { name: "编辑 Issue" })).toBeNull();
  });

  it("向前切状态不确认，回退仍确认，完成不直接写状态", async () => {
    const user = userEvent.setup();
    const running = boardIssue({
      id: 61,
      status: "running",
      source: "local",
      linkedSessionId: 311,
      linkedSessionStatus: "closed",
    });
    advanceIssueStatusMock.mockResolvedValue(
      boardIssue({ ...running, status: "review" }),
    );
    const runningRoot = await openFromBoard(running, {
      projection: null,
      linkedChangeRequests: [],
    });
    await user.click(
      within(runningRoot).getByRole("button", { name: "打开状态选项" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "待验收" }));
    expect(screen.queryByText("确定要退回至待办阶段吗？")).toBeNull();
    await waitFor(() =>
      expect(advanceIssueStatusMock).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 61, targetStatus: "review" }),
      ),
    );
    expect(updateIssueMock).not.toHaveBeenCalled();
    cleanupRenderedBoard();

    advanceIssueStatusMock.mockClear();
    const backward = await openFromBoard(running, {
      projection: null,
      linkedChangeRequests: [],
    });
    await user.click(
      within(backward).getByRole("button", { name: "打开状态选项" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "待办" }));
    expect(
      await screen.findByText("确定要退回至待办阶段吗？"),
    ).toBeInTheDocument();
    expect(advanceIssueStatusMock).not.toHaveBeenCalled();
    cleanupRenderedBoard();

    const review = boardIssue({
      id: 62,
      status: "review",
      source: "local",
      linkedSessionId: 312,
      linkedSessionStatus: "closed",
    });
    completeIssueFlowMock.mockResolvedValue({
      action: "completed",
      issue: boardIssue({ ...review, status: "completed" }),
      flow: null,
      message: "Issue completed",
      mergeBlockReason: null,
      targetBranch: null,
      workspaceBranch: null,
      workspacePath: null,
      actualPath: null,
      drifted: false,
      sessionId: 312,
    });
    const reviewRoot = await openFromBoard(review, {
      projection: null,
      linkedChangeRequests: [],
    });
    await user.click(
      within(reviewRoot).getByRole("button", { name: "打开状态选项" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "已完成" }));
    await waitFor(() => expect(completeIssueFlowMock).toHaveBeenCalled());
    expect(updateIssueMock).not.toHaveBeenCalled();
    expect(advanceIssueStatusMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ targetStatus: "completed" }),
    );
  });

  it("没有关联会话时选已完成只推进状态", async () => {
    const user = userEvent.setup();
    const review = boardIssue({
      id: 73,
      status: "review",
      source: "local",
    });
    advanceIssueStatusMock.mockResolvedValue(
      boardIssue({ ...review, status: "completed" }),
    );
    const root = await openFromBoard(review, {
      projection: null,
      linkedChangeRequests: [],
    });
    await user.click(
      within(root).getByRole("button", { name: "打开状态选项" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "已完成" }));
    await waitFor(() =>
      expect(advanceIssueStatusMock).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 73, targetStatus: "completed" }),
      ),
    );
    expect(completeIssueFlowMock).not.toHaveBeenCalled();
  });

  it("已完成不能选待验收，不能续接时不能选进行中", async () => {
    const user = userEvent.setup();
    const reopenable = boardIssue({
      id: 63,
      status: "completed",
      source: "local",
      linkedSessionId: 313,
      linkedSessionStatus: "closed",
      linkedSessionDisplayMode: "json",
      linkedSessionProviderSessionId: "thread-63",
      linkedSessionAgentType: "codex",
    });
    const root = await openFromBoard(reopenable, {
      projection: null,
      linkedChangeRequests: [],
    });
    await user.click(
      within(root).getByRole("button", { name: "打开状态选项" }),
    );
    expect(screen.getByRole("menuitem", { name: "待验收" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "进行中" })).toBeEnabled();
    await user.keyboard("{Escape}");
    await user.click(within(root).getByRole("button", { name: "查看回看" }));
    expect(
      await screen.findByRole("dialog", { name: "Issue 总结" }),
    ).toBeInTheDocument();
    cleanupRenderedBoard();

    const blocked = boardIssue({
      id: 64,
      status: "completed",
      source: "local",
      linkedSessionId: 314,
      linkedSessionStatus: "closed",
      linkedSessionDisplayMode: "tui",
      linkedSessionProviderSessionId: "thread-64",
      linkedSessionAgentType: "deepseek",
    });
    const blockedRoot = await openFromBoard(blocked, {
      projection: null,
      linkedChangeRequests: [],
    });
    await user.click(
      within(blockedRoot).getByRole("button", { name: "打开状态选项" }),
    );
    expect(screen.getByRole("menuitem", { name: "进行中" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "待验收" })).toBeDisabled();
  });

  it("编辑页是单行标题和现有工具栏，彩色标签在编辑器下方", async () => {
    const issue = boardIssue({
      id: 12,
      number: 12,
      source: "local",
      labels: [{ ...bugLabel }],
      attachments: [
        {
          id: 9,
          issueId: 12,
          displayName: "notes.pdf",
          storedName: "notes.pdf",
          relativePath: "issue-12/notes.pdf",
          absolutePath: "/tmp/notes.pdf",
          mimeType: "application/pdf",
          fileSize: 10,
          kind: "pdf",
          isPreviewable: true,
          createdAt: 1,
        },
      ],
    });
    const root = await openFromBoard(issue, {
      projection: null,
      linkedChangeRequests: [],
    });
    expect(within(root).getByLabelText("标题").tagName).toBe("INPUT");
    for (const name of [
      "加粗",
      "引用",
      "代码块",
      "无序列表",
      "有序列表",
      "插入图片",
      "添加附件",
      "清除格式",
    ]) {
      expect(within(root).getByRole("button", { name })).toBeInTheDocument();
    }
    expect(
      within(root).getAllByRole("button", { name: "添加附件" }),
    ).toHaveLength(1);
    expect(within(root).getByRole("button", { name: "" })).toHaveAttribute(
      "data-label",
      "正文",
    );
    expect(within(root).getByText("PDF")).toBeInTheDocument();
    expect(within(root).getByText("notes.pdf")).toBeInTheDocument();
    expect(within(root).getByText("View")).toBeInTheDocument();
    expect(within(root).getByText("Down")).toBeInTheDocument();
    expect(within(root).getByText("Del")).toBeInTheDocument();
    const description = within(root).getByLabelText("描述");
    const chip = await within(root).findByText("bug");
    expect(
      description.compareDocumentPosition(chip) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(chip.closest(".issue-label-chip")).toHaveStyle({
      backgroundColor: "#E11D48",
    });
  });

  it("已完成且关联 PR 为 open 时详情显示 PR 待合并，远端不是 closed", async () => {
    const issue = boardIssue({
      id: 70,
      status: "completed",
      source: "remote",
      provider: "github",
      externalNumber: 70,
    });
    const root = await openFromBoard(issue, {
      projection: hostProjection({ remoteState: "open" }),
      linkedChangeRequests: [changeRequest({ state: "open" })],
    });
    const host = within(root).getByRole("region", { name: "GitHub" });
    expect(within(host).getByText("PR 待合并")).toBeInTheDocument();
    expect(within(host).queryByText("closed")).toBeNull();
  });

  it("写回失败时详情显示待写回，并可重试", async () => {
    const user = userEvent.setup();
    const retry = vi.mocked(retryIssueCompletionWriteback);
    retry.mockResolvedValue(undefined);
    const issue = boardIssue({
      id: 71,
      status: "completed",
      source: "remote",
      provider: "github",
      externalNumber: 71,
    });
    const root = await openFromBoard(issue, {
      projection: hostProjection({ remoteState: "open" }),
      linkedChangeRequests: [],
      writebackPending: true,
      writebackError: "writebackOffline",
    });
    const host = within(root).getByRole("region", { name: "GitHub" });
    expect(within(host).getByText("待写回")).toBeInTheDocument();
    expect(
      within(host).getByText("网络不可用，完成写回失败。"),
    ).toBeInTheDocument();
    await user.click(within(host).getByRole("button", { name: "重试写回" }));
    expect(retry).toHaveBeenCalledWith({ issueId: 71, projectId: 1 });
  });
});

function cleanupRenderedBoard(): void {
  cleanup();
  resetIssuePageStateCacheForTests();
}
