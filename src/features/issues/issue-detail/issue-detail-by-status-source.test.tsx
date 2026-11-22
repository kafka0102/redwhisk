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
import "../../../shared/styles/issue-detail.css";
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
  refreshIssueRemoteAvailability: vi.fn(() => new Promise(() => {})),
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
  del: 0,
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
  const number =
    issue.source === "remote" && issue.externalNumber != null
      ? issue.externalNumber
      : issue.number;
  return `#${number} · ${issue.title}`;
}

const listMarkdown = "- 第一项\n- 第二项";

function px(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function lineBoxHeight(element: HTMLElement): number {
  const style = window.getComputedStyle(element);
  const fontSize = px(style.fontSize);
  if (style.lineHeight.endsWith("px")) {
    return px(style.lineHeight);
  }
  const multiplier = px(style.lineHeight);
  return multiplier > 0 ? fontSize * multiplier : fontSize * 1.2;
}

function listItemGap(first: HTMLElement, second: HTMLElement): number {
  const firstBox = first.getBoundingClientRect();
  const secondBox = second.getBoundingClientRect();
  if (firstBox.height > 0 && secondBox.height > 0) {
    return secondBox.top - firstBox.bottom;
  }
  const nestedMargin = (
    item: HTMLElement,
    edge: "marginTop" | "marginBottom",
  ): number => {
    const child = item.querySelector("p");
    return child == null ? 0 : px(window.getComputedStyle(child)[edge]);
  };
  return (
    px(window.getComputedStyle(first).marginBottom) +
    px(window.getComputedStyle(second).marginTop) +
    nestedMargin(first, "marginBottom") +
    nestedMargin(second, "marginTop")
  );
}

function opensBacklogEditor(issue: IssueBoardRecord): boolean {
  return (
    issue.status === "backlog" &&
    (issue.source === "local" || issue.source === "remote")
  );
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
  if (opensBacklogEditor(issue)) {
    return screen.findByRole("form", { name: "编辑 Issue" });
  }
  return screen.findByRole("region", { name: "Issue 详情" });
}

describe("Issue 详情按状态与来源", () => {
  beforeAll(async () => {
    // jsdom 没有 Tailwind preflight。补上列表重置，确认只读详情的标记能盖过它。
    const listReset = document.createElement("style");
    listReset.textContent =
      "ul, ol { list-style-type: none; margin: 0; } p { margin: 0; } .issue-page__main--readonly .issue-detail__description { font-size: 14px; }";
    document.head.appendChild(listReset);
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
      issueDisplayMode: "board",
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
      name: "待办远程直接编辑且没有右侧栏",
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
      actions: ["运行", "保存", "删除"],
      absent: ["打开状态选项", "更多 issue 操作", "完成", "查看回看"],
      cards: [] as Array<"host" | "pr" | "session">,
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
      prState: "Open",
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
      actions: ["打开状态选项", "更多 issue 操作"],
      absent: ["运行", "保存", "完成", "删除", "查看回看"],
      statusText: "已完成",
      cards: ["host", "pr", "session"] as Array<"host" | "pr" | "session">,
      prState: "已合并",
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
      actions: ["打开状态选项", "更多 issue 操作"],
      absent: ["运行", "保存", "完成", "打开 GitHub", "查看回看"],
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

      if (opensBacklogEditor(issue)) {
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
          within(pullRequest).getByRole("button", { name: "在应用内查看" }),
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

  it("远程待办点击直接进入编辑表单且没有只读详情", async () => {
    const user = userEvent.setup();
    const issue = boardIssue({
      id: 43,
      number: 43,
      status: "backlog",
      source: "remote",
      provider: "github",
      externalNumber: 128,
    });
    renderBoard(issue, {
      projection: hostProjection(),
      linkedChangeRequests: [],
    });

    await user.click(await screen.findByRole("button", { name: issue.title }));

    const form = await screen.findByRole("form", { name: "编辑 Issue" });
    expect(screen.queryByRole("region", { name: "Issue 详情" })).toBeNull();
    for (const name of ["运行", "保存", "删除"]) {
      expect(within(form).getByRole("button", { name })).toBeInTheDocument();
    }
    for (const name of [
      "打开状态选项",
      "更多 issue 操作",
      "完成",
      "查看回看",
    ]) {
      expect(within(form).queryByRole("button", { name })).toBeNull();
    }
  });

  it("仅本地、仅远程和混合来源下，待办本地与远程都直接进入编辑", async () => {
    for (const issueSourceMode of ["local", "remote", "mixed"] as const) {
      const settings = await getProjectIssueSourceSettingsMock(1);
      getProjectIssueSourceSettingsMock.mockResolvedValue({
        ...settings,
        issueSourceMode,
      });
      for (const source of ["local", "remote"] as const) {
        const issue = boardIssue({
          id: 91,
          title: `${issueSourceMode}-${source}`,
          source,
          provider: source === "remote" ? "github" : null,
          externalNumber: source === "remote" ? 91 : null,
        });
        const form = await openFromBoard(issue, {
          projection: source === "remote" ? hostProjection() : null,
          linkedChangeRequests: [],
        });
        expect(screen.queryByRole("region", { name: "Issue 详情" })).toBeNull();
        expect(
          within(form).getByRole("button", { name: "保存" }),
        ).toBeInTheDocument();
        expect(
          within(form).queryByRole("region", { name: "GitHub" }),
        ).toBeNull();
        cleanupRenderedBoard();
      }
    }
  });

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
      status: "running",
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
      within(root).getByRole("heading", { level: 2, name: "#7 · 完成流程" }),
    ).not.toHaveTextContent(/\bGL\b/);
    const host = within(root).getByRole("region", { name: "GitLab" });
    await userEvent.click(
      within(host).getByRole("button", { name: "打开 GitLab" }),
    );
    expect(openUrlMock).toHaveBeenCalledWith(
      "https://gitlab.com/acme/redwhisk/-/issues/7",
    );
    expect(within(root).queryByRole("heading", { name: "待办" })).toBeNull();
  });

  it("GitHub 详情标题显示远端编号，不出现 GH", async () => {
    const issue = boardIssue({
      id: 78,
      number: 3,
      title: "残句处理",
      status: "running",
      source: "remote",
      provider: "github",
      externalNumber: 78,
    });
    const root = await openFromBoard(issue, {
      projection: hostProjection(),
      linkedChangeRequests: [],
    });
    const heading = within(root).getByRole("heading", {
      level: 2,
      name: "#78 · 残句处理",
    });
    expect(heading).not.toHaveTextContent(/\bGH\b/);
    expect(
      within(root).queryByRole("heading", { level: 2, name: "#3 · 残句处理" }),
    ).toBeNull();
  });

  it("本地详情标题仍是项目内编号", async () => {
    const issue = boardIssue({
      id: 12,
      number: 12,
      title: "本地标题",
      status: "running",
      source: "local",
    });
    const root = await openFromBoard(issue, {
      projection: null,
      linkedChangeRequests: [],
    });
    const heading = within(root).getByRole("heading", {
      level: 2,
      name: "#12 · 本地标题",
    });
    expect(heading).not.toHaveTextContent(/\bGH\b|\bGL\b/);
  });

  it("只读详情把 Markdown 列表显示为两项带标记且缩进的列表", async () => {
    const issue = boardIssue({
      id: 81,
      number: 81,
      title: "列表间距",
      status: "running",
      source: "local",
      description: listMarkdown,
    });
    const root = await openFromBoard(issue, {
      projection: null,
      linkedChangeRequests: [],
    });
    const article = within(root).getByRole("article");
    const items = within(article).getAllByRole("listitem");
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "第一项",
      "第二项",
    ]);
    const list = items[0]?.closest("ul");
    expect(list).not.toBeNull();
    const listStyle = window.getComputedStyle(list as HTMLElement);
    expect(listStyle.listStyleType).toBe("disc");
    expect(px(listStyle.paddingLeft)).toBeGreaterThan(0);
    const description = (list as HTMLElement).parentElement;
    expect(description).not.toBeNull();
    const descriptionStyle = window.getComputedStyle(
      description as HTMLElement,
    );
    expect(descriptionStyle.whiteSpace).not.toBe("pre-wrap");
    expect(listItemGap(items[0], items[1])).toBeLessThan(
      lineBoxHeight(description as HTMLElement),
    );
  });

  it("编辑态仍把同一段 Markdown 显示为带缩进的列表", async () => {
    const issue = boardIssue({
      id: 82,
      number: 82,
      title: "编辑列表",
      status: "backlog",
      source: "local",
      description: listMarkdown,
    });
    const form = await openFromBoard(issue, {
      projection: null,
      linkedChangeRequests: [],
    });
    const editor = form.querySelector(".ql-editor");
    expect(editor).toBeInstanceOf(HTMLElement);
    const items = within(editor as HTMLElement).getAllByRole("listitem");
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "第一项",
      "第二项",
    ]);
    expect(px(window.getComputedStyle(items[0]).paddingLeft)).toBeGreaterThan(
      0,
    );
  });

  it("只读标签在正文上方，零个标签没有标签行", async () => {
    const empty = boardIssue({
      id: 51,
      status: "running",
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
      status: "running",
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

  it("只读详情先显示 Issue 自己的彩色标签，再追加对不上目录的宿主标签", async () => {
    listProjectLabelsMock.mockImplementation(async (input) => {
      if (input.scope === "global") {
        return { labels: [] };
      }
      return {
        labels: [{ ...bugLabel, id: 8, color: "#111111" }],
      };
    });
    const issue = boardIssue({
      id: 82,
      status: "running",
      source: "remote",
      provider: "github",
      externalNumber: 82,
      description: "正文还在",
      labels: [
        {
          id: 1,
          name: "bug",
          scope: "project",
          projectId: 1,
          color: "#E11D48",
          workflowSkill: null,
        },
        {
          id: 2,
          name: "feature",
          scope: "project",
          projectId: 1,
          color: "#2563EB",
          workflowSkill: null,
        },
      ],
    });
    const root = await openFromBoard(issue, {
      projection: hostProjection({
        labels: ["bug", "sync", "sync", "  "],
      }),
      linkedChangeRequests: [],
    });
    const labelGroup = await within(root).findByRole("group", { name: "标签" });
    await waitFor(() => {
      const chips = [
        ...labelGroup.querySelectorAll(".issue-detail__readonly-label"),
      ];
      expect(chips.map((chip) => chip.textContent)).toEqual([
        "bug",
        "feature",
        "sync",
      ]);
      expect(chips[0]).toHaveStyle({ backgroundColor: "#E11D48" });
      expect(chips[1]).toHaveStyle({ backgroundColor: "#2563EB" });
      expect(chips[2]?.getAttribute("style") ?? "").not.toMatch(/background/i);
    });
    const body = within(root).getByText("正文还在");
    expect(
      labelGroup.compareDocumentPosition(body) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("目录加载失败时保留 Issue 彩色标签，对不上的宿主标签没有行内背景", async () => {
    listProjectLabelsMock.mockRejectedValue(new Error("labels down"));
    const issue = boardIssue({
      id: 83,
      status: "running",
      source: "remote",
      provider: "github",
      externalNumber: 83,
      labels: [{ ...bugLabel, color: "#E11D48" }],
    });
    const root = await openFromBoard(issue, {
      projection: hostProjection({ labels: ["sync"] }),
      linkedChangeRequests: [],
    });
    const labelGroup = await within(root).findByRole("group", { name: "标签" });
    await waitFor(() => {
      const chips = [
        ...labelGroup.querySelectorAll(".issue-detail__readonly-label"),
      ];
      expect(chips.map((chip) => chip.textContent)).toEqual(["bug", "sync"]);
      expect(chips[0]).toHaveStyle({ backgroundColor: "#E11D48" });
      expect(chips[1]?.getAttribute("style") ?? "").not.toMatch(/background/i);
    });
  });

  it("目录加载成功后，对得上的宿主标签改用目录颜色", async () => {
    let resolveProjectLabels: (value: {
      labels: Array<typeof bugLabel>;
    }) => void = () => undefined;
    listProjectLabelsMock.mockImplementation((input) => {
      if (input.scope === "global") {
        return Promise.resolve({ labels: [] });
      }
      return new Promise((resolve) => {
        resolveProjectLabels = resolve;
      });
    });
    const issue = boardIssue({
      id: 84,
      status: "running",
      source: "remote",
      provider: "github",
      externalNumber: 84,
      labels: [{ ...bugLabel, color: "#E11D48" }],
    });
    const root = await openFromBoard(issue, {
      projection: hostProjection({ labels: ["feature", "sync"] }),
      linkedChangeRequests: [],
    });
    const labelGroup = await within(root).findByRole("group", { name: "标签" });
    await waitFor(() => {
      const chips = [
        ...labelGroup.querySelectorAll(".issue-detail__readonly-label"),
      ];
      expect(chips.map((chip) => chip.textContent)).toEqual([
        "bug",
        "feature",
        "sync",
      ]);
      expect(chips[1]?.getAttribute("style") ?? "").not.toMatch(/background/i);
      expect(chips[2]?.getAttribute("style") ?? "").not.toMatch(/background/i);
    });
    resolveProjectLabels({
      labels: [{ ...bugLabel, id: 9, name: "feature", color: "#2563EB" }],
    });
    await waitFor(() => {
      const chips = [
        ...labelGroup.querySelectorAll(".issue-detail__readonly-label"),
      ];
      expect(chips[0]).toHaveStyle({ backgroundColor: "#E11D48" });
      expect(chips[1]).toHaveStyle({ backgroundColor: "#2563EB" });
      expect(chips[2]?.getAttribute("style") ?? "").not.toMatch(/background/i);
    });
  });

  it("项目标签颜色覆盖同名全局标签", async () => {
    listProjectLabelsMock.mockImplementation(async (input) => {
      if (input.scope === "global") {
        return {
          labels: [
            {
              ...bugLabel,
              id: 3,
              scope: "global" as const,
              projectId: null,
              color: "#00FF00",
            },
          ],
        };
      }
      return {
        labels: [{ ...bugLabel, color: "#E11D48" }],
      };
    });
    const issue = boardIssue({
      id: 85,
      status: "running",
      source: "remote",
      provider: "github",
      externalNumber: 85,
      labels: [],
    });
    const root = await openFromBoard(issue, {
      projection: hostProjection({ labels: ["bug", "sync"] }),
      linkedChangeRequests: [],
    });
    const labelGroup = await within(root).findByRole("group", { name: "标签" });
    await waitFor(() => {
      const chips = [
        ...labelGroup.querySelectorAll(".issue-detail__readonly-label"),
      ];
      expect(chips.map((chip) => chip.textContent)).toEqual(["bug", "sync"]);
      expect(chips[0]).toHaveStyle({ backgroundColor: "#E11D48" });
      expect(chips[0]).not.toHaveStyle({ backgroundColor: "#00FF00" });
      expect(chips[1]?.getAttribute("style") ?? "").not.toMatch(/background/i);
    });
  });

  it("宿主标签按忽略大小写对上目录，空颜色不设置行内背景", async () => {
    listProjectLabelsMock.mockImplementation(async (input) => {
      if (input.scope === "global") {
        return { labels: [] };
      }
      return {
        labels: [
          { ...bugLabel, name: "bug", color: "#E11D48" },
          { ...bugLabel, id: 10, name: "blank", color: "   " },
        ],
      };
    });
    const matched = boardIssue({
      id: 86,
      status: "running",
      source: "remote",
      provider: "github",
      externalNumber: 86,
      labels: [],
    });
    const matchedRoot = await openFromBoard(matched, {
      projection: hostProjection({ labels: ["Bug"] }),
      linkedChangeRequests: [],
    });
    await waitFor(() => {
      const chip = within(matchedRoot).getByText("Bug");
      expect(chip).toHaveStyle({ backgroundColor: "#E11D48" });
    });
    cleanupRenderedBoard();

    const blank = boardIssue({
      id: 87,
      status: "review",
      source: "remote",
      provider: "github",
      externalNumber: 87,
      labels: [{ ...bugLabel, color: "   " }],
    });
    const blankRoot = await openFromBoard(blank, {
      projection: hostProjection({ labels: ["blank"] }),
      linkedChangeRequests: [],
    });
    await waitFor(() => {
      const chips = [
        ...within(blankRoot)
          .getByRole("group", { name: "标签" })
          .querySelectorAll(".issue-detail__readonly-label"),
      ];
      expect(chips.map((chip) => chip.textContent)).toEqual(["bug", "blank"]);
      expect(chips[0]?.getAttribute("style") ?? "").not.toMatch(/background/i);
      expect(chips[1]?.getAttribute("style") ?? "").not.toMatch(/background/i);
    });
  });

  it("宿主没有标签时仍显示 Issue 自己的彩色标签", async () => {
    const issue = boardIssue({
      id: 88,
      status: "running",
      source: "remote",
      provider: "github",
      externalNumber: 88,
      labels: [{ ...bugLabel, color: "#E11D48" }],
    });
    const root = await openFromBoard(issue, {
      projection: hostProjection({ labels: [] }),
      linkedChangeRequests: [],
    });
    const chip = await within(root).findByText("bug");
    expect(chip).toHaveStyle({ backgroundColor: "#E11D48" });
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
    expect(within(first).getByText("Open")).toBeInTheDocument();
    expect(within(first).getByText("3/4 通过")).toBeInTheDocument();
    expect(within(second).getByText("已合并")).toBeInTheDocument();
    expect(within(second).getByText("4/4 通过")).toBeInTheDocument();
    expect(
      within(first).getByRole("button", { name: "在应用内查看" }),
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
            open: 0,
            closed: 0,
          },
          pullRequestRefs: [],
          lastSyncedAt: null,
          syncError: null,
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
      within(root).getByRole("button", { name: "在应用内查看" }),
    );
    expect(
      await screen.findByRole("heading", { name: /#9/ }),
    ).toBeInTheDocument();
  });

  it("投影为 null 时没有宿主卡和 PR 卡", async () => {
    const issue = boardIssue({
      id: 54,
      status: "running",
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
      status: "running",
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
        name: "#55 · 完成流程",
      }),
    ).not.toHaveTextContent(/\bGH\b/);
    expect(within(root).getByText("正文还在")).toBeInTheDocument();
    expect(within(root).queryByRole("region", { name: "GitHub" })).toBeNull();
  });

  it("时间轴查询失败时标题和正文仍在", async () => {
    getIssueTimelineMock.mockRejectedValue(new Error("timeline failed"));
    const issue = boardIssue({
      id: 59,
      status: "running",
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
        name: "#59 · 完成流程",
      }),
    ).toBeInTheDocument();
    expect(within(root).getByText("正文还在")).toBeInTheDocument();
    expect(within(root).queryByRole("region", { name: "动态" })).toBeNull();
  });

  it("远端状态为空或未知时显示不可用，指派为空显示占位", async () => {
    for (const remoteState of ["", "bogus"]) {
      const issue = boardIssue({
        id: 56,
        status: "running",
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
      status: "running",
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
    const editForm = backlogRoot;
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
        { level: 2, name: "#60 · 完成流程" },
      ),
    ).toBeInTheDocument();
  });

  it.each([{ provider: "github" as const }, { provider: "gitlab" as const }])(
    "远程待办保存本地副本后回到看板，再打开仍是 #128 · 新标题（$provider）",
    async ({ provider }) => {
      const user = userEvent.setup();
      const issue = boardIssue({
        id: 128,
        number: 12,
        title: "原标题",
        source: "remote",
        provider,
        externalNumber: 128,
      });
      updateIssueMock.mockImplementation(async (input) =>
        issueRecordWithoutMirror(issue, {
          title: input.title,
          description: input.description,
        }),
      );
      const form = await openFromBoard(issue, {
        projection: hostProjection({ provider }),
        linkedChangeRequests: [],
      });
      fireEvent.change(within(form).getByLabelText("标题"), {
        target: { value: "新标题" },
      });
      invokeMock.mockClear();
      await user.click(within(form).getByRole("button", { name: "保存" }));
      await waitFor(() =>
        expect(updateIssueMock).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: 1,
            issueId: 128,
            title: "新标题",
          }),
        ),
      );
      expectNoHostMutation(/update|write|edit|close|delete/);
      const saved =
        await updateIssueMock.mock.results[
          updateIssueMock.mock.results.length - 1
        ]?.value;
      expect(saved).not.toHaveProperty("source");
      expect(saved).not.toHaveProperty("provider");
      expect(saved).not.toHaveProperty("externalNumber");
      expect(screen.queryByRole("form", { name: "编辑 Issue" })).toBeNull();
      expect(screen.queryByRole("region", { name: "Issue 详情" })).toBeNull();

      await user.click(await screen.findByRole("button", { name: "新标题" }));
      const reopened = await screen.findByRole("form", { name: "编辑 Issue" });
      expect(
        within(reopened).getByRole("heading", {
          level: 2,
          name: "#128 · 新标题",
        }),
      ).not.toHaveTextContent(/\bGH\b|\bGL\b/);
      expect(
        screen.queryByRole("heading", { level: 2, name: "#12 · 原标题" }),
      ).toBeNull();
      expect(
        screen.queryByRole("heading", { level: 2, name: "#12 · 新标题" }),
      ).toBeNull();
      cleanupRenderedBoard();
    },
  );

  it("推进状态后仍保留远端编号，不退回项目内编号", async () => {
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
      screen.getByRole("heading", { level: 2, name: "#128 · 原标题" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 2, name: "#12 · 原标题" }),
    ).toBeNull();
  });

  it("完成流程后仍保留远端编号，不退回项目内编号", async () => {
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
      screen.getByRole("heading", { level: 2, name: "#128 · 原标题" }),
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
    expect(within(root).queryByRole("button", { name: "查看回看" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Issue 总结" })).toBeNull();
    expect(
      within(root).getByRole("button", { name: "查看会话" }),
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

  it("远程 Issue 已经 closed 时不显示 PR 待合并", async () => {
    const issue = boardIssue({
      id: 72,
      status: "completed",
      source: "remote",
      provider: "github",
      externalNumber: 72,
    });
    const root = await openFromBoard(issue, {
      projection: hostProjection({ remoteState: "closed" }),
      linkedChangeRequests: [changeRequest({ state: "open" })],
    });
    const host = within(root).getByRole("region", { name: "GitHub" });
    expect(within(host).queryByText("PR 待合并")).toBeNull();
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
