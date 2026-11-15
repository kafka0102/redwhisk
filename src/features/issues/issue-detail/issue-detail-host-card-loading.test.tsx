import { act, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../shared/i18n/i18n";
import { makeAgentSession } from "../../../test/agent-session-fixture";
import { listAgentSessions } from "../../agents/agent-session-commands";
import { EMPTY_FORM } from "../issue-activity-types";
import type { IssueRecord } from "../issue-commands";
import {
  getIssueDetail,
  refreshIssueRemoteAvailability,
  type IssueDetailRecord,
} from "./issue-detail-commands";
import { IssueReadOnlyPage } from "./issue-read-only-page";

vi.mock("./issue-detail-commands", () => ({
  applyIssueRecovery: vi.fn(),
  getIssueDetail: vi.fn(),
  refreshIssueRemoteAvailability: vi.fn(),
  retryIssueCompletionWriteback: vi.fn(),
}));

vi.mock("../issue-commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../issue-commands")>();
  return {
    ...actual,
    getIssueTimeline: vi.fn(async () => ({ entries: [] })),
  };
});

vi.mock("../../agents/agent-session-commands", () => ({
  listAgentSessions: vi.fn(),
}));

const getIssueDetailMock = vi.mocked(getIssueDetail);
const refreshMock = vi.mocked(refreshIssueRemoteAvailability);
const listAgentSessionsMock = vi.mocked(listAgentSessions);

const issue: IssueRecord = {
  id: 128,
  number: 128,
  projectId: 1,
  title: "flow",
  description: "body",
  attachments: [],
  labels: [],
  status: "completed",
  linkedSessionId: 50,
  linkedSessionStatus: "closed",
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
};

function detail(overrides: Partial<IssueDetailRecord> = {}): IssueDetailRecord {
  return {
    projection: {
      provider: "github",
      repo: "acme/redwhisk",
      externalUrl: "https://github.com/acme/redwhisk/issues/128",
      remoteState: "open",
      authorLogin: "lin",
      assignees: [],
      labels: [],
    },
    linkedChangeRequests: [],
    writebackPending: false,
    writebackError: null,
    unavailableBanner: null,
    ...overrides,
  };
}

function renderPage(selected: IssueRecord = issue): void {
  listAgentSessionsMock.mockResolvedValue({
    sessions: [
      makeAgentSession({
        issueId: selected.id,
        issueNumber: selected.number,
        projectId: selected.projectId,
        sessionId: selected.linkedSessionId ?? 50,
      }),
    ],
  });
  render(
    <I18nProvider fixedLocale="zh">
      <IssueReadOnlyPage
        canOpenAgentsActivity
        errorMessage={null}
        form={EMPTY_FORM}
        hasLinkedSession={selected.linkedSessionId != null}
        isSaving={false}
        selectedIssue={selected}
        onAdvanceStatus={vi.fn()}
        onBack={vi.fn()}
        onDeleteIssue={vi.fn()}
        onDownloadAttachment={vi.fn()}
        onEditIssue={vi.fn()}
        onOpenLinkedSession={vi.fn()}
        onPreviewAttachment={vi.fn()}
      />
    </I18nProvider>,
  );
}

describe("外部 Issue 宿主卡片", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("先和会话信息一起画出本地卡片，探测回来后再更新", async () => {
    let resolveRefresh: (value: IssueDetailRecord) => void = () => {};
    getIssueDetailMock.mockResolvedValue(detail());
    refreshMock.mockImplementation(
      () =>
        new Promise<IssueDetailRecord>((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    renderPage();

    const host = await screen.findByRole("region", { name: "GitHub" });
    expect(
      await screen.findByRole("heading", { name: "会话信息" }),
    ).toBeInTheDocument();
    expect(within(host).getByText("acme/redwhisk")).toBeInTheDocument();
    expect(within(host).getByText("open")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保留为本地" })).toBeNull();
    expect(refreshMock).toHaveBeenCalledWith({ issueId: 128, projectId: 1 });

    await act(async () => {
      resolveRefresh(
        detail({
          projection: {
            provider: "github",
            repo: "acme/redwhisk",
            externalUrl: "https://github.com/acme/redwhisk/issues/128",
            remoteState: "unavailable",
            authorLogin: "lin",
            assignees: [],
            labels: [],
          },
          unavailableBanner: {
            actions: ["keep_local", "unlink", "retry"],
            showsDeleteConfirmation: false,
          },
        }),
      );
    });

    expect(
      await screen.findByRole("button", { name: "保留为本地" }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "GitHub" })).getByText(
        "不可用",
      ),
    ).toBeInTheDocument();
  });

  it("本地详情没有宿主投影时不探测", async () => {
    getIssueDetailMock.mockResolvedValue(detail({ projection: null }));
    refreshMock.mockImplementation(() => new Promise(() => {}));

    renderPage();

    expect(
      await screen.findByRole("heading", { name: "会话信息" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(getIssueDetailMock).toHaveBeenCalled());
    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "GitHub" })).toBeNull();
  });

  it("探测失败时保留已经显示的宿主卡片", async () => {
    getIssueDetailMock.mockResolvedValue(detail());
    refreshMock.mockRejectedValue(new Error("offline"));

    renderPage();

    const host = await screen.findByRole("region", { name: "GitHub" });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(within(host).getByText("open")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "GitHub" })).toBeInTheDocument();
  });
});
