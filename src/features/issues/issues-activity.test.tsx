import { convertFileSrc } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssuesActivity } from "./issues-activity";
import { resetIssuePageStateCacheForTests } from "./issues-activity-cache";
import { ISSUE_PAGE_SIZE } from "./issue-activity-types";
import {
  getProjectGitBranches,
  advanceIssueStatus,
  completeIssueFlow,
  completeIssueManual,
  createIssue,
  deleteIssue,
  deleteIssueWorktree,
  detectAgentCommitCompletion,
  exportIssueAttachment,
  getIssueSummary,
  getIssueTimeline,
  getIssueWorktreeStatus,
  listIssues,
  markIssueReview,
  prepareAgentCommitCompletion,
  previewIssueAttachment,
  saveIssueAttachmentDraft,
  sendAgentCommitPrompt,
  startAgentSession,
  updateIssue,
  type IssueAttachmentRecord,
  type IssueRecord,
  type StartAgentSessionResult,
} from "./issue-commands";
import {
  injectAgentSessionPrompt,
  listAgentSessions,
  resumeStructuredAgentSession,
} from "../agents/agent-session-commands";
import {
  listAgentProfiles,
  listProjectLabels,
  listSavedAgentSkills,
} from "../settings/settings-commands";
import { I18nProvider } from "../../shared/i18n/i18n";
import { toast } from "../../shared/toast";
import { selectShadcnOption } from "../../test/select-helpers";

vi.mock("./issue-commands", () => ({
  advanceIssueStatus: vi.fn(),
  completeIssueFlow: vi.fn(),
  completeIssueManual: vi.fn(),
  createIssue: vi.fn(),
  deleteIssue: vi.fn(),
  deleteIssueWorktree: vi.fn(),
  detectAgentCommitCompletion: vi.fn(),
  exportIssueAttachment: vi.fn(),
  getIssueSummary: vi.fn(),
  getIssueTimeline: vi.fn(),
  getIssueWorktreeStatus: vi.fn(),
  getProjectGitBranches: vi.fn(),
  listIssues: vi.fn(),
  markIssueReview: vi.fn(),
  prepareAgentCommitCompletion: vi.fn(),
  previewIssueAttachment: vi.fn(),
  saveIssueAttachmentDraft: vi.fn(),
  sendAgentCommitPrompt: vi.fn(),
  startAgentSession: vi.fn(),
  updateIssue: vi.fn(),
}));

vi.mock("../agents/agent-session-commands", () => ({
  injectAgentSessionPrompt: vi.fn(),
  listAgentSessions: vi.fn(),
  resumeStructuredAgentSession: vi.fn(),
}));

vi.mock("../settings/settings-commands", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../settings/settings-commands")>();
  return {
    ...actual,
    listAgentProfiles: vi.fn(),
    listProjectLabels: vi.fn(),
    listSavedAgentSkills: vi.fn(),
  };
});

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

