import { convertFileSrc } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssuesActivity } from "./issues-activity";
import { resetIssuePageStateCacheForTests } from "./issues-activity-cache";
import {
  getProjectGitBranches,
  advanceIssueStatus,
  completeIssueManual,
  createIssue,
  deleteIssue,
  detectAgentCommitCompletion,
  exportIssueAttachment,
  getIssueSummary,
  listIssues,
  markIssueReview,
  prepareAgentCommitCompletion,
  previewIssueAttachment,
  sendAgentCommitPrompt,
  startAgentSession,
  updateIssue,
  type IssueAttachmentRecord,
  type IssueRecord,
} from "./issue-commands";
import {
  injectAgentSessionPrompt,
  listAgentSessions,
} from "../agents/agent-session-commands";
import {
  listAgentProfiles,
  listProjectLabels,
} from "../settings/settings-commands";
import { I18nProvider } from "../../shared/i18n/i18n";
import { toast } from "../../shared/toast";
import { selectShadcnOption } from "../../test/select-helpers";

vi.mock("./issue-commands", () => ({
  advanceIssueStatus: vi.fn(),
  completeIssueManual: vi.fn(),
  createIssue: vi.fn(),
  deleteIssue: vi.fn(),
  detectAgentCommitCompletion: vi.fn(),
  exportIssueAttachment: vi.fn(),
  getIssueSummary: vi.fn(),
  getProjectGitBranches: vi.fn(),
  listIssues: vi.fn(),
  markIssueReview: vi.fn(),
  prepareAgentCommitCompletion: vi.fn(),
  previewIssueAttachment: vi.fn(),
  sendAgentCommitPrompt: vi.fn(),
  startAgentSession: vi.fn(),
  updateIssue: vi.fn(),
}));

vi.mock("../agents/agent-session-commands", () => ({
  injectAgentSessionPrompt: vi.fn(),
  listAgentSessions: vi.fn(),
}));

