import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../shared/i18n/i18n";
import { EMPTY_FORM } from "../issue-activity-types";
import type { IssueRecord } from "../issue-commands";
import { IssueReadOnlyPage } from "./issue-read-only-page";
import { applyIssueRecovery, getIssueDetail } from "./issue-detail-commands";

vi.mock("./issue-detail-commands", () => ({
  applyIssueRecovery: vi.fn(),
  getIssueDetail: vi.fn(),
  retryIssueCompletionWriteback: vi.fn(),
}));

vi.mock("../issue-commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../issue-commands")>();
  return {
    ...actual,
    getIssueTimeline: vi.fn(async () => ({ entries: [] })),
  };
});

const issue: IssueRecord = {
  id: 128,
  number: 128,
  projectId: 1,
  title: "flow",
  description: "body",
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
};

describe("unavailable issue banner", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows keep local, unlink, and retry without a delete confirmation", async () => {
    vi.mocked(getIssueDetail).mockResolvedValue({
      projection: {
        provider: "github",
        repo: "acme/redwhisk",
        externalUrl: "https://github.com/acme/redwhisk/issues/128",
        remoteState: "unavailable",
        authorLogin: "lin",
        assignees: [],
        labels: [],
      },
      linkedChangeRequest: null,
      writebackPending: false,
      writebackError: null,
      unavailableBanner: {
        actions: ["keep_local", "unlink", "retry"],
        showsDeleteConfirmation: false,
      },
    });
    vi.mocked(applyIssueRecovery).mockResolvedValue({
      projection: null,
      linkedChangeRequest: null,
      writebackPending: false,
      writebackError: null,
      unavailableBanner: null,
    });

    render(
      <I18nProvider fixedLocale="zh">
        <IssueReadOnlyPage
          canOpenAgentsActivity={false}
          errorMessage={null}
          form={EMPTY_FORM}
          hasLinkedSession={false}
          isSaving={false}
          selectedIssue={issue}
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

    expect(
      await screen.findByRole("button", { name: "保留为本地" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "移除关联" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(screen.queryByText("确认删除 Issue")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "保留为本地" }));
    expect(applyIssueRecovery).toHaveBeenCalledWith({
      action: "keep_local",
      issueId: 128,
      projectId: 1,
    });
  });
});
