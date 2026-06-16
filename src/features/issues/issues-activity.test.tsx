import { convertFileSrc } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssuesActivity } from "./issues-activity";
import {
  getProjectGitBranches,
  advanceIssueStatus,
  completeIssueManual,
  createIssue,
  deleteIssue,
  exportIssueAttachment,
  getIssueSummary,
  listIssues,
  markIssueReview,
  previewIssueAttachment,
  startAgentSession,
  updateIssue,
  type IssueAttachmentRecord,
  type IssueRecord,
} from "./issue-commands";
import { listAgentSessions } from "../agents/agent-session-commands";
import { listAgentProfiles } from "../settings/settings-commands";
import { I18nProvider } from "../../shared/i18n/i18n";

vi.mock("./issue-commands", () => ({
  advanceIssueStatus: vi.fn(),
  completeIssueManual: vi.fn(),
  createIssue: vi.fn(),
  deleteIssue: vi.fn(),
  exportIssueAttachment: vi.fn(),
  getIssueSummary: vi.fn(),
  getProjectGitBranches: vi.fn(),
  listIssues: vi.fn(),
  markIssueReview: vi.fn(),
  previewIssueAttachment: vi.fn(),
  startAgentSession: vi.fn(),
  updateIssue: vi.fn(),
}));

vi.mock("../agents/agent-session-commands", () => ({
  listAgentSessions: vi.fn(),
}));