vi.mock("../settings/settings-commands", () => ({
  listAgentProfiles: vi.fn(),
  listProjectLabels: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

vi.mock("../../shared/toast", () => ({
  toast: {
    success: vi.fn(),
  },
}));

vi.mock("./issue-description-editor", () => ({
  IssueDescriptionEditor: ({
    attachments = [],
    ariaLabel,
    footer,
    onChange,
    onDownloadAttachment,
    onPreviewAttachment,
    onRemoveAttachment,
    placeholder,
    value,
  }: {
    attachments?: Array<
      | IssueAttachmentRecord
      | {
          token: string;
          displayName: string;
          sourcePath: string;
          kind: "image" | "pdf" | "word" | "text" | "generic";
          isPreviewable: boolean;
        }
    >;
    ariaLabel: string;
    footer?: ReactNode;
    onChange: (value: string) => void;
    onDownloadAttachment?: (attachment: unknown) => void;
    onPreviewAttachment?: (attachment: unknown) => void;
    onRemoveAttachment?: (attachment: unknown) => void;
    placeholder: string;
    value: string;
  }) => (
    <div>
      <textarea
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {footer}
      {attachments.map((attachment) => (
        <div key={"id" in attachment ? attachment.id : attachment.token}>
          <span>{attachment.displayName}</span>
          {attachment.isPreviewable ? (
            <button
              aria-label={`查看 ${attachment.displayName}`}
              type="button"
              onClick={() => onPreviewAttachment?.(attachment)}
            >
              查看
            </button>
          ) : null}
          <button
            aria-label={`下载 ${attachment.displayName}`}
            type="button"
            onClick={() => onDownloadAttachment?.(attachment)}
          >
            下载
          </button>
          <button
            aria-label={`删除 ${attachment.displayName}`}
            type="button"
            onClick={() => onRemoveAttachment?.(attachment)}
          >
            删除
          </button>
        </div>
      ))}
    </div>
  ),
}));

const advanceIssueStatusMock = vi.mocked(advanceIssueStatus);
const completeIssueManualMock = vi.mocked(completeIssueManual);
const createIssueMock = vi.mocked(createIssue);
const deleteIssueMock = vi.mocked(deleteIssue);
const detectAgentCommitCompletionMock = vi.mocked(detectAgentCommitCompletion);
const exportIssueAttachmentMock = vi.mocked(exportIssueAttachment);
const getIssueSummaryMock = vi.mocked(getIssueSummary);
const getProjectGitBranchesMock = vi.mocked(getProjectGitBranches);
const injectAgentSessionPromptMock = vi.mocked(injectAgentSessionPrompt);
const listAgentSessionsMock = vi.mocked(listAgentSessions);
const listIssuesMock = vi.mocked(listIssues);
const markIssueReviewMock = vi.mocked(markIssueReview);
const prepareAgentCommitCompletionMock = vi.mocked(
  prepareAgentCommitCompletion,
);
const previewIssueAttachmentMock = vi.mocked(previewIssueAttachment);
const sendAgentCommitPromptMock = vi.mocked(sendAgentCommitPrompt);
const startAgentSessionMock = vi.mocked(startAgentSession);
const updateIssueMock = vi.mocked(updateIssue);
const listAgentProfilesMock = vi.mocked(listAgentProfiles);
const listProjectLabelsMock = vi.mocked(listProjectLabels);
const openDialogMock = vi.mocked(open);
const saveDialogMock = vi.mocked(save);
const convertFileSrcMock = vi.mocked(convertFileSrc);
const toastSuccessMock = vi.mocked(toast.success);

const existingIssue: IssueRecord = {
  id: 20,
  projectId: 1,
  title: "Existing issue",
  description: "Existing description",
  status: "backlog",
  createdAt: 1_780_632_000_000,
  updatedAt: 1_780_632_000_000,
};

const runningIssue: IssueRecord = {
  id: 21,
  projectId: 1,
  title: "Running issue",
  description: "Running description",
  status: "running",
  createdAt: 1_780_632_000_000,
  updatedAt: 1_780_633_000_000,
};

const reviewIssue: IssueRecord = {
  id: 22,
  projectId: 1,
  title: "Review issue",
  description: "Review description",
  status: "review",
  createdAt: 1_780_632_000_000,
  updatedAt: 1_780_634_000_000,
};

const completedIssue: IssueRecord = {
  id: 23,
  projectId: 1,
  title: "Completed issue",
  description: "Completed description",
  status: "completed",
  createdAt: 1_780_632_000_000,
  updatedAt: 1_780_635_000_000,
};

const linkedSessionIssue: IssueRecord = {
  id: 24,
  projectId: 1,
  title: "Linked session issue",
  description: "Resume from the existing session",
  status: "backlog",
  linkedSessionId: 301,
  linkedSessionStatus: "stopped",
  linkedSessionAttention: "none",
  createdAt: 1_780_632_000_000,
  updatedAt: 1_780_636_000_000,
};

const completedLinkedSessionIssue: IssueRecord = {
  id: 25,
  projectId: 1,
  title: "Completed linked session issue",
  description: "Already completed",
  status: "completed",
  linkedSessionId: 401,
  linkedSessionStatus: "closed",
  linkedSessionAttention: "none",
  createdAt: 1_780_632_000_000,
  updatedAt: 1_780_637_000_000,
};

const crashedRunningIssue: IssueRecord = {
  id: 26,
  projectId: 1,
  title: "Crashed running issue",
  description: "Need log path later",
  status: "running",
  linkedSessionId: 402,
  linkedSessionStatus: "crashed",
  linkedSessionAttention: "none",
  createdAt: 1_780_632_000_000,
  updatedAt: 1_780_638_000_000,
};

const attentionIssue: IssueRecord = {
  id: 27,
  projectId: 1,
  title: "Attention issue",
  description: "Need a quick review in Codex",
  status: "running",
  linkedSessionId: 403,
  linkedSessionStatus: "running",
  linkedSessionAttention: "requested",
  createdAt: 1_780_632_000_000,
  updatedAt: 1_780_639_000_000,
};

const projectProfile = {
  id: 100,
  name: "Project Codex",
  agentType: "codex" as const,
  command: "/usr/local/bin/codex",
  scope: "project" as const,
  projectId: 1,
  mode: "full-auto",
  dangerous: true,
  defaultSkill: "bmad-dev-story",
  promptTemplate: "Review {{issue.description}} in {{project.name}}.",
  del: 0,
};

const globalProfile = {
  id: 200,
  name: "Global Codex",
  agentType: "codex" as const,
  command: "/usr/local/bin/codex",
  scope: "global" as const,
  projectId: null,
  mode: "full-auto",
  dangerous: false,
  defaultSkill: "",
  promptTemplate: "",
  del: 0,
};

const projectLabel = {
  id: 301,
  name: "bug",
  scope: "project" as const,
  projectId: 1,
  color: "#E11D48",
  agentProfileId: null,
  agentName: null,
  workflowSkill: null,
};

const globalLabel = {
  id: 302,
  name: "release",
  scope: "global" as const,
  projectId: null,
  color: "#3B82F6",
  agentProfileId: null,
  agentName: null,
  workflowSkill: null,
};

const existingIssueRunPrompt = [
  "using skill bmad-dev-story for task:",
  "Existing description",
].join("\n\n");

const existingIssueRunPromptWithoutSkill = "Existing description";

describe("IssuesActivity", () => {
  beforeEach(() => {
    advanceIssueStatusMock.mockReset();
    completeIssueManualMock.mockReset();
    createIssueMock.mockReset();
    deleteIssueMock.mockReset();
    detectAgentCommitCompletionMock.mockReset();
    exportIssueAttachmentMock.mockReset();
    getIssueSummaryMock.mockReset();
    getProjectGitBranchesMock.mockReset();
    injectAgentSessionPromptMock.mockReset();
    listAgentSessionsMock.mockReset();
    listIssuesMock.mockReset();
    markIssueReviewMock.mockReset();
    prepareAgentCommitCompletionMock.mockReset();
    previewIssueAttachmentMock.mockReset();
    sendAgentCommitPromptMock.mockReset();
    startAgentSessionMock.mockReset();
    updateIssueMock.mockReset();
    listAgentProfilesMock.mockReset();
    listProjectLabelsMock.mockReset();
    openDialogMock.mockReset();
    saveDialogMock.mockReset();
    convertFileSrcMock.mockReset();
    toastSuccessMock.mockReset();
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    convertFileSrcMock.mockImplementation((path) => `asset://${path}`);
    resetIssuePageStateCacheForTests();
    listAgentProfilesMock.mockResolvedValue({ profiles: [] });
    listProjectLabelsMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return { labels: [] };
      }
      return { labels: [] };
    });
    listAgentSessionsMock.mockResolvedValue({ sessions: [] });
    injectAgentSessionPromptMock.mockResolvedValue({
      sessionId: 1,
      codexSessionId: "thread-1",
    });
    getProjectGitBranchesMock.mockResolvedValue({
      currentBranch: "main",
      localBranches: ["main", "develop", "release"],
    });
    prepareAgentCommitCompletionMock.mockRejectedValue({
      code: "ISSUE_VALIDATION_FAILED",
      message: "当前仓库无未提交改动，请直接使用 Complete。",
      details: [
        {
          "@type": "GitStatus",
          isClean: true,
          targetBranch: "dev",
        },
      ],
    });
  });

  it("renders four persistent lanes and groups issues by status", async () => {
    listIssuesMock.mockResolvedValue({
      issues: [existingIssue, runningIssue, reviewIssue, completedIssue],
    });

    renderIssuesActivity();

    const backlogLane = await screen.findByRole("region", {
      name: "Backlog",
    });
    const runningLane = screen.getByRole("region", { name: "In Progress" });
    const reviewLane = screen.getByRole("region", { name: "Review" });
    const completedLane = screen.getByRole("region", { name: "Done" });

    expect(
      within(backlogLane).getByRole("button", { name: "Existing issue" }),
    ).toBeInTheDocument();
    expect(
      within(runningLane).getByRole("button", { name: "Running issue" }),
    ).toBeInTheDocument();
    expect(
      within(reviewLane).getByRole("button", { name: "Review issue" }),
    ).toBeInTheDocument();
    expect(
      within(completedLane).getByRole("button", { name: "Completed issue" }),
    ).toBeInTheDocument();
    expect(
      within(backlogLane).queryByRole("button", { name: "Running issue" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the Issues title in English when Chinese is selected", async () => {
    window.localStorage.setItem("redwhisk.locale", "zh");
    listIssuesMock.mockResolvedValue({ issues: [] });

    renderIssuesActivity();

    expect(
      await screen.findByRole("heading", { name: "Issues" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "议题" }),
    ).not.toBeInTheDocument();
  });

  it("keeps empty lanes visible when only backlog issues exist", async () => {
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });

    renderIssuesActivity();

    const runningLane = await screen.findByRole("region", {
      name: "In Progress",
    });
    const reviewLane = screen.getByRole("region", { name: "Review" });
    const completedLane = screen.getByRole("region", { name: "Done" });

    expect(runningLane).toHaveTextContent("0");
    expect(runningLane).toHaveTextContent("no issues");
    expect(reviewLane).toHaveTextContent("no issues");
    expect(completedLane).toHaveTextContent("no issues");
  });

  it("shows issue id, updated time, full title, and a single-line description excerpt", async () => {
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });

    renderIssuesActivity();

    const card = await screen.findByRole("button", {
      name: "Existing issue",
    });

    expect(card).toHaveTextContent("Existing issue");
    expect(card).toHaveTextContent("#20");
    expect(card).toHaveTextContent(
      formatTestTimestamp(existingIssue.updatedAt),
    );
    expect(card).toHaveTextContent("Existing description");
    expect(card).not.toHaveTextContent(/priority|label|assignee|milestone/i);
  });

  it("shows issue label chips on cards across lanes when labels are present", async () => {
    listIssuesMock.mockResolvedValue({
      issues: [
        {
          ...existingIssue,
          labels: [projectLabel, globalLabel],
        },
        {
          ...reviewIssue,
          labels: [globalLabel],
        },
      ],
    });

    renderIssuesActivity();

    const backlogCard = await screen.findByRole("button", {
      name: "Existing issue",
    });
    const reviewCard = screen.getByRole("button", { name: "Review issue" });

    expect(backlogCard).toHaveAccessibleDescription(
      expect.stringContaining("Labels: bug, release"),
    );
    expect(reviewCard).toHaveAccessibleDescription(
      expect.stringContaining("Labels: release"),
    );
    expect(screen.getByText("bug")).toBeInTheDocument();
    expect(screen.getAllByText("release")).toHaveLength(2);
  });

  it("shows a needs-attention marker on issue cards when linked session attention is requested", async () => {
    listIssuesMock.mockResolvedValue({
      issues: [attentionIssue, linkedSessionIssue],
    });

    renderIssuesActivity();

    const attentionCard = await screen.findByRole("button", {
      name: "Attention issue",
    });
    const normalCard = screen.getByRole("button", {
      name: "Linked session issue",
    });

    expect(attentionCard).toHaveTextContent("Codex 需要确认");
    expect(normalCard).not.toHaveTextContent("Codex 需要确认");
  });

  it("opens a backlog issue edit page without status or updated-at fields", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );

    const page = screen.getByRole("form", {
      name: "Edit Issue",
    });
    expect(
      screen.queryByRole("dialog", { name: "Edit Issue" }),
    ).not.toBeInTheDocument();
    expect(within(page).getByLabelText("Title")).toHaveValue("Existing issue");
    expect(within(page).getByLabelText("Description")).toHaveValue(
      "Existing description",
    );
    expect(
      within(page).getByPlaceholderText("Issue title"),
    ).toBeInTheDocument();
    expect(within(page).getByLabelText("Description")).toBeInTheDocument();
    expect(
      within(page).queryByLabelText(/status|updated/i, {
        selector: "input, textarea, select",
      }),
    ).not.toBeInTheDocument();
    expect(within(page).queryByText("Backlog")).not.toBeInTheDocument();
    expect(
      within(page).queryByText(formatTestTimestamp(existingIssue.updatedAt)),
    ).not.toBeInTheDocument();
    expect(
      within(page).queryByRole("button", { name: /Run/i }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["in-progress", runningIssue],
    ["review", reviewIssue],
    ["done", completedIssue],
  ])("opens %s issues as read-only details page", async (_label, issue) => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [issue] });

    renderIssuesActivity();

    await user.click(await screen.findByRole("button", { name: issue.title }));

    const page = screen.getByRole("region", { name: "Issue Detail" });
    expect(
      screen.queryByRole("dialog", { name: "Issue Detail" }),
    ).not.toBeInTheDocument();
    expect(
      within(page).getByRole("button", { name: "返回" }).querySelector("svg"),
    ).toBeNull();
    expect(within(page).getByText(issue.title)).toBeInTheDocument();
    expect(within(page).getByText(issue.description)).toBeInTheDocument();
    expect(page.querySelector(".issue-detail__divider")).toBeInTheDocument();
    expect(within(page).queryByLabelText("Title")).not.toBeInTheDocument();
    expect(
      within(page).queryByLabelText("Description"),
    ).not.toBeInTheDocument();
    expect(
      within(page).queryByRole("button", { name: "Attach file" }),
    ).not.toBeInTheDocument();
    expect(
      within(page).queryByRole("button", { name: "保存" }),
    ).not.toBeInTheDocument();
  });

  it("closes the edit page with 返回 and restores the issue board", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });

    renderIssuesActivity();

    const card = await screen.findByRole("button", { name: "Existing issue" });
    await user.click(card);

    expect(screen.getByLabelText("Title")).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "返回" }));

    expect(
      screen.queryByRole("form", { name: "Edit Issue" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Backlog" })).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Existing issue" }),
      ).toHaveFocus(),
    );
  });

  it("lets the issue page use normal page focus order", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );

    const page = screen.getByRole("form", { name: "Edit Issue" });
    expect(within(page).getByLabelText("Title")).toHaveFocus();

    await user.tab({ shift: true });
    expect(within(page).getByRole("button", { name: "删除" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(within(page).getByRole("button", { name: "保存" })).toHaveFocus();
  });

  it("keeps the empty kanban and page input when issue creation fails", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [] });
    createIssueMock.mockRejectedValue({
      code: "ISSUE_VALIDATION_FAILED",
      message: "Issue title 不能为空。",
    });

    renderIssuesActivity();

    await user.click(
      (await screen.findAllByRole("button", { name: "New Issue" }))[0],
    );
    await user.type(screen.getByLabelText("Title"), "draft local issue");
    await user.click(screen.getByRole("button", { name: "创建 Issue" }));

    const page = screen.getByRole("form", { name: "New Issue" });
    expect(
      await within(page).findByRole("status", { name: "Dialog status" }),
    ).toHaveTextContent("Issue title 不能为空。");
    expect(
      screen.queryByRole("button", { name: "draft local issue" }),
    ).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("draft local issue")).toBeInTheDocument();
  });

  it("keeps the create page open while a create request is pending", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [] });
    createIssueMock.mockImplementation(
      () => new Promise<IssueRecord>(() => undefined),
    );

    renderIssuesActivity();

    await user.click(
      (await screen.findAllByRole("button", { name: "New Issue" }))[0],
    );
    await user.type(screen.getByLabelText("Title"), "Pending issue");
    await user.click(screen.getByRole("button", { name: "创建 Issue" }));
    await user.keyboard("{Escape}");

    expect(screen.getByRole("form", { name: "New Issue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建 Issue" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "返回" })).toBeDisabled();
  });

  it("keeps lowercase input and closes the create page after save", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [] });
    createIssueMock.mockResolvedValue({
      id: 24,
      projectId: 1,
      title: "draft local issue",
      description: "small task shape",
      status: "backlog",
      createdAt: 1_780_632_000_000,
      updatedAt: 1_780_632_000_000,
    });

    renderIssuesActivity();

    await user.click(
      (await screen.findAllByRole("button", { name: "New Issue" }))[0],
    );
    const titleInput = screen.getByLabelText("Title");
    const descriptionInput = screen.getByLabelText("Description");
    await user.type(titleInput, "draft local issue");
    await user.type(descriptionInput, "small task shape");

    expect(titleInput).toHaveValue("draft local issue");
    expect(descriptionInput).toHaveValue("small task shape");

    await user.click(screen.getByRole("button", { name: "创建 Issue" }));

    await waitFor(() =>
      expect(createIssueMock).toHaveBeenCalledWith({
        projectId: 1,
        title: "draft local issue",
        description: "small task shape",
        attachments: [],
        labelIds: [],
      }),
    );
    expect(
      screen.queryByRole("form", { name: "New Issue" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "draft local issue" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("inserts a draft attachment from the footer file picker and submits its draft metadata", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [] });
    openDialogMock.mockResolvedValue("/tmp/tsconfig.json");
    createIssueMock.mockResolvedValue({
      id: 24,
      projectId: 1,
      title: "draft local issue",
      description: "Read the config.",
      status: "backlog",
      createdAt: 1_780_632_000_000,
      updatedAt: 1_780_632_000_000,
    });

    renderIssuesActivity();

    await user.click(
      (await screen.findAllByRole("button", { name: "New Issue" }))[0],
    );
    await user.type(screen.getByLabelText("Title"), "draft local issue");
    await user.type(screen.getByLabelText("Description"), "Read the config.");
    await user.click(screen.getByRole("button", { name: "Attach file" }));

    expect(openDialogMock).toHaveBeenCalled();
    expect(screen.getByText("tsconfig.json")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "创建 Issue" }));

    expect(createIssueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 1,
        title: "draft local issue",
        attachments: [
          expect.objectContaining({
            displayName: "tsconfig.json",
            sourcePath: "/tmp/tsconfig.json",
          }),
        ],
        labelIds: [],
      }),
    );
    expect(createIssueMock.mock.calls[0]?.[0].description).toBe(
      "Read the config.",
    );
  });

  it("closes the edit page after save", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });
    updateIssueMock.mockResolvedValue({
      ...existingIssue,
      title: "Updated issue",
      description: "Updated description",
      updatedAt: 1_780_635_600_000,
    });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Updated issue");
    await user.clear(screen.getByLabelText("Description"));
    await user.type(
      screen.getByLabelText("Description"),
      "Updated description",
    );
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(updateIssueMock).toHaveBeenCalledWith({
        projectId: 1,
        issueId: 20,
        title: "Updated issue",
        description: "Updated description",
        attachments: [],
        labelIds: [],
      }),
    );
    expect(
      screen.queryByRole("form", { name: "Edit Issue" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Updated issue" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the stored issue card when update fails", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });
    updateIssueMock.mockRejectedValue({
      code: "ISSUE_NOT_FOUND",
      message: "Issue 不存在。",
    });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Failed update");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(updateIssueMock).toHaveBeenCalledWith({
      projectId: 1,
      issueId: 20,
      title: "Failed update",
      description: "Existing description",
      attachments: [],
      labelIds: [],
    });
    const page = screen.getByRole("form", { name: "Edit Issue" });
    expect(
      await within(page).findByRole("status", { name: "Dialog status" }),
    ).toHaveTextContent("Issue 不存在。");
    expect(
      screen.queryByRole("region", { name: "Backlog" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Failed update" }),
    ).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Failed update")).toBeInTheDocument();
  });

  it("clears stale issue state when a new project list fails", async () => {
    listIssuesMock.mockResolvedValueOnce({ issues: [existingIssue] });
    const { rerender } = renderIssuesActivity();

    expect(
      await screen.findByRole("button", { name: "Existing issue" }),
    ).toBeInTheDocument();

    listIssuesMock.mockRejectedValueOnce({
      code: "PROJECT_NOT_FOUND",
      message: "Project 不存在。",
    });
    rerender(
      <IssuesActivity
        projectCompletionPolicy="agent_auto_commit"
        projectId={2}
      />,
    );

    expect(
      await screen.findByRole("status", { name: "Issues status" }),
    ).toHaveTextContent("Project 不存在。");
    expect(
      screen.queryByRole("button", { name: "Existing issue" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ignores a late create result after switching projects", async () => {
    const user = userEvent.setup();
    let resolveCreate: (issue: IssueRecord) => void = () => {};
    listIssuesMock
      .mockResolvedValueOnce({ issues: [] })
      .mockResolvedValueOnce({ issues: [] });
    createIssueMock.mockImplementation(
      () =>
        new Promise<IssueRecord>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const { rerender } = renderIssuesActivity();

    await user.click(
      (await screen.findAllByRole("button", { name: "New Issue" }))[0],
    );
    await user.type(screen.getByLabelText("Title"), "Late issue");
    await user.click(screen.getByRole("button", { name: "创建 Issue" }));
    rerender(
      <IssuesActivity
        projectCompletionPolicy="agent_auto_commit"
        projectId={2}
      />,
    );
    resolveCreate({
      id: 24,
      projectId: 1,
      title: "Late issue",
      description: "",
      status: "backlog",
      createdAt: 1_780_632_000_000,
      updatedAt: 1_780_632_000_000,
    });

    await waitFor(() => expect(listIssuesMock).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole("button", { name: "Late issue" }),
    ).not.toBeInTheDocument();
  });

  it("submits selected project and global label ids from the backlog dialog", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [] });
    listProjectLabelsMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return { labels: [projectLabel] };
      }
      return { labels: [globalLabel] };
    });
    createIssueMock.mockResolvedValue({
      id: 24,
      projectId: 1,
      title: "Label issue",
      description: "Needs a label",
      status: "backlog",
      labels: [projectLabel, globalLabel],
      createdAt: 1_780_632_000_000,
      updatedAt: 1_780_632_000_000,
    });

    renderIssuesActivity();

    await user.click(
      (await screen.findAllByRole("button", { name: "New Issue" }))[0],
    );
    await user.type(screen.getByLabelText("Title"), "Label issue");
    await user.type(screen.getByLabelText("Description"), "Needs a label");
    await user.click(screen.getByRole("button", { name: "添加标签" }));
    await user.click(screen.getByRole("option", { name: "bug" }));
    await user.click(screen.getByRole("option", { name: "release" }));
    await user.click(screen.getByRole("button", { name: "添加标签" }));
    expect(screen.getByText("bug")).toBeInTheDocument();
    expect(screen.getByText("release")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "创建 Issue" }));

    await waitFor(() =>
      expect(createIssueMock).toHaveBeenCalledWith({
        projectId: 1,
        title: "Label issue",
        description: "Needs a label",
        attachments: [],
        labelIds: [301, 302],
      }),
    );
  });

  it("opens project settings labels when the picker is empty", async () => {
    const user = userEvent.setup();
    const onOpenProjectSettingsLabels = vi.fn();
    listIssuesMock.mockResolvedValue({ issues: [] });

    renderIssuesActivity({ onOpenProjectSettingsLabels });

    await user.click(
      (await screen.findAllByRole("button", { name: "New Issue" }))[0],
    );
    await user.click(screen.getByRole("button", { name: "添加标签" }));
    const addLabelButtons = screen.getAllByRole("button", {
      name: "添加标签",
    });
    await user.click(addLabelButtons[addLabelButtons.length - 1]);

    expect(onOpenProjectSettingsLabels).toHaveBeenCalledTimes(1);
  });

  it("restores an in-progress create page after the activity is unmounted and mounted again", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });

    const { unmount } = renderIssuesActivity();

    await user.click(await screen.findByRole("button", { name: "New Issue" }));
    await user.type(screen.getByLabelText("Title"), "kept draft");
    await user.type(screen.getByLabelText("Description"), "kept body");

    unmount();
    renderIssuesActivity();

    const page = await screen.findByRole("form", { name: "New Issue" });
    expect(within(page).getByLabelText("Title")).toHaveValue("kept draft");
    expect(within(page).getByLabelText("Description")).toHaveValue("kept body");
  });

  it("restores the selected issue when create is canceled", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });

    renderIssuesActivity();

    expect(
      await screen.findByRole("button", { name: "Existing issue" }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "New Issue" }));
    await user.click(screen.getByRole("button", { name: "返回" }));

    expect(
      screen.getByRole("button", { name: "Existing issue" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.queryByRole("form", { name: "New Issue" }),
    ).not.toBeInTheDocument();
  });

  it("closes an untouched create page with 返回", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });

    renderIssuesActivity();

    await user.click(screen.getByRole("button", { name: "New Issue" }));
    const page = screen.getByRole("form", { name: "New Issue" });

    await user.click(within(page).getByRole("button", { name: "返回" }));

    expect(
      screen.queryByRole("form", { name: "New Issue" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a dirty create page until 返回 is used", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });

    renderIssuesActivity();

    await user.click(screen.getByRole("button", { name: "New Issue" }));
    await user.type(screen.getByLabelText("Title"), "dirty draft");
    expect(screen.getByRole("form", { name: "New Issue" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "返回" }));

    expect(
      screen.queryByRole("form", { name: "New Issue" }),
    ).not.toBeInTheDocument();
  });

  it("treats reverted edit values as clean and allows 返回 to close", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );
    const title = screen.getByLabelText("Title");

    await user.clear(title);
    await user.type(title, "Changed once");
    await user.clear(title);
    await user.type(title, existingIssue.title);

    await user.click(screen.getByRole("button", { name: "返回" }));

    expect(
      screen.queryByRole("form", { name: "Edit Issue" }),
    ).not.toBeInTheDocument();
  });

  it("uses the requested issue as the initial selection when provided", async () => {
    listIssuesMock.mockResolvedValue({
      issues: [existingIssue, runningIssue, reviewIssue],
    });

    renderIssuesActivity({ requestedIssueId: reviewIssue.id });

    expect(
      await screen.findByRole("button", { name: "Review issue" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("uses the backlog lane header plus action to create issues", async () => {
    listIssuesMock.mockResolvedValue({ issues: [] });

    renderIssuesActivity();

    const header = screen.getByRole("heading", {
      name: "Issues",
    }).parentElement;
    const backlogLane = await screen.findByRole("region", { name: "Backlog" });
    const createButton = within(backlogLane).getByRole("button", {
      name: "New Issue",
    });

    expect(header).not.toHaveTextContent("New Issue");
    expect(
      within(backlogLane).queryByRole("button", {
        name: "New Issue for backlog",
      }),
    ).not.toBeInTheDocument();
    expect(createButton).toBeInTheDocument();
  });

  it("opens a compact run dialog with read-only prompt when profiles are available", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return { profiles: [projectProfile] };
      }

      return { profiles: [globalProfile] };
    });

    renderIssuesActivity();

    const { dialog } = await openExistingIssueRunDialog(user);
    expect(within(dialog).getByLabelText("Agent profile")).toHaveFocus();
    expect(
      within(dialog).getByRole("heading", { name: "Run Issue #20" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Agent profile")).toHaveTextContent(
      "Project Codex (Project)",
    );
    expect(within(dialog).getByLabelText("Workflow skill")).toHaveTextContent(
      "bmad-dev-story",
    );
    expect(within(dialog).getByLabelText("Commit strategy")).toHaveTextContent(
      "Agent auto commit",
    );
    expect(within(dialog).getByLabelText("Development mode")).toHaveTextContent(
      "Worktree",
    );
    expect(within(dialog).getByLabelText("Target branch")).toHaveTextContent(
      "main",
    );
    expect(
      within(dialog).getByRole("combobox", { name: "Target branch" }),
    ).toBeEnabled();
    expect(
      within(dialog).queryByLabelText("Working directory"),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByLabelText("Default args"),
    ).not.toBeInTheDocument();
    const promptField = within(dialog).getByLabelText(
      "Final prompt",
    ) as HTMLTextAreaElement;
    expect(promptField.value).toBe(existingIssueRunPrompt);
    expect(promptField).toHaveAttribute("readonly");
    expect(promptField).toHaveClass(
      "field-sizing-fixed",
      "h-56",
      "resize-none",
      "overflow-y-auto",
    );
    expect(
      within(dialog).queryByText("Prompt sources"),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByLabelText("Run summary"),
    ).not.toBeInTheDocument();
  });

  it("focuses the issue summary dialog container instead of the close button", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [completedIssue] });
    getIssueSummaryMock.mockResolvedValue({
      issue: completedIssue,
      sessionStartedAt: 1_780_634_000_000,
      sessionClosedAt: 1_780_635_000_000,
      completion: {
        option: "complete_manual",
        result: "completed",
        commitHash: "abc1234",
        failureReason: null,
        headBefore: null,
        headAfter: null,
        changedFilesJson: null,
        createdAt: 1_780_635_000_000,
        source: "issue_action",
      },
      diagnostics: [],
    });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Completed issue" }),
    );
    await user.click(screen.getByRole("button", { name: "View Summary" }));

    const dialog = await screen.findByRole("dialog", { name: "Issue Summary" });
    expect(dialog).toHaveFocus();
  });

  it("submits the generated prompt snapshot when starting", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return { profiles: [projectProfile] };
      }

      return { profiles: [globalProfile] };
    });
    startAgentSessionMock.mockRejectedValue({
      code: "AGENT_SESSION_START_NOT_READY",
      message: "Agent Session 启动将在 Story 2.3 接入。",
    });

    renderIssuesActivity();

    const { dialog } = await openExistingIssueRunDialog(user);
    const promptField = within(dialog).getByLabelText(
      "Final prompt",
    ) as HTMLTextAreaElement;

    expect(promptField).toHaveAttribute("readonly");
    await user.click(within(dialog).getByRole("button", { name: "Start" }));

    expect(startAgentSessionMock).toHaveBeenCalledWith({
      projectId: 1,
      issueId: 20,
      agentProfileId: 100,
      promptSnapshot: existingIssueRunPrompt,
      completionPolicyOverride: "agent_auto_commit",
      workspaceMode: "worktree",
      targetBranch: "main",
      worktreeSetupCommand: "pnpm install",
    });
    expect(
      within(dialog).getByText("Agent Session 启动将在 Story 2.3 接入。"),
    ).toBeInTheDocument();
  });

  it("enables target branch selection in worktree mode and submits remembered selections", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return { profiles: [projectProfile] };
      }

      return { profiles: [globalProfile] };
    });
    startAgentSessionMock.mockResolvedValue({
      sessionId: 301,
      issueId: existingIssue.id,
    });

    renderIssuesActivity();

    let { dialog } = await openExistingIssueRunDialog(user);
    await selectShadcnOption(
      user,
      within(dialog),
      "Development mode",
      "Worktree",
    );
    await selectShadcnOption(user, within(dialog), "Target branch", "develop");
    await selectShadcnOption(user, within(dialog), "Commit strategy", "Manual");
    expect(
      within(dialog).getByRole("combobox", { name: "Target branch" }),
    ).toBeEnabled();

    await user.click(
      within(dialog).getByRole("button", { name: "Close run dialog" }),
    );

    ({ dialog } = await openExistingIssueRunDialog(user));
    expect(within(dialog).getByLabelText("Development mode")).toHaveTextContent(
      "Worktree",
    );
    expect(within(dialog).getByLabelText("Target branch")).toHaveTextContent(
      "develop",
    );

    await user.click(within(dialog).getByRole("button", { name: "Start" }));

    expect(startAgentSessionMock).toHaveBeenCalledWith({
      projectId: 1,
      issueId: 20,
      agentProfileId: 100,
      promptSnapshot: existingIssueRunPrompt,
      completionPolicyOverride: "agent_auto_commit",
      workspaceMode: "worktree",
      targetBranch: "develop",
      worktreeSetupCommand: "pnpm install",
    });
  }, 10_000);

  it("defaults master and main branches to worktree mode", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return { profiles: [projectProfile] };
      }

      return { profiles: [globalProfile] };
    });
    getProjectGitBranchesMock.mockResolvedValue({
      currentBranch: "master",
      localBranches: ["master", "develop"],
    });
    startAgentSessionMock.mockResolvedValue({
      sessionId: 301,
      issueId: existingIssue.id,
    });

    renderIssuesActivity();

    const { dialog } = await openExistingIssueRunDialog(user);
    expect(within(dialog).getByLabelText("Development mode")).toHaveTextContent(
      "Worktree",
    );
    expect(within(dialog).getByLabelText("Target branch")).toHaveTextContent(
      "master",
    );

    await user.click(within(dialog).getByRole("button", { name: "Start" }));

    expect(startAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceMode: "worktree",
        targetBranch: "master",
        worktreeSetupCommand: "pnpm install",
      }),
    );
  });

  it("defaults non-main branches to the most recent issue session workspace mode", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return { profiles: [projectProfile] };
      }

      return { profiles: [globalProfile] };
    });
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          issueId: existingIssue.id,
          issueTitle: existingIssue.title,
          issueStatus: "completed",
          agentProfileId: projectProfile.id,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          title: null,
          agentType: "codex",
          status: "closed",
          attention: "none",
          isTurnRunning: false,
          workspaceMode: "worktree",
          logPath: "/tmp/redwhisk/session.log",
          latestOutput: null,
          lastActiveAt: 1_780_632_000_000,
          startedAt: 1_780_632_000_000,
          closedAt: 1_780_633_000_000,
        },
      ],
    });
    getProjectGitBranchesMock.mockResolvedValue({
      currentBranch: "feature/redesign",
      localBranches: ["feature/redesign", "develop"],
    });
    startAgentSessionMock.mockResolvedValue({
      sessionId: 302,
      issueId: existingIssue.id,
    });

    renderIssuesActivity();

    const { dialog } = await openExistingIssueRunDialog(user);
    expect(within(dialog).getByLabelText("Development mode")).toHaveTextContent(
      "Worktree",
    );
    expect(within(dialog).getByLabelText("Target branch")).toHaveTextContent(
      "feature/redesign",
    );

    await user.click(within(dialog).getByRole("button", { name: "Start" }));

    expect(startAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceMode: "worktree",
        targetBranch: "feature/redesign",
      }),
    );
  });

  it("keeps non-main branches on current branch without a previous issue session", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "redwhisk.issue-run.recent-workspace-selection",
      JSON.stringify({
        "1": { workspaceMode: "worktree", targetBranch: "develop" },
      }),
    );
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return { profiles: [projectProfile] };
      }

      return { profiles: [globalProfile] };
    });
    getProjectGitBranchesMock.mockResolvedValue({
      currentBranch: "feature/redesign",
      localBranches: ["feature/redesign", "develop"],
    });
    startAgentSessionMock.mockResolvedValue({
      sessionId: 302,
      issueId: existingIssue.id,
    });

    renderIssuesActivity();

    const { dialog } = await openExistingIssueRunDialog(user);
    expect(within(dialog).getByLabelText("Development mode")).toHaveTextContent(
      "Current branch",
    );

    await user.click(within(dialog).getByRole("button", { name: "Start" }));

    expect(startAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceMode: "current_branch",
        targetBranch: "feature/redesign",
      }),
    );
  });

  it("hides the worktree setup command field while still using project settings", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return { profiles: [projectProfile] };
      }

      return { profiles: [globalProfile] };
    });
    startAgentSessionMock.mockResolvedValue({
      sessionId: 301,
      issueId: existingIssue.id,
    });

    renderIssuesActivity({
      worktreeSetupCommand: "pnpm install",
    });

    const { dialog } = await openExistingIssueRunDialog(user);
    expect(
      within(dialog).queryByLabelText("Worktree setup after creation"),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByPlaceholderText("pnpm install"),
    ).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Start" }));

    expect(startAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreeSetupCommand: "pnpm install",
      }),
    );
  });

  it("re-enables the start action after a start failure", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return { profiles: [projectProfile] };
      }

      return { profiles: [globalProfile] };
    });
    startAgentSessionMock
      .mockRejectedValueOnce({
        code: "AGENT_SESSION_START_FAILED",
        message: "Agent 启动失败。",
      })
      .mockResolvedValueOnce({
        sessionId: 301,
        issueId: existingIssue.id,
      });

    renderIssuesActivity();

    const { dialog } = await openExistingIssueRunDialog(user);
    const startButton = within(dialog).getByRole("button", { name: "Start" });

    await user.click(startButton);

    expect(within(dialog).getByText("Agent 启动失败。")).toBeInTheDocument();
    await waitFor(() => expect(startButton).toBeEnabled());

    await user.click(startButton);

    expect(startAgentSessionMock).toHaveBeenCalledTimes(2);
  });

  it("closes the run dialog and refreshes issues when start succeeds", async () => {
    const user = userEvent.setup();
    const onOpenAgentsActivity = vi.fn();
    listIssuesMock
      .mockResolvedValueOnce({ issues: [existingIssue] })
      .mockResolvedValueOnce({
        issues: [
          {
            ...existingIssue,
            status: "running" as const,
            linkedSessionId: 301,
            linkedSessionStatus: "running" as const,
          },
        ],
      });
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return { profiles: [projectProfile] };
      }

      return { profiles: [globalProfile] };
    });
    startAgentSessionMock.mockResolvedValue({
      sessionId: 301,
      issueId: existingIssue.id,
    });

    renderIssuesActivity({ onOpenAgentsActivity });

    const { dialog } = await openExistingIssueRunDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Start" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Run Issue #20" }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(listIssuesMock).toHaveBeenCalledTimes(2));
    expect(onOpenAgentsActivity).toHaveBeenCalledWith(301);
  });

  it("falls back to the refreshed linked session when start succeeds without a session id", async () => {
    const user = userEvent.setup();
    const onOpenAgentsActivity = vi.fn();
    listIssuesMock
      .mockResolvedValueOnce({ issues: [existingIssue] })
      .mockResolvedValueOnce({
        issues: [
          {
            ...existingIssue,
            status: "running" as const,
            linkedSessionId: 301,
            linkedSessionStatus: "running" as const,
          },
        ],
      });
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return { profiles: [projectProfile] };
      }

      return { profiles: [globalProfile] };
    });
    startAgentSessionMock.mockResolvedValue({
      sessionId: null,
      issueId: existingIssue.id,
    });

    renderIssuesActivity({ onOpenAgentsActivity });

    const { dialog } = await openExistingIssueRunDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Start" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Run Issue #20" }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(listIssuesMock).toHaveBeenCalledTimes(2));
    expect(onOpenAgentsActivity).toHaveBeenCalledWith(301);
  });

  it("uses the latest available project profile before global fallback", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return {
          profiles: [
            projectProfile,
            { ...projectProfile, id: 101, name: "Project Claude" },
          ],
        };
      }

      return {
        profiles: [
          globalProfile,
          { ...globalProfile, id: 201, name: "Global Claude" },
        ],
      };
    });

    renderIssuesActivity();

    const { dialog } = await openExistingIssueRunDialog(user);
    expect(within(dialog).getByLabelText("Agent profile")).toHaveTextContent(
      "Project Claude (Project)",
    );
  });

  it("prefers the most recent issue run profile when it is still available", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          issueId: 19,
          issueTitle: "Previous issue",
          issueStatus: "running",
          agentProfileId: 200,
          title: null,
          agentType: "codex",
          status: "closed",
          attention: "none",
          logPath: "/tmp/run.log",
          latestOutput: null,
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: 1_780_639_000_000,
        },
      ],
    });
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return { profiles: [projectProfile] };
      }

      return { profiles: [globalProfile] };
    });

    renderIssuesActivity();

    const { dialog } = await openExistingIssueRunDialog(user);
    expect(within(dialog).getByLabelText("Agent profile")).toHaveTextContent(
      "Global Codex (Global)",
    );
  });

  it("hides the workflow skill field when the selected agent profile has no configured skill", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return { profiles: [] };
      }

      return { profiles: [globalProfile] };
    });

    renderIssuesActivity();

    const { dialog } = await openExistingIssueRunDialog(user);
    expect(
      within(dialog).queryByLabelText("Workflow skill"),
    ).not.toBeInTheDocument();
  });

  it("allows selecting none for workflow skill and updates the final prompt", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return { profiles: [projectProfile] };
      }

      return { profiles: [globalProfile] };
    });

    renderIssuesActivity();

    const { dialog } = await openExistingIssueRunDialog(user);
    await selectShadcnOption(user, within(dialog), "Workflow skill", "None");

    expect(within(dialog).getByLabelText("Final prompt")).toHaveValue(
      existingIssueRunPromptWithoutSkill,
    );
  });

  it("restores the most recently used workflow skill for the selected agent profile", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return {
          profiles: [
            {
              ...projectProfile,
              defaultSkill: JSON.stringify(["bmad-dev-story", "review-skill"]),
            },
          ],
        };
      }

      return { profiles: [globalProfile] };
    });

    renderIssuesActivity();

    let { dialog } = await openExistingIssueRunDialog(user);
    await selectShadcnOption(
      user,
      within(dialog),
      "Workflow skill",
      "review-skill",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Close run dialog" }),
    );

    ({ dialog } = await openExistingIssueRunDialog(user));
    expect(within(dialog).getByLabelText("Workflow skill")).toHaveTextContent(
      "review-skill",
    );
  });

  it("falls back to the first configured workflow skill when there is no recent selection", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return {
          profiles: [
            {
              ...projectProfile,
              defaultSkill: JSON.stringify(["skill-a", "skill-b"]),
            },
          ],
        };
      }

      return { profiles: [globalProfile] };
    });

    renderIssuesActivity();

    const { dialog } = await openExistingIssueRunDialog(user);
    expect(within(dialog).getByLabelText("Workflow skill")).toHaveTextContent(
      "skill-a",
    );
  });

  it("restores focus to the Run button after canceling the run dialog", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return { profiles: [] };
      }

      return { profiles: [globalProfile] };
    });

    renderIssuesActivity();

    const { dialog: runDialog, runButton } =
      await openExistingIssueRunDialog(user);
    expect(
      within(runDialog).queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();
    await user.click(
      within(runDialog).getByRole("button", { name: "Close run dialog" }),
    );

    expect(
      screen.queryByRole("dialog", { name: "Run Issue #20" }),
    ).not.toBeInTheDocument();
    expect(runButton).toHaveFocus();
    expect(startAgentSessionMock).not.toHaveBeenCalled();
  });

  it("keeps the run dialog open and shows the failure message when start fails", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return { profiles: [projectProfile] };
      }

      return { profiles: [] };
    });
    startAgentSessionMock.mockRejectedValue({
      code: "AGENT_SESSION_START_NOT_READY",
      message: "Agent Session 启动将在 Story 2.3 接入。",
    });

    renderIssuesActivity();

    const { dialog } = await openExistingIssueRunDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Start" }));

    expect(
      screen.getByRole("dialog", { name: "Run Issue #20" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Agent Session 启动将在 Story 2.3 接入。"),
    ).toBeInTheDocument();
    expect(updateIssueMock).not.toHaveBeenCalled();
  });

  it("refreshes issues and closes the run dialog when start reports an existing session", async () => {
    const user = userEvent.setup();
    const onOpenAgentsActivity = vi.fn();
    listIssuesMock
      .mockResolvedValueOnce({ issues: [existingIssue] })
      .mockResolvedValueOnce({
        issues: [
          {
            ...existingIssue,
            status: "running" as const,
            linkedSessionId: 301,
            linkedSessionStatus: "running" as const,
          },
        ],
      });
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return { profiles: [projectProfile] };
      }

      return { profiles: [globalProfile] };
    });
    startAgentSessionMock.mockRejectedValue({
      code: "AGENT_SESSION_ALREADY_EXISTS",
      message: "当前 Issue 已存在关联 Agent Session。",
      details: [{ "@type": "AgentSession", sessionId: 301 }],
    });

    renderIssuesActivity({ onOpenAgentsActivity });

    await openExistingIssueRunDialog(user);
    await user.click(
      within(screen.getByRole("dialog", { name: "Run Issue #20" })).getByRole(
        "button",
        { name: "Start" },
      ),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Run Issue #20" }),
      ).not.toBeInTheDocument(),
    );
    expect(onOpenAgentsActivity).toHaveBeenCalledWith(301);
  });

  it("shows a factual prompt when no agent profiles are available", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );

    const dialog = screen.getByRole("form", { name: "Edit Issue" });
    expect(
      within(dialog).queryByRole("button", { name: /Run/i }),
    ).not.toBeInTheDocument();
  });

  it("previews and downloads a draft attachment from the issue page", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [] });
    openDialogMock.mockResolvedValue("/tmp/tsconfig.json");
    previewIssueAttachmentMock.mockResolvedValue({
      displayName: "tsconfig.json",
      kind: "text",
      textContent: '{ "compilerOptions": {} }',
      absolutePath: null,
    });
    saveDialogMock.mockResolvedValue("/tmp/exported-tsconfig.json");
    exportIssueAttachmentMock.mockResolvedValue();

    renderIssuesActivity();

    await user.click(
      (await screen.findAllByRole("button", { name: "New Issue" }))[0],
    );
    await user.click(screen.getByRole("button", { name: "Attach file" }));

    await user.click(
      screen.getByRole("button", { name: "查看 tsconfig.json" }),
    );
    expect(previewIssueAttachmentMock).toHaveBeenCalledWith({
      projectId: 1,
      sourcePath: "/tmp/tsconfig.json",
      displayName: "tsconfig.json",
    });
    expect(
      await screen.findByRole("dialog", { name: "Attachment Preview" }),
    ).toBeInTheDocument();
    expect(screen.getByText('{ "compilerOptions": {} }')).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "下载 tsconfig.json" }),
    );
    expect(saveDialogMock).toHaveBeenCalled();
    expect(exportIssueAttachmentMock).toHaveBeenCalledWith({
      projectId: 1,
      sourcePath: "/tmp/tsconfig.json",
      displayName: "tsconfig.json",
      targetPath: "/tmp/exported-tsconfig.json",
    });
  });

  it("keeps a stopped backlog linked session in the backlog edit form", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({
      issues: [
        {
          ...linkedSessionIssue,
          linkedSessionLogPath: "/tmp/stopped.log",
        } as IssueRecord,
      ],
    });
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return { profiles: [projectProfile] };
      }

      return { profiles: [globalProfile] };
    });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Linked session issue" }),
    );

    const dialog = screen.getByRole("form", { name: "Edit Issue" });
    expect(
      within(dialog).queryByRole("button", { name: "Open Session" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: /Run/i }),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByText("#301")).not.toBeInTheDocument();
  });

  it("opens the linked session from the issue detail link even when the session is closed", async () => {
    const user = userEvent.setup();
    const onOpenAgentsActivity = vi.fn();
    listIssuesMock.mockResolvedValue({ issues: [completedLinkedSessionIssue] });

    renderIssuesActivity({ onOpenAgentsActivity });

    await user.click(
      await screen.findByRole("button", {
        name: "Completed linked session issue",
      }),
    );

    const dialog = screen.getByRole("region", { name: "Issue Detail" });
    await user.click(
      within(dialog).getByRole("button", { name: "Open linked session #401" }),
    );

    expect(onOpenAgentsActivity).toHaveBeenCalledWith(401);
    expect(
      screen.queryByRole("region", { name: "Issue Detail" }),
    ).not.toBeInTheDocument();
  });

  it("shows a forward-only status menu and completes a running issue after confirmation", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({
      issues: [
        {
          ...attentionIssue,
          linkedSessionLatestOutput: "agent produced output",
        } as IssueRecord,
      ],
    });
    markIssueReviewMock.mockResolvedValueOnce({
      ...attentionIssue,
      status: "review",
      linkedSessionLatestOutput: "agent produced output",
      updatedAt: attentionIssue.updatedAt + 1_000,
    });
    completeIssueManualMock.mockResolvedValueOnce({
      ...attentionIssue,
      status: "completed",
      linkedSessionStatus: "closed",
      linkedSessionLatestOutput: "agent produced output",
      updatedAt: attentionIssue.updatedAt + 2_000,
    });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", {
        name: "Attention issue",
      }),
    );

    const dialog = screen.getByRole("region", { name: "Issue Detail" });
    await user.click(
      within(dialog).getByRole("button", { name: "Open status options" }),
    );

    expect(screen.getByRole("menuitem", { name: "Backlog" })).toBeDisabled();
    expect(
      screen.getByRole("menuitem", { name: "In progress" }),
    ).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "In review" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Done" })).toBeEnabled();

    await user.click(screen.getByRole("menuitem", { name: "Done" }));

    expect(
      screen.getByRole("dialog", { name: "session 未结束，确认要完成吗？" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() =>
      expect(markIssueReviewMock).toHaveBeenCalledWith({
        projectId: 1,
        issueId: attentionIssue.id,
      }),
    );
    await user.click(await screen.findByRole("button", { name: "确认" }));
    await waitFor(() =>
      expect(completeIssueManualMock).toHaveBeenCalledWith({
        projectId: 1,
        issueId: attentionIssue.id,
      }),
    );
    expect(
      screen.getByRole("button", { name: "View Summary" }),
    ).toBeInTheDocument();
  });

  it("sends an agent commit prompt before completing a dirty auto-commit review issue", async () => {
    const user = userEvent.setup();
    const reviewWithSession = {
      ...reviewIssue,
      linkedSessionId: 503,
      linkedSessionStatus: "running" as const,
      linkedSessionAttention: "none" as const,
    };
    listIssuesMock.mockResolvedValue({ issues: [reviewWithSession] });
    prepareAgentCommitCompletionMock.mockResolvedValueOnce({
      issueId: reviewWithSession.id,
      sessionId: 503,
      option: "complete_agent_commit",
      head: "abc123",
      changedFilesCount: 1,
      changedFiles: [{ status: "M", path: "tracked.txt" }],
      completionPrompt:
        "请获取本次修改相关的代码，检查当前 issue 涉及的文件变更。",
    });
    sendAgentCommitPromptMock.mockResolvedValueOnce({
      issueId: reviewWithSession.id,
      sessionId: 503,
      codexSessionId: "thread-503",
    });
    detectAgentCommitCompletionMock.mockResolvedValueOnce({
      outcome: "completed",
      issue: {
        ...reviewWithSession,
        status: "completed",
        linkedSessionStatus: "closed",
        updatedAt: reviewWithSession.updatedAt + 1_000,
      },
      message: "已检测到新的 commit，Issue 已完成。",
    });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Review issue" }),
    );
    const dialog = screen.getByRole("region", { name: "Issue Detail" });
    await user.click(
      within(dialog).getByRole("button", { name: "Open status options" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Done" }));

    expect(prepareAgentCommitCompletionMock).toHaveBeenCalledWith({
      projectId: 1,
      issueId: reviewWithSession.id,
    });
    expect(sendAgentCommitPromptMock).toHaveBeenCalledWith({
      projectId: 1,
      issueId: reviewWithSession.id,
    });
    expect(detectAgentCommitCompletionMock).toHaveBeenCalledWith({
      projectId: 1,
      issueId: reviewWithSession.id,
    });
    expect(completeIssueManualMock).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("button", { name: "View Summary" }),
    ).toBeInTheDocument();
  });

  it("blocks Done when related dirty files exist and completion policy is manual", async () => {
    const user = userEvent.setup();
    const reviewWithSession = {
      ...reviewIssue,
      linkedSessionId: 504,
      linkedSessionStatus: "running" as const,
      linkedSessionAttention: "none" as const,
    };
    listIssuesMock.mockResolvedValue({ issues: [reviewWithSession] });
    prepareAgentCommitCompletionMock.mockRejectedValueOnce({
      code: "ISSUE_VALIDATION_FAILED",
      message: "当前项目中有未提交的代码，请提交后再标记完成。",
      details: [
        {
          "@type": "CompletionPolicy",
          completionPolicy: "manual",
        },
      ],
    });

    renderIssuesActivity({ projectCompletionPolicy: "manual" });

    await user.click(
      await screen.findByRole("button", { name: "Review issue" }),
    );
    const dialog = screen.getByRole("region", { name: "Issue Detail" });
    await user.click(
      within(dialog).getByRole("button", { name: "Open status options" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Done" }));

    expect(completeIssueManualMock).not.toHaveBeenCalled();
    expect(
      within(dialog).getByText(
        "当前项目中有未提交的代码，请提交后再标记完成。",
      ),
    ).toBeInTheDocument();
  });

  it("confirms merge into a worktree target branch before finishing Done", async () => {
    const user = userEvent.setup();
    const reviewWithSession = {
      ...reviewIssue,
      linkedSessionId: 505,
      linkedSessionStatus: "running" as const,
      linkedSessionAttention: "none" as const,
    };
    listIssuesMock.mockResolvedValue({ issues: [reviewWithSession] });
    prepareAgentCommitCompletionMock.mockRejectedValueOnce({
      code: "ISSUE_VALIDATION_FAILED",
      message: "当前仓库无未提交改动，请直接使用 Complete。",
      details: [
        {
          "@type": "GitStatus",
          isClean: true,
          targetBranch: "dev",
        },
      ],
    });
    completeIssueManualMock.mockResolvedValueOnce({
      ...reviewWithSession,
      status: "completed",
      linkedSessionStatus: "closed",
      updatedAt: reviewWithSession.updatedAt + 1_000,
    });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Review issue" }),
    );
    const dialog = screen.getByRole("region", { name: "Issue Detail" });
    await user.click(
      within(dialog).getByRole("button", { name: "Open status options" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Done" }));

    expect(
      screen.getByRole("dialog", {
        name: "即将完成当前 issue，并把临时分支合入目标分支 dev。确认继续吗？",
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() =>
      expect(completeIssueManualMock).toHaveBeenCalledWith({
        projectId: 1,
        issueId: reviewWithSession.id,
      }),
    );
  });

  it("hands off worktree merge conflicts to the linked agent session", async () => {
    const user = userEvent.setup();
    const onOpenAgentsActivity = vi.fn();
    const reviewWithSession = {
      ...reviewIssue,
      linkedSessionId: 506,
      linkedSessionStatus: "running" as const,
      linkedSessionAttention: "none" as const,
    };
    listIssuesMock.mockResolvedValue({ issues: [reviewWithSession] });
    prepareAgentCommitCompletionMock.mockRejectedValueOnce({
      code: "ISSUE_VALIDATION_FAILED",
      message: "当前仓库无未提交改动，请直接使用 Complete。",
      details: [
        {
          "@type": "GitStatus",
          isClean: true,
          targetBranch: "dev",
        },
      ],
    });
    let rejectMerge!: (error: unknown) => void;
    const mergePromise = new Promise<IssueRecord>((_, reject) => {
      rejectMerge = reject;
    });
    completeIssueManualMock.mockReturnValueOnce(mergePromise);
    injectAgentSessionPromptMock.mockResolvedValueOnce({
      sessionId: 506,
      codexSessionId: "thread-506",
    });

    renderIssuesActivity({ onOpenAgentsActivity });

    await user.click(
      await screen.findByRole("button", { name: "Review issue" }),
    );
    const dialog = screen.getByRole("region", { name: "Issue Detail" });
    await user.click(
      within(dialog).getByRole("button", { name: "Open status options" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Done" }));
    await user.click(await screen.findByRole("button", { name: "确认" }));

    expect(
      await screen.findByRole("dialog", { name: "Complete issue" }),
    ).toBeInTheDocument();
    rejectMerge({
      code: "ISSUE_VALIDATION_FAILED",
      message: "当前 Project 的 Git 状态不可用。",
      details: [
        {
          "@type": "Cause",
          message:
            "git command failed for git merge --no-ff --no-edit issue-506",
        },
        {
          "@type": "WorktreeMerge",
          sessionId: 506,
          targetBranch: "dev",
          workspaceBranch: "issue-506",
          workspacePath: "/tmp/worktrees/issue-506",
        },
      ],
    });
    await waitFor(() =>
      expect(injectAgentSessionPromptMock).toHaveBeenCalledWith({
        projectId: 1,
        sessionId: 506,
        kind: "follow_up",
        prompt: expect.stringContaining(
          "Please resolve the conflicts from merging issue-506 into the originally recorded target branch dev",
        ),
      }),
    );
    expect(onOpenAgentsActivity).toHaveBeenCalledWith(506);
    expect(
      screen.queryByRole("dialog", { name: "Complete issue" }),
    ).not.toBeInTheDocument();
  });

  it("soft deletes an issue after confirmation and removes it from the list", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue, runningIssue] });
    deleteIssueMock.mockResolvedValue({ issueId: runningIssue.id });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", {
        name: "Running issue",
      }),
    );

    const dialog = screen.getByRole("region", { name: "Issue Detail" });
    await user.click(
      within(dialog).getByRole("button", { name: "Delete issue" }),
    );

    expect(
      screen.getByRole("dialog", {
        name: "Are you sure to delete this issue?",
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(deleteIssueMock).toHaveBeenCalledWith({
        projectId: 1,
        issueId: runningIssue.id,
      }),
    );
    expect(
      screen.queryByRole("region", { name: "Issue Detail" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Running issue" }),
    ).not.toBeInTheDocument();
    expect(toastSuccessMock).toHaveBeenCalledWith("Deleted successfully");
  });

  it("shows a delete button in the backlog edit page header and deletes the issue after dialog confirmation", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue, runningIssue] });
    deleteIssueMock.mockResolvedValue({ issueId: existingIssue.id });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", {
        name: "Existing issue",
      }),
    );

    const dialog = screen.getByRole("form", { name: "Edit Issue" });
    await user.click(within(dialog).getByRole("button", { name: "删除" }));
    const deleteDialog = screen.getByRole("dialog", { name: "确认删除 Issue" });
    expect(deleteDialog).toBeInTheDocument();
    await user.click(
      within(deleteDialog).getByRole("button", { name: "删除" }),
    );

    expect(deleteIssueMock).toHaveBeenCalledWith({
      projectId: 1,
      issueId: existingIssue.id,
    });
    expect(
      screen.queryByRole("form", { name: "Edit Issue" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Existing issue" }),
    ).not.toBeInTheDocument();
    expect(toastSuccessMock).toHaveBeenCalledWith("Deleted successfully");
  });

  it("closes the backlog edit delete dialog without deleting", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue, runningIssue] });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", {
        name: "Existing issue",
      }),
    );

    const dialog = screen.getByRole("form", { name: "Edit Issue" });
    await user.click(within(dialog).getByRole("button", { name: "删除" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "确认删除 Issue" })).getByRole(
        "button",
        { name: "返回" },
      ),
    );

    expect(deleteIssueMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("form", { name: "Edit Issue" }),
    ).toBeInTheDocument();
  });

  it("does not delete an issue when deletion confirmation is canceled", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue, runningIssue] });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", {
        name: "Running issue",
      }),
    );

    const dialog = screen.getByRole("region", { name: "Issue Detail" });
    await user.click(
      within(dialog).getByRole("button", { name: "Delete issue" }),
    );

    expect(
      screen.getByRole("dialog", {
        name: "Are you sure to delete this issue?",
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: "Are you sure to delete this issue?",
        }),
      ).not.toBeInTheDocument(),
    );
    expect(deleteIssueMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("region", { name: "Issue Detail" }),
    ).toBeInTheDocument();
  });

  it("shows summary action and inline linked session entry for completed issues", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [completedLinkedSessionIssue] });
    getIssueSummaryMock.mockResolvedValue({
      issue: {
        ...completedLinkedSessionIssue,
        linkedSessionLogPath: "/tmp/completed.log",
      },
      sessionStartedAt: 1_780_636_000_000,
      sessionClosedAt: 1_780_637_000_000,
      completion: {
        option: "complete_manual",
        result: "completed",
        commitHash: null,
        failureReason: null,
        headBefore: null,
        headAfter: null,
        changedFilesJson: null,
        createdAt: 1_780_637_000_000,
        source: "issue_action_fallback",
      },
      diagnostics: [
        "缺少 CompletionAttempt 记录，已回退到 Issue 完成事件推断。",
      ],
    });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", {
        name: "Completed linked session issue",
      }),
    );

    const dialog = screen.getByRole("region", { name: "Issue Detail" });
    expect(
      within(dialog).queryByRole("button", { name: "Open Session" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "View Summary" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Open linked session #401" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Open Log" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the linked session entry available for crashed sessions without open log", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({
      issues: [
        {
          ...crashedRunningIssue,
          linkedSessionLogPath: "/tmp/crashed.log",
        } as IssueRecord,
      ],
    });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", {
        name: "Crashed running issue",
      }),
    );

    const dialog = screen.getByRole("region", { name: "Issue Detail" });
    expect(
      within(dialog).queryByRole("button", { name: "Open Session" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Open linked session #402" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Open Log" }),
    ).not.toBeInTheDocument();
  });

  it("opens completed issue summary from the issue detail page", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [completedLinkedSessionIssue] });
    getIssueSummaryMock.mockResolvedValue({
      issue: {
        ...completedLinkedSessionIssue,
        linkedSessionLogPath: "/tmp/completed.log",
      },
      sessionStartedAt: 1_780_636_000_000,
      sessionClosedAt: 1_780_637_000_000,
      completion: {
        option: "agent_auto_commit",
        result: "completed",
        commitHash: "abc1234",
        failureReason: null,
        headBefore: "1111111",
        headAfter: "abc1234",
        changedFilesJson: "[]",
        createdAt: 1_780_637_000_000,
        source: "completion_attempt",
      },
      diagnostics: [],
    });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", {
        name: "Completed linked session issue",
      }),
    );

    const dialog = screen.getByRole("region", { name: "Issue Detail" });
    await user.click(
      within(dialog).getByRole("button", { name: "View Summary" }),
    );

    const summary = await screen.findByRole("dialog", {
      name: "Issue Summary",
    });
    expect(
      within(summary).getByText("Commit hash: abc1234"),
    ).toBeInTheDocument();
    expect(
      within(summary).getByText("Log path: /tmp/completed.log"),
    ).toBeInTheDocument();
  });
});

function renderIssuesActivity(
  props?: Partial<ComponentProps<typeof IssuesActivity>>,
) {
  return render(
    <I18nProvider>
      <IssuesActivity
        projectCompletionPolicy="agent_auto_commit"
        projectId={1}
        worktreeSetupCommand="pnpm install"
        {...props}
      />
    </I18nProvider>,
  );
}

async function openExistingIssueRunDialog(
  user: ReturnType<typeof userEvent.setup>,
) {
  const runButton = await screen.findByRole("button", {
    name: "Run Existing issue",
  });
  await waitFor(() => expect(runButton).toBeEnabled());
  await user.click(runButton);

  return {
    dialog: screen.getByRole("dialog", { name: "Run Issue #20" }),
    runButton,
  };
}

function formatTestTimestamp(epochMilliseconds: number): string {
  return new Date(epochMilliseconds).toLocaleString();
}