vi.mock("./issue-form/issue-description-editor", () => ({
  IssueDescriptionEditor: ({
    attachments = [],
    ariaLabel,
    onChange,
    onDownloadAttachment,
    onPreviewAttachment,
    onRemoveAttachment,
    onSelectAttachment,
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
    onSelectAttachment?: (filter?: "image" | "file") => Promise<unknown>;
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
      <button
        aria-label="Attach file"
        type="button"
        onClick={() => void onSelectAttachment?.()}
      >
        Attach file
      </button>
      <button
        aria-label="Upload image"
        type="button"
        onClick={async () => {
          const attachment = (await onSelectAttachment?.("image")) as
            | {
                token: string;
                displayName: string;
              }
            | null
            | undefined;
          if (!attachment) {
            return;
          }
          // 模拟真实 RichTextEditor 在 insertEmbed 图片后触发的 text-change：
          // 同步把图片占位符 markdown 写回 description，与 attachments 追加并发，
          // 用以回归验证 setForm 竞态不会丢失刚追加的附件。
          const markdown = `![${attachment.displayName}]({{issue-attachment-temp:${attachment.token}}})`;
          onChange(markdown);
        }}
      >
        Upload image
      </button>
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
const completeIssueFlowMock = vi.mocked(completeIssueFlow);
const completeIssueManualMock = vi.mocked(completeIssueManual);
const createIssueMock = vi.mocked(createIssue);
const deleteIssueMock = vi.mocked(deleteIssue);
const deleteIssueWorktreeMock = vi.mocked(deleteIssueWorktree);
const detectAgentCommitCompletionMock = vi.mocked(detectAgentCommitCompletion);
const exportIssueAttachmentMock = vi.mocked(exportIssueAttachment);
const getIssueSummaryMock = vi.mocked(getIssueSummary);
const getIssueTimelineMock = vi.mocked(getIssueTimeline);
const getIssueWorktreeStatusMock = vi.mocked(getIssueWorktreeStatus);
const getProjectGitBranchesMock = vi.mocked(getProjectGitBranches);
const injectAgentSessionPromptMock = vi.mocked(injectAgentSessionPrompt);
const resumeStructuredAgentSessionMock = vi.mocked(
  resumeStructuredAgentSession,
);
const listAgentSessionsMock = vi.mocked(listAgentSessions);
const listIssuesMock = vi.mocked(listIssues);
const markIssueReviewMock = vi.mocked(markIssueReview);
const prepareAgentCommitCompletionMock = vi.mocked(
  prepareAgentCommitCompletion,
);
const previewIssueAttachmentMock = vi.mocked(previewIssueAttachment);
const saveIssueAttachmentDraftMock = vi.mocked(saveIssueAttachmentDraft);
const sendAgentCommitPromptMock = vi.mocked(sendAgentCommitPrompt);
const startAgentSessionMock = vi.mocked(startAgentSession);
const updateIssueMock = vi.mocked(updateIssue);
const listAgentProfilesMock = vi.mocked(listAgentProfiles);
const listProjectLabelsMock = vi.mocked(listProjectLabels);
const listSavedAgentSkillsMock = vi.mocked(listSavedAgentSkills);
const openDialogMock = vi.mocked(open);
const saveDialogMock = vi.mocked(save);
const convertFileSrcMock = vi.mocked(convertFileSrc);
const toastSuccessMock = vi.mocked(toast.success);

const existingIssue: IssueRecord = {
  id: 20,
  number: 1,
  projectId: 1,
  title: "Existing issue",
  description: "Existing description",
  attachments: [],
  status: "backlog",
  labels: [
    {
      id: 301,
      name: "bug",
      scope: "project",
      projectId: 1,
      color: "#E11D48",
      workflowSkill: "bmad-dev-story",
    },
  ],
  linkedSessionId: null,
  linkedSessionStatus: null,
  linkedSessionAttention: null,
  linkedSessionLogPath: null,
  linkedSessionLatestOutput: null,
  createdAt: 1_780_632_000_000,
  updatedAt: 1_780_632_000_000,
  statusChangedAt: 1_780_632_000_000,
};

const runningIssue: IssueRecord = {
  id: 21,
  number: 21,
  projectId: 1,
  title: "Running issue",
  description: "Running description",
  attachments: [],
  labels: [],
  status: "running",
  linkedSessionId: null,
  linkedSessionStatus: null,
  linkedSessionAttention: null,
  linkedSessionLogPath: null,
  linkedSessionLatestOutput: null,
  createdAt: 1_780_632_000_000,
  updatedAt: 1_780_633_000_000,
  statusChangedAt: 1_780_633_000_000,
};

const reviewIssue: IssueRecord = {
  id: 22,
  number: 22,
  projectId: 1,
  title: "Review issue",
  description: "Review description",
  attachments: [],
  labels: [],
  status: "review",
  linkedSessionId: null,
  linkedSessionStatus: null,
  linkedSessionAttention: null,
  linkedSessionLogPath: null,
  linkedSessionLatestOutput: null,
  createdAt: 1_780_632_000_000,
  updatedAt: 1_780_634_000_000,
  statusChangedAt: 1_780_634_000_000,
};

const completedIssue: IssueRecord = {
  id: 23,
  number: 23,
  projectId: 1,
  title: "Completed issue",
  description: "Completed description",
  attachments: [],
  labels: [],
  status: "completed",
  linkedSessionId: null,
  linkedSessionStatus: null,
  linkedSessionAttention: null,
  linkedSessionLogPath: null,
  linkedSessionLatestOutput: null,
  createdAt: 1_780_632_000_000,
  updatedAt: 1_780_635_000_000,
  statusChangedAt: 1_780_635_000_000,
};

const linkedSessionIssue: IssueRecord = {
  id: 24,
  number: 24,
  projectId: 1,
  title: "Linked session issue",
  description: "Resume from the existing session",
  attachments: [],
  labels: [],
  status: "backlog",
  linkedSessionId: 301,
  linkedSessionStatus: "stopped",
  linkedSessionAttention: "none",
  linkedSessionLogPath: null,
  linkedSessionLatestOutput: null,
  createdAt: 1_780_632_000_000,
  updatedAt: 1_780_636_000_000,
  statusChangedAt: 1_780_636_000_000,
};

const completedLinkedSessionIssue: IssueRecord = {
  id: 25,
  number: 25,
  projectId: 1,
  title: "Completed linked session issue",
  description: "Already completed",
  attachments: [],
  labels: [],
  status: "completed",
  linkedSessionId: 401,
  linkedSessionStatus: "closed",
  linkedSessionAttention: "none",
  linkedSessionLogPath: null,
  linkedSessionLatestOutput: null,
  createdAt: 1_780_632_000_000,
  updatedAt: 1_780_637_000_000,
  statusChangedAt: 1_780_637_000_000,
};

const attentionIssue: IssueRecord = {
  id: 27,
  number: 27,
  projectId: 1,
  title: "Attention issue",
  description: "Need a quick review in Codex",
  attachments: [],
  labels: [],
  status: "running",
  linkedSessionId: 403,
  linkedSessionStatus: "running",
  linkedSessionAttention: "requested",
  linkedSessionLogPath: null,
  linkedSessionLatestOutput: null,
  createdAt: 1_780_632_000_000,
  updatedAt: 1_780_639_000_000,
  statusChangedAt: 1_780_639_000_000,
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
  workflowSkill: null,
  del: 0,
};

const globalLabel = {
  id: 302,
  name: "release",
  scope: "global" as const,
  projectId: null,
  color: "#3B82F6",
  workflowSkill: null,
  del: 0,
};

const existingIssueRunPrompt = [
  "using skill bmad-dev-story for task:",
  "Existing description",
].join("\n\n");

const existingIssueRunPromptWithoutSkill = "Existing description";

function completedFlowResult(issue: Partial<IssueRecord> & { id: number }) {
  const completedIssue: IssueRecord = {
    id: issue.id,
    number: issue.number ?? issue.id,
    projectId: issue.projectId ?? 1,
    title: issue.title ?? "Completed issue",
    description: issue.description ?? "",
    attachments: issue.attachments ?? [],
    labels: issue.labels ?? [],
    status: "completed",
    linkedSessionId: issue.linkedSessionId ?? null,
    linkedSessionStatus: "closed",
    linkedSessionAttention: "none",
    linkedSessionLogPath: issue.linkedSessionLogPath ?? null,
    linkedSessionLatestOutput: issue.linkedSessionLatestOutput ?? null,
    createdAt: issue.createdAt ?? 1_780_632_000_000,
    updatedAt: issue.updatedAt ?? 1_780_639_000_000,
    statusChangedAt: issue.statusChangedAt ?? 1_780_639_000_000,
  };
  return {
    action: "completed" as const,
    issue: completedIssue,
    flow: null,
    message: "Issue completed",
    mergeBlockReason: null,
    targetBranch: null,
    workspaceBranch: null,
    workspacePath: null,
    actualPath: null,
    drifted: false,
    sessionId: completedIssue.linkedSessionId,
  };
}

describe("IssuesActivity", () => {
  beforeEach(() => {
    advanceIssueStatusMock.mockReset();
    completeIssueFlowMock.mockReset();
    completeIssueManualMock.mockReset();
    createIssueMock.mockReset();
    deleteIssueMock.mockReset();
    deleteIssueWorktreeMock.mockReset();
    detectAgentCommitCompletionMock.mockReset();
    exportIssueAttachmentMock.mockReset();
    getIssueSummaryMock.mockReset();
    getIssueTimelineMock.mockReset();
    getIssueWorktreeStatusMock.mockReset();
    getProjectGitBranchesMock.mockReset();
    injectAgentSessionPromptMock.mockReset();
    resumeStructuredAgentSessionMock.mockReset();
    listAgentSessionsMock.mockReset();
    listIssuesMock.mockReset();
    markIssueReviewMock.mockReset();
    prepareAgentCommitCompletionMock.mockReset();
    previewIssueAttachmentMock.mockReset();
    saveIssueAttachmentDraftMock.mockReset();
    sendAgentCommitPromptMock.mockReset();
    startAgentSessionMock.mockReset();
    updateIssueMock.mockReset();
    listAgentProfilesMock.mockReset();
    listProjectLabelsMock.mockReset();
    listSavedAgentSkillsMock.mockReset();
    openDialogMock.mockReset();
    saveDialogMock.mockReset();
    convertFileSrcMock.mockReset();
    toastSuccessMock.mockReset();
    completeIssueFlowMock.mockImplementation(async (input) =>
      completedFlowResult({
        id: input.issueId,
        projectId: input.projectId,
      }),
    );
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    convertFileSrcMock.mockImplementation((path) => `asset://${path}`);
    saveIssueAttachmentDraftMock.mockImplementation(async (input) => ({
      path: `/Users/yujianjia/.redwhisk/issue-attachment-drafts/${input.displayName}`,
      displayName: input.displayName,
      kind: input.displayName.endsWith(".png") ? "image" : "text",
      isPreviewable: true,
    }));
    updateIssueMock.mockImplementation(async (input) => ({
      ...existingIssue,
      id: input.issueId,
      projectId: input.projectId,
      title: input.title,
      description: input.description,
      updatedAt: 1_780_640_000_000,
    }));
    resetIssuePageStateCacheForTests();
    listAgentProfilesMock.mockResolvedValue({ profiles: [] });
    listProjectLabelsMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return { labels: [] };
      }
      return { labels: [] };
    });
    listSavedAgentSkillsMock.mockImplementation(async ({ scope }) => ({
      skills:
        scope === "global"
          ? [
              {
                id: 1,
                name: "bmad-dev-story",
                scope: "global",
                projectId: null,
                skillPaths: [
                  {
                    agentType: "codex",
                    path: "/home/me/.agents/skills/bmad-dev-story/SKILL.md",
                  },
                ],
              },
            ]
          : [],
    }));
    listAgentSessionsMock.mockResolvedValue({ sessions: [] });
    resumeStructuredAgentSessionMock.mockResolvedValue({
      sessionId: 1,
      threadId: "thread-1",
    });
    injectAgentSessionPromptMock.mockResolvedValue({
      sessionId: 1,
      codexSessionId: "thread-1",
    });
    getProjectGitBranchesMock.mockResolvedValue({
      currentBranch: "main",
      localBranches: ["main", "develop", "release"],
    });
    getIssueWorktreeStatusMock.mockResolvedValue({
      exists: false,
      canDelete: false,
      workspacePath: null,
      workspaceBranch: null,
    });
    getIssueTimelineMock.mockResolvedValue({ entries: [] });
    deleteIssueWorktreeMock.mockResolvedValue({
      issueId: 0,
      deleted: true,
      workspacePath: null,
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

  it("shows backend lane totals even when more issues exist beyond the loaded page", async () => {
    // 仅加载 1 条 backlog，但后端总数为 7：甬道计数应显示总数而非已加载条数。
    listIssuesMock.mockResolvedValue({
      issues: [existingIssue],
      statusTotals: {
        backlog: 7,
        running: 2,
        review: 0,
        completed: 0,
      },
    });

    renderIssuesActivity();

    const backlogLane = await screen.findByRole("region", { name: "Backlog" });
    expect(within(backlogLane).getByText("7")).toBeInTheDocument();
    expect(
      within(backlogLane).getByRole("button", { name: "Existing issue" }),
    ).toBeInTheDocument();
    const runningLane = screen.getByRole("region", { name: "In Progress" });
    expect(within(runningLane).getByText("2")).toBeInTheDocument();
  });

  it("increments the backlog lane total after creating an issue", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({
      issues: [existingIssue],
      statusTotals: {
        backlog: 7,
        running: 0,
        review: 0,
        completed: 0,
      },
    });
    createIssueMock.mockResolvedValue({
      id: 25,
      number: 25,
      projectId: 1,
      title: "Brand new issue",
      description: "",
      attachments: [],
      labels: [],
      status: "backlog",
      linkedSessionId: null,
      linkedSessionStatus: null,
      linkedSessionAttention: null,
      linkedSessionLogPath: null,
      linkedSessionLatestOutput: null,
      createdAt: 1_780_632_000_000,
      updatedAt: 1_780_640_000_000,
      statusChangedAt: 1_780_640_000_000,
    });

    renderIssuesActivity();

    const backlogLane = await screen.findByRole("region", { name: "Backlog" });
    expect(within(backlogLane).getByText("7")).toBeInTheDocument();

    await user.click(
      (await screen.findAllByRole("button", { name: "New Issue" }))[0],
    );
    await user.type(screen.getByLabelText("Title"), "Brand new issue");
    await user.click(screen.getByRole("button", { name: "Create Issue" }));

    // 创建页打开期间看板会卸载，保存后回到看板需重新定位甬道。
    const refreshedBacklogLane = await screen.findByRole("region", {
      name: "Backlog",
    });
    expect(within(refreshedBacklogLane).getByText("8")).toBeInTheDocument();
  });

  it("loads more issues for a lane when scrolled to its bottom", async () => {
    const backlogIssues: IssueRecord[] = Array.from(
      { length: ISSUE_PAGE_SIZE },
      (_, index) => ({
        ...existingIssue,
        id: 100 + index,
        title: `Backlog ${index}`,
        status: "backlog" as const,
      }),
    );
    const pageTwoIssues: IssueRecord[] = Array.from(
      { length: 5 },
      (_, index) => ({
        ...existingIssue,
        id: 200 + index,
        title: `Backlog page two ${index}`,
        status: "backlog" as const,
      }),
    );
    listIssuesMock.mockImplementation(async (input) => {
      if (input.perStatusLimit) {
        return { issues: backlogIssues };
      }
      if (input.status === "backlog") {
        return { issues: pageTwoIssues };
      }
      return { issues: [] };
    });

    renderIssuesActivity();

    const backlogLane = await screen.findByRole("region", { name: "Backlog" });
    expect(within(backlogLane).getByText("Backlog 0")).toBeInTheDocument();

    scrollLaneToBottom(backlogLane);

    await waitFor(() =>
      expect(listIssuesMock).toHaveBeenCalledWith({
        projectId: 1,
        status: "backlog",
        limit: ISSUE_PAGE_SIZE,
        offset: ISSUE_PAGE_SIZE,
      }),
    );
    expect(await screen.findByText("Backlog page two 0")).toBeInTheDocument();
  });

  it("shows a loading indicator in the lane while loading more", async () => {
    const backlogIssues: IssueRecord[] = Array.from(
      { length: ISSUE_PAGE_SIZE },
      (_, index) => ({
        ...existingIssue,
        id: 100 + index,
        title: `Backlog ${index}`,
        status: "backlog" as const,
      }),
    );
    let resolveLoadMore: (response: {
      issues: IssueRecord[];
    }) => void = () => {};
    listIssuesMock.mockImplementation(async (input) => {
      if (input.perStatusLimit) {
        return { issues: backlogIssues };
      }
      if (input.status === "backlog") {
        return new Promise<{ issues: IssueRecord[] }>((resolve) => {
          resolveLoadMore = resolve;
        });
      }
      return { issues: [] };
    });

    renderIssuesActivity();

    const backlogLane = await screen.findByRole("region", { name: "Backlog" });
    scrollLaneToBottom(backlogLane);

    expect(
      await screen.findByText("Loading more issues..."),
    ).toBeInTheDocument();

    resolveLoadMore({ issues: [] });
    await waitFor(() =>
      expect(
        screen.queryByText("Loading more issues..."),
      ).not.toBeInTheDocument(),
    );
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

  it("sorts issues by id descending within the same lane", async () => {
    listIssuesMock.mockResolvedValue({
      issues: [
        { ...existingIssue, id: 3, title: "Issue 3" },
        { ...existingIssue, id: 9, title: "Issue 9" },
        { ...existingIssue, id: 5, title: "Issue 5" },
      ],
    });

    renderIssuesActivity();

    const backlogLane = await screen.findByRole("region", { name: "Backlog" });
    const issue9 = within(backlogLane).getByRole("button", { name: "Issue 9" });
    const issue5 = within(backlogLane).getByRole("button", { name: "Issue 5" });
    const issue3 = within(backlogLane).getByRole("button", { name: "Issue 3" });

    expect(issue9.compareDocumentPosition(issue5)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(issue5.compareDocumentPosition(issue3)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("shows issue project number (not global id), created time, full title, and a single-line description excerpt", async () => {
    // existingIssue.id = 20 但 number = 1；卡片展示必须用 number。
    expect(existingIssue.id).not.toBe(existingIssue.number);
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });

    renderIssuesActivity();

    const card = await screen.findByRole("button", {
      name: "Existing issue",
    });

    expect(card).toHaveTextContent("Existing issue");
    expect(card).toHaveTextContent("#1");
    expect(card).not.toHaveTextContent("#20");
    expect(card).toHaveTextContent(
      formatTestTimestamp(existingIssue.createdAt),
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

    expect(attentionCard).toHaveTextContent("Codex needs confirmation");
    expect(normalCard).not.toHaveTextContent("Codex needs confirmation");
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
      within(page).getByRole("button", { name: "Run" }),
    ).toBeInTheDocument();
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
    expect(page).toHaveClass("issue-page--fullscreen");
    expect(
      screen.queryByRole("dialog", { name: "Issue Detail" }),
    ).not.toBeInTheDocument();
    expect(
      within(page).getByRole("button", { name: "Back" }).querySelector("svg"),
    ).toBeNull();
    expect(within(page).getByText(issue.title)).toBeInTheDocument();
    expect(within(page).getByText(issue.description)).toBeInTheDocument();
    expect(within(page).queryByLabelText("Title")).not.toBeInTheDocument();
    expect(
      within(page).queryByLabelText("Description"),
    ).not.toBeInTheDocument();
    expect(
      within(page).queryByRole("button", { name: "Attach file" }),
    ).not.toBeInTheDocument();
    expect(
      within(page).queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
  });

  it("closes the edit page with 返回 and restores the issue board", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });

    renderIssuesActivity();

    const card = await screen.findByRole("button", { name: "Existing issue" });
    await user.click(card);

    expect(screen.getByLabelText("Title")).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Back" }));

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

  it("returns to the read-only detail when canceling an edit started from it", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [runningIssue] });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Running issue" }),
    );

    const readOnlyPage = screen.getByRole("region", { name: "Issue Detail" });
    await openIssueMoreMenu(user, readOnlyPage);
    await user.click(
      await screen.findByRole("menuitem", { name: "Edit Issue" }),
    );

    expect(
      screen.getByRole("form", { name: "Edit Issue" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back" }));

    // 从只读详情发起的编辑：返回只读详情，而非关闭回看板。
    expect(
      screen.queryByRole("form", { name: "Edit Issue" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Issue Detail" }),
    ).toBeInTheDocument();
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
    expect(within(page).getByRole("button", { name: "Delete" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(within(page).getByRole("button", { name: "Save" })).toHaveFocus();
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
    await user.click(screen.getByRole("button", { name: "Create Issue" }));

    const page = screen.getByRole("form", { name: "New Issue" });
    expect(
      await within(page).findByRole("status", { name: "Dialog status" }),
    ).toHaveTextContent("Issue title 不能为空。");
    expect(
      screen.queryByRole("button", { name: "draft local issue" }),
    ).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("draft local issue")).toBeInTheDocument();
  });

  it("shows a field-level error under the title when submitting with an empty title", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [] });

    renderIssuesActivity();

    await user.click(
      (await screen.findAllByRole("button", { name: "New Issue" }))[0],
    );
    await user.click(screen.getByRole("button", { name: "Create Issue" }));

    const page = screen.getByRole("form", { name: "New Issue" });
    expect(await within(page).findByRole("alert")).toHaveTextContent(
      "Issue title is required.",
    );
    expect(createIssueMock).not.toHaveBeenCalled();
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
    await user.click(screen.getByRole("button", { name: "Create Issue" }));
    await user.keyboard("{Escape}");

    expect(screen.getByRole("form", { name: "New Issue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Issue" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  });

  it("keeps lowercase input and closes the create page after save", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [] });
    createIssueMock.mockResolvedValue({
      id: 24,
      number: 24,
      projectId: 1,
      title: "draft local issue",
      description: "small task shape",
      attachments: [],
      labels: [],
      status: "backlog",
      linkedSessionId: null,
      linkedSessionStatus: null,
      linkedSessionAttention: null,
      linkedSessionLogPath: null,
      linkedSessionLatestOutput: null,
      createdAt: 1_780_632_000_000,
      updatedAt: 1_780_632_000_000,
      statusChangedAt: 1_780_632_000_000,
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
      number: 24,
      projectId: 1,
      title: "draft local issue",
      description: "Read the config.",
      attachments: [],
      labels: [],
      status: "backlog",
      linkedSessionId: null,
      linkedSessionStatus: null,
      linkedSessionAttention: null,
      linkedSessionLogPath: null,
      linkedSessionLatestOutput: null,
      createdAt: 1_780_632_000_000,
      updatedAt: 1_780_632_000_000,
      statusChangedAt: 1_780_632_000_000,
    });

    renderIssuesActivity();

    await user.click(
      (await screen.findAllByRole("button", { name: "New Issue" }))[0],
    );
    await user.type(screen.getByLabelText("Title"), "draft local issue");
    await user.type(screen.getByLabelText("Description"), "Read the config.");
    await user.click(screen.getByRole("button", { name: "Attach file" }));

    expect(openDialogMock).toHaveBeenCalled();
    expect(saveIssueAttachmentDraftMock).toHaveBeenCalledWith({
      sourcePath: "/tmp/tsconfig.json",
      displayName: "tsconfig.json",
    });
    expect(screen.getByText("tsconfig.json")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create Issue" }));

    expect(createIssueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 1,
        title: "draft local issue",
        attachments: [
          expect.objectContaining({
            displayName: "tsconfig.json",
            sourcePath:
              "/Users/yujianjia/.redwhisk/issue-attachment-drafts/tsconfig.json",
          }),
        ],
        labelIds: [],
      }),
    );
    expect(createIssueMock.mock.calls[0]?.[0].description).toMatch(
      /^Read the config\.\n\n\{\{issue-attachment-temp:draft-[^}]+\}\}$/,
    );
  });

  it("stores draft image attachments under the RedWhisk data directory before editor preview", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [] });
    openDialogMock.mockResolvedValue("/Users/alice/Desktop/screenshot.png");
    saveIssueAttachmentDraftMock.mockResolvedValue({
      path: "/Users/yujianjia/.redwhisk/issue-attachment-drafts/screenshot.png",
      displayName: "screenshot.png",
      kind: "image",
      isPreviewable: true,
    });
    createIssueMock.mockResolvedValue({
      id: 25,
      number: 25,
      projectId: 1,
      title: "",
      description: "",
      attachments: [],
      labels: [],
      status: "backlog",
      linkedSessionId: null,
      linkedSessionStatus: null,
      linkedSessionAttention: null,
      linkedSessionLogPath: null,
      linkedSessionLatestOutput: null,
      createdAt: 1_780_632_000_000,
      updatedAt: 1_780_632_000_000,
      statusChangedAt: 1_780_632_000_000,
    });

    renderIssuesActivity();

    await user.click(
      (await screen.findAllByRole("button", { name: "New Issue" }))[0],
    );
    await user.type(screen.getByLabelText("Title"), "image draft");
    await user.click(screen.getByRole("button", { name: "Attach file" }));
    await user.click(screen.getByRole("button", { name: "Create Issue" }));

    expect(saveIssueAttachmentDraftMock).toHaveBeenCalledWith({
      sourcePath: "/Users/alice/Desktop/screenshot.png",
      displayName: "screenshot.png",
    });
    expect(createIssueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          expect.objectContaining({
            displayName: "screenshot.png",
            sourcePath:
              "/Users/yujianjia/.redwhisk/issue-attachment-drafts/screenshot.png",
          }),
        ],
      }),
    );
  });

  it("preserves an image attachment when the editor rewrites description synchronously after upload", async () => {
    // 回归测试：真实 RichTextEditor 在 insertEmbed 图片后会同步触发 text-change，
    // 进而调用 description 的 onChange。若该 onChange 用闭包陈旧的 form 快照覆盖，
    // 会把刚由 handleSelectAttachment 追加的图片附件丢掉，导致保存时 attachments 为空、
    // 后端不重写 token、不建附件记录。这里用 mock 编辑器复现该并发场景。
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [] });
    openDialogMock.mockResolvedValue("/Users/alice/Desktop/screenshot.png");
    saveIssueAttachmentDraftMock.mockResolvedValue({
      path: "/Users/yujianjia/.redwhisk/issue-attachment-drafts/screenshot.png",
      displayName: "screenshot.png",
      kind: "image",
      isPreviewable: true,
    });
    createIssueMock.mockResolvedValue({
      id: 26,
      number: 26,
      projectId: 1,
      title: "image race",
      description: "",
      attachments: [],
      labels: [],
      status: "backlog",
      linkedSessionId: null,
      linkedSessionStatus: null,
      linkedSessionAttention: null,
      linkedSessionLogPath: null,
      linkedSessionLatestOutput: null,
      createdAt: 1_780_632_000_000,
      updatedAt: 1_780_632_000_000,
      statusChangedAt: 1_780_632_000_000,
    });

    renderIssuesActivity();

    await user.click(
      (await screen.findAllByRole("button", { name: "New Issue" }))[0],
    );
    await user.type(screen.getByLabelText("Title"), "image race");
    // 点击 Upload image：mock 编辑器会先 onSelectAttachment("image") 追加附件，
    // 再同步 onChange 写入图片占位符 markdown，模拟真实 insertEmbed → text-change。
    await user.click(screen.getByRole("button", { name: "Upload image" }));
    await user.click(screen.getByRole("button", { name: "Create Issue" }));

    expect(createIssueMock).toHaveBeenCalledTimes(1);
    const createCall = createIssueMock.mock.calls[0]?.[0];
    // 附件必须仍存在于提交载荷中（未被 description onChange 覆盖丢失）
    expect(createCall.attachments).toHaveLength(1);
    expect(createCall.attachments?.[0]).toEqual(
      expect.objectContaining({
        displayName: "screenshot.png",
        sourcePath:
          "/Users/yujianjia/.redwhisk/issue-attachment-drafts/screenshot.png",
        tempToken: expect.stringMatching(/^draft-/),
      }),
    );
    // description 应含图片占位符 markdown（temp token 待后端重写）
    expect(createCall.description).toMatch(
      /^!\[screenshot\.png\]\(\{\{issue-attachment-temp:draft-[^}]+\}\}\)$/,
    );
  });

  it("preserves saved attachment markers when re-saving an existing issue", async () => {
    const user = userEvent.setup();
    const attachment: IssueAttachmentRecord = {
      id: 501,
      issueId: existingIssue.id,
      displayName: "spec.md",
      storedName: "spec.md",
      relativePath: ".redwhisk/issues/20/attachments/spec.md",
      absolutePath: "/tmp/spec.md",
      mimeType: "text/markdown",
      fileSize: 128,
      kind: "text",
      isPreviewable: true,
      createdAt: 1_780_632_100_000,
    };
    listIssuesMock.mockResolvedValue({
      issues: [
        {
          ...existingIssue,
          description: "Existing description\n\n{{issue-attachment:501}}",
          attachments: [attachment],
        },
      ],
    });
    updateIssueMock.mockResolvedValue({
      ...existingIssue,
      description: "Existing description\n\n{{issue-attachment:501}}",
      attachments: [attachment],
      updatedAt: 1_780_635_600_000,
    });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );
    expect(screen.getByText("spec.md")).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toHaveValue(
      "Existing description",
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateIssueMock).toHaveBeenCalledWith({
        projectId: 1,
        issueId: 20,
        title: "Existing issue",
        description: "Existing description\n\n{{issue-attachment:501}}",
        attachments: [
          {
            attachmentId: 501,
            tempToken: null,
            sourcePath: null,
            displayName: "spec.md",
            mimeType: "text/markdown",
          },
        ],
        labelIds: [301],
      }),
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
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateIssueMock).toHaveBeenCalledWith({
        projectId: 1,
        issueId: 20,
        title: "Updated issue",
        description: "Updated description",
        attachments: [],
        labelIds: [301],
      }),
    );
    expect(
      screen.queryByRole("form", { name: "Edit Issue" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Updated issue" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("returns to the read-only page after saving an edit started from the read-only page", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [runningIssue] });
    updateIssueMock.mockResolvedValue({
      ...runningIssue,
      title: "Updated running issue",
      description: "Updated running description",
      updatedAt: 1_780_640_000_000,
    });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Running issue" }),
    );
    const readOnlyPage = screen.getByRole("region", { name: "Issue Detail" });
    await openIssueMoreMenu(user, readOnlyPage);
    await user.click(
      await screen.findByRole("menuitem", { name: "Edit Issue" }),
    );

    const editForm = screen.getByRole("form", { name: "Edit Issue" });
    await user.clear(within(editForm).getByLabelText("Title"));
    await user.type(
      within(editForm).getByLabelText("Title"),
      "Updated running issue",
    );
    await user.clear(within(editForm).getByLabelText("Description"));
    await user.type(
      within(editForm).getByLabelText("Description"),
      "Updated running description",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateIssueMock).toHaveBeenCalledWith({
        projectId: 1,
        issueId: 21,
        title: "Updated running issue",
        description: "Updated running description",
        attachments: [],
        labelIds: [],
      }),
    );
    expect(
      screen.queryByRole("form", { name: "Edit Issue" }),
    ).not.toBeInTheDocument();
    const readOnlyPageAfterSave = screen.getByRole("region", {
      name: "Issue Detail",
    });
    expect(
      within(readOnlyPageAfterSave).getByRole("heading", {
        name: "Updated running issue",
      }),
    ).toBeInTheDocument();
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
      labelIds: [301],
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
    rerender(<IssuesActivity projectId={2} />);

    expect(
      await screen.findByRole("status", { name: "Issues status" }),
    ).toHaveTextContent("Project not found.");
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
    rerender(<IssuesActivity projectId={2} />);
    resolveCreate({
      id: 24,
      number: 24,
      projectId: 1,
      title: "Late issue",
      description: "",
      attachments: [],
      labels: [],
      status: "backlog",
      linkedSessionId: null,
      linkedSessionStatus: null,
      linkedSessionAttention: null,
      linkedSessionLogPath: null,
      linkedSessionLatestOutput: null,
      createdAt: 1_780_632_000_000,
      updatedAt: 1_780_632_000_000,
      statusChangedAt: 1_780_632_000_000,
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
      number: 24,
      projectId: 1,
      title: "Label issue",
      description: "Needs a label",
      attachments: [],
      status: "backlog",
      labels: [projectLabel, globalLabel],
      linkedSessionId: null,
      linkedSessionStatus: null,
      linkedSessionAttention: null,
      linkedSessionLogPath: null,
      linkedSessionLatestOutput: null,
      createdAt: 1_780_632_000_000,
      updatedAt: 1_780_632_000_000,
      statusChangedAt: 1_780_632_000_000,
    });

    renderIssuesActivity();

    await user.click(
      (await screen.findAllByRole("button", { name: "New Issue" }))[0],
    );
    await user.type(screen.getByLabelText("Title"), "Label issue");
    await user.type(screen.getByLabelText("Description"), "Needs a label");
    await user.click(screen.getByRole("button", { name: "Add label" }));
    await user.click(screen.getByRole("option", { name: "bug" }));
    await user.click(screen.getByRole("option", { name: "release" }));
    await user.click(screen.getByRole("button", { name: "Add label" }));
    expect(screen.getByText("bug")).toBeInTheDocument();
    expect(screen.getByText("release")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create Issue" }));

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

  it("hides global labels shadowed by a project-level label in the label dropdown", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [] });
    listProjectLabelsMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return {
          labels: [
            {
              id: 301,
              name: "bug",
              scope: "project",
              projectId: 1,
              color: "#E11D48",
              workflowSkill: null,
              del: 0,
            },
          ],
        };
      }

      return {
        labels: [
          {
            id: 302,
            name: "bug",
            scope: "global",
            projectId: null,
            color: "#3B82F6",
            workflowSkill: null,
            del: 0,
          },
          {
            id: 303,
            name: "release",
            scope: "global",
            projectId: null,
            color: "#3B82F6",
            workflowSkill: null,
            del: 0,
          },
        ],
      };
    });

    renderIssuesActivity();

    await user.click(
      (await screen.findAllByRole("button", { name: "New Issue" }))[0],
    );
    await user.click(screen.getByRole("button", { name: "Add label" }));

    // 项目级同名 bug 覆盖全局 bug：下拉只剩一个 bug（项目级），release 不受影响。
    expect(screen.getAllByRole("option", { name: "bug" })).toHaveLength(1);
    expect(screen.getByRole("option", { name: "release" })).toBeInTheDocument();
  });

  it("opens project settings labels when the picker is empty", async () => {
    const user = userEvent.setup();
    const onOpenProjectSettingsLabels = vi.fn();
    listIssuesMock.mockResolvedValue({ issues: [] });

    renderIssuesActivity({ onOpenProjectSettingsLabels });

    await user.click(
      (await screen.findAllByRole("button", { name: "New Issue" }))[0],
    );
    await user.click(screen.getByRole("button", { name: "Add label" }));
    const addLabelButtons = screen.getAllByRole("button", {
      name: "Add label",
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
    await user.click(screen.getByRole("button", { name: "Back" }));

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

    await user.click(within(page).getByRole("button", { name: "Back" }));

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

    await user.click(screen.getByRole("button", { name: "Back" }));

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

    await user.click(screen.getByRole("button", { name: "Back" }));

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
      within(dialog).getByRole("heading", { name: "Run Issue #1" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Agent profile")).toHaveTextContent(
      "Project Codex (Project)",
    );
    expect(within(dialog).getByLabelText("Workflow skill")).toHaveTextContent(
      "bmad-dev-story",
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

  it("renders read-only description image and file attachment tokens inline", async () => {
    const user = userEvent.setup();
    const imageAttachment: IssueAttachmentRecord = {
      id: 501,
      issueId: completedIssue.id,
      displayName: "screenshot.png",
      storedName: "screenshot.png",
      relativePath: "issue-23/screenshot.png",
      absolutePath: "/tmp/redwhisk/screenshot.png",
      mimeType: "image/png",
      fileSize: 1024,
      kind: "image",
      isPreviewable: true,
      createdAt: 1_780_632_000_000,
    };
    const textAttachment: IssueAttachmentRecord = {
      id: 502,
      issueId: completedIssue.id,
      displayName: "notes.md",
      storedName: "notes.md",
      relativePath: "issue-23/notes.md",
      absolutePath: "/tmp/redwhisk/notes.md",
      mimeType: "text/markdown",
      fileSize: 512,
      kind: "text",
      isPreviewable: true,
      createdAt: 1_780_632_000_000,
    };
    listIssuesMock.mockResolvedValue({
      issues: [
        {
          ...completedIssue,
          description: [
            "Completed description",
            "",
            "![screenshot.png]({{issue-attachment:501}})",
            "",
            "{{issue-attachment:502}}",
          ].join("\n"),
          attachments: [imageAttachment, textAttachment],
        },
      ],
    });
    previewIssueAttachmentMock.mockResolvedValue({
      attachmentId: textAttachment.id,
      displayName: textAttachment.displayName,
      kind: "text",
      isPreviewable: true,
      textContent: "preview body",
      absolutePath: null,
    });
    saveDialogMock.mockResolvedValue("/tmp/exported-notes.md");
    exportIssueAttachmentMock.mockResolvedValue(undefined);

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Completed issue" }),
    );

    expect(await screen.findByAltText("screenshot.png")).toHaveAttribute(
      "src",
      "asset:///tmp/redwhisk/screenshot.png",
    );
    expect(screen.getByText("notes.md")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Preview notes.md" }));
    expect(previewIssueAttachmentMock).toHaveBeenCalledWith({
      projectId: 1,
      attachmentId: textAttachment.id,
    });

    await user.click(screen.getByRole("button", { name: "Download notes.md" }));
    expect(exportIssueAttachmentMock).toHaveBeenCalledWith({
      projectId: 1,
      attachmentId: textAttachment.id,
      targetPath: "/tmp/exported-notes.md",
    });
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
      workspaceMode: "worktree",
      targetBranch: "main",
      worktreeSetupCommand: "pnpm install",
    });
    // 失败后 Run Dialog 重新显示并展示错误文案。
    const restoredDialog = await screen.findByRole("dialog", {
      name: "Run Issue #1",
    });
    expect(
      within(restoredDialog).getByText(
        "Agent Session 启动将在 Story 2.3 接入。",
      ),
    ).toBeInTheDocument();
  });

  it("enables target branch selection in worktree mode and submits the chosen branch", async () => {
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

    const { dialog } = await openExistingIssueRunDialog(user);
    await selectShadcnOption(
      user,
      within(dialog),
      "Development mode",
      "Worktree",
    );
    await selectShadcnOption(user, within(dialog), "Target branch", "develop");
    expect(
      within(dialog).getByRole("combobox", { name: "Target branch" }),
    ).toBeEnabled();

    await user.click(within(dialog).getByRole("button", { name: "Start" }));

    expect(startAgentSessionMock).toHaveBeenCalledWith({
      projectId: 1,
      issueId: 20,
      agentProfileId: 100,
      promptSnapshot: existingIssueRunPrompt,
      workspaceMode: "worktree",
      targetBranch: "develop",
      worktreeSetupCommand: "pnpm install",
    });
  }, 10_000);

  it("resets the worktree target branch to the current branch on reopen instead of remembering the previous selection", async () => {
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

    await user.click(
      within(dialog).getByRole("button", { name: "Close run dialog" }),
    );

    ({ dialog } = await openExistingIssueRunDialog(user));
    expect(within(dialog).getByLabelText("Development mode")).toHaveTextContent(
      "Worktree",
    );
    expect(within(dialog).getByLabelText("Target branch")).toHaveTextContent(
      "main",
    );
  });

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
          number: 301,
          projectId: 1,
          issueId: existingIssue.id,
          issueNumber: existingIssue.number,
          issueTitle: existingIssue.title,
          issueStatus: "completed",
          agentProfileId: projectProfile.id,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          title: null,
          agentType: "codex",
          status: "closed",
          attention: "none",
          isTurnRunning: false,
          workspaceMode: "worktree",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/redwhisk/session.log",
          latestOutput: null,
          lastActiveAt: 1_780_632_000_000,
          startedAt: 1_780_632_000_000,
          closedAt: 1_780_633_000_000,
          processingMs: 0,
          lastOutputAt: null,
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

    // 失败后 Run Dialog 重新显示（保留表单状态供重试），LoadingDialog 关闭。
    const restoredDialog = await screen.findByRole("dialog", {
      name: "Run Issue #1",
    });
    expect(
      within(restoredDialog).getByText("Agent 启动失败。"),
    ).toBeInTheDocument();
    const restoredStartButton = within(restoredDialog).getByRole("button", {
      name: "Start",
    });
    await waitFor(() => expect(restoredStartButton).toBeEnabled());

    await user.click(restoredStartButton);

    expect(startAgentSessionMock).toHaveBeenCalledTimes(2);
  });

  it("shows a blocking loading dialog while starting and hides the run dialog", async () => {
    const user = userEvent.setup();
    const pendingStart = createDeferred<StartAgentSessionResult>();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return { profiles: [projectProfile] };
      }

      return { profiles: [globalProfile] };
    });
    startAgentSessionMock.mockReturnValue(pendingStart.promise);

    renderIssuesActivity();

    const { dialog } = await openExistingIssueRunDialog(user);
    const startButton = within(dialog).getByRole("button", { name: "Start" });
    await user.click(startButton);

    expect(startAgentSessionMock).toHaveBeenCalledTimes(1);

    // 启动期间 Run Dialog 被隐藏，改为显示阻塞式 LoadingDialog，避免两个 overlay
    // 共存造成冲突（见 4df1948）。LoadingDialog 不可关闭（dismissible=false）。
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Run Issue #1" }),
      ).not.toBeInTheDocument(),
    );
    const loadingDialog = await screen.findByRole("dialog");
    expect(loadingDialog).toHaveTextContent("Starting agent session...");
    expect(
      screen.queryByRole("button", { name: "Close run dialog" }),
    ).not.toBeInTheDocument();

    // 启动期间重复点击不会再次触发 startAgentSession。
    await user.click(loadingDialog);
    expect(startAgentSessionMock).toHaveBeenCalledTimes(1);

    pendingStart.resolve({ sessionId: 301, issueId: existingIssue.id });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
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
        screen.queryByRole("dialog", { name: "Run Issue #1" }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(listIssuesMock).toHaveBeenCalledTimes(2));
    expect(onOpenAgentsActivity).toHaveBeenCalledWith(301);
  });

  it("returns issue edit page to kanban before opening started session", async () => {
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
    expect(
      screen.getByRole("form", { name: "Edit Issue" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Run" }));
    await user.click(
      within(
        screen.getByRole("dialog", { name: "Are you sure you want to run?" }),
      ).getByRole("button", { name: "Confirm" }),
    );
    await user.click(
      within(
        await screen.findByRole("dialog", { name: "Run Issue #1" }),
      ).getByRole("button", { name: "Start" }),
    );

    await waitFor(() => expect(onOpenAgentsActivity).toHaveBeenCalledWith(301));
    expect(
      screen.queryByRole("form", { name: "Edit Issue" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Issues kanban" }),
    ).toBeInTheDocument();
  });

  it("saves edited issue content before running from edit page", async () => {
    const user = userEvent.setup();
    const updatedIssue: IssueRecord = {
      ...existingIssue,
      title: "Updated issue",
      description: "Updated description",
      updatedAt: 1_780_640_000_000,
    };
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });
    updateIssueMock.mockResolvedValue(updatedIssue);
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return { profiles: [projectProfile] };
      }

      return { profiles: [] };
    });
    startAgentSessionMock.mockResolvedValue({
      sessionId: 301,
      issueId: existingIssue.id,
    });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );
    const editPage = screen.getByRole("form", { name: "Edit Issue" });
    await user.clear(within(editPage).getByLabelText("Title"));
    await user.type(within(editPage).getByLabelText("Title"), "Updated issue");
    await user.clear(within(editPage).getByLabelText("Description"));
    await user.type(
      within(editPage).getByLabelText("Description"),
      "Updated description",
    );

    await user.click(within(editPage).getByRole("button", { name: "Run" }));
    await user.click(
      within(
        screen.getByRole("dialog", { name: "Are you sure you want to run?" }),
      ).getByRole("button", { name: "Confirm" }),
    );

    await waitFor(() =>
      expect(updateIssueMock).toHaveBeenCalledWith({
        projectId: 1,
        issueId: existingIssue.id,
        title: "Updated issue",
        description: "Updated description",
        attachments: [],
        labelIds: [301],
      }),
    );
    const runDialog = await screen.findByRole("dialog", {
      name: "Run Issue #1",
    });
    expect(within(runDialog).getByLabelText("Final prompt")).toHaveValue(
      ["using skill bmad-dev-story for task:", "Updated description"].join(
        "\n\n",
      ),
    );

    expect(startAgentSessionMock).not.toHaveBeenCalled();
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
        screen.queryByRole("dialog", { name: "Run Issue #1" }),
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
          number: 301,
          projectId: 1,
          issueId: 19,
          issueNumber: 19,
          issueTitle: "Previous issue",
          issueStatus: "running",
          agentProfileId: 200,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          title: null,
          agentType: "codex",
          status: "closed",
          attention: "none",
          isTurnRunning: false,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/run.log",
          latestOutput: null,
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: 1_780_639_000_000,
          processingMs: 0,
          lastOutputAt: null,
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

  it("defaults to no workflow skill when issue labels have no configured workflow skill", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({
      issues: [
        {
          ...existingIssue,
          labels: [
            { ...projectLabel, workflowSkill: null },
            { ...globalLabel, workflowSkill: null },
          ],
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
    expect(within(dialog).getByLabelText("Workflow skill")).toHaveTextContent(
      "None",
    );
    expect(within(dialog).getByLabelText("Final prompt")).toHaveValue(
      existingIssueRunPromptWithoutSkill,
    );
  });

  it("defaults to the first workflow skill configured by issue labels", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({
      issues: [
        {
          ...existingIssue,
          labels: [
            { ...projectLabel, workflowSkill: null },
            { ...globalLabel, workflowSkill: "skill-b" },
          ],
        },
      ],
    });
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return { profiles: [projectProfile] };
      }

      return { profiles: [globalProfile] };
    });
    listSavedAgentSkillsMock.mockResolvedValue({
      skills: [
        {
          id: 1,
          name: "skill-a",
          scope: "global",
          projectId: null,
          skillPaths: [
            {
              agentType: "codex",
              path: "/home/me/.agents/skills/skill-a/SKILL.md",
            },
          ],
        },
        {
          id: 2,
          name: "skill-b",
          scope: "global",
          projectId: null,
          skillPaths: [
            {
              agentType: "codex",
              path: "/home/me/.agents/skills/skill-b/SKILL.md",
            },
          ],
        },
      ],
    });

    renderIssuesActivity();

    const { dialog } = await openExistingIssueRunDialog(user);
    expect(within(dialog).getByLabelText("Workflow skill")).toHaveTextContent(
      "skill-b",
    );
    expect(within(dialog).getByLabelText("Final prompt")).toHaveValue(
      ["using skill skill-b for task:", "Existing description"].join("\n\n"),
    );
  });

  it("defaults to the workflow skill configured by issue labels when matched by saved skills", async () => {
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
    expect(within(dialog).getByLabelText("Workflow skill")).toHaveTextContent(
      "bmad-dev-story",
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
      screen.queryByRole("dialog", { name: "Run Issue #1" }),
    ).not.toBeInTheDocument();
    expect(runButton).toHaveFocus();
    expect(startAgentSessionMock).not.toHaveBeenCalled();
  });

  it("restores the run dialog and shows the failure message when start fails", async () => {
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

    // 失败后 Run Dialog 重新显示（保留表单状态），并展示错误文案。
    const restoredDialog = await screen.findByRole("dialog", {
      name: "Run Issue #1",
    });
    expect(
      within(restoredDialog).getByText(
        "Agent Session 启动将在 Story 2.3 接入。",
      ),
    ).toBeInTheDocument();
    expect(updateIssueMock).not.toHaveBeenCalled();
  });

  it("shows a non-dismissible loading dialog while starting the issue", async () => {
    const user = userEvent.setup();
    let resolveStart: (value: StartAgentSessionResult) => void = () => {};
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return { profiles: [projectProfile] };
      }

      return { profiles: [] };
    });
    startAgentSessionMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve;
        }),
    );

    renderIssuesActivity();

    const { dialog } = await openExistingIssueRunDialog(user);
    const startButton = within(dialog).getByRole("button", { name: "Start" });
    await user.click(startButton);

    // 启动期间 Run Dialog 隐藏，LoadingDialog 接管；重复点击不会再次触发请求。
    const loadingDialog = await screen.findByRole("dialog");
    await user.click(loadingDialog);
    expect(startAgentSessionMock).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Close run dialog" }),
    ).not.toBeInTheDocument();

    resolveStart({ issueId: existingIssue.id, sessionId: 301 });
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
      within(screen.getByRole("dialog", { name: "Run Issue #1" })).getByRole(
        "button",
        { name: "Start" },
      ),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Run Issue #1" }),
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
    await user.click(within(dialog).getByRole("button", { name: "Run" }));
    await user.click(
      within(
        screen.getByRole("dialog", { name: "Are you sure you want to run?" }),
      ).getByRole("button", { name: "Confirm" }),
    );

    const runDialog = await screen.findByRole("dialog", {
      name: "Run Issue #1",
    });
    expect(
      within(runDialog).getByText(
        "No Agent Profile is available for the current agent type.",
      ),
    ).toBeInTheDocument();
  });

  it("confirms before running an issue from the edit page header", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return { profiles: [projectProfile] };
      }

      return { profiles: [] };
    });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );

    const page = screen.getByRole("form", { name: "Edit Issue" });
    const backButton = within(page).getByRole("button", { name: "Back" });
    const runButton = within(page).getByRole("button", { name: "Run" });

    expect(
      Array.from(
        backButton.parentElement?.querySelectorAll("button") ?? [],
      ).slice(0, 2),
    ).toEqual([backButton, runButton]);

    await user.click(runButton);

    const confirmation = screen.getByRole("dialog", {
      name: "Are you sure you want to run?",
    });
    expect(
      within(confirmation).getByText("Are you sure you want to run?"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "Run Issue #1" }),
    ).not.toBeInTheDocument();

    await user.click(
      within(confirmation).getByRole("button", { name: "Confirm" }),
    );

    expect(
      await screen.findByRole("dialog", { name: "Run Issue #1" }),
    ).toBeInTheDocument();
  });

  it("previews and downloads a draft attachment from the issue page", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [] });
    openDialogMock.mockResolvedValue("/tmp/tsconfig.json");
    previewIssueAttachmentMock.mockResolvedValue({
      attachmentId: null,
      displayName: "tsconfig.json",
      kind: "text",
      isPreviewable: true,
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
      sourcePath:
        "/Users/yujianjia/.redwhisk/issue-attachment-drafts/tsconfig.json",
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
      sourcePath:
        "/Users/yujianjia/.redwhisk/issue-attachment-drafts/tsconfig.json",
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

  it("clears the cached read-only page when opening the linked session so the kanban shows on return", async () => {
    const user = userEvent.setup();
    const onOpenAgentsActivity = vi.fn();
    listIssuesMock.mockResolvedValue({ issues: [completedLinkedSessionIssue] });
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 401,
          number: 401,
          projectId: 1,
          issueId: completedLinkedSessionIssue.id,
          issueNumber: completedLinkedSessionIssue.number,
          issueTitle: completedLinkedSessionIssue.title,
          issueStatus: "completed",
          agentProfileId: projectProfile.id,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          title: null,
          agentType: "codex",
          status: "closed",
          attention: "none",
          isTurnRunning: false,
          workspaceMode: "worktree",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/completed.log",
          latestOutput: null,
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_636_000_000,
          closedAt: 1_780_637_000_000,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    // 模拟从只读 Issue 页跳转 session 页面：父组件同步卸载 IssuesActivity，
    // 依赖 dialogMode 变化的缓存清理 effect 不会执行，必须由 openLinkedSession
    // 同步清缓存，否则返回 issues 标签时会复现只读 Issue 页而非看板。
    const view = renderIssuesActivity({ onOpenAgentsActivity });
    onOpenAgentsActivity.mockImplementation(() => {
      view.unmount();
    });

    await user.click(
      await screen.findByRole("button", {
        name: "Completed linked session issue",
      }),
    );
    const dialog = screen.getByRole("region", { name: "Issue Detail" });
    const sessionPanel = within(dialog).getByRole("complementary", {
      name: "Session info",
    });
    await user.click(
      await within(sessionPanel).findByRole("button", { name: "View Session" }),
    );

    expect(onOpenAgentsActivity).toHaveBeenCalledWith(401);

    // 重新挂载 IssuesActivity 模拟回到 issues 标签：缓存应已清空，回到看板。
    renderIssuesActivity({ onOpenAgentsActivity });
    expect(
      await screen.findByRole("region", { name: "Issues kanban" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Issue Detail" }),
    ).not.toBeInTheDocument();
  });

  it("allows backward status choices and completes a running issue after confirmation", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [attentionIssue] });
    markIssueReviewMock.mockResolvedValueOnce({
      ...attentionIssue,
      status: "review",
      updatedAt: attentionIssue.updatedAt + 1_000,
    });
    completeIssueFlowMock.mockResolvedValueOnce(
      completedFlowResult({
        ...attentionIssue,
        status: "completed",
        linkedSessionStatus: "closed",
        updatedAt: attentionIssue.updatedAt + 2_000,
      }),
    );

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

    expect(screen.getByRole("menuitem", { name: "Backlog" })).toBeEnabled();
    expect(
      screen.getByRole("menuitem", { name: "In Progress" }),
    ).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Review" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Done" })).toBeEnabled();

    await user.click(screen.getByRole("menuitem", { name: "Done" }));

    expect(
      screen.getByRole("dialog", {
        name: "This issue is still running. Mark it as completed?",
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(markIssueReviewMock).toHaveBeenCalledWith({
        projectId: 1,
        issueId: attentionIssue.id,
      }),
    );
    await waitFor(() =>
      expect(completeIssueFlowMock).toHaveBeenCalledWith({
        projectId: 1,
        issueId: attentionIssue.id,
        dirtyDecision: null,
        branchName: null,
        actualPath: null,
        continueAfterCommit: null,
        worktreeCleanupDecision: null,
      }),
    );
    expect(
      await screen.findByRole("region", { name: "Issue Detail" }),
    ).toBeInTheDocument();
  });

  it("confirms before moving an issue backward to a non-backlog status", async () => {
    const user = userEvent.setup();
    const reviewWithClosedSession: IssueRecord = {
      ...reviewIssue,
      linkedSessionId: 601,
      linkedSessionStatus: "closed",
      linkedSessionAttention: "none",
    };
    listIssuesMock.mockResolvedValue({ issues: [reviewWithClosedSession] });
    advanceIssueStatusMock.mockResolvedValueOnce({
      ...reviewWithClosedSession,
      status: "running",
      updatedAt: reviewWithClosedSession.updatedAt + 1_000,
    });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Review issue" }),
    );
    const dialog = screen.getByRole("region", { name: "Issue Detail" });
    await user.click(
      within(dialog).getByRole("button", { name: "Open status options" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "In Progress" }));

    expect(
      screen.getByRole("dialog", {
        name: "Move this issue back to In Progress?",
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(advanceIssueStatusMock).toHaveBeenCalledWith({
        projectId: 1,
        issueId: reviewWithClosedSession.id,
        targetStatus: "running",
      }),
    );
  });

  it("shows a blocking loading dialog while advancing status and hides it when done", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [runningIssue] });
    const pendingAdvance =
      createDeferred<Awaited<ReturnType<typeof advanceIssueStatus>>>();
    advanceIssueStatusMock.mockReturnValue(pendingAdvance.promise);

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Running issue" }),
    );
    const detail = screen.getByRole("region", { name: "Issue Detail" });
    await user.click(
      within(detail).getByRole("button", { name: "Open status options" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Review" }));

    expect(advanceIssueStatusMock).toHaveBeenCalledTimes(1);
    const loadingDialog = await screen.findByRole("dialog");
    expect(loadingDialog).toHaveTextContent("Updating status...");

    pendingAdvance.resolve({
      ...runningIssue,
      status: "review",
      updatedAt: runningIssue.updatedAt + 1_000,
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("shows read-only status transition command failures in alert dialog", async () => {
    const user = userEvent.setup();
    const reviewWithClosedSession: IssueRecord = {
      ...reviewIssue,
      linkedSessionId: 601,
      linkedSessionStatus: "closed",
      linkedSessionAttention: "none",
    };
    const errorMessage = "只有运行中的 Issue 可以标记待验收。";
    listIssuesMock.mockResolvedValue({ issues: [reviewWithClosedSession] });
    advanceIssueStatusMock.mockRejectedValueOnce({
      code: "ISSUE_VALIDATION_FAILED",
      message: errorMessage,
    });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Review issue" }),
    );
    const dialog = screen.getByRole("region", { name: "Issue Detail" });
    await user.click(
      within(dialog).getByRole("button", { name: "Open status options" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "In Progress" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(
      await screen.findByRole("dialog", { name: errorMessage }),
    ).toBeInTheDocument();
    expect(document.querySelector(".issues-status")).not.toBeInTheDocument();
  });

  it("asks to terminate the running session before returning an issue to backlog", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [attentionIssue] });
    advanceIssueStatusMock.mockResolvedValueOnce({
      ...attentionIssue,
      status: "backlog",
      linkedSessionId: null,
      linkedSessionStatus: null,
      linkedSessionAttention: null,
      updatedAt: attentionIssue.updatedAt + 1_000,
    });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Attention issue" }),
    );
    const dialog = screen.getByRole("region", { name: "Issue Detail" });
    await user.click(
      within(dialog).getByRole("button", { name: "Open status options" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Backlog" }));

    expect(
      screen.getByRole("dialog", {
        name: "This issue is still running. Stop it and return it to Backlog?",
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(advanceIssueStatusMock).toHaveBeenCalledWith({
        projectId: 1,
        issueId: attentionIssue.id,
        targetStatus: "backlog",
      }),
    );
  });

  it("asks to delete the same-name worktree before returning to backlog and deletes on confirm", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [attentionIssue] });
    getIssueWorktreeStatusMock.mockResolvedValue({
      exists: true,
      canDelete: true,
      workspacePath: "/tmp/redwhisk/worktrees/issue-27",
      workspaceBranch: "issue-27",
    });
    advanceIssueStatusMock.mockResolvedValueOnce({
      ...attentionIssue,
      status: "backlog",
      linkedSessionId: null,
      linkedSessionStatus: null,
      linkedSessionAttention: null,
      updatedAt: attentionIssue.updatedAt + 1_000,
    });
    deleteIssueWorktreeMock.mockResolvedValueOnce({
      issueId: attentionIssue.id,
      deleted: true,
      workspacePath: "/tmp/redwhisk/worktrees/issue-27",
    });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Attention issue" }),
    );
    const dialog = screen.getByRole("region", { name: "Issue Detail" });
    await user.click(
      within(dialog).getByRole("button", { name: "Open status options" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Backlog" }));

    // 第一步：确认终止并退回 Backlog
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    // 第二步：同名 worktree 删除询问，确认删除
    await screen.findByRole("dialog", { name: "Same-name worktree exists" });
    await user.click(screen.getByRole("button", { name: "Delete worktree" }));

    await waitFor(() =>
      expect(advanceIssueStatusMock).toHaveBeenCalledWith({
        projectId: 1,
        issueId: attentionIssue.id,
        targetStatus: "backlog",
      }),
    );
    expect(deleteIssueWorktreeMock).toHaveBeenCalledWith({
      projectId: 1,
      issueId: attentionIssue.id,
    });
  });

  it("keeps the residual worktree when the user declines deletion on return to backlog", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [attentionIssue] });
    getIssueWorktreeStatusMock.mockResolvedValue({
      exists: true,
      canDelete: true,
      workspacePath: "/tmp/redwhisk/worktrees/issue-27",
      workspaceBranch: "issue-27",
    });
    advanceIssueStatusMock.mockResolvedValueOnce({
      ...attentionIssue,
      status: "backlog",
      linkedSessionId: null,
      linkedSessionStatus: null,
      linkedSessionAttention: null,
      updatedAt: attentionIssue.updatedAt + 1_000,
    });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Attention issue" }),
    );
    const dialog = screen.getByRole("region", { name: "Issue Detail" });
    await user.click(
      within(dialog).getByRole("button", { name: "Open status options" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Backlog" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await screen.findByRole("dialog", { name: "Same-name worktree exists" });
    // 选择保留：仅退回状态，不删除 worktree
    await user.click(screen.getByRole("button", { name: "Keep" }));

    await waitFor(() =>
      expect(advanceIssueStatusMock).toHaveBeenCalledWith({
        projectId: 1,
        issueId: attentionIssue.id,
        targetStatus: "backlog",
      }),
    );
    expect(deleteIssueWorktreeMock).not.toHaveBeenCalled();
  });

  it("returns to the board after switching an issue back to backlog", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [reviewIssue] });
    advanceIssueStatusMock.mockResolvedValueOnce({
      ...reviewIssue,
      status: "backlog",
      updatedAt: reviewIssue.updatedAt + 1_000,
    });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Review issue" }),
    );
    const dialog = screen.getByRole("region", { name: "Issue Detail" });
    await user.click(
      within(dialog).getByRole("button", { name: "Open status options" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Backlog" }));

    // 退回 Backlog 需要二次确认。
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(advanceIssueStatusMock).toHaveBeenCalledWith({
        projectId: 1,
        issueId: reviewIssue.id,
        targetStatus: "backlog",
      }),
    );
    // 退回待办后直接回到看板：不应停留在只读页，也不应翻转为编辑页。
    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "Issue Detail" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("form", { name: "Edit Issue" }),
      ).not.toBeInTheDocument();
    });
    const backlogLane = screen.getByRole("region", { name: "Backlog" });
    expect(
      within(backlogLane).getByRole("button", { name: "Review issue" }),
    ).toBeInTheDocument();
  });

  it("blocks running when a same-name worktree already exists", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return { profiles: [projectProfile] };
      }

      return { profiles: [globalProfile] };
    });
    getIssueWorktreeStatusMock.mockResolvedValue({
      exists: true,
      canDelete: true,
      workspacePath: "/tmp/redwhisk/worktrees/issue-20",
      workspaceBranch: "issue-20",
    });

    renderIssuesActivity();

    const { dialog } = await openExistingIssueRunDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Start" }));

    expect(startAgentSessionMock).not.toHaveBeenCalled();
    // worktree 占用检查失败后 Run Dialog 重新显示并提示用户。
    const restoredDialog = await screen.findByRole("dialog", {
      name: "Run Issue #1",
    });
    expect(
      within(restoredDialog).getByText(
        "A same-name worktree already exists. Delete it before running.",
      ),
    ).toBeInTheDocument();
  });

  it("moves an inactive issue to completed without the extra running-session confirmation", async () => {
    const user = userEvent.setup();
    const reviewWithClosedSession: IssueRecord = {
      ...reviewIssue,
      linkedSessionId: 602,
      linkedSessionStatus: "closed",
      linkedSessionAttention: "none",
    };
    listIssuesMock.mockResolvedValue({ issues: [reviewWithClosedSession] });
    completeIssueFlowMock.mockResolvedValueOnce(
      completedFlowResult({
        ...reviewWithClosedSession,
        status: "completed",
        updatedAt: reviewWithClosedSession.updatedAt + 1_000,
      }),
    );

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Review issue" }),
    );
    const dialog = screen.getByRole("region", { name: "Issue Detail" });
    await user.click(
      within(dialog).getByRole("button", { name: "Open status options" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Done" }));

    await waitFor(() =>
      expect(completeIssueFlowMock).toHaveBeenCalledWith({
        projectId: 1,
        issueId: reviewWithClosedSession.id,
        dirtyDecision: null,
        branchName: null,
        actualPath: null,
        continueAfterCommit: null,
        worktreeCleanupDecision: null,
      }),
    );
    expect(
      screen.queryByRole("dialog", {
        name: "This issue is still running. Mark it as completed?",
      }),
    ).not.toBeInTheDocument();
  });

  it("blocks Done when related dirty files exist and shows the dirty workspace dialog", async () => {
    const user = userEvent.setup();
    const reviewWithSession = {
      ...reviewIssue,
      linkedSessionId: 504,
      linkedSessionStatus: "running" as const,
      linkedSessionAttention: "none" as const,
    };
    listIssuesMock.mockResolvedValue({ issues: [reviewWithSession] });
    completeIssueFlowMock
      .mockResolvedValueOnce({
        action: "prompt_dirty_decision",
        issue: reviewWithSession,
        flow: null,
        message: "当前工作区存在未提交改动，请选择处理方式。",
        mergeBlockReason: null,
        targetBranch: null,
        workspaceBranch: null,
        workspacePath: null,
        actualPath: null,
        drifted: false,
        sessionId: 504,
      })
      .mockResolvedValueOnce({
        action: "cancelled",
        issue: reviewWithSession,
        flow: null,
        message: "完成已取消，Issue 保持待验收。",
        mergeBlockReason: null,
        targetBranch: null,
        workspaceBranch: null,
        workspacePath: null,
        actualPath: null,
        drifted: false,
        sessionId: 504,
      });

    renderIssuesActivity({});

    await user.click(
      await screen.findByRole("button", { name: "Review issue" }),
    );
    const dialog = screen.getByRole("region", { name: "Issue Detail" });
    await user.click(
      within(dialog).getByRole("button", { name: "Open status options" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Done" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(completeIssueManualMock).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("dialog", { name: "Uncommitted changes" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
  });

  it("continues completion when dirty changes are skipped", async () => {
    const user = userEvent.setup();
    const reviewWithSession = {
      ...reviewIssue,
      linkedSessionId: 514,
      linkedSessionStatus: "running" as const,
      linkedSessionAttention: "none" as const,
    };
    listIssuesMock.mockResolvedValue({ issues: [reviewWithSession] });
    completeIssueFlowMock
      .mockResolvedValueOnce({
        action: "prompt_dirty_decision",
        issue: reviewWithSession,
        flow: null,
        message: "当前工作区存在未提交改动，请确认是否继续完成。",
        mergeBlockReason: null,
        targetBranch: null,
        workspaceBranch: null,
        workspacePath: null,
        actualPath: null,
        drifted: false,
        sessionId: 514,
      })
      .mockResolvedValueOnce(
        completedFlowResult({
          ...reviewWithSession,
          status: "completed",
          linkedSessionStatus: "closed",
          updatedAt: reviewWithSession.updatedAt + 1_000,
        }),
      );

    renderIssuesActivity({});

    await user.click(
      await screen.findByRole("button", { name: "Review issue" }),
    );
    const dialog = screen.getByRole("region", { name: "Issue Detail" });
    await user.click(
      within(dialog).getByRole("button", { name: "Open status options" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Done" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await user.click(
      await screen.findByRole("button", { name: "Complete without commit" }),
    );

    await waitFor(() =>
      expect(completeIssueFlowMock).toHaveBeenLastCalledWith({
        projectId: 1,
        issueId: reviewWithSession.id,
        dirtyDecision: "skip",
        branchName: null,
        actualPath: null,
        continueAfterCommit: null,
        worktreeCleanupDecision: null,
      }),
    );
    expect(
      await screen.findByRole("region", { name: "Issue Detail" }),
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
    completeIssueFlowMock
      .mockResolvedValueOnce({
        action: "confirm_worktree_cleanup",
        issue: reviewWithSession,
        flow: null,
        message: "需要确认外部 worktree。",
        mergeBlockReason: null,
        targetBranch: "dev",
        workspaceBranch: "issue-505",
        workspacePath: "/tmp/worktrees/issue-505",
        actualPath: null,
        drifted: false,
        sessionId: 505,
      })
      .mockResolvedValueOnce(
        completedFlowResult({
          ...reviewWithSession,
          status: "completed",
          linkedSessionStatus: "closed",
          updatedAt: reviewWithSession.updatedAt + 1_000,
        }),
      );

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Review issue" }),
    );
    const dialog = screen.getByRole("region", { name: "Issue Detail" });
    await user.click(
      within(dialog).getByRole("button", { name: "Open status options" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Done" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(
      screen.getByRole("dialog", {
        name: "Delete worktree",
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(completeIssueFlowMock).toHaveBeenLastCalledWith({
        projectId: 1,
        issueId: reviewWithSession.id,
        dirtyDecision: null,
        branchName: null,
        actualPath: null,
        continueAfterCommit: null,
        worktreeCleanupDecision: true,
      }),
    );
  });

  it("supports keeping the worktree when completing an external worktree issue", async () => {
    const user = userEvent.setup();
    const reviewWithSession = {
      ...reviewIssue,
      linkedSessionId: 515,
      linkedSessionStatus: "running" as const,
      linkedSessionAttention: "none" as const,
    };
    listIssuesMock.mockResolvedValue({ issues: [reviewWithSession] });
    completeIssueFlowMock
      .mockResolvedValueOnce({
        action: "confirm_worktree_cleanup",
        issue: reviewWithSession,
        flow: null,
        message: "代码已提交至 dev。是否删除当前 worktree？",
        mergeBlockReason: null,
        targetBranch: "dev",
        workspaceBranch: "issue-515",
        workspacePath: "/tmp/worktrees/issue-515",
        actualPath: null,
        drifted: false,
        sessionId: 515,
      })
      .mockResolvedValueOnce(
        completedFlowResult({
          ...reviewWithSession,
          status: "completed",
          linkedSessionStatus: "closed",
          updatedAt: reviewWithSession.updatedAt + 1_000,
        }),
      );

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Review issue" }),
    );
    const dialog = screen.getByRole("region", { name: "Issue Detail" });
    await user.click(
      within(dialog).getByRole("button", { name: "Open status options" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Done" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    // 保留 worktree（不删除）→ worktreeCleanupDecision=false → 完成。
    expect(
      await screen.findByRole("dialog", { name: "Delete worktree" }),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Keep" }));

    await waitFor(() =>
      expect(completeIssueFlowMock).toHaveBeenLastCalledWith({
        projectId: 1,
        issueId: reviewWithSession.id,
        dirtyDecision: null,
        branchName: null,
        actualPath: null,
        continueAfterCommit: null,
        worktreeCleanupDecision: false,
      }),
    );
    expect(
      await screen.findByRole("region", { name: "Issue Detail" }),
    ).toBeInTheDocument();
  });

  it("shows dismissible loading dialog while completing from the issue detail page", async () => {
    const user = userEvent.setup();
    const reviewWithSession = {
      ...reviewIssue,
      linkedSessionId: 517,
      linkedSessionStatus: "running" as const,
      linkedSessionAttention: "none" as const,
    };
    const completion =
      createDeferred<Awaited<ReturnType<typeof completeIssueFlow>>>();
    listIssuesMock.mockResolvedValue({ issues: [reviewWithSession] });
    completeIssueFlowMock.mockReturnValueOnce(completion.promise);

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Review issue" }),
    );
    const dialog = screen.getByRole("region", { name: "Issue Detail" });
    await user.click(
      within(dialog).getByRole("button", { name: "Open status options" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Done" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(
      await screen.findByRole("dialog", { name: "Submitting..." }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Close completion progress" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Submitting..." }),
    ).not.toBeInTheDocument();

    completion.resolve(
      completedFlowResult({
        ...reviewWithSession,
        status: "completed",
        linkedSessionStatus: "closed",
        updatedAt: reviewWithSession.updatedAt + 1_000,
      }),
    );

    expect(
      await screen.findByRole("region", { name: "Issue Detail" }),
    ).toBeInTheDocument();
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
    completeIssueFlowMock.mockResolvedValueOnce({
      action: "blocked",
      issue: reviewWithSession,
      flow: null,
      message: "Agent worktree 合并被阻止，请手动处理冲突。",
      mergeBlockReason: "merge_conflict",
      targetBranch: "dev",
      workspaceBranch: "issue-506",
      workspacePath: "/tmp/worktrees/issue-506",
      actualPath: null,
      drifted: false,
      sessionId: 506,
    });
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
    await user.click(screen.getByRole("button", { name: "Confirm" }));

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
    // resume 必须在 inject 之前被调用，以保证 session 在 agent_registry 中有 handle。
    expect(resumeStructuredAgentSessionMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 506,
    });
    expect(onOpenAgentsActivity).toHaveBeenCalledWith(506);
    expect(
      screen.queryByRole("dialog", { name: "Complete issue" }),
    ).not.toBeInTheDocument();
  });

  it("surfaces resume failure instead of silently swallowing it during merge handoff", async () => {
    const user = userEvent.setup();
    const onOpenAgentsActivity = vi.fn();
    const reviewWithSession = {
      ...reviewIssue,
      linkedSessionId: 526,
      linkedSessionStatus: "running" as const,
      linkedSessionAttention: "none" as const,
    };
    listIssuesMock.mockResolvedValue({ issues: [reviewWithSession] });
    completeIssueFlowMock.mockResolvedValueOnce({
      action: "blocked",
      issue: reviewWithSession,
      flow: null,
      message: "Agent worktree 合并被阻止，请手动处理冲突。",
      mergeBlockReason: "merge_conflict",
      targetBranch: "dev",
      workspaceBranch: "issue-526",
      workspacePath: "/tmp/worktrees/issue-526",
      actualPath: null,
      drifted: false,
      sessionId: 526,
    });
    // resume 重建 handle 失败（如工作区丢失）→ 不应静默吞掉后继续 inject。
    resumeStructuredAgentSessionMock.mockRejectedValueOnce({
      code: "RESUME_FAILURE_TEST",
      message: "resume workspace missing",
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
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    // resume 失败 → 具体错误展示在对话框，inject 不被调用，不跳转 agents activity。
    expect(
      await screen.findByText("resume workspace missing"),
    ).toBeInTheDocument();
    expect(injectAgentSessionPromptMock).not.toHaveBeenCalled();
    expect(onOpenAgentsActivity).not.toHaveBeenCalled();
  });

  it("shows the specific worktree merge blocker instead of handing non-conflicts to the agent", async () => {
    const user = userEvent.setup();
    const onOpenAgentsActivity = vi.fn();
    const reviewWithSession = {
      ...reviewIssue,
      linkedSessionId: 516,
      linkedSessionStatus: "running" as const,
      linkedSessionAttention: "none" as const,
    };
    listIssuesMock.mockResolvedValue({ issues: [reviewWithSession] });
    completeIssueFlowMock.mockResolvedValueOnce({
      action: "blocked",
      issue: reviewWithSession,
      flow: null,
      message:
        "目标分支工作区存在未提交改动，无法合入 Agent worktree。请先在目标分支工作区提交、暂存或丢弃这些改动：base.txt。",
      mergeBlockReason: "target_worktree_dirty",
      targetBranch: "dev",
      workspaceBranch: "issue-516",
      workspacePath: "/tmp/worktrees/issue-516",
      actualPath: null,
      drifted: false,
      sessionId: 516,
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
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(
      await screen.findByText(/目标分支工作区存在未提交改动/),
    ).toBeInTheDocument();
    expect(injectAgentSessionPromptMock).not.toHaveBeenCalled();
    expect(onOpenAgentsActivity).not.toHaveBeenCalled();
  });

  it("soft deletes an issue after confirmation and removes it from the list", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue, runningIssue] });
    deleteIssueMock.mockResolvedValue({
      issueId: runningIssue.id,
      linkedSessionId: null,
    });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", {
        name: "Running issue",
      }),
    );

    const dialog = screen.getByRole("region", { name: "Issue Detail" });
    await openIssueMoreMenu(user, dialog);
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    expect(
      screen.getByRole("dialog", {
        name: "This cannot be undone. Delete the current Issue?",
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

  it("shows a blocking loading dialog while deleting and hides it when done", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue, runningIssue] });
    const pendingDelete =
      createDeferred<Awaited<ReturnType<typeof deleteIssue>>>();
    deleteIssueMock.mockReturnValue(pendingDelete.promise);

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );
    const form = screen.getByRole("form", { name: "Edit Issue" });
    await user.click(within(form).getByRole("button", { name: "Delete" }));
    const deleteDialog = screen.getByRole("dialog", {
      name: "This cannot be undone. Delete the current Issue?",
    });
    await user.click(
      within(deleteDialog).getByRole("button", { name: "Delete" }),
    );

    expect(deleteIssueMock).toHaveBeenCalledTimes(1);
    const loadingDialog = await screen.findByRole("dialog");
    expect(loadingDialog).toHaveTextContent("Deleting...");

    pendingDelete.resolve({
      issueId: existingIssue.id,
      linkedSessionId: null,
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("Deleted successfully");
  });

  it("shows a delete button in the backlog edit page header and deletes the issue after dialog confirmation", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue, runningIssue] });
    deleteIssueMock.mockResolvedValue({
      issueId: existingIssue.id,
      linkedSessionId: null,
    });

    renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", {
        name: "Existing issue",
      }),
    );

    const dialog = screen.getByRole("form", { name: "Edit Issue" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    const deleteDialog = screen.getByRole("dialog", {
      name: "This cannot be undone. Delete the current Issue?",
    });
    expect(deleteDialog).toBeInTheDocument();
    await user.click(
      within(deleteDialog).getByRole("button", { name: "Delete" }),
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
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await user.click(
      within(
        screen.getByRole("dialog", {
          name: "This cannot be undone. Delete the current Issue?",
        }),
      ).getByRole("button", { name: "Back" }),
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
    await openIssueMoreMenu(user, dialog);
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    expect(
      screen.getByRole("dialog", {
        name: "This cannot be undone. Delete the current Issue?",
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: "This cannot be undone. Delete the current Issue?",
        }),
      ).not.toBeInTheDocument(),
    );
    expect(deleteIssueMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("region", { name: "Issue Detail" }),
    ).toBeInTheDocument();
  });

  it("renders dual-column read-only detail with session info and run parameters", async () => {
    const user = userEvent.setup();
    const onOpenAgentsActivity = vi.fn();
    listIssuesMock.mockResolvedValue({ issues: [completedLinkedSessionIssue] });
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 401,
          number: 401,
          projectId: 1,
          issueId: completedLinkedSessionIssue.id,
          issueNumber: completedLinkedSessionIssue.number,
          issueTitle: completedLinkedSessionIssue.title,
          issueStatus: "completed",
          agentProfileId: projectProfile.id,
          agentProfileName: projectProfile.name,
          workflowSkillName: "bmad-dev-story",
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          title: null,
          agentType: "codex",
          status: "closed",
          attention: "none",
          isTurnRunning: false,
          workspaceMode: "worktree",
          workingDir: "/tmp/worktrees/issue-25",
          workspacePath: "/tmp/worktrees/issue-25",
          originBranch: "main",
          workspaceBranch: "issue-25",
          worktreeOwner: "redwhisk",
          logPath: "/tmp/completed.log",
          latestOutput: null,
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_636_000_000,
          closedAt: 1_780_637_000_000,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    renderIssuesActivity({ onOpenAgentsActivity });

    await user.click(
      await screen.findByRole("button", {
        name: "Completed linked session issue",
      }),
    );

    const dialog = await screen.findByRole("region", { name: "Issue Detail" });
    const sessionPanel = within(dialog).getByRole("complementary", {
      name: "Session info",
    });

    expect(
      within(sessionPanel).getByRole("heading", { name: "Session info" }),
    ).toBeInTheDocument();
    expect(
      within(sessionPanel).getByRole("heading", { name: "Run parameters" }),
    ).toBeInTheDocument();
    expect(within(sessionPanel).getByText("Project Codex")).toBeInTheDocument();
    expect(
      within(sessionPanel).getByText("bmad-dev-story"),
    ).toBeInTheDocument();
    expect(
      within(sessionPanel).getByText(/Worktree \(issue-25\) issue-25/),
    ).toBeInTheDocument();

    await user.click(
      within(sessionPanel).getByRole("button", { name: "View Session" }),
    );
    expect(onOpenAgentsActivity).toHaveBeenCalledWith(401);
  });

  it("returns to the board from a read-only detail when the activity icon signal fires", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [runningIssue] });
    const { rerender } = renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: runningIssue.title }),
    );
    expect(
      screen.getByRole("region", { name: "Issue Detail" }),
    ).toBeInTheDocument();

    rerender(
      <I18nProvider>
        <IssuesActivity projectId={1} issuesReturnSignal={1} />
      </I18nProvider>,
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Issue Detail" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: runningIssue.title }),
    ).toBeInTheDocument();
  });

  it("returns from an unchanged edit page when the activity icon signal fires", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });
    const { rerender } = renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );
    expect(
      screen.getByRole("form", { name: "Edit Issue" }),
    ).toBeInTheDocument();

    rerender(
      <I18nProvider>
        <IssuesActivity projectId={1} issuesReturnSignal={1} />
      </I18nProvider>,
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("form", { name: "Edit Issue" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("keeps the edit page when the signal fires but the form has changes", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });
    const { rerender } = renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Changed title");

    rerender(
      <I18nProvider>
        <IssuesActivity projectId={1} issuesReturnSignal={1} />
      </I18nProvider>,
    );

    expect(
      screen.getByRole("form", { name: "Edit Issue" }),
    ).toBeInTheDocument();
  });

  it("returns from an unchanged create page when the signal fires", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [] });
    const { rerender } = renderIssuesActivity();

    await user.click(
      (await screen.findAllByRole("button", { name: "New Issue" }))[0],
    );
    expect(screen.getByRole("form", { name: "New Issue" })).toBeInTheDocument();

    rerender(
      <I18nProvider>
        <IssuesActivity projectId={1} issuesReturnSignal={1} />
      </I18nProvider>,
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("form", { name: "New Issue" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("keeps the create page when the signal fires but the form has changes", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [] });
    const { rerender } = renderIssuesActivity();

    await user.click(
      (await screen.findAllByRole("button", { name: "New Issue" }))[0],
    );
    await user.type(screen.getByLabelText("Title"), "Draft title");

    rerender(
      <I18nProvider>
        <IssuesActivity projectId={1} issuesReturnSignal={1} />
      </I18nProvider>,
    );

    expect(screen.getByRole("form", { name: "New Issue" })).toBeInTheDocument();
  });

  it("does nothing when the signal fires on the kanban board", async () => {
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });
    const { rerender } = renderIssuesActivity();

    await screen.findByRole("button", { name: "Existing issue" });

    rerender(
      <I18nProvider>
        <IssuesActivity projectId={1} issuesReturnSignal={1} />
      </I18nProvider>,
    );

    expect(
      screen.getByRole("button", { name: "Existing issue" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("form", { name: "Edit Issue" }),
    ).not.toBeInTheDocument();
  });

  it("ignores the activity icon signal while a save is in progress", async () => {
    const user = userEvent.setup();
    let resolveSave: (issue: IssueRecord) => void = () => {};
    updateIssueMock.mockImplementation(
      () =>
        new Promise<IssueRecord>((resolve) => {
          resolveSave = resolve;
        }),
    );
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });
    const { rerender } = renderIssuesActivity();

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    rerender(
      <I18nProvider>
        <IssuesActivity projectId={1} issuesReturnSignal={1} />
      </I18nProvider>,
    );

    expect(
      screen.getByRole("form", { name: "Edit Issue" }),
    ).toBeInTheDocument();
    resolveSave({ ...existingIssue, updatedAt: 1_780_640_000_000 });
  });

  it("does not trigger return on mount when the initial signal is non-zero", async () => {
    listIssuesMock.mockResolvedValue({ issues: [runningIssue] });
    renderIssuesActivity({
      requestedIssueId: runningIssue.id,
      issuesReturnSignal: 3,
    });

    expect(
      await screen.findByRole("region", { name: "Issue Detail" }),
    ).toBeInTheDocument();
  });
});