vi.mock("../settings/settings-commands", () => ({
  listAgentProfiles: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

vi.mock("./issue-description-editor", () => ({
  IssueDescriptionEditor: ({
    attachments = [],
    ariaLabel,
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
const exportIssueAttachmentMock = vi.mocked(exportIssueAttachment);
const getIssueSummaryMock = vi.mocked(getIssueSummary);
const getProjectGitBranchesMock = vi.mocked(getProjectGitBranches);
const listAgentSessionsMock = vi.mocked(listAgentSessions);
const listIssuesMock = vi.mocked(listIssues);
const markIssueReviewMock = vi.mocked(markIssueReview);
const previewIssueAttachmentMock = vi.mocked(previewIssueAttachment);
const startAgentSessionMock = vi.mocked(startAgentSession);
const updateIssueMock = vi.mocked(updateIssue);
const listAgentProfilesMock = vi.mocked(listAgentProfiles);
const openDialogMock = vi.mocked(open);
const saveDialogMock = vi.mocked(save);
const convertFileSrcMock = vi.mocked(convertFileSrc);

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
  worktreePath: "/tmp/redwhisk.worktrees",
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
  worktreePath: "/tmp/redwhisk.worktrees",
  scope: "global" as const,
  projectId: null,
  mode: "full-auto",
  dangerous: false,
  defaultSkill: "",
  promptTemplate: "",
  del: 0,
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
    exportIssueAttachmentMock.mockReset();
    getIssueSummaryMock.mockReset();
    getProjectGitBranchesMock.mockReset();
    listAgentSessionsMock.mockReset();
    listIssuesMock.mockReset();
    markIssueReviewMock.mockReset();
    previewIssueAttachmentMock.mockReset();
    startAgentSessionMock.mockReset();
    updateIssueMock.mockReset();
    listAgentProfilesMock.mockReset();
    openDialogMock.mockReset();
    saveDialogMock.mockReset();
    convertFileSrcMock.mockReset();
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    convertFileSrcMock.mockImplementation((path) => `asset://${path}`);
    listAgentProfilesMock.mockResolvedValue({ profiles: [] });
    listAgentSessionsMock.mockResolvedValue({ sessions: [] });
    getProjectGitBranchesMock.mockResolvedValue({
      currentBranch: "main",
      localBranches: ["main", "develop", "release"],
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

  it("opens a backlog issue edit dialog without status or updated-at fields", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "Edit Issue",
    });
    expect(within(dialog).getByLabelText("Title")).toHaveValue(
      "Existing issue",
    );
    expect(within(dialog).getByLabelText("Description")).toHaveValue(
      "Existing description",
    );
    expect(
      within(dialog).getByPlaceholderText("Issue title"),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Description")).toBeInTheDocument();
    expect(
      within(dialog).queryByLabelText(/status|updated/i, {
        selector: "input, textarea, select",
      }),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Backlog")).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText(formatTestTimestamp(existingIssue.updatedAt)),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Run" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["in-progress", runningIssue],
    ["review", reviewIssue],
    ["done", completedIssue],
  ])("opens %s issues as read-only details", async (_label, issue) => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [issue] });

    renderIssuesActivity();

    await user.click(await screen.findByRole("button", { name: issue.title }));

    const dialog = screen.getByRole("dialog", { name: "Issue Detail" });
    expect(dialog).toHaveFocus();
    expect(within(dialog).getByText(issue.title)).toBeInTheDocument();
    expect(within(dialog).getByText(issue.description)).toBeInTheDocument();
    expect(dialog.querySelector(".issue-detail__divider")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Title")).not.toBeInTheDocument();
    expect(
      within(dialog).queryByLabelText("Description"),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Attach file" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
  });

  it("closes the detail dialog with Escape and restores focus to the triggering card", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });

    renderIssuesActivity();

    const card = await screen.findByRole("button", { name: "Existing issue" });
    await user.click(card);

    expect(screen.getByLabelText("Title")).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(card).toHaveFocus();
  });

  it("keeps Tab focus inside the issue dialog", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Edit Issue" });
    expect(within(dialog).getByLabelText("Title")).toHaveFocus();

    await user.tab({ shift: true });
    expect(within(dialog).getByRole("button", { name: "Save" })).toHaveFocus();

    await user.tab();
    expect(
      within(dialog).getByRole("button", { name: "Close issue dialog" }),
    ).toHaveFocus();
  });

  it("keeps the empty kanban and dialog input when issue creation fails", async () => {
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
    await user.click(screen.getByRole("button", { name: "Create Issue" }));

    const dialog = screen.getByRole("dialog", { name: "New Issue" });
    expect(
      await within(dialog).findByRole("status", { name: "Dialog status" }),
    ).toHaveTextContent("Issue title 不能为空。");
    expect(
      screen.queryByRole("button", { name: "draft local issue" }),
    ).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("draft local issue")).toBeInTheDocument();
  });

  it("keeps the create dialog open while a create request is pending", async () => {
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
    await user.click(screen.getByRole("button", { name: "Create Issue" }));
    await user.keyboard("{Escape}");

    expect(
      screen.getByRole("dialog", { name: "New Issue" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Issue" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();
  });

  it("keeps lowercase input and closes the create dialog after save", async () => {
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

    await user.click(screen.getByRole("button", { name: "Create Issue" }));

    await waitFor(() =>
      expect(createIssueMock).toHaveBeenCalledWith({
        projectId: 1,
        title: "draft local issue",
        description: "small task shape",
        attachments: [],
      }),
    );
    expect(
      screen.queryByRole("dialog", { name: "New Issue" }),
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

    await user.click(screen.getByRole("button", { name: "Create Issue" }));

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
      }),
    );
    expect(createIssueMock.mock.calls[0]?.[0].description).toContain(
      "{{issue-attachment-temp:",
    );
  });

  it("closes the edit dialog after save", async () => {
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
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateIssueMock).toHaveBeenCalledWith({
        projectId: 1,
        issueId: 20,
        title: "Updated issue",
        description: "Updated description",
        attachments: [],
      }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Edit Issue" }),
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
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(updateIssueMock).toHaveBeenCalledWith({
      projectId: 1,
      issueId: 20,
      title: "Failed update",
      description: "Existing description",
      attachments: [],
    });
    const dialog = screen.getByRole("dialog", { name: "Edit Issue" });
    expect(
      await within(dialog).findByRole("status", { name: "Dialog status" }),
    ).toHaveTextContent("Issue 不存在。");
    expect(
      screen.getByRole("button", { name: "Existing issue" }),
    ).toHaveAttribute("aria-pressed", "true");
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
    await user.click(screen.getByRole("button", { name: "Create Issue" }));
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

  it("restores the selected issue when create is canceled", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });

    renderIssuesActivity();

    expect(
      await screen.findByRole("button", { name: "Existing issue" }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "New Issue" }));
    await user.click(
      screen.getByRole("button", { name: "Close issue dialog" }),
    );

    expect(
      screen.getByRole("button", { name: "Existing issue" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("allows clicking outside to close an untouched create dialog", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });

    renderIssuesActivity();

    await user.click(screen.getByRole("button", { name: "New Issue" }));
    const dialog = screen.getByRole("dialog", { name: "New Issue" });

    await user.click(dialog.parentElement as HTMLElement);

    expect(
      screen.queryByRole("dialog", { name: "New Issue" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a dirty create dialog open on outside click and Escape until the close button is used", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });

    renderIssuesActivity();

    await user.click(screen.getByRole("button", { name: "New Issue" }));
    await user.type(screen.getByLabelText("Title"), "dirty draft");
    const dialog = screen.getByRole("dialog", { name: "New Issue" });

    await user.click(dialog.parentElement as HTMLElement);
    expect(
      screen.getByRole("dialog", { name: "New Issue" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(
      screen.getByRole("dialog", { name: "New Issue" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Close issue dialog" }),
    );

    expect(
      screen.queryByRole("dialog", { name: "New Issue" }),
    ).not.toBeInTheDocument();
  });

  it("treats reverted edit values as clean and allows outside click to close", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );
    const title = screen.getByLabelText("Title");
    const dialog = screen.getByRole("dialog", { name: "Edit Issue" });

    await user.clear(title);
    await user.type(title, "Changed once");
    await user.clear(title);
    await user.type(title, existingIssue.title);

    await user.click(dialog.parentElement as HTMLElement);

    expect(
      screen.queryByRole("dialog", { name: "Edit Issue" }),
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

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Run Existing issue" }),
      ).toBeEnabled(),
    );
    await user.click(
      screen.getByRole("button", { name: "Run Existing issue" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Run Issue #20" });
    expect(within(dialog).getByLabelText("Agent profile")).toHaveFocus();
    expect(
      within(dialog).getByRole("heading", { name: "Run Issue #20" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Agent profile")).toHaveValue("100");
    expect(within(dialog).getByLabelText("Workflow skill")).toHaveValue(
      "bmad-dev-story",
    );
    expect(within(dialog).getByLabelText("Commit strategy")).toHaveValue(
      "agent_auto_commit",
    );
    expect(within(dialog).getByLabelText("Development mode")).toHaveValue(
      "current_branch",
    );
    expect(within(dialog).getByLabelText("Target branch")).toHaveValue("main");
    expect(within(dialog).getByLabelText("Target branch")).toBeDisabled();
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

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Run Existing issue" }),
      ).toBeEnabled(),
    );
    await user.click(
      screen.getByRole("button", { name: "Run Existing issue" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Run Issue #20" });
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
      workspaceMode: "current_branch",
      targetBranch: "main",
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

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );
    await user.click(screen.getByRole("button", { name: "Run Existing issue" }));

    let dialog = screen.getByRole("dialog", { name: "Run Issue #20" });
    await user.selectOptions(
      within(dialog).getByLabelText("Development mode"),
      "worktree",
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Target branch"),
      "develop",
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Commit strategy"),
      "manual",
    );
    expect(within(dialog).getByLabelText("Target branch")).toBeEnabled();

    await user.click(
      within(dialog).getByRole("button", { name: "Close run dialog" }),
    );

    await user.click(screen.getByRole("button", { name: "Run Existing issue" }));
    dialog = screen.getByRole("dialog", { name: "Run Issue #20" });
    expect(within(dialog).getByLabelText("Development mode")).toHaveValue(
      "worktree",
    );
    expect(within(dialog).getByLabelText("Target branch")).toHaveValue(
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
    });
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

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Run Existing issue" }),
      ).toBeEnabled(),
    );
    await user.click(
      screen.getByRole("button", { name: "Run Existing issue" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Run Issue #20" });
    await user.click(within(dialog).getByRole("button", { name: "Start" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Run Issue #20" }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(listIssuesMock).toHaveBeenCalledTimes(2));
    expect(onOpenAgentsActivity).toHaveBeenCalledWith(301);
    expect(
      screen.getByRole("button", { name: "Open linked session #301" }),
    ).toBeEnabled();
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

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Run Existing issue" }),
      ).toBeEnabled(),
    );
    await user.click(
      screen.getByRole("button", { name: "Run Existing issue" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Run Issue #20" });
    const profileSelect = within(dialog).getByLabelText(
      "Agent profile",
    ) as HTMLSelectElement;

    expect(profileSelect).toHaveValue("101");
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

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Run Existing issue" }),
      ).toBeEnabled(),
    );
    await user.click(
      screen.getByRole("button", { name: "Run Existing issue" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Run Issue #20" });
    const profileSelect = within(dialog).getByLabelText(
      "Agent profile",
    ) as HTMLSelectElement;

    expect(profileSelect).toHaveValue("200");
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

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );
    await user.click(screen.getByRole("button", { name: "Run Existing issue" }));

    const dialog = screen.getByRole("dialog", { name: "Run Issue #20" });
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

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );
    await user.click(screen.getByRole("button", { name: "Run Existing issue" }));

    const dialog = screen.getByRole("dialog", { name: "Run Issue #20" });
    await user.selectOptions(
      within(dialog).getByLabelText("Workflow skill"),
      "__none__",
    );

    expect(
      within(dialog).getByLabelText("Final prompt"),
    ).toHaveValue(existingIssueRunPromptWithoutSkill);
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

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );
    await user.click(screen.getByRole("button", { name: "Run Existing issue" }));

    let dialog = screen.getByRole("dialog", { name: "Run Issue #20" });
    await user.selectOptions(
      within(dialog).getByLabelText("Workflow skill"),
      "review-skill",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Close run dialog" }),
    );

    await user.click(screen.getByRole("button", { name: "Run Existing issue" }));
    dialog = screen.getByRole("dialog", { name: "Run Issue #20" });
    expect(within(dialog).getByLabelText("Workflow skill")).toHaveValue(
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

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );
    await user.click(screen.getByRole("button", { name: "Run Existing issue" }));

    const dialog = screen.getByRole("dialog", { name: "Run Issue #20" });
    expect(within(dialog).getByLabelText("Workflow skill")).toHaveValue(
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

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Run Existing issue" }),
      ).toBeEnabled(),
    );

    const runButton = screen.getByRole("button", {
      name: "Run Existing issue",
    });
    await user.click(runButton);
    const runDialog = screen.getByRole("dialog", { name: "Run Issue #20" });
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

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Run Existing issue" }),
      ).toBeEnabled(),
    );
    await user.click(
      screen.getByRole("button", { name: "Run Existing issue" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Run Issue #20" });
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

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Run Existing issue" }),
      ).toBeEnabled(),
    );
    await user.click(
      screen.getByRole("button", { name: "Run Existing issue" }),
    );
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
    expect(
      screen.getByRole("button", { name: "Open linked session #301" }),
    ).toBeEnabled();
  });

  it("shows a factual prompt when no agent profiles are available", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Edit Issue" });
    expect(
      within(dialog).queryByRole("button", { name: "Run" }),
    ).not.toBeInTheDocument();
  });

  it("previews and downloads a draft attachment from the issue dialog", async () => {
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

    const dialog = screen.getByRole("dialog", { name: "Edit Issue" });
    expect(
      within(dialog).queryByRole("button", { name: "Open Session" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Run" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText("#301"),
    ).not.toBeInTheDocument();
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

    const dialog = screen.getByRole("dialog", { name: "Issue Detail" });
    await user.click(
      within(dialog).getByRole("button", { name: "Open linked session #401" }),
    );

    expect(onOpenAgentsActivity).toHaveBeenCalledWith(401);
    expect(screen.queryByRole("dialog", { name: "Issue Detail" })).not.toBeInTheDocument();
  });

  it("shows a forward-only status menu and completes a running issue after confirmation", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
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

    const dialog = screen.getByRole("dialog", { name: "Issue Detail" });
    await user.click(
      within(dialog).getByRole("button", { name: "Open status options" }),
    );

    expect(
      screen.getByRole("menuitem", { name: "Backlog" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("menuitem", { name: "In progress" }),
    ).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "In review" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Done" })).toBeEnabled();

    await user.click(screen.getByRole("menuitem", { name: "Done" }));

    expect(confirmSpy).toHaveBeenCalledWith("session 未结束，确认要完成吗？");
    expect(markIssueReviewMock).toHaveBeenCalledWith({
      projectId: 1,
      issueId: attentionIssue.id,
    });
    expect(completeIssueManualMock).toHaveBeenCalledWith({
      projectId: 1,
      issueId: attentionIssue.id,
    });
    expect(screen.getByRole("button", { name: "View Summary" })).toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it("soft deletes an issue after confirmation and removes it from the list", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    listIssuesMock.mockResolvedValue({ issues: [existingIssue, runningIssue] });
    deleteIssueMock.mockResolvedValue({ issueId: runningIssue.id });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", {
        name: "Running issue",
      }),
    );

    const dialog = screen.getByRole("dialog", { name: "Issue Detail" });
    await user.click(within(dialog).getByRole("button", { name: "Delete issue" }));

    expect(confirmSpy).toHaveBeenCalledWith("确认删除这个 issue 吗？");
    expect(deleteIssueMock).toHaveBeenCalledWith({
      projectId: 1,
      issueId: runningIssue.id,
    });
    expect(screen.queryByRole("dialog", { name: "Issue Detail" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Running issue" }),
    ).not.toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it("does not delete an issue when deletion confirmation is canceled", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    listIssuesMock.mockResolvedValue({ issues: [existingIssue, runningIssue] });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", {
        name: "Running issue",
      }),
    );

    const dialog = screen.getByRole("dialog", { name: "Issue Detail" });
    await user.click(within(dialog).getByRole("button", { name: "Delete issue" }));

    expect(confirmSpy).toHaveBeenCalledWith("确认删除这个 issue 吗？");
    expect(deleteIssueMock).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Issue Detail" })).toBeInTheDocument();

    confirmSpy.mockRestore();
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

    const dialog = screen.getByRole("dialog", { name: "Issue Detail" });
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

    const dialog = screen.getByRole("dialog", { name: "Issue Detail" });
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

  it("opens completed issue summary from the issue detail dialog", async () => {
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

    const dialog = screen.getByRole("dialog", { name: "Issue Detail" });
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
        {...props}
      />
    </I18nProvider>,
  );
}

function formatTestTimestamp(epochMilliseconds: number): string {
  return new Date(epochMilliseconds).toLocaleString();
}