function renderIssuesActivity(
  props?: Partial<ComponentProps<typeof IssuesActivity>>,
) {
  return render(
    <I18nProvider>
      <IssuesActivity
        projectId={1}
        worktreeSetupCommand="pnpm install"
        {...props}
      />
    </I18nProvider>,
  );
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

/**
 * 模拟甬道滚动到底部以触发加载更多。jsdom 不会计算真实滚动尺寸，
 * 这里直接覆写 scrollHeight/clientHeight/scrollTop 后派发 scroll 事件。
 */
function scrollLaneToBottom(lane: HTMLElement) {
  const cards = within(lane).getByRole("list");
  Object.defineProperty(cards, "scrollHeight", {
    configurable: true,
    value: 2000,
  });
  Object.defineProperty(cards, "clientHeight", {
    configurable: true,
    value: 500,
  });
  Object.defineProperty(cards, "scrollTop", {
    configurable: true,
    value: 1500,
  });
  fireEvent.scroll(cards);
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
    dialog: screen.getByRole("dialog", { name: "Run Issue #1" }),
    runButton,
  };
}

async function openIssueMoreMenu(
  user: ReturnType<typeof userEvent.setup>,
  container: HTMLElement = document.body,
) {
  await user.click(
    within(container).getByRole("button", { name: "More issue actions" }),
  );
  return screen.findByRole("menu");
}

function formatTestTimestamp(epochMilliseconds: number): string {
  return new Date(epochMilliseconds).toLocaleString();
}
