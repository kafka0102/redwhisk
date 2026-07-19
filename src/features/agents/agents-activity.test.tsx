import { createElement } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openPath } from "@tauri-apps/plugin-opener";
import type { AgentSessionListChangedEvent } from "./agent-session-events";

import claudeLogoSrc from "../../assets/images/claude.svg";
import codexLogoSrc from "../../assets/images/codex.svg";
import { AgentsActivity } from "./agents-activity";
import {
  injectAgentSessionPrompt,
  deleteAgentSession,
  listAgentSessions,
  resumeStructuredAgentSession,
  setAgentSessionAttention,
  startStructuredAgentSession,
  updateAgentSessionTitle,
} from "./agent-session-commands";
import * as composerDraftModule from "./composer/use-agent-composer";
import {
  completeIssueFlow,
  completeIssueClean,
  completeIssueManual,
  detectAgentCommitCompletion,
  listIssues,
  markIssueReview,
  prepareAgentCommitCompletion,
  sendAgentCommitPrompt,
  updateIssue,
} from "../issues/issue-commands";
import { listAgentProfiles } from "../settings/settings-commands";
import {
  closeProjectTerminal,
  createTemporaryProjectTerminal,
} from "../terminals/project-terminal-commands";
import { toast } from "../../shared/toast";
import appCssRaw from "../../app/app.css?raw";

const sharedStyleModules = import.meta.glob("../../shared/styles/*.css", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const appCss = appCssRaw + Object.values(sharedStyleModules).join("\n");
import tokensCss from "../../shared/styles/tokens.css?raw";
import {
  getProjectWorktreeChanges,
  getProjectWorktreeCommitHistory,
  getProjectWorktreeFileTree,
  readProjectWorktreeDiff,
  readProjectWorktreeFile,
  type WorkspaceCommitChangedFile,
  type WorkspaceCommitRecord,
  type WorkspaceChangedFile,
  type WorkspaceChangeKind,
  type WorkspaceFileTreeNode,
} from "./session-workspace/session-workspace-commands";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: vi.fn(),
}));

const eventMocks = vi.hoisted(() => ({
  listeners: [] as Array<{
    eventName: string;
    callback: (event: { payload: AgentSessionListChangedEvent }) => void;
  }>,
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    (
      eventName: string,
      callback: (event: { payload: AgentSessionListChangedEvent }) => void,
    ) => {
      eventMocks.listeners.push({ eventName, callback });
      return Promise.resolve(eventMocks.unlisten);
    },
  ),
}));

// mock AgentSessionView 为占位组件，避免在 agents-activity 测试中深渲染
// message-stream / composer（它们有独立的测试覆盖）。
vi.mock("./session-pane/agent-session-view", () => ({
  AgentSessionView: () =>
    createElement("div", {
      "aria-label": "Agent session message stream",
      "data-testid": "agent-session-view",
    }),
}));

vi.mock("../terminals/project-terminal", () => ({
  ProjectTerminal: ({
    projectId,
    sessionId,
  }: {
    projectId: number;
    sessionId: number;
  }) =>
    createElement(
      "div",
      {
        "data-testid": `inline-project-terminal:${projectId}:${sessionId}`,
      },
      `terminal ${sessionId}`,
    ),
}));

vi.mock("@monaco-editor/react", () => ({
  DiffEditor: ({
    modified,
    options,
    original,
  }: {
    modified: string;
    options?: { readOnly?: boolean; renderSideBySide?: boolean };
    original: string;
  }) =>
    createElement("div", {
      "data-modified": modified,
      "data-original": original,
      "data-read-only": String(options?.readOnly ?? false),
      "data-render-side-by-side": String(options?.renderSideBySide ?? true),
      "data-testid": "monaco-diff",
    }),
  Editor: ({
    options,
    value,
  }: {
    options?: { readOnly?: boolean };
    value: string;
  }) =>
    createElement("div", {
      "data-testid": "monaco-editor",
      "data-read-only": String(options?.readOnly ?? false),
      "data-value": value,
    }),
}));

vi.mock("./agent-session-commands", () => ({
  deleteAgentSession: vi.fn(),
  injectAgentSessionPrompt: vi.fn(),
  listAgentSessions: vi.fn(),
  resumeStructuredAgentSession: vi.fn(),
  setAgentSessionAttention: vi.fn(),
  startStructuredAgentSession: vi.fn(),
  updateAgentSessionTitle: vi.fn(),
  sendAgentMessage: vi.fn(),
}));

vi.mock("./session-workspace/session-workspace-commands", () => ({
  getProjectWorktreeChanges: vi.fn(),
  getProjectWorktreeCommitHistory: vi.fn(),
  getProjectWorktreeFileTree: vi.fn(),
  listCodeWorkspaceRoots: vi.fn().mockResolvedValue({ roots: [] }),
  readProjectWorktreeDiff: vi.fn(),
  readProjectWorktreeFile: vi.fn(),
}));

vi.mock("../settings/settings-commands", () => ({
  listAgentProfiles: vi.fn(),
}));

vi.mock("../issues/issue-commands", () => ({
  completeIssueFlow: vi.fn(),
  completeIssueManual: vi.fn(),
  completeIssueClean: vi.fn(),
  detectAgentCommitCompletion: vi.fn(),
  listIssues: vi.fn(),
  markIssueReview: vi.fn(),
  prepareAgentCommitCompletion: vi.fn(),
  sendAgentCommitPrompt: vi.fn(),
  updateIssue: vi.fn(),
}));

vi.mock("../terminals/project-terminal-commands", () => ({
  closeProjectTerminal: vi.fn(),
  createTemporaryProjectTerminal: vi.fn(),
}));

vi.mock("../../shared/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    message: vi.fn(),
    dismiss: vi.fn(),
    update: vi.fn(),
  },
}));

const listAgentSessionsMock = vi.mocked(listAgentSessions);
const deleteAgentSessionMock = vi.mocked(deleteAgentSession);
const injectAgentSessionPromptMock = vi.mocked(injectAgentSessionPrompt);
const resumeStructuredAgentSessionMock = vi.mocked(
  resumeStructuredAgentSession,
);
const setAgentSessionAttentionMock = vi.mocked(setAgentSessionAttention);
const startStructuredAgentSessionMock = vi.mocked(startStructuredAgentSession);
const updateAgentSessionTitleMock = vi.mocked(updateAgentSessionTitle);
const listAgentProfilesMock = vi.mocked(listAgentProfiles);
const completeIssueFlowMock = vi.mocked(completeIssueFlow);
const completeIssueCleanMock = vi.mocked(completeIssueClean);
const completeIssueManualMock = vi.mocked(completeIssueManual);
const detectAgentCommitCompletionMock = vi.mocked(detectAgentCommitCompletion);
const listIssuesMock = vi.mocked(listIssues);
const markIssueReviewMock = vi.mocked(markIssueReview);
const prepareAgentCommitCompletionMock = vi.mocked(
  prepareAgentCommitCompletion,
);
const sendAgentCommitPromptMock = vi.mocked(sendAgentCommitPrompt);
const updateIssueMock = vi.mocked(updateIssue);
const openPathMock = vi.mocked(openPath);
const getProjectWorktreeChangesMock = vi.mocked(getProjectWorktreeChanges);
const getProjectWorktreeCommitHistoryMock = vi.mocked(
  getProjectWorktreeCommitHistory,
);
const getProjectWorktreeFileTreeMock = vi.mocked(getProjectWorktreeFileTree);
const readProjectWorktreeDiffMock = vi.mocked(readProjectWorktreeDiff);
const readProjectWorktreeFileMock = vi.mocked(readProjectWorktreeFile);
const closeProjectTerminalMock = vi.mocked(closeProjectTerminal);
const createTemporaryProjectTerminalMock = vi.mocked(
  createTemporaryProjectTerminal,
);
const toastSuccessMock = vi.mocked(toast.success);
const toastErrorMock = vi.mocked(toast.error);

function completedFlowResult(issueId: number, projectId = 1) {
  return {
    action: "completed" as const,
    issue: {
      id: issueId,
      number: issueId,
      projectId,
      title: "Review issue",
      description: "",
      attachments: [],
      labels: [],
      status: "completed" as const,
      linkedSessionId: 502,
      linkedSessionStatus: "closed" as const,
      linkedSessionAttention: "none" as const,
      linkedSessionLogPath: null,
      linkedSessionLatestOutput: null,
      createdAt: 1_780_637_000_000,
      updatedAt: 1_780_639_000_000,
      statusChangedAt: 1_780_639_000_000,
    },
    flow: null,
    message: "Issue completed",
    mergeBlockReason: null,
    targetBranch: null,
    workspaceBranch: null,
    workspacePath: null,
    actualPath: null,
    drifted: false,
    sessionId: 502,
  };
}

async function findSessionList() {
  return screen.findByRole("list", { name: "Agent sessions" });
}

function getSessionRowByIssue(
  sessionList: HTMLElement,
  issueId: number,
  issueTitle: string,
) {
  const row = within(sessionList)
    .getAllByRole("button")
    .find(
      (button) =>
        within(button).queryByText(issueTitle) !== null &&
        within(button).queryByText(`#${issueId}`) !== null,
    );

  if (!row) {
    throw new Error(`Unable to find session row for #${issueId} ${issueTitle}`);
  }

  return row;
}

const defaultProfiles = {
  project: [
    {
      id: 101,
      name: "Project Agent",
      agentType: "codex" as const,
      command: "codex",
      scope: "project" as const,
      projectId: 1,
      mode: "full-auto",
      dangerous: true,
      defaultSkill: "",
      promptTemplate: "",
      del: 0,
    },
  ],
  global: [
    {
      id: 201,
      name: "Global Agent",
      agentType: "codex" as const,
      command: "codex",
      scope: "global" as const,
      projectId: null,
      mode: "full-auto",
      dangerous: true,
      defaultSkill: "",
      promptTemplate: "",
      del: 0,
    },
  ],
};

function runningSession(sessionId: number, issueTitle = "Existing issue") {
  return {
    sessionId,
    number: sessionId - 280,
    projectId: 1,
    issueId: sessionId - 281,
    issueNumber: sessionId - 281,
    issueTitle,
    issueStatus: null,
    agentProfileId: 1,
    agentProfileName: "Test Profile",
    workflowSkillName: null,
    canCompleteClean: false,
    canCompleteAgentCommit: false,
    title: null,
    agentType: "codex" as const,
    status: "running" as const,
    attention: "none" as const,
    isTurnRunning: true,
    workspaceMode: "current_branch" as const,
    workingDir: "/tmp/repo",
    workspacePath: null,
    originBranch: null,
    workspaceBranch: null,
    worktreeOwner: "redwhisk" as const,
    logPath: "/tmp/session.log",
    latestOutput: null,
    lastActiveAt: 1_780_637_000_000 + sessionId,
    startedAt: 1_780_637_000_000,
    closedAt: null,
    processingMs: 0,
    lastOutputAt: null,
  };
}

function changedFile(
  filePath: string,
  kind: WorkspaceChangeKind,
): WorkspaceChangedFile {
  return {
    filePath,
    oldPath: null,
    fileName: getLastPathSegment(filePath),
    kind,
    status: kind === "untracked" ? "??" : " M",
    additions: 1,
    deletions: 0,
    isBinary: false,
    contentHash: `${filePath}:${kind}`,
    metadataSignature: `${filePath}:${kind}:meta`,
  };
}

function committedFile(
  filePath: string,
  status: WorkspaceCommitChangedFile["status"],
  oldPath: string | null = null,
): WorkspaceCommitChangedFile {
  return {
    filePath,
    oldPath,
    fileName: getLastPathSegment(filePath),
    kind: status === "A" ? "added" : status === "R" ? "renamed" : "modified",
    status,
  };
}

function commitRecord(
  hash: string,
  message: string,
  files: WorkspaceCommitChangedFile[],
): WorkspaceCommitRecord {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    message,
    authorName: "yujianjia",
    committedAt: 1_780_638_000_000,
    files,
    isPushed: false,
    pushedTo: null,
    isCreatedInWorktree: false,
  };
}

function fileNode(path: string): WorkspaceFileTreeNode {
  return {
    id: path,
    name: getLastPathSegment(path),
    path,
    kind: "file",
    isIgnored: false,
  };
}

function getLastPathSegment(path: string): string {
  const segments = path.split("/");
  return segments[segments.length - 1] ?? path;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function emitSessionListChanged(
  projectId: number,
  sessionId: number | null = null,
) {
  await act(async () => {
    eventMocks.listeners
      .filter((listener) => listener.eventName === "agent-session-list-changed")
      .forEach((listener) => {
        listener.callback({
          payload: {
            projectId,
            sessionId,
            reason: "session_updated",
          },
        });
      });
    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
  });
}

async function addSessionTool(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  await user.click(screen.getByRole("button", { name: "Add session tool" }));
  await user.click(await screen.findByRole("menuitem", { name }));
}

describe("AgentsActivity", () => {
  beforeEach(() => {
    eventMocks.listeners = [];
    eventMocks.unlisten.mockReset();
    listAgentSessionsMock.mockReset();
    deleteAgentSessionMock.mockReset();
    injectAgentSessionPromptMock.mockReset();
    resumeStructuredAgentSessionMock.mockReset();
    setAgentSessionAttentionMock.mockReset();
    startStructuredAgentSessionMock.mockReset();
    updateAgentSessionTitleMock.mockReset();
    listIssuesMock.mockReset();
    completeIssueFlowMock.mockReset();
    completeIssueManualMock.mockReset();
    completeIssueCleanMock.mockReset();
    detectAgentCommitCompletionMock.mockReset();
    prepareAgentCommitCompletionMock.mockReset();
    sendAgentCommitPromptMock.mockReset();
    markIssueReviewMock.mockReset();
    updateIssueMock.mockReset();
    getProjectWorktreeChangesMock.mockReset();
    getProjectWorktreeCommitHistoryMock.mockReset();
    getProjectWorktreeFileTreeMock.mockReset();
    readProjectWorktreeDiffMock.mockReset();
    readProjectWorktreeFileMock.mockReset();
    closeProjectTerminalMock.mockReset();
    createTemporaryProjectTerminalMock.mockReset();
    openPathMock.mockReset();
    toastSuccessMock.mockReset();
    completeIssueFlowMock.mockImplementation(async (input) =>
      completedFlowResult(input.issueId, input.projectId),
    );
    setAgentSessionAttentionMock.mockResolvedValue({
      sessionId: 301,
      attention: "requested",
    });
    startStructuredAgentSessionMock.mockResolvedValue({
      sessionId: 701,
      threadId: "thread-701",
    });
    deleteAgentSessionMock.mockResolvedValue({
      sessionId: 701,
    });
    resumeStructuredAgentSessionMock.mockResolvedValue({
      sessionId: 502,
      threadId: "thread-502",
    });
    injectAgentSessionPromptMock.mockResolvedValue({
      sessionId: 502,
      codexSessionId: "thread-502",
    });
    updateAgentSessionTitleMock.mockResolvedValue({
      sessionId: 701,
      title: "Renamed Session",
    });
    openPathMock.mockResolvedValue();
    closeProjectTerminalMock.mockResolvedValue(undefined);
    createTemporaryProjectTerminalMock.mockResolvedValue({
      sessionId: -11,
      name: "issue-20-redwhisk",
      workingDir: "/tmp/worktrees/issue-20-redwhisk",
      launchCommand: "/bin/zsh",
    });
    sendAgentCommitPromptMock.mockResolvedValue({
      issueId: 22,
      sessionId: 502,
      codexSessionId: "019d8b4d-2998-7913-889d-fb3c32971610",
    });
    listIssuesMock.mockResolvedValue({
      issues: [
        {
          id: 20,
          number: 20,
          projectId: 1,
          title: "Existing issue",
          description: "Existing description",
          attachments: [],
          labels: [],
          status: "running",
          linkedSessionId: 301,
          linkedSessionStatus: "running",
          linkedSessionAttention: "none",
          linkedSessionLogPath: null,
          linkedSessionLatestOutput: null,
          createdAt: 1_780_637_000_000,
          updatedAt: 1_780_637_000_000,
          statusChangedAt: 1_780_637_000_000,
        },
        {
          id: 21,
          number: 21,
          projectId: 1,
          title: "Running issue",
          description: "Running description",
          attachments: [],
          labels: [],
          status: "running",
          linkedSessionId: 302,
          linkedSessionStatus: "running",
          linkedSessionAttention: "none",
          linkedSessionLogPath: null,
          linkedSessionLatestOutput: null,
          createdAt: 1_780_638_000_000,
          updatedAt: 1_780_638_000_000,
          statusChangedAt: 1_780_638_000_000,
        },
      ],
    });
    markIssueReviewMock.mockResolvedValue({
      id: 20,
      number: 20,
      projectId: 1,
      title: "Existing issue",
      description: "",
      attachments: [],
      labels: [],
      status: "review",
      linkedSessionId: 301,
      linkedSessionStatus: "running",
      linkedSessionAttention: "none",
      linkedSessionLogPath: null,
      linkedSessionLatestOutput: null,
      createdAt: 1_780_637_000_000,
      updatedAt: 1_780_638_001_000,
      statusChangedAt: 1_780_638_001_000,
    });
    completeIssueManualMock.mockResolvedValue({
      id: 22,
      number: 22,
      projectId: 1,
      title: "Review issue",
      description: "Review description",
      attachments: [],
      labels: [],
      status: "completed",
      linkedSessionId: 502,
      linkedSessionStatus: "closed",
      linkedSessionAttention: "none",
      linkedSessionLogPath: null,
      linkedSessionLatestOutput: null,
      createdAt: 1_780_632_000_000,
      updatedAt: 1_780_639_000_000,
      statusChangedAt: 1_780_639_000_000,
    });
    completeIssueCleanMock.mockResolvedValue({
      id: 22,
      number: 22,
      projectId: 1,
      title: "Review issue",
      description: "Review description",
      attachments: [],
      labels: [],
      status: "completed",
      linkedSessionId: 502,
      linkedSessionStatus: "closed",
      linkedSessionAttention: "none",
      linkedSessionLogPath: null,
      linkedSessionLatestOutput: null,
      createdAt: 1_780_632_000_000,
      updatedAt: 1_780_639_000_000,
      statusChangedAt: 1_780_639_000_000,
    });
    detectAgentCommitCompletionMock.mockResolvedValue({
      outcome: "completed",
      issue: {
        id: 22,
        number: 22,
        projectId: 1,
        title: "Review issue",
        description: "Review description",
        attachments: [],
        labels: [],
        status: "completed",
        linkedSessionId: 502,
        linkedSessionStatus: "closed",
        linkedSessionAttention: "none",
        linkedSessionLogPath: "/tmp/session.log",
        linkedSessionLatestOutput: null,
        createdAt: 1_780_632_000_000,
        updatedAt: 1_780_639_000_000,
        statusChangedAt: 1_780_639_000_000,
      },
      message: "已检测到新的 commit，Issue 已完成。",
    });
    prepareAgentCommitCompletionMock.mockResolvedValue({
      issueId: 22,
      sessionId: 502,
      option: "complete_agent_commit",
      head: "4157f0c",
      changedFilesCount: 2,
      changedFiles: [
        {
          status: " M",
          path: "src/features/agents/agents-activity.tsx",
          oldPath: null,
        },
        {
          status: " M",
          path: "src-tauri/src/core/issue_service.rs",
          oldPath: null,
        },
      ],
      completionPrompt: "请仅处理当前 Issue 相关改动，并在确认无误后提交。",
    });
    updateIssueMock.mockImplementation(async (input) => ({
      id: input.issueId,
      number: input.issueId,
      projectId: input.projectId,
      title: input.title,
      description: input.description,
      attachments: [],
      labels: [],
      status: "running",
      linkedSessionId: 301,
      linkedSessionStatus: "running",
      linkedSessionAttention: "none",
      linkedSessionLogPath: null,
      linkedSessionLatestOutput: null,
      createdAt: 1_780_637_000_000,
      updatedAt: 1_780_638_002_000,
      statusChangedAt: 1_780_638_002_000,
    }));
    listAgentProfilesMock.mockReset();
    listAgentProfilesMock.mockImplementation(async ({ scope }) => ({
      profiles:
        scope === "project" ? defaultProfiles.project : defaultProfiles.global,
    }));
    getProjectWorktreeChangesMock.mockResolvedValue({
      signature: "default-changes",
      files: [
        changedFile("src/features/agents/agents-activity.tsx", "modified"),
        changedFile("src/features/agents/agents-session-pane.tsx", "modified"),
        changedFile("src/features/agents/session-side-panel.tsx", "added"),
        changedFile("src/features/agents/session-workspace-tabs.tsx", "added"),
        changedFile("src/app/app.css", "modified"),
        changedFile("src/features/agents/agents-activity.test.tsx", "modified"),
      ],
    });
    getProjectWorktreeCommitHistoryMock.mockResolvedValue({
      signature: "default-commits",
      commits: [],
      isWorktree: false,
    });
    getProjectWorktreeFileTreeMock.mockResolvedValue({
      signature: "default-tree",
      nodes: [
        {
          id: "src",
          name: "src",
          path: "src",
          kind: "directory",
          isIgnored: false,
          children: [
            {
              id: "src/features/agents/session-side-panel.tsx",
              name: "session-side-panel.tsx",
              path: "src/features/agents/session-side-panel.tsx",
              kind: "file",
              isIgnored: false,
            },
            {
              id: "src/app/app.css",
              name: "app.css",
              path: "src/app/app.css",
              kind: "file",
              isIgnored: false,
            },
          ],
        },
      ],
    });
    readProjectWorktreeDiffMock.mockResolvedValue({
      filePath: "src/placeholder.ts",
      oldPath: null,
      kind: "modified",
      language: "typescript",
      originalContent: "",
      modifiedContent: "",
      isBinary: false,
      isTooLarge: false,
    });
    readProjectWorktreeFileMock.mockResolvedValue({
      filePath: "src/placeholder.ts",
      language: "typescript",
      content: "",
      modifiedAt: null,
      sizeBytes: 0,
      isBinary: false,
      isTooLarge: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a flat session list, workspace and info pane for the selected session", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 302,
          number: 302,
          issueId: 21,
          issueNumber: 21,
          issueTitle: "Running issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          latestOutput: "Running pnpm test -- --run agents-activity.test.tsx",
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
          projectId: 1,
          issueStatus: null,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          processingMs: 0,
          lastOutputAt: null,
        },
        {
          sessionId: 301,
          number: 301,
          issueId: 20,
          issueNumber: 20,
          issueTitle: "Existing issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
          projectId: 1,
          issueStatus: null,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
        {
          sessionId: 401,
          number: 401,
          issueId: 22,
          issueNumber: 22,
          issueTitle: "Closed issue",
          title: null,
          agentType: "codex",
          status: "closed",
          attention: "none",
          lastActiveAt: 1_780_630_000_000,
          startedAt: 1_780_629_000_000,
          closedAt: 1_780_631_000_000,
          projectId: 1,
          issueStatus: null,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: false,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Sessions" }),
    ).toBeInTheDocument();

    const sessionList = await screen.findByRole("list", {
      name: "Agent sessions",
    });

    expect(screen.queryByText("In Progress")).not.toBeInTheDocument();
    expect(screen.queryByText("Review")).not.toBeInTheDocument();
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
    expect(within(sessionList).getAllByRole("listitem")).toHaveLength(3);
    expect(
      within(sessionList).getByRole("button", { name: /Existing issue/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(sessionList).getByText(
        "Running pnpm test -- --run agents-activity.test.tsx",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Linked Issue")).not.toBeInTheDocument();
    expect(screen.queryByText("Selected Session")).not.toBeInTheDocument();
    expect(
      screen.getByRole("separator", { name: "Resize session list" }),
    ).toHaveAttribute("aria-valuenow", "230");
    expect(
      screen.queryByRole("separator", { name: "Resize session info" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("complementary", { name: "Issue details" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "#20 Existing issue" }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Agent session message stream"),
    ).toBeInTheDocument();
  });

  it("refreshes uncommitted changes while the side panel is open", async () => {
    vi.useFakeTimers();
    getProjectWorktreeChangesMock
      .mockResolvedValueOnce({
        signature: "one",
        files: [changedFile("src/one.ts", "modified")],
      })
      .mockResolvedValueOnce({
        signature: "two",
        files: [
          changedFile("src/one.ts", "modified"),
          changedFile("src/two.ts", "added"),
        ],
      });
    getProjectWorktreeFileTreeMock.mockResolvedValue({
      signature: "tree",
      nodes: [],
    });
    listAgentSessionsMock.mockResolvedValue({
      sessions: [runningSession(301)],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);
    await flushMicrotasks();
    fireEvent.click(screen.getByLabelText("Open session side panel"));
    fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
    await flushMicrotasks();
    expect(screen.getByRole("button", { name: /one.ts/ })).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });

    expect(screen.getByRole("button", { name: /two.ts/ })).toBeInTheDocument();
  });

  it("keeps newer uncommitted changes when an older refresh returns last", async () => {
    vi.useFakeTimers();
    const oldChanges =
      deferred<Awaited<ReturnType<typeof getProjectWorktreeChanges>>>();
    const newChanges =
      deferred<Awaited<ReturnType<typeof getProjectWorktreeChanges>>>();
    getProjectWorktreeChangesMock
      .mockReturnValueOnce(oldChanges.promise)
      .mockReturnValueOnce(newChanges.promise);
    listAgentSessionsMock.mockResolvedValue({
      sessions: [runningSession(301)],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);
    await flushMicrotasks();
    fireEvent.click(screen.getByLabelText("Open session side panel"));
    fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      newChanges.resolve({
        signature: "new",
        files: [changedFile("src/new.ts", "modified")],
      });
      await newChanges.promise;
    });
    expect(screen.getByRole("button", { name: /new.ts/ })).toBeInTheDocument();

    await act(async () => {
      oldChanges.resolve({
        signature: "old",
        files: [changedFile("src/old.ts", "modified")],
      });
      await oldChanges.promise;
    });

    expect(screen.getByRole("button", { name: /new.ts/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /old.ts/ }),
    ).not.toBeInTheDocument();
  });

  it("stops auto-refreshing uncommitted changes when the workspace root is inaccessible", async () => {
    vi.useFakeTimers();
    getProjectWorktreeChangesMock.mockRejectedValue({
      code: "AGENT_SESSION_VALIDATION_FAILED",
      message: "仓库路径不可访问。",
      details: [{ "@type": "WorkspaceRoot", path: "/tmp/worktrees/missing" }],
    });
    getProjectWorktreeFileTreeMock.mockResolvedValue({
      signature: "tree",
      nodes: [],
    });
    listAgentSessionsMock.mockResolvedValue({
      sessions: [runningSession(301)],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);
    await flushMicrotasks();
    fireEvent.click(screen.getByLabelText("Open session side panel"));
    fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
    await flushMicrotasks();

    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("仓库路径不可访问。")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    // 仓库路径不可访问属于不可恢复错误，自动轮询应停止，调用次数不再增加。
    expect(getProjectWorktreeChangesMock).toHaveBeenCalledTimes(1);
  });

  it("hides stale uncommitted files when the workspace root becomes inaccessible", async () => {
    vi.useFakeTimers();
    getProjectWorktreeChangesMock
      .mockResolvedValueOnce({
        signature: "one",
        files: [changedFile("src/one.ts", "modified")],
      })
      .mockRejectedValueOnce({
        code: "AGENT_SESSION_VALIDATION_FAILED",
        message: "仓库路径不可访问。",
        details: [{ "@type": "WorkspaceRoot", path: "/tmp/worktrees/missing" }],
      });
    getProjectWorktreeFileTreeMock.mockResolvedValue({
      signature: "tree",
      nodes: [],
    });
    listAgentSessionsMock.mockResolvedValue({
      sessions: [runningSession(301)],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);
    await flushMicrotasks();
    fireEvent.click(screen.getByLabelText("Open session side panel"));
    fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
    await flushMicrotasks();

    // 先成功加载过未提交文件，此时 one.ts 可见。
    expect(screen.getByRole("button", { name: /one.ts/ })).toBeInTheDocument();

    // worktree 被删除后，下一次 2s 自动轮询返回不可访问：错误信息显示，残留的旧文件
    // 行必须消失，否则点击会打开已不存在的文件。手动刷新按钮已按 spec 移除，这里通过
    // 推进未提交轮询间隔触发第二次拉取。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });

    expect(screen.getByText("仓库路径不可访问。")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /one.ts/ }),
    ).not.toBeInTheDocument();
  });

  it("loads committed branch history and expands changed files", async () => {
    const user = userEvent.setup();
    // 本用例聚焦已提交历史：把未提交清空，避免与已提交面板的 status 字母（M/R/A）
    // 同时渲染造成断言歧义。
    getProjectWorktreeChangesMock.mockResolvedValue({
      signature: "empty",
      files: [],
    });
    getProjectWorktreeCommitHistoryMock.mockResolvedValue({
      signature: "commit-history",
      commits: [
        commitRecord("abcdef1234567890", "fix(web): 补齐列表标题宽度限制", [
          committedFile(
            "apps/web/src/pages/event/index/index.module.scss",
            "M",
          ),
          committedFile("apps/web/src/pages/event/index/index.tsx", "R"),
          committedFile("apps/web/src/pages/problem/index/index.tsx", "A"),
        ]),
      ],
      isWorktree: false,
    });
    listAgentSessionsMock.mockResolvedValue({
      sessions: [runningSession(301)],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);
    await user.click(await screen.findByLabelText("Open session side panel"));
    const panel = await screen.findByRole("complementary", {
      name: "Session side panel",
    });
    await user.click(within(panel).getByRole("tab", { name: "Changes" }));

    // 已提交面板默认收起：点击面板头展开后才触发首次拉取与轮询。
    await user.click(
      within(panel).getByRole("button", { name: "Committed changes" }),
    );

    const commitButton = await within(panel).findByRole("button", {
      name: /fix\(web\): 补齐列表标题宽度限制/,
    });
    expect(commitButton).toBeInTheDocument();
    expect(getProjectWorktreeCommitHistoryMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 301,
    });

    await user.click(commitButton);

    const eventFile = within(panel).getByRole("button", {
      name: /index\.module\.scss apps\/web\/src\/pages\/event\/index M/,
    });
    expect(
      within(eventFile).getByText("index.module.scss"),
    ).toBeInTheDocument();
    expect(
      within(eventFile).getByText("apps/web/src/pages/event/index"),
    ).toBeInTheDocument();
    expect(within(eventFile).getByText("M")).toHaveClass(
      "session-commit-file__status--modified",
    );
    expect(within(panel).getByText("R")).toHaveClass(
      "session-commit-file__status--renamed",
    );
    expect(within(panel).getByText("A")).toHaveClass(
      "session-commit-file__status--added",
    );

    await user.click(eventFile);

    expect(readProjectWorktreeDiffMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 301,
      filePath: "apps/web/src/pages/event/index/index.module.scss",
      commitHash: "abcdef1234567890",
    });
    expect(await screen.findByTestId("monaco-diff")).toBeInTheDocument();
  });

  it("refreshes the file tree while the files tab is active", async () => {
    vi.useFakeTimers();
    getProjectWorktreeFileTreeMock
      .mockResolvedValueOnce({
        signature: "one",
        nodes: [fileNode("src/one.ts")],
      })
      .mockResolvedValueOnce({
        signature: "two",
        nodes: [fileNode("src/one.ts"), fileNode("src/two.ts")],
      });
    listAgentSessionsMock.mockResolvedValue({
      sessions: [runningSession(301)],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);
    await flushMicrotasks();
    fireEvent.click(screen.getByLabelText("Open session side panel"));
    fireEvent.click(screen.getByRole("tab", { name: "Files" }));
    await flushMicrotasks();
    expect(screen.getByRole("button", { name: /one.ts/ })).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100);
    });

    expect(screen.getByRole("button", { name: /two.ts/ })).toBeInTheDocument();
  });

  it("opens a read-only file viewer when clicking a file tree file", async () => {
    const user = userEvent.setup();
    getProjectWorktreeChangesMock.mockResolvedValue({
      signature: "changes",
      files: [],
    });
    getProjectWorktreeFileTreeMock.mockResolvedValue({
      signature: "tree",
      nodes: [
        {
          id: "src",
          name: "src",
          path: "src",
          kind: "directory",
          isIgnored: false,
          children: [
            {
              id: "src/file.ts",
              name: "file.ts",
              path: "src/file.ts",
              kind: "file",
              isIgnored: false,
            },
          ],
        },
      ],
    });
    readProjectWorktreeFileMock.mockResolvedValue({
      filePath: "src/file.ts",
      language: "typescript",
      content: "export const value = 1;",
      modifiedAt: 1,
      sizeBytes: 23,
      isBinary: false,
      isTooLarge: false,
    });
    listAgentSessionsMock.mockResolvedValue({
      sessions: [runningSession(301)],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);
    await user.click(await screen.findByLabelText("Open session side panel"));
    await user.click(screen.getByRole("tab", { name: "Files" }));
    await user.click(await screen.findByRole("button", { name: /src/ }));
    await user.click(await screen.findByRole("button", { name: /file.ts/ }));

    expect(await screen.findByTestId("monaco-editor")).toHaveAttribute(
      "data-value",
      "export const value = 1;",
    );
  });

  it("renders file tree folders collapsed with VS Code style disclosure arrows", async () => {
    const user = userEvent.setup();
    getProjectWorktreeFileTreeMock.mockResolvedValue({
      signature: "tree",
      nodes: [
        {
          id: "src",
          name: "src",
          path: "src",
          kind: "directory",
          isIgnored: false,
          children: [fileNode("src/file.ts")],
        },
      ],
    });
    listAgentSessionsMock.mockResolvedValue({
      sessions: [runningSession(301)],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);
    await user.click(await screen.findByLabelText("Open session side panel"));
    await user.click(screen.getByRole("tab", { name: "Files" }));

    const folder = await screen.findByRole("button", { name: /src/ });
    expect(folder).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: /file.ts/ }),
    ).not.toBeInTheDocument();
    expect(
      folder.querySelector(".session-file-tree__chevron.lucide-chevron-right"),
    ).toBeInTheDocument();

    await user.click(folder);

    expect(folder).toHaveAttribute("aria-expanded", "true");
    expect(
      folder.querySelector(".session-file-tree__chevron.lucide-chevron-down"),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /file.ts/ }),
    ).toBeInTheDocument();
  });

  it("renders distinct file icon classes for common file extensions", async () => {
    const user = userEvent.setup();
    getProjectWorktreeFileTreeMock.mockResolvedValue({
      signature: "tree",
      nodes: [
        {
          id: "src",
          name: "src",
          path: "src",
          kind: "directory",
          isIgnored: false,
          children: [
            fileNode("src/app.tsx"),
            fileNode("src/app.css"),
            fileNode("src/package.json"),
          ],
        },
      ],
    });
    listAgentSessionsMock.mockResolvedValue({
      sessions: [runningSession(301)],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);
    await user.click(await screen.findByLabelText("Open session side panel"));
    await user.click(screen.getByRole("tab", { name: "Files" }));
    await user.click(await screen.findByRole("button", { name: /src/ }));

    expect(
      screen
        .getByRole("button", { name: /app.tsx/ })
        .querySelector(".session-file-tree__chevron--placeholder"),
    ).toBeInTheDocument();
    expect(
      screen
        .getByRole("button", { name: /app.tsx/ })
        .querySelector(".session-file-tree__icon--tsx"),
    ).toBeInTheDocument();
    expect(
      screen
        .getByRole("button", { name: /app.css/ })
        .querySelector(".session-file-tree__icon--css"),
    ).toBeInTheDocument();
    expect(
      screen
        .getByRole("button", { name: /package.json/ })
        .querySelector(".session-file-tree__icon--json"),
    ).toBeInTheDocument();
  });

  it("does not open a file tab when clicking a directory", async () => {
    const user = userEvent.setup();
    getProjectWorktreeFileTreeMock.mockResolvedValue({
      signature: "tree",
      nodes: [
        {
          id: "src",
          name: "src",
          path: "src",
          kind: "directory",
          isIgnored: false,
          children: [],
        },
      ],
    });
    listAgentSessionsMock.mockResolvedValue({
      sessions: [runningSession(301)],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);
    await user.click(await screen.findByLabelText("Open session side panel"));
    await user.click(screen.getByRole("tab", { name: "Files" }));
    await user.click(await screen.findByRole("button", { name: /src/ }));

    expect(screen.queryByRole("tab", { name: "src" })).not.toBeInTheDocument();
  });

  it("keeps newer file tree nodes when an older refresh returns last", async () => {
    vi.useFakeTimers();
    const oldFileTree =
      deferred<Awaited<ReturnType<typeof getProjectWorktreeFileTree>>>();
    const newFileTree =
      deferred<Awaited<ReturnType<typeof getProjectWorktreeFileTree>>>();
    getProjectWorktreeFileTreeMock
      .mockReturnValueOnce(oldFileTree.promise)
      .mockReturnValueOnce(newFileTree.promise);
    listAgentSessionsMock.mockResolvedValue({
      sessions: [runningSession(301)],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);
    await flushMicrotasks();
    fireEvent.click(screen.getByLabelText("Open session side panel"));
    fireEvent.click(screen.getByRole("tab", { name: "Files" }));
    expect(getProjectWorktreeFileTreeMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100);
    });
    expect(getProjectWorktreeFileTreeMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      newFileTree.resolve({
        signature: "new",
        nodes: [fileNode("src/new.ts")],
      });
      await newFileTree.promise;
    });
    expect(screen.getByRole("button", { name: /new.ts/ })).toBeInTheDocument();

    await act(async () => {
      oldFileTree.resolve({
        signature: "old",
        nodes: [fileNode("src/old.ts")],
      });
      await oldFileTree.promise;
    });

    expect(screen.getByRole("button", { name: /new.ts/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /old.ts/ }),
    ).not.toBeInTheDocument();
  });

  it("restores cached workspace tab when switching back to a session", async () => {
    const user = userEvent.setup();
    getProjectWorktreeChangesMock.mockResolvedValue({
      signature: "changes",
      files: [changedFile("src/a.ts", "modified")],
    });
    readProjectWorktreeDiffMock.mockResolvedValue({
      filePath: "src/a.ts",
      oldPath: null,
      kind: "modified",
      language: "typescript",
      originalContent: "old",
      modifiedContent: "new",
      isBinary: false,
      isTooLarge: false,
    });
    listAgentSessionsMock.mockResolvedValue({
      sessions: [runningSession(301), runningSession(302, "Other issue")],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);
    await user.click(await screen.findByLabelText("Open session side panel"));
    await user.click(screen.getByRole("tab", { name: "Changes" }));
    await user.click(await screen.findByRole("button", { name: /a.ts/ }));
    expect(
      await screen.findByRole("tab", { name: "a.ts" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Other issue/ }));
    await user.click(screen.getByRole("button", { name: /Existing issue/ }));

    expect(screen.getByRole("tab", { name: "a.ts" })).toBeInTheDocument();
  });

  it("opens a read-only diff for a changed file without placeholder text", async () => {
    const user = userEvent.setup();
    getProjectWorktreeChangesMock.mockResolvedValue({
      signature: "changes",
      files: [changedFile("src/a.ts", "modified")],
    });
    readProjectWorktreeDiffMock.mockResolvedValue({
      filePath: "src/a.ts",
      oldPath: null,
      kind: "modified",
      language: "typescript",
      originalContent: "const value = 1;",
      modifiedContent: "const value = 2;",
      isBinary: false,
      isTooLarge: false,
    });
    listAgentSessionsMock.mockResolvedValue({
      sessions: [runningSession(301)],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);
    await user.click(await screen.findByLabelText("Open session side panel"));
    await user.click(screen.getByRole("tab", { name: "Changes" }));
    await user.click(await screen.findByRole("button", { name: /a.ts/ }));

    expect(await screen.findByTestId("monaco-diff")).toHaveAttribute(
      "data-original",
      "const value = 1;",
    );
    expect(
      screen.queryByText(/当前版本暂不实现 Diff 渲染/),
    ).not.toBeInTheDocument();
  });

  it("shows a status letter for every changed file kind", async () => {
    const expectations: Array<{
      kind: WorkspaceChangeKind;
      fileName: string;
      status: string;
      className: string;
    }> = [
      {
        kind: "added",
        fileName: "added.ts",
        status: "A",
        className: "session-commit-file__status--added",
      },
      {
        kind: "modified",
        fileName: "modified.ts",
        status: "M",
        className: "session-commit-file__status--modified",
      },
      {
        kind: "deleted",
        fileName: "deleted.ts",
        status: "D",
        className: "session-commit-file__status--deleted",
      },
      {
        kind: "renamed",
        fileName: "renamed.ts",
        status: "R",
        className: "session-commit-file__status--renamed",
      },
      {
        kind: "copied",
        fileName: "copied.ts",
        status: "C",
        className: "session-commit-file__status--copied",
      },
      {
        kind: "binary",
        fileName: "binary.ts",
        status: "X",
        className: "session-commit-file__status--unknown",
      },
    ];
    getProjectWorktreeChangesMock.mockResolvedValue({
      signature: "changes",
      files: expectations.map(({ kind }) =>
        changedFile(`src/${kind}.ts`, kind),
      ),
    });
    listAgentSessionsMock.mockResolvedValue({
      sessions: [runningSession(301)],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);
    await userEvent.click(
      await screen.findByLabelText("Open session side panel"),
    );
    await userEvent.click(screen.getByRole("tab", { name: "Changes" }));

    for (const { fileName, status, className } of expectations) {
      const row = await screen.findByRole("button", {
        name: new RegExp(fileName),
      });
      expect(within(row).getByText(status)).toHaveClass(
        "session-change-row__status",
        className,
      );
    }
  });

  it("shows an explicit unavailable state for binary diffs", async () => {
    const user = userEvent.setup();
    getProjectWorktreeChangesMock.mockResolvedValue({
      signature: "changes",
      files: [changedFile("src/image.png", "binary")],
    });
    readProjectWorktreeDiffMock.mockResolvedValue({
      filePath: "src/image.png",
      oldPath: null,
      kind: "binary",
      language: null,
      originalContent: "",
      modifiedContent: "",
      isBinary: true,
      isTooLarge: false,
    });
    listAgentSessionsMock.mockResolvedValue({
      sessions: [runningSession(301)],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);
    await user.click(await screen.findByLabelText("Open session side panel"));
    await user.click(screen.getByRole("tab", { name: "Changes" }));
    await user.click(await screen.findByRole("button", { name: /image.png/ }));

    expect(
      await screen.findByText("Binary files cannot be previewed."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("monaco-diff")).not.toBeInTheDocument();
  });

  it("uses a full-height split layout for the session list and workspace", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          number: 301,
          issueId: 20,
          issueNumber: 20,
          issueTitle: "Existing issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
          projectId: 1,
          issueStatus: null,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    const activity = (
      await screen.findByRole("separator", { name: "Resize session list" })
    ).closest(".activity-surface--agents");

    expect(activity).toHaveStyle({ "--agents-sidebar-width": "230px" });
  });

  it("uses fixed compact header heights for agents and issue surfaces", async () => {
    expect(appCss).toMatch(
      /\.issue-surface-header\s*\{(?=[^}]*align-items:\s*center;)[^}]*\}/s,
    );
    expect(appCss).toMatch(
      /\.activity-surface--issues\s*\{(?=[^}]*padding:\s*0 0 8px;)[^}]*\}/s,
    );
    expect(appCss).toMatch(
      /@media[^{}]*\([^)]*max-width:\s*640px[^)]*\)[\s\S]*?\.activity-surface--issues\s*\{(?=[^}]*padding:\s*0 0 16px;)[^}]*\}/s,
    );
    expect(appCss).toMatch(
      /\.issue-surface-header--activity\s*\{(?=[^}]*height:\s*var\(--activity-header-height\);)(?![^}]*min-height:)[^}]*\}/s,
    );
    expect(appCss).toMatch(
      /\.issue-surface-header--fullscreen\s*\{(?=[^}]*height:\s*var\(--activity-header-height\);)(?![^}]*min-height:)[^}]*\}/s,
    );
    expect(appCss).toMatch(
      /\.agents-sidebar__header\s*\{(?=[^}]*align-items:\s*center;)(?=[^}]*height:\s*var\(--activity-header-height\);)(?![^}]*min-height:)[^}]*\}/s,
    );
    expect(appCss).toMatch(
      /\.agents-session-toolbar\s*\{(?=[^}]*align-items:\s*center;)(?=[^}]*height:\s*var\(--activity-header-height\);)(?![^}]*min-height:)[^}]*\}/s,
    );
    expect(tokensCss).toMatch(/--activity-header-height:\s*52px;/);
  });

  it("keeps visible session order stable across polling updates", async () => {
    vi.useFakeTimers();
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 301,
            number: 301,
            issueId: 20,
            issueNumber: 20,
            issueTitle: "First visible session",
            issueStatus: "running",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_637_000_000,
            startedAt: 1_780_637_000_000,
            closedAt: null,
            projectId: 1,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
          {
            sessionId: 302,
            number: 302,
            issueId: 21,
            issueNumber: 21,
            issueTitle: "Second visible session",
            issueStatus: "running",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_000_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
            projectId: 1,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 301,
            number: 301,
            issueId: 20,
            issueNumber: 20,
            issueTitle: "First visible session",
            issueStatus: "review",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_640_000_000,
            startedAt: 1_780_637_000_000,
            closedAt: null,
            projectId: 1,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
          {
            sessionId: 302,
            number: 302,
            issueId: 21,
            issueNumber: 21,
            issueTitle: "Second visible session",
            issueStatus: "running",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_000_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
            projectId: 1,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    await act(async () => {
      await Promise.resolve();
    });
    const sessionList = screen.getByRole("list", { name: "Agent sessions" });

    const firstInitialRow = within(sessionList).getAllByRole("button")[0];
    expect(firstInitialRow).toHaveTextContent("First visible session");
    expect(firstInitialRow).toHaveTextContent("#20");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    const firstRefreshedRow = within(sessionList).getAllByRole("button")[0];
    expect(firstRefreshedRow).toHaveTextContent("First visible session");
    expect(firstRefreshedRow).toHaveTextContent("#20");
  });

  it("shows the issue id and active branch in the session card meta row", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 502,
          number: 502,
          issueId: 22,
          issueNumber: 22,
          issueTitle: "Current branch issue",
          issueStatus: "running",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          originBranch: "main",
          workspaceMode: "current_branch",
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workingDir: "/tmp/repo",
          workspacePath: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
        {
          sessionId: 503,
          number: 503,
          issueId: 23,
          issueNumber: 23,
          issueTitle: "Worktree issue",
          issueStatus: "review",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          originBranch: "main",
          workspaceBranch: "issue-23",
          workspaceMode: "worktree",
          lastActiveAt: 1_780_639_000_000,
          startedAt: 1_780_639_000_000,
          closedAt: null,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workingDir: "/tmp/repo",
          workspacePath: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={502} projectId={1} />);

    const sessionList = await findSessionList();
    const currentBranchRow = within(sessionList).getByRole("button", {
      name: /Current branch issue/i,
    });
    const worktreeRow = within(sessionList).getByRole("button", {
      name: /Worktree issue/i,
    });

    expect(currentBranchRow).toHaveTextContent("#22");
    expect(currentBranchRow).toHaveTextContent("main");
    expect(worktreeRow).toHaveTextContent("#23");
    expect(worktreeRow).toHaveTextContent("issue-23");
  });

  it("shows review running sessions as blue without a running spinner", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 501,
          number: 501,
          issueId: 24,
          issueNumber: 24,
          issueTitle: "Review waiting issue",
          issueStatus: "review",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={501} projectId={1} />);

    const sessionList = await screen.findByRole("list", {
      name: "Agent sessions",
    });
    const sessionRow = within(sessionList).getByRole("button", {
      name: /Review waiting issue/i,
    });

    expect(
      within(sessionRow).getByLabelText("Session status: Review"),
    ).toHaveClass("agents-session-row__status-dot--review");
    expect(
      within(sessionRow).queryByLabelText("Session is running"),
    ).not.toBeInTheDocument();
  });

  it("hides the running spinner when the structured turn has completed", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 502,
          number: 502,
          issueId: 25,
          issueNumber: 25,
          issueTitle: "In progress waiting issue",
          issueStatus: "running",
          isTurnRunning: false,
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={502} projectId={1} />);

    const sessionList = await screen.findByRole("list", {
      name: "Agent sessions",
    });
    const sessionRow = within(sessionList).getByRole("button", {
      name: /In progress waiting issue/i,
    });

    expect(
      within(sessionRow).getByLabelText("Session status: In Progress"),
    ).toHaveClass("agents-session-row__status-dot--in-progress");
    expect(
      within(sessionRow).queryByLabelText("Session is running"),
    ).not.toBeInTheDocument();
  });

  it("keeps the running spinner while the structured turn is active", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 503,
          number: 503,
          issueId: 26,
          issueNumber: 26,
          issueTitle: "Active turn issue",
          issueStatus: "running",
          isTurnRunning: true,
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={503} projectId={1} />);

    const sessionList = await screen.findByRole("list", {
      name: "Agent sessions",
    });
    const sessionRow = within(sessionList).getByRole("button", {
      name: /Active turn issue/i,
    });

    expect(
      within(sessionRow).getByLabelText("Session is running"),
    ).toBeInTheDocument();
  });

  it("renders agent type icons without visible text labels", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 302,
          number: 302,
          issueId: 21,
          issueNumber: 21,
          issueTitle: "Blue agent issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
          projectId: 1,
          issueStatus: null,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
        {
          sessionId: 303,
          number: 303,
          issueId: 22,
          issueNumber: 22,
          issueTitle: "Orange agent issue",
          title: null,
          agentType: "claude_code",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
          projectId: 1,
          issueStatus: null,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={302} projectId={1} />);

    const sessionList = await findSessionList();
    const codexRow = within(sessionList).getByRole("button", {
      name: /Blue agent issue/i,
    });
    const claudeRow = within(sessionList).getByRole("button", {
      name: /Orange agent issue/i,
    });

    expect(
      within(codexRow).getByRole("img", { name: "Agent type: Codex" }),
    ).toHaveAttribute("src", codexLogoSrc);
    expect(
      within(claudeRow).getByRole("img", { name: "Agent type: Claude" }),
    ).toHaveAttribute("src", claudeLogoSrc);
    expect(codexRow).not.toHaveTextContent("Codex");
    expect(claudeRow).not.toHaveTextContent("Claude");
  });

  it("creates a new session immediately when only one agent profile is configured", async () => {
    const user = userEvent.setup();
    listAgentProfilesMock.mockImplementation(async ({ scope }) => ({
      profiles: scope === "project" ? defaultProfiles.project : [],
    }));
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 301,
            number: 301,
            issueId: 20,
            issueNumber: 20,
            issueTitle: "Existing issue",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_637_000_000,
            startedAt: 1_780_637_000_000,
            closedAt: null,
            projectId: 1,
            issueStatus: null,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 701,
            number: 701,
            issueId: null,
            issueNumber: null,
            issueTitle: null,
            title: "Untitled Session",
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_500_000,
            startedAt: 1_780_638_500_000,
            closedAt: null,
            projectId: 1,
            issueStatus: null,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
          {
            sessionId: 301,
            number: 301,
            issueId: 20,
            issueNumber: 20,
            issueTitle: "Existing issue",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_637_000_000,
            startedAt: 1_780_637_000_000,
            closedAt: null,
            projectId: 1,
            issueStatus: null,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      })
      .mockResolvedValue({
        sessions: [
          {
            sessionId: 701,
            number: 701,
            issueId: null,
            issueNumber: null,
            issueTitle: null,
            title: "Untitled Session",
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_500_000,
            startedAt: 1_780_638_500_000,
            closedAt: null,
            projectId: 1,
            issueStatus: null,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
          {
            sessionId: 301,
            number: 301,
            issueId: 20,
            issueNumber: 20,
            issueTitle: "Existing issue",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_637_000_000,
            startedAt: 1_780_637_000_000,
            closedAt: null,
            projectId: 1,
            issueStatus: null,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    const newSessionButton = await screen.findByRole("button", {
      name: "New session",
    });
    await waitFor(() => expect(newSessionButton).not.toBeDisabled());

    await user.click(newSessionButton);

    await waitFor(() =>
      expect(startStructuredAgentSessionMock).toHaveBeenCalledWith({
        projectId: 1,
        title: "Untitled Session",
        agentType: "codex",
        agentProfileId: 101,
      }),
    );
    await waitFor(() =>
      expect(listAgentSessionsMock.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    expect(newSessionButton).toHaveFocus();
    expect(
      screen.getByRole("heading", { level: 3, name: "Untitled Session" }),
    ).toBeInTheDocument();
  });

  it("shows standalone session header actions without issue status controls", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 701,
          number: 701,
          issueId: null,
          issueNumber: null,
          issueTitle: null,
          title: "Untitled Session",
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_638_500_000,
          startedAt: 1_780_638_500_000,
          closedAt: null,
          projectId: 1,
          issueStatus: null,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={701} projectId={1} />);

    expect(
      await screen.findByRole("heading", {
        level: 3,
        name: "Untitled Session",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "More session actions" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open terminal" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add session tool" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open session side panel" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mark review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open status options" }),
    ).not.toBeInTheDocument();
  });

  it("deletes a standalone session after confirmation", async () => {
    const user = userEvent.setup();
    const clearComposerDraftSpy = vi.spyOn(
      composerDraftModule,
      "clearComposerDraft",
    );
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 701,
            number: 701,
            issueId: null,
            issueNumber: null,
            issueTitle: null,
            title: "Untitled Session",
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_500_000,
            startedAt: 1_780_638_500_000,
            closedAt: null,
            projectId: 1,
            issueStatus: null,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        sessions: [],
      })
      .mockResolvedValue({
        sessions: [],
      });

    render(<AgentsActivity activeSessionId={701} projectId={1} />);

    const actionsButton = await screen.findByRole("button", {
      name: "More session actions",
    });
    await user.click(actionsButton);
    const deleteMenuItem = await screen.findByRole("menuitem", {
      name: "Delete session",
    });
    await user.click(deleteMenuItem);
    expect(
      screen.getByRole("dialog", { name: "Delete this Session?" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(deleteAgentSessionMock).not.toHaveBeenCalled();

    await user.click(actionsButton);
    await user.click(
      await screen.findByRole("menuitem", { name: "Delete session" }),
    );
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(deleteAgentSessionMock).toHaveBeenCalledWith({
        projectId: 1,
        sessionId: 701,
      }),
    );
    // 删除成功后应清除该 session 的输入草稿缓存（ADR 0006：id 复用必须清理）。
    expect(clearComposerDraftSpy).toHaveBeenCalledWith(701);
    expect(await screen.findByText("No sessions.")).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Session" }),
    ).not.toBeInTheDocument();
    expect(toastSuccessMock).toHaveBeenCalledWith("Deleted successfully");
  });

  it("renames standalone session from header actions", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 701,
            number: 701,
            issueId: null,
            issueNumber: null,
            issueTitle: null,
            title: "Untitled Session",
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_500_000,
            startedAt: 1_780_638_500_000,
            closedAt: null,
            projectId: 1,
            issueStatus: null,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      })
      .mockResolvedValue({
        sessions: [
          {
            sessionId: 701,
            number: 701,
            issueId: null,
            issueNumber: null,
            issueTitle: null,
            title: "Renamed Session",
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_600_000,
            startedAt: 1_780_638_500_000,
            closedAt: null,
            projectId: 1,
            issueStatus: null,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      });

    render(<AgentsActivity activeSessionId={701} projectId={1} />);

    await user.click(
      await screen.findByRole("button", { name: "More session actions" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Rename session title" }),
    );

    const titleInput = screen.getByRole("textbox", {
      name: "Session title",
    });
    expect(titleInput).toHaveValue("Untitled Session");

    await user.clear(titleInput);
    await user.type(titleInput, "Renamed Session");
    await user.click(
      screen.getByRole("button", { name: "Save session title" }),
    );

    await waitFor(() =>
      expect(updateAgentSessionTitleMock).toHaveBeenCalledWith({
        projectId: 1,
        sessionId: 701,
        title: "Renamed Session",
      }),
    );
    expect(
      await screen.findByRole("heading", {
        level: 3,
        name: "Renamed Session",
      }),
    ).toBeInTheDocument();
  });

  it("cancels standalone session title editing without saving", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 701,
          number: 701,
          issueId: null,
          issueNumber: null,
          issueTitle: null,
          title: "Untitled Session",
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_638_500_000,
          startedAt: 1_780_638_500_000,
          closedAt: null,
          projectId: 1,
          issueStatus: null,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={701} projectId={1} />);

    await user.click(
      await screen.findByRole("button", { name: "More session actions" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Rename session title" }),
    );
    await user.clear(screen.getByRole("textbox", { name: "Session title" }));
    await user.type(
      screen.getByRole("textbox", { name: "Session title" }),
      "Draft title",
    );
    await user.click(
      screen.getByRole("button", { name: "Cancel session title editing" }),
    );

    expect(updateAgentSessionTitleMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { level: 3, name: "Untitled Session" }),
    ).toBeInTheDocument();
  });

  it("prompts to open agent settings when no agent profiles are available", async () => {
    const user = userEvent.setup();
    const handleOpenProjectAgentSettings = vi.fn();
    listAgentProfilesMock.mockImplementation(async () => ({ profiles: [] }));
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          number: 301,
          issueId: 20,
          issueNumber: 20,
          issueTitle: "Existing issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
          projectId: 1,
          issueStatus: null,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(
      <AgentsActivity
        activeSessionId={301}
        onOpenProjectAgentSettings={handleOpenProjectAgentSettings}
        projectId={1}
      />,
    );

    await user.click(
      await screen.findByRole("button", {
        name: "New session",
      }),
    );

    const confirmation = await screen.findByRole("dialog", {
      name: "No Agent is available. Create one now?",
    });
    expect(
      within(confirmation).getByText("No Agent is available. Create one now?"),
    ).toBeInTheDocument();
    await user.click(within(confirmation).getByRole("button", { name: "Yes" }));

    expect(handleOpenProjectAgentSettings).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("shows all configured agent profiles by name when multiple agents are configured", async () => {
    const user = userEvent.setup();
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return {
          profiles: [
            defaultProfiles.project[0],
            {
              ...defaultProfiles.project[0],
              id: 102,
              name: "Second Codex Agent",
            },
            {
              ...defaultProfiles.project[0],
              id: 103,
              name: "Claude Agent",
              agentType: "claude",
              command: "claude",
            },
          ],
        };
      }

      return {
        profiles: [defaultProfiles.global[0]],
      };
    });
    listAgentSessionsMock.mockResolvedValueOnce({
      sessions: [
        {
          sessionId: 301,
          number: 301,
          issueId: 20,
          issueNumber: 20,
          issueTitle: "Existing issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
          projectId: 1,
          issueStatus: null,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "New session" }),
      ).not.toBeDisabled(),
    );
    await user.click(screen.getByRole("button", { name: "New session" }));

    expect(
      await screen.findByRole("menuitem", { name: "Project Agent" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Second Codex Agent" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Claude Agent" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Global Agent" }),
    ).toBeInTheDocument();
    expect(startStructuredAgentSessionMock).not.toHaveBeenCalled();
  });

  it("creates a session for the selected agent profile from the picker", async () => {
    const user = userEvent.setup();
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return {
          profiles: [
            defaultProfiles.project[0],
            {
              ...defaultProfiles.project[0],
              id: 102,
              name: "Second Codex Agent",
            },
            {
              ...defaultProfiles.project[0],
              id: 103,
              name: "Claude Agent",
              agentType: "claude",
              command: "claude",
            },
          ],
        };
      }

      return {
        profiles: [defaultProfiles.global[0]],
      };
    });
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 301,
            number: 301,
            issueId: 20,
            issueNumber: 20,
            issueTitle: "Existing issue",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_637_000_000,
            startedAt: 1_780_637_000_000,
            closedAt: null,
            projectId: 1,
            issueStatus: null,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 701,
            number: 701,
            issueId: null,
            issueNumber: null,
            issueTitle: null,
            title: "Untitled Session",
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_500_000,
            startedAt: 1_780_638_500_000,
            closedAt: null,
            projectId: 1,
            issueStatus: null,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
          {
            sessionId: 301,
            number: 301,
            issueId: 20,
            issueNumber: 20,
            issueTitle: "Existing issue",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_637_000_000,
            startedAt: 1_780_637_000_000,
            closedAt: null,
            projectId: 1,
            issueStatus: null,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      })
      .mockResolvedValue({
        sessions: [
          {
            sessionId: 701,
            number: 701,
            issueId: null,
            issueNumber: null,
            issueTitle: null,
            title: "Untitled Session",
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_500_000,
            startedAt: 1_780_638_500_000,
            closedAt: null,
            projectId: 1,
            issueStatus: null,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
          {
            sessionId: 301,
            number: 301,
            issueId: 20,
            issueNumber: 20,
            issueTitle: "Existing issue",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_637_000_000,
            startedAt: 1_780_637_000_000,
            closedAt: null,
            projectId: 1,
            issueStatus: null,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "New session" }),
      ).not.toBeDisabled(),
    );
    await user.click(screen.getByRole("button", { name: "New session" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Global Agent" }),
    );

    await waitFor(() =>
      expect(startStructuredAgentSessionMock).toHaveBeenCalledWith({
        projectId: 1,
        title: "Untitled Session",
        agentType: "codex",
        agentProfileId: 201,
      }),
    );
    await waitFor(() =>
      expect(listAgentSessionsMock.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    expect(
      screen.getByRole("heading", { level: 3, name: "Untitled Session" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("complementary", { name: "Linked issue" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/^Issue$/)).not.toBeInTheDocument();
    expect(screen.queryByText("No linked issue")).not.toBeInTheDocument();
  });

  it("shows the start failure reason inline when session creation fails", async () => {
    const user = userEvent.setup();
    listAgentProfilesMock.mockImplementation(async ({ scope }) => ({
      profiles: scope === "project" ? defaultProfiles.project : [],
    }));
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          number: 301,
          issueId: 20,
          issueNumber: 20,
          issueTitle: "Existing issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
          projectId: 1,
          issueStatus: null,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });
    startStructuredAgentSessionMock.mockRejectedValue({
      code: "AGENT_SESSION_START_FAILED",
      message: "Agent 进程启动失败。",
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    await user.click(
      await screen.findByRole("button", {
        name: "New session",
      }),
    );
    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Agent 进程启动失败。");
    });
    expect(listAgentSessionsMock).toHaveBeenCalledTimes(1);
  });

  it("groups sessions by linked issue status without rendering backlog", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 302,
          number: 302,
          issueId: 21,
          issueNumber: 21,
          issueTitle: "Running issue",
          issueStatus: "running",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
        {
          sessionId: 303,
          number: 303,
          issueId: 25,
          issueNumber: 25,
          issueTitle: "Review issue",
          issueStatus: "review",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_636_000_000,
          startedAt: 1_780_636_000_000,
          closedAt: null,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
        {
          sessionId: 401,
          number: 401,
          issueId: 22,
          issueNumber: 22,
          issueTitle: "Closed issue",
          issueStatus: "completed",
          title: null,
          agentType: "codex",
          status: "closed",
          attention: "none",
          lastActiveAt: 1_780_630_000_000,
          startedAt: 1_780_629_000_000,
          closedAt: 1_780_631_000_000,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: false,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
        {
          sessionId: 402,
          number: 402,
          issueId: 23,
          issueNumber: 23,
          issueTitle: "Crashed issue",
          issueStatus: "running",
          title: null,
          agentType: "codex",
          status: "crashed",
          attention: "none",
          lastActiveAt: 1_780_632_000_000,
          startedAt: 1_780_631_000_000,
          closedAt: 1_780_633_000_000,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: false,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
        {
          sessionId: 403,
          number: 403,
          issueId: 24,
          issueNumber: 24,
          issueTitle: "Stopped issue",
          issueStatus: "review",
          title: null,
          agentType: "codex",
          status: "stopped",
          attention: "none",
          lastActiveAt: 1_780_634_000_000,
          startedAt: 1_780_633_000_000,
          closedAt: 1_780_635_000_000,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: false,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
        {
          sessionId: 404,
          number: 404,
          issueId: 26,
          issueNumber: 26,
          issueTitle: "Backlog issue",
          issueStatus: "backlog",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_635_000_000,
          startedAt: 1_780_635_000_000,
          closedAt: null,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
        {
          sessionId: 405,
          number: 405,
          issueId: null,
          issueNumber: null,
          issueTitle: null,
          issueStatus: null,
          title: "Finished scratch session",
          agentType: "codex",
          status: "closed",
          attention: "none",
          lastActiveAt: 1_780_636_000_000,
          startedAt: 1_780_635_000_000,
          closedAt: 1_780_636_500_000,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: false,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={302} projectId={1} />);

    const sessionList = await findSessionList();
    expect(
      within(sessionList).getByRole("button", { name: /Running issue/i }),
    ).toBeInTheDocument();
    expect(
      within(sessionList).getByRole("button", { name: /Crashed issue/i }),
    ).toBeInTheDocument();
    expect(
      within(sessionList).getByRole("button", { name: /Review issue/i }),
    ).toBeInTheDocument();
    expect(
      within(sessionList).getByRole("button", { name: /Stopped issue/i }),
    ).toBeInTheDocument();
    expect(
      within(sessionList).getByRole("button", { name: /Closed issue/i }),
    ).toBeInTheDocument();
    expect(
      within(sessionList).getByRole("button", {
        name: /Finished scratch session/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Backlog issue/i }),
    ).not.toBeInTheDocument();
  });

  it("allows manually switching to another session even when an initial active session is provided", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 302,
          number: 302,
          issueId: 21,
          issueNumber: 21,
          issueTitle: "Running issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
          projectId: 1,
          issueStatus: null,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
        {
          sessionId: 301,
          number: 301,
          issueId: 20,
          issueNumber: 20,
          issueTitle: "Existing issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
          projectId: 1,
          issueStatus: null,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    const sessionList = await findSessionList();
    const existingIssueRow = within(sessionList).getByRole("button", {
      name: /Existing issue/i,
    });
    const runningIssueRow = within(sessionList).getByRole("button", {
      name: /Running issue/i,
    });

    expect(existingIssueRow).toHaveAttribute("aria-pressed", "true");

    await user.click(runningIssueRow);

    expect(runningIssueRow).toHaveAttribute("aria-pressed", "true");
    expect(existingIssueRow).toHaveAttribute("aria-pressed", "false");
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "#21 Running issue" }),
      ).toBeInTheDocument(),
    );
  });

  it("keeps attention session rows orange after selecting another session", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 302,
          number: 302,
          issueId: 21,
          issueNumber: 21,
          issueTitle: "Needs attention issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "requested",
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
          projectId: 1,
          issueStatus: null,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
        {
          sessionId: 303,
          number: 303,
          issueId: 22,
          issueNumber: 22,
          issueTitle: "Quiet issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
          projectId: 1,
          issueStatus: null,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
        {
          sessionId: 304,
          number: 304,
          issueId: 23,
          issueNumber: 23,
          issueTitle: "Selected issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_636_000_000,
          startedAt: 1_780_636_000_000,
          closedAt: null,
          projectId: 1,
          issueStatus: null,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={304} projectId={1} />);

    const sessionList = await findSessionList();
    const attentionRow = within(sessionList).getByRole("button", {
      name: /Needs attention issue/i,
    });
    const quietRow = within(sessionList).getByRole("button", {
      name: /Quiet issue/i,
    });

    expect(
      within(attentionRow).getByLabelText("Session status: Output complete"),
    ).toHaveClass("agents-session-row__status-dot--attention");
    expect(
      within(attentionRow).queryByLabelText("Session is running"),
    ).not.toBeInTheDocument();
    expect(
      within(quietRow).getByLabelText("Session status: Running"),
    ).toHaveClass("agents-session-row__status-dot--running");
    expect(
      within(quietRow).getByLabelText("Session is running"),
    ).toBeInTheDocument();

    await user.click(quietRow);

    expect(
      within(attentionRow).getByLabelText("Session status: Output complete"),
    ).toHaveClass("agents-session-row__status-dot--attention");
    expect(
      within(attentionRow).queryByLabelText("Session is running"),
    ).not.toBeInTheDocument();
    expect(attentionRow).not.toHaveTextContent("running");
    expect(quietRow).not.toHaveTextContent("running");
  });

  it("shows a gray output status dot for completed sessions", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 401,
          number: 401,
          issueId: 22,
          issueNumber: 22,
          issueTitle: "Closed issue",
          title: null,
          agentType: "codex",
          status: "closed",
          attention: "none",
          logPath: "/tmp/closed.log",
          lastActiveAt: 1_780_630_000_000,
          startedAt: 1_780_629_000_000,
          closedAt: 1_780_631_000_000,
          projectId: 1,
          issueStatus: null,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: false,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={401} projectId={1} />);

    const sessionList = await findSessionList();
    const completedRow = within(sessionList).getByRole("button", {
      name: /Closed issue/i,
    });

    expect(
      within(completedRow).getByLabelText("Session status: Completed"),
    ).toHaveClass("agents-session-row__status-dot--done");
    expect(completedRow).toHaveTextContent("Completed");
  });

  it("shows crashed status without exposing a header log opener", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 402,
          number: 402,
          issueId: 23,
          issueNumber: 23,
          issueTitle: "Crashed issue",
          issueStatus: "running",
          title: null,
          agentType: "codex",
          status: "crashed",
          attention: "none",
          logPath: "/tmp/crashed.log",
          lastActiveAt: 1_780_632_000_000,
          startedAt: 1_780_631_000_000,
          closedAt: 1_780_633_000_000,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: false,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={402} projectId={1} />);

    const sessionList = await findSessionList();
    const crashedRow = within(sessionList).getByRole("button", {
      name: /Crashed issue/i,
    });

    expect(crashedRow).toHaveTextContent("Failed");
    expect(
      await screen.findByRole("heading", { name: "#23 Crashed issue" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Status: Failed")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open Log" }),
    ).not.toBeInTheDocument();
    expect(openPathMock).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Open Session" }),
    ).not.toBeInTheDocument();
  });

  it("shows stopped status without exposing a header log opener", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 403,
          number: 403,
          issueId: 24,
          issueNumber: 24,
          issueTitle: "Stopped issue",
          issueStatus: "running",
          title: null,
          agentType: "codex",
          status: "stopped",
          attention: "none",
          logPath: "/tmp/stopped.log",
          lastActiveAt: 1_780_633_000_000,
          startedAt: 1_780_632_000_000,
          closedAt: 1_780_634_000_000,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: false,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={403} projectId={1} />);

    const sessionList = await findSessionList();
    const stoppedRow = within(sessionList).getByRole("button", {
      name: /Stopped issue/i,
    });

    expect(stoppedRow).toHaveTextContent("Stopped");
    expect(
      await screen.findByRole("heading", { name: "#24 Stopped issue" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Status: Stopped")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open Log" }),
    ).not.toBeInTheDocument();
    expect(openPathMock).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Open Session" }),
    ).not.toBeInTheDocument();
  });

  it("polls the session list and refreshes the attention dot", async () => {
    vi.useFakeTimers();
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            number: 302,
            issueId: 21,
            issueNumber: 21,
            issueTitle: "Polling issue",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_000_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
            projectId: 1,
            issueStatus: null,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
          {
            sessionId: 303,
            number: 303,
            issueId: 22,
            issueNumber: 22,
            issueTitle: "Selected polling issue",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_637_000_000,
            startedAt: 1_780_637_000_000,
            closedAt: null,
            projectId: 1,
            issueStatus: null,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            number: 302,
            issueId: 21,
            issueNumber: 21,
            issueTitle: "Polling issue",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "requested",
            lastActiveAt: 1_780_638_000_500,
            startedAt: 1_780_638_000_000,
            closedAt: null,
            projectId: 1,
            issueStatus: null,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
          {
            sessionId: 303,
            number: 303,
            issueId: 22,
            issueNumber: 22,
            issueTitle: "Selected polling issue",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_637_000_000,
            startedAt: 1_780_637_000_000,
            closedAt: null,
            projectId: 1,
            issueStatus: null,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      });

    render(<AgentsActivity activeSessionId={303} projectId={1} />);

    await act(async () => {
      await Promise.resolve();
    });
    const sessionList = screen.getByRole("list", { name: "Agent sessions" });
    const initialRow = getSessionRowByIssue(sessionList, 21, "Polling issue");
    expect(
      within(initialRow).getByLabelText("Session status: Running"),
    ).toHaveClass("agents-session-row__status-dot--running");

    await emitSessionListChanged(1, 302);

    const refreshedRow = getSessionRowByIssue(sessionList, 21, "Polling issue");
    expect(
      within(refreshedRow).getByLabelText("Session status: Output complete"),
    ).toHaveClass("agents-session-row__status-dot--attention");
    expect(
      within(refreshedRow).queryByLabelText("Session is running"),
    ).not.toBeInTheDocument();
  });

  it("keeps a running session green after the user clicks it", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 303,
          number: 303,
          issueId: 22,
          issueNumber: 22,
          issueTitle: "Initially selected issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
          projectId: 1,
          issueStatus: null,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
        {
          sessionId: 302,
          number: 302,
          issueId: 21,
          issueNumber: 21,
          issueTitle: "Viewed session issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
          projectId: 1,
          issueStatus: null,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={303} projectId={1} />);

    const sessionList = await findSessionList();
    const sessionRow = await within(sessionList).findByRole("button", {
      name: /Viewed session issue/i,
    });

    expect(
      within(sessionRow).getByLabelText("Session status: Running"),
    ).toHaveClass("agents-session-row__status-dot--running");
    expect(
      within(sessionRow).getByLabelText("Session is running"),
    ).toBeInTheDocument();

    await user.click(sessionRow);

    expect(
      within(sessionRow).getByLabelText("Session status: Running"),
    ).toHaveClass("agents-session-row__status-dot--running");
    expect(
      within(sessionRow).getByLabelText("Session is running"),
    ).toBeInTheDocument();
    expect(setAgentSessionAttentionMock).not.toHaveBeenCalled();
  });

  it("keeps the current session row green while new session activity arrives", async () => {
    vi.useFakeTimers();
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            number: 302,
            issueId: 21,
            issueNumber: 21,
            issueTitle: "Viewed polling issue",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_000_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
            projectId: 1,
            issueStatus: null,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            number: 302,
            issueId: 21,
            issueNumber: 21,
            issueTitle: "Viewed polling issue",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_002_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
            projectId: 1,
            issueStatus: null,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      });

    render(<AgentsActivity activeSessionId={302} projectId={1} />);

    await act(async () => {
      await Promise.resolve();
    });

    const sessionList = screen.getByRole("list", { name: "Agent sessions" });
    const sessionRow = within(sessionList).getByRole("button", {
      name: /Viewed polling issue/i,
    });

    fireEvent.click(sessionRow);
    expect(
      within(sessionRow).getByLabelText("Session status: Running"),
    ).toHaveClass("agents-session-row__status-dot--running");
    expect(
      within(sessionRow).getByLabelText("Session is running"),
    ).toBeInTheDocument();

    await emitSessionListChanged(1, 302);

    expect(
      within(sessionRow).getByLabelText("Session status: Running"),
    ).toHaveClass("agents-session-row__status-dot--running");
    expect(
      within(sessionRow).getByLabelText("Session is running"),
    ).toBeInTheDocument();
  });

  it("marks a linked running issue for review from the session header and refreshes sessions", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            number: 302,
            issueId: 21,
            issueNumber: 21,
            issueTitle: "Review candidate",
            issueStatus: "running",
            isTurnRunning: true,
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_000_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
            projectId: 1,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            number: 302,
            issueId: 21,
            issueNumber: 21,
            issueTitle: "Review candidate",
            issueStatus: "review",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_001_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
            projectId: 1,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      });
    markIssueReviewMock.mockResolvedValue({
      id: 21,
      number: 21,
      projectId: 1,
      title: "Review candidate",
      description: "",
      status: "review",
      linkedSessionId: 302,
      linkedSessionStatus: "running",
      linkedSessionAttention: "none",
      createdAt: 1_780_637_000_000,
      updatedAt: 1_780_638_001_000,
      statusChangedAt: 1_780_638_001_000,
      attachments: [],
      labels: [],
      linkedSessionLogPath: null,
      linkedSessionLatestOutput: null,    });

    render(<AgentsActivity activeSessionId={302} projectId={1} />);

    expect(
      await screen.findByRole("heading", {
        level: 3,
        name: "#21 Review candidate",
      }),
    ).toBeInTheDocument();

    const markReviewButton = screen.getByRole("button", {
      name: "Mark review",
    });
    await user.click(markReviewButton);
    await user.click(await screen.findByRole("button", { name: "Yes" }));

    expect(markIssueReviewMock).toHaveBeenCalledWith({
      projectId: 1,
      issueId: 21,
    });
    await waitFor(() => expect(listAgentSessionsMock).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole("button", { name: "Mark review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("Agent session message stream"),
    ).toBeInTheDocument();
  });

  it("marks review without confirmation when the linked session is already finished", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            number: 302,
            issueId: 21,
            issueNumber: 21,
            issueTitle: "Review candidate",
            issueStatus: "running",
            title: null,
            agentType: "codex",
            status: "closed",
            attention: "none",
            lastActiveAt: 1_780_638_000_000,
            startedAt: 1_780_638_000_000,
            closedAt: 1_780_638_000_500,
            projectId: 1,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: false,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            number: 302,
            issueId: 21,
            issueNumber: 21,
            issueTitle: "Review candidate",
            issueStatus: "review",
            title: null,
            agentType: "codex",
            status: "closed",
            attention: "none",
            lastActiveAt: 1_780_638_001_000,
            startedAt: 1_780_638_000_000,
            closedAt: 1_780_638_000_500,
            projectId: 1,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: false,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      });
    markIssueReviewMock.mockResolvedValue({
      id: 21,
      number: 21,
      projectId: 1,
      title: "Review candidate",
      description: "",
      status: "review",
      linkedSessionId: 302,
      linkedSessionStatus: "closed",
      linkedSessionAttention: "none",
      createdAt: 1_780_637_000_000,
      updatedAt: 1_780_638_001_000,
      statusChangedAt: 1_780_638_001_000,
      attachments: [],
      labels: [],
      linkedSessionLogPath: null,
      linkedSessionLatestOutput: null,    });

    render(<AgentsActivity activeSessionId={302} projectId={1} />);

    expect(
      await screen.findByRole("heading", {
        level: 3,
        name: "#21 Review candidate",
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mark review" }));

    expect(
      screen.queryByRole("button", { name: "Yes" }),
    ).not.toBeInTheDocument();
    expect(markIssueReviewMock).toHaveBeenCalledWith({
      projectId: 1,
      issueId: 21,
    });
    await waitFor(() => expect(listAgentSessionsMock).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole("button", { name: "Mark review" }),
    ).not.toBeInTheDocument();
  });

  it("marks review without confirmation when the session is open but the turn is idle", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            number: 302,
            issueId: 21,
            issueNumber: 21,
            issueTitle: "Review candidate",
            issueStatus: "running",
            isTurnRunning: false,
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_000_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
            projectId: 1,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            number: 302,
            issueId: 21,
            issueNumber: 21,
            issueTitle: "Review candidate",
            issueStatus: "review",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_001_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
            projectId: 1,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      });
    markIssueReviewMock.mockResolvedValue({
      id: 21,
      number: 21,
      projectId: 1,
      title: "Review candidate",
      description: "",
      status: "review",
      linkedSessionId: 302,
      linkedSessionStatus: "running",
      linkedSessionAttention: "none",
      createdAt: 1_780_637_000_000,
      updatedAt: 1_780_638_001_000,
      statusChangedAt: 1_780_638_001_000,
      attachments: [],
      labels: [],
      linkedSessionLogPath: null,
      linkedSessionLatestOutput: null,    });

    render(<AgentsActivity activeSessionId={302} projectId={1} />);

    expect(
      await screen.findByRole("heading", {
        level: 3,
        name: "#21 Review candidate",
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mark review" }));

    expect(
      screen.queryByRole("button", { name: "Yes" }),
    ).not.toBeInTheDocument();
    expect(markIssueReviewMock).toHaveBeenCalledWith({
      projectId: 1,
      issueId: 21,
    });
    await waitFor(() => expect(listAgentSessionsMock).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole("button", { name: "Mark review" }),
    ).not.toBeInTheDocument();
  });

  it("shows mark review command failures in alert dialog", async () => {
    const user = userEvent.setup();
    const errorMessage = "只有运行中的 Issue 可以标记待验收。";
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 302,
          number: 302,
          issueId: 21,
          issueNumber: 21,
          issueTitle: "Review candidate",
          issueStatus: "running",
          isTurnRunning: true,
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });
    markIssueReviewMock.mockRejectedValueOnce({
      code: "ISSUE_VALIDATION_FAILED",
      message: errorMessage,
    });

    render(<AgentsActivity activeSessionId={302} projectId={1} />);

    await user.click(
      await screen.findByRole("button", { name: "Mark review" }),
    );
    await user.click(await screen.findByRole("button", { name: "Yes" }));

    expect(
      await screen.findByRole("dialog", { name: errorMessage }),
    ).toBeInTheDocument();
    expect(
      document.querySelector(".agents-session-status-stack"),
    ).not.toBeInTheDocument();
  });

  it("hides mark review after command success when refreshing sessions fails", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            number: 302,
            issueId: 21,
            issueNumber: 21,
            issueTitle: "Review candidate",
            issueStatus: "running",
            isTurnRunning: true,
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_000_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
            projectId: 1,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      })
      .mockRejectedValueOnce(new Error("refresh failed"));
    markIssueReviewMock.mockResolvedValue({
      id: 21,
      number: 21,
      projectId: 1,
      title: "Review candidate",
      description: "",
      status: "review",
      linkedSessionId: 302,
      linkedSessionStatus: "running",
      linkedSessionAttention: "none",
      createdAt: 1_780_637_000_000,
      updatedAt: 1_780_638_001_000,
      statusChangedAt: 1_780_638_001_000,
      attachments: [],
      labels: [],
      linkedSessionLogPath: null,
      linkedSessionLatestOutput: null,    });

    render(<AgentsActivity activeSessionId={302} projectId={1} />);

    await user.click(
      await screen.findByRole("button", {
        name: "Mark review",
      }),
    );
    await user.click(await screen.findByRole("button", { name: "Yes" }));

    await waitFor(() => expect(listAgentSessionsMock).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole("button", { name: "Mark review" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("refresh failed")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Agent session message stream"),
    ).toBeInTheDocument();
  });

  it("keeps mark review hidden when an older event refresh returns running after command success", async () => {
    vi.useFakeTimers();
    let resolveEventRefreshResponse:
      | ((response: Awaited<ReturnType<typeof listAgentSessions>>) => void)
      | null = null;
    const eventRefreshResponse = new Promise<
      Awaited<ReturnType<typeof listAgentSessions>>
    >((resolve) => {
      resolveEventRefreshResponse = resolve;
    });
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            number: 302,
            issueId: 21,
            issueNumber: 21,
            issueTitle: "Review candidate",
            issueStatus: "running",
            isTurnRunning: true,
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_000_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
            projectId: 1,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      })
      .mockReturnValueOnce(eventRefreshResponse)
      .mockRejectedValueOnce(new Error("refresh failed"));
    markIssueReviewMock.mockResolvedValue({
      id: 21,
      number: 21,
      projectId: 1,
      title: "Review candidate",
      description: "",
      status: "review",
      linkedSessionId: 302,
      linkedSessionStatus: "running",
      linkedSessionAttention: "none",
      createdAt: 1_780_637_000_000,
      updatedAt: 1_780_638_001_000,
      statusChangedAt: 1_780_638_001_000,
      attachments: [],
      labels: [],
      linkedSessionLogPath: null,
      linkedSessionLatestOutput: null,    });

    render(<AgentsActivity activeSessionId={302} projectId={1} />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.getByRole("button", { name: "Mark review" }),
    ).toBeInTheDocument();
    await emitSessionListChanged(1, 302);
    expect(listAgentSessionsMock).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Mark review" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(listAgentSessionsMock).toHaveBeenCalledTimes(3);
    expect(
      screen.queryByRole("button", { name: "Mark review" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      resolveEventRefreshResponse?.({
        sessions: [
          {
            sessionId: 302,
            number: 302,
            issueId: 21,
            issueNumber: 21,
            issueTitle: "Review candidate",
            issueStatus: "running",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_637_999_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
            projectId: 1,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      });
    });

    expect(
      screen.queryByRole("button", { name: "Mark review" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("refresh failed")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Agent session message stream"),
    ).toBeInTheDocument();
  });

  it("refreshes sessions after mark review command fails without unmounting terminal", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            number: 302,
            issueId: 21,
            issueNumber: 21,
            issueTitle: "Review candidate",
            issueStatus: "running",
            isTurnRunning: true,
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_000_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
            projectId: 1,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            number: 302,
            issueId: 21,
            issueNumber: 21,
            issueTitle: "Review candidate",
            issueStatus: "review",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_001_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
            projectId: 1,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      });
    markIssueReviewMock.mockRejectedValue(new Error("already review"));

    render(<AgentsActivity activeSessionId={302} projectId={1} />);

    await user.click(
      await screen.findByRole("button", {
        name: "Mark review",
      }),
    );
    await user.click(await screen.findByRole("button", { name: "Yes" }));

    await waitFor(() => expect(listAgentSessionsMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText("already review")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mark review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("Agent session message stream"),
    ).toBeInTheDocument();
  });

  it("hides mark review when the selected session has no linked running issue", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 501,
          number: 501,
          issueId: null,
          issueNumber: null,
          issueTitle: null,
          issueStatus: null,
          title: "Temporary session",
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
        {
          sessionId: 502,
          number: 502,
          issueId: 22,
          issueNumber: 22,
          issueTitle: "Review issue",
          issueStatus: "review",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
        {
          sessionId: 503,
          number: 503,
          issueId: 23,
          issueNumber: 23,
          issueTitle: "Completed issue",
          issueStatus: "completed",
          title: null,
          agentType: "codex",
          status: "closed",
          attention: "none",
          lastActiveAt: 1_780_636_000_000,
          startedAt: 1_780_635_000_000,
          closedAt: 1_780_636_500_000,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: false,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={501} projectId={1} />);

    expect(
      await screen.findByRole("heading", {
        level: 3,
        name: "Temporary session",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mark review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("Agent session message stream"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Review issue/i }));
    expect(
      await screen.findByRole("heading", { name: "#22 Review issue" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mark review" }),
    ).not.toBeInTheDocument();

    const sessionList = screen.getByRole("list", { name: "Agent sessions" });
    await user.click(
      within(sessionList).getByRole("button", { name: /Completed issue/i }),
    );
    expect(
      await screen.findByRole("heading", {
        level: 3,
        name: "#23 Completed issue",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mark review" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the same review session selected with terminal mounted", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 502,
          number: 502,
          issueId: 22,
          issueNumber: 22,
          issueTitle: "Review issue",
          issueStatus: "review",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
        {
          sessionId: 503,
          number: 503,
          issueId: 23,
          issueNumber: 23,
          issueTitle: "Another running issue",
          issueStatus: "running",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_636_000_000,
          startedAt: 1_780_636_000_000,
          closedAt: null,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={502} projectId={1} />);

    const sessionList = await findSessionList();
    expect(
      await screen.findByRole("heading", {
        level: 3,
        name: "#22 Review issue",
      }),
    ).toBeInTheDocument();
    expect(
      within(sessionList).getByRole("button", { name: /Review issue/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.queryByRole("button", { name: "Mark review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mark done" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open status options" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mark review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "View Summary" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open Log" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("Agent session message stream"),
    ).toBeInTheDocument();
  });

  it("shows the manual completion action on review header without placeholder follow-up actions", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 502,
          number: 502,
          issueId: 22,
          issueNumber: 22,
          issueTitle: "Review issue",
          issueStatus: "review",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={502} projectId={1} />);

    expect(
      await screen.findByRole("heading", { name: "#22 Review issue" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mark review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mark done" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open status options" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mark review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "View Summary" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open Log" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("Agent session message stream"),
    ).toBeInTheDocument();
  });

  it("shows agent commit action for dirty review sessions and opens completion confirmation", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 502,
          number: 502,
          issueId: 22,
          issueNumber: 22,
          issueTitle: "Review issue",
          issueStatus: "review",
          canCompleteClean: false,
          canCompleteAgentCommit: true,
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          isTurnRunning: false,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={502} projectId={1} />);

    expect(
      await screen.findByRole("button", { name: "Mark done" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open status options" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mark review" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mark done" }));

    expect(prepareAgentCommitCompletionMock).toHaveBeenCalledWith({
      projectId: 1,
      issueId: 22,
    });

    const dialog = await screen.findByRole("dialog", {
      name: "Completion Confirmation",
    });
    expect(within(dialog).getByText("HEAD: 4157f0c")).toBeInTheDocument();
    expect(within(dialog).getByText("Changed files: 2")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Completion option: complete_agent_commit"),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByText(
        "请仅处理当前 Issue 相关改动，并在确认无误后提交。",
      ),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText("Completion prompt"),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Submit code" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Mark done" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Completion Confirmation" }),
      ).not.toBeInTheDocument(),
    );
    expect(completeIssueCleanMock).not.toHaveBeenCalled();
  });

  it("completes an agent auto commit review session when the preview finds a clean worktree", async () => {
    const user = userEvent.setup();
    prepareAgentCommitCompletionMock.mockRejectedValueOnce({
      code: "ISSUE_VALIDATION_FAILED",
      message: "当前仓库无未提交改动，请直接使用 Complete。",
      details: [
        {
          "@type": "GitStatus",
          head: "4157f0c",
          isClean: true,
        },
      ],
    });
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 502,
            number: 502,
            issueId: 22,
            issueNumber: 22,
            issueTitle: "Review issue",
            issueStatus: "review",
            canCompleteClean: false,
            canCompleteAgentCommit: true,
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_637_000_000,
            startedAt: 1_780_637_000_000,
            closedAt: null,
            projectId: 1,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            isTurnRunning: false,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 502,
            number: 502,
            issueId: 22,
            issueNumber: 22,
            issueTitle: "Review issue",
            issueStatus: "completed",
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            title: null,
            agentType: "codex",
            status: "closed",
            attention: "none",
            lastActiveAt: 1_780_639_000_000,
            startedAt: 1_780_637_000_000,
            closedAt: 1_780_639_000_000,
            projectId: 1,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            isTurnRunning: false,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      });

    render(<AgentsActivity activeSessionId={502} projectId={1} />);

    await user.click(await screen.findByRole("button", { name: "Mark done" }));

    expect(prepareAgentCommitCompletionMock).toHaveBeenCalledWith({
      projectId: 1,
      issueId: 22,
    });
    expect(completeIssueFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 1, issueId: 22 }),
    );
    await waitFor(() => expect(listAgentSessionsMock).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByText("当前仓库无未提交改动，请直接使用 Complete。"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mark done" }),
    ).not.toBeInTheDocument();
    expect(toastSuccessMock).toHaveBeenCalledWith("Issue marked as done");
  });

  it("marks a dirty review session done directly from completion confirmation", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 502,
            number: 502,
            issueId: 22,
            issueNumber: 22,
            issueTitle: "Review issue",
            issueStatus: "review",
            canCompleteClean: false,
            canCompleteAgentCommit: true,
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_637_000_000,
            startedAt: 1_780_637_000_000,
            closedAt: null,
            projectId: 1,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            isTurnRunning: false,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 502,
            number: 502,
            issueId: 22,
            issueNumber: 22,
            issueTitle: "Review issue",
            issueStatus: "completed",
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            title: null,
            agentType: "codex",
            status: "closed",
            attention: "none",
            lastActiveAt: 1_780_639_000_000,
            startedAt: 1_780_637_000_000,
            closedAt: 1_780_639_000_000,
            projectId: 1,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            isTurnRunning: false,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      });

    render(<AgentsActivity activeSessionId={502} projectId={1} />);

    await user.click(await screen.findByRole("button", { name: "Mark done" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Completion Confirmation",
    });
    await user.click(within(dialog).getByRole("button", { name: "Mark done" }));

    expect(completeIssueFlowMock).toHaveBeenCalledWith({
      projectId: 1,
      issueId: 22,
      ignoreDirty: true,
    });
    expect(sendAgentCommitPromptMock).not.toHaveBeenCalled();
    expect(detectAgentCommitCompletionMock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Completion Confirmation" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Mark done" }),
    ).not.toBeInTheDocument();
  });

  it("shows dismissible loading dialog while completing linked issue", async () => {
    const user = userEvent.setup();
    const completion =
      deferred<Awaited<ReturnType<typeof completeIssueFlow>>>();
    completeIssueFlowMock.mockReturnValueOnce(completion.promise);
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 502,
          number: 502,
          issueId: 22,
          issueNumber: 22,
          issueTitle: "Review issue",
          issueStatus: "review",
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          isTurnRunning: false,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={502} projectId={1} />);

    await user.click(await screen.findByRole("button", { name: "Mark done" }));

    expect(
      await screen.findByRole("dialog", { name: "Submitting..." }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Close completion progress" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Submitting..." }),
    ).not.toBeInTheDocument();

    await act(async () => {
      completion.reject(new Error("completion failed"));
    });

    expect(
      await screen.findByRole("dialog", { name: "completion failed" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "Submitting..." }),
    ).not.toBeInTheDocument();
  });

  it("detects agent commit completion after sending prompt and hides completion actions", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 502,
            number: 502,
            issueId: 22,
            issueNumber: 22,
            issueTitle: "Review issue",
            issueStatus: "review",
            canCompleteClean: false,
            canCompleteAgentCommit: true,
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_637_000_000,
            startedAt: 1_780_637_000_000,
            closedAt: null,
            projectId: 1,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            isTurnRunning: false,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 502,
            number: 502,
            issueId: 22,
            issueNumber: 22,
            issueTitle: "Review issue",
            issueStatus: "completed",
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            title: null,
            agentType: "codex",
            status: "closed",
            attention: "none",
            lastActiveAt: 1_780_639_000_000,
            startedAt: 1_780_637_000_000,
            closedAt: 1_780_639_000_000,
            projectId: 1,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            isTurnRunning: false,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      });

    render(<AgentsActivity activeSessionId={502} projectId={1} />);

    await user.click(await screen.findByRole("button", { name: "Mark done" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Completion Confirmation",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Submit code" }),
    );

    await waitFor(() =>
      expect(completeIssueFlowMock).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 1, issueId: 22 }),
      ),
    );
    await waitFor(() => expect(listAgentSessionsMock).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole("button", { name: "Mark done" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mark review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open status options" }),
    ).not.toBeInTheDocument();
  });

  it("completes a linked review issue manually from the session header and refreshes sessions", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 502,
            number: 502,
            issueId: 22,
            issueNumber: 22,
            issueTitle: "Review issue",
            issueStatus: "review",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_637_000_000,
            startedAt: 1_780_637_000_000,
            closedAt: null,
            projectId: 1,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 502,
            number: 502,
            issueId: 22,
            issueNumber: 22,
            issueTitle: "Review issue",
            issueStatus: "completed",
            title: null,
            agentType: "codex",
            status: "closed",
            attention: "none",
            lastActiveAt: 1_780_639_000_000,
            startedAt: 1_780_637_000_000,
            closedAt: 1_780_639_000_000,
            projectId: 1,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: false,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      });

    render(<AgentsActivity activeSessionId={502} projectId={1} />);

    expect(
      await screen.findByRole("button", { name: "Mark done" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mark done" }));

    expect(completeIssueFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 1, issueId: 22 }),
    );
    await waitFor(() => expect(listAgentSessionsMock).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole("button", { name: "Mark done" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mark review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("Agent session message stream"),
    ).toBeInTheDocument();
  });

  it("keeps mark done hidden after command success when refreshing sessions fails", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 502,
            number: 502,
            issueId: 22,
            issueNumber: 22,
            issueTitle: "Review issue",
            issueStatus: "review",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_637_000_000,
            startedAt: 1_780_637_000_000,
            closedAt: null,
            projectId: 1,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      })
      .mockRejectedValueOnce(new Error("refresh failed"));

    render(<AgentsActivity activeSessionId={502} projectId={1} />);

    await user.click(await screen.findByRole("button", { name: "Mark done" }));

    await waitFor(() => expect(listAgentSessionsMock).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole("button", { name: "Mark done" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("refresh failed")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Agent session message stream"),
    ).toBeInTheDocument();
  });

  it("completes a linked running issue directly to done from the status menu", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            number: 302,
            issueId: 21,
            issueNumber: 21,
            issueTitle: "Review candidate",
            issueStatus: "running",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_000_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
            projectId: 1,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            number: 302,
            issueId: 21,
            issueNumber: 21,
            issueTitle: "Review candidate",
            issueStatus: "completed",
            title: null,
            agentType: "codex",
            status: "closed",
            attention: "none",
            lastActiveAt: 1_780_638_002_000,
            startedAt: 1_780_638_000_000,
            closedAt: 1_780_638_002_000,
            projectId: 1,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: false,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      });
    completeIssueFlowMock.mockResolvedValueOnce({
      ...completedFlowResult(21),
      issue: {
        ...completedFlowResult(21).issue,
        title: "Review candidate",
        linkedSessionId: 302,
        updatedAt: 1_780_638_002_000,
      },
      sessionId: 302,
    });

    render(<AgentsActivity activeSessionId={302} projectId={1} />);

    await user.click(
      await screen.findByRole("button", { name: "Open status options" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Done" }));

    expect(markIssueReviewMock).not.toHaveBeenCalled();
    expect(completeIssueFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 1, issueId: 21 }),
    );
    await waitFor(() => expect(listAgentSessionsMock).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole("button", { name: "Mark done" }),
    ).not.toBeInTheDocument();
  });

  it("asks before handing off a worktree merge to the session and does nothing on no", async () => {
    const user = userEvent.setup();
    completeIssueFlowMock.mockResolvedValueOnce({
      action: "blocked",
      issue: {
        id: 21,
        number: 21,
        projectId: 1,
        title: "Review candidate",
        description: "",
        status: "running",
        linkedSessionId: 302,
        linkedSessionStatus: "running",
        linkedSessionAttention: "none",
        createdAt: 1_780_637_000_000,
        updatedAt: 1_780_638_000_000,
        statusChangedAt: 1_780_638_000_000,
        attachments: [],
        labels: [],
        linkedSessionLogPath: null,
        linkedSessionLatestOutput: null,      },
      flow: null,
      message:
        "目标分支工作区存在未提交改动，无法合入 Agent worktree。请先处理这些改动。",
      mergeBlockReason: "target_worktree_dirty",
      targetBranch: "main",
      workspaceBranch: "issue-21",
      workspacePath: "/tmp/worktrees/issue-21",
      actualPath: null,
      drifted: false,
      sessionId: 302,
    });
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 302,
          number: 302,
          issueId: 21,
          issueNumber: 21,
          issueTitle: "Review candidate",
          issueStatus: "running",
          workspaceMode: "worktree",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={302} projectId={1} />);

    await user.click(
      await screen.findByRole("button", { name: "Open status options" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Done" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Let the agent auto-merge the current branch into the base branch?",
    });
    expect(dialog).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: "Let the agent auto-merge the current branch into the base branch?",
        }),
      ).not.toBeInTheDocument(),
    );
    expect(resumeStructuredAgentSessionMock).not.toHaveBeenCalled();
    expect(injectAgentSessionPromptMock).not.toHaveBeenCalled();
    expect(markIssueReviewMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Mark review" }),
    ).toBeInTheDocument();
  });

  it("shows submitting state and loading while sending a worktree merge handoff", async () => {
    const user = userEvent.setup();
    const handoff =
      deferred<Awaited<ReturnType<typeof injectAgentSessionPrompt>>>();
    injectAgentSessionPromptMock.mockReturnValueOnce(handoff.promise);
    completeIssueFlowMock.mockResolvedValueOnce({
      action: "blocked",
      issue: {
        id: 21,
        number: 21,
        projectId: 1,
        title: "Review candidate",
        description: "",
        status: "running",
        linkedSessionId: 302,
        linkedSessionStatus: "running",
        linkedSessionAttention: "none",
        createdAt: 1_780_637_000_000,
        updatedAt: 1_780_638_000_000,
        statusChangedAt: 1_780_638_000_000,
        attachments: [],
        labels: [],
        linkedSessionLogPath: null,
        linkedSessionLatestOutput: null,      },
      flow: null,
      message: "Agent worktree 合并被阻止，请手动处理冲突。",
      mergeBlockReason: "merge_conflict",
      targetBranch: "main",
      workspaceBranch: "issue-21",
      workspacePath: "/tmp/worktrees/issue-21",
      actualPath: null,
      drifted: false,
      sessionId: 302,
    });
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 302,
          number: 302,
          issueId: 21,
          issueNumber: 21,
          issueTitle: "Review candidate",
          issueStatus: "running",
          workspaceMode: "worktree",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={302} projectId={1} />);

    await user.click(
      await screen.findByRole("button", { name: "Open status options" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Done" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Let the agent auto-merge the current branch into the base branch?",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Auto-merge" }),
    );

    expect(
      within(dialog).getByText("Submitting").closest("button"),
    ).toBeDisabled();
    expect(
      await screen.findByRole("dialog", { name: "Submitting..." }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Close completion progress" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Submitting..." }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("dialog", {
        name: "Let the agent auto-merge the current branch into the base branch?",
      }),
    ).toBeInTheDocument();

    await act(async () => {
      handoff.resolve({
        sessionId: 302,
        codexSessionId: "thread-302",
      });
      await handoff.promise;
    });

    await waitFor(() =>
      expect(injectAgentSessionPromptMock).toHaveBeenCalledWith({
        projectId: 1,
        sessionId: 302,
        kind: "follow_up",
        prompt: expect.stringContaining(
          "Please resolve the conflicts from merging issue-21 into the originally recorded target branch main",
        ),
      }),
    );
    // resume 必须在 inject 之前被调用，以保证 session 在 agent_registry 中有 handle。
    expect(resumeStructuredAgentSessionMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 302,
    });
    expect(
      screen.queryByRole("dialog", {
        name: "Let the agent auto-merge the current branch into the base branch?",
      }),
    ).not.toBeInTheDocument();
    expect(markIssueReviewMock).not.toHaveBeenCalled();
  });

  it("clears requested attention from the selected running session", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            number: 302,
            issueId: 21,
            issueNumber: 21,
            issueTitle: "Manual attention issue",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "requested",
            lastActiveAt: 1_780_638_000_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
            projectId: 1,
            issueStatus: null,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            number: 302,
            issueId: 21,
            issueNumber: 21,
            issueTitle: "Manual attention issue",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_001_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
            projectId: 1,
            issueStatus: null,
            agentProfileId: 1,
            agentProfileName: "Test Profile",
            workflowSkillName: null,
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            isTurnRunning: true,
            workspaceMode: "current_branch",
            workingDir: "/tmp/repo",
            workspacePath: null,
            originBranch: null,
            workspaceBranch: null,
            worktreeOwner: "redwhisk",
            logPath: "/tmp/session.log",
            latestOutput: null,
            processingMs: 0,
            lastOutputAt: null,
          },
        ],
      });
    setAgentSessionAttentionMock.mockResolvedValue({
      sessionId: 302,
      attention: "none",
    });

    render(<AgentsActivity activeSessionId={302} projectId={1} />);

    const sessionList = await findSessionList();
    const attentionRow = within(sessionList).getByRole("button", {
      name: /Manual attention issue/i,
    });

    expect(
      within(attentionRow).getByLabelText("Session status: Output complete"),
    ).toHaveClass("agents-session-row__status-dot--attention");

    await user.click(attentionRow);

    expect(setAgentSessionAttentionMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 302,
      attention: "none",
    });

    await waitFor(() =>
      expect(
        within(attentionRow).getByLabelText("Session status: Running"),
      ).toHaveClass("agents-session-row__status-dot--running"),
    );
    expect(
      within(attentionRow).getByLabelText("Session is running"),
    ).toBeInTheDocument();
  });

  it("resizes the session list with the keyboard separator control", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 302,
          number: 302,
          issueId: 21,
          issueNumber: 21,
          issueTitle: "Running issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
          projectId: 1,
          issueStatus: null,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={302} projectId={1} />);

    const separator = await screen.findByRole("separator", {
      name: "Resize session list",
    });

    separator.focus();
    await user.keyboard("{ArrowRight}");
    expect(separator).toHaveAttribute("aria-valuenow", "246");

    await user.keyboard("{ArrowLeft}");
    expect(separator).toHaveAttribute("aria-valuenow", "230");
  });

  it("resizes the session list when dragging the separator", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 302,
          number: 302,
          issueId: 21,
          issueNumber: 21,
          issueTitle: "Running issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
          projectId: 1,
          issueStatus: null,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={302} projectId={1} />);

    const separator = await screen.findByRole("separator", {
      name: "Resize session list",
    });

    fireEvent.mouseDown(separator, { clientX: 200 });
    fireEvent.mouseMove(window, { clientX: 296 });

    expect(separator).toHaveAttribute("aria-valuenow", "326");

    fireEvent.mouseUp(window);
  });

  it("falls back to the first running session when no session is explicitly selected", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 302,
          number: 302,
          issueId: 21,
          issueNumber: 21,
          issueTitle: "Newest running issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
          projectId: 1,
          issueStatus: null,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
        {
          sessionId: 301,
          number: 301,
          issueId: 20,
          issueNumber: 20,
          issueTitle: "Older running issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
          projectId: 1,
          issueStatus: null,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={null} projectId={1} />);

    const sessionList = await findSessionList();
    expect(
      within(sessionList).getByRole("button", {
        name: /Newest running issue/i,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("heading", { name: "#21 Newest running issue" }),
    ).toBeInTheDocument();
  });

  it("falls back to the first completed session when no running session exists", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 402,
          number: 402,
          issueId: 23,
          issueNumber: 23,
          issueTitle: "Newest completed issue",
          title: null,
          agentType: "codex",
          status: "closed",
          attention: "none",
          lastActiveAt: 1_780_632_000_000,
          startedAt: 1_780_631_000_000,
          closedAt: 1_780_633_000_000,
          projectId: 1,
          issueStatus: null,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: false,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
        {
          sessionId: 401,
          number: 401,
          issueId: 22,
          issueNumber: 22,
          issueTitle: "Older completed issue",
          title: null,
          agentType: "codex",
          status: "stopped",
          attention: "none",
          lastActiveAt: 1_780_630_000_000,
          startedAt: 1_780_629_000_000,
          closedAt: 1_780_631_000_000,
          projectId: 1,
          issueStatus: null,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: false,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={null} projectId={1} />);

    const sessionList = await findSessionList();
    expect(
      within(sessionList).getByRole("button", {
        name: /Newest completed issue/i,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByLabelText("Agent session message stream"),
    ).toBeInTheDocument();
  });

  it("hides the info pane when the selected session has no linked issue", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 501,
          number: 501,
          issueId: null,
          issueNumber: null,
          issueTitle: null,
          title: "Temporary session",
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
          projectId: 1,
          issueStatus: null,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={501} projectId={1} />);

    expect(
      await screen.findByRole("button", { name: /Temporary session/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("separator", { name: "Resize session info" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("complementary", { name: "Linked issue" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/^Issue$/)).not.toBeInTheDocument();
    expect(screen.queryByText("No linked issue")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /#issue/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps completed standalone sessions isolated from linked issue UI", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 601,
          number: 601,
          issueId: null,
          issueNumber: null,
          issueTitle: null,
          title: "Finished scratch session",
          agentType: "codex",
          status: "closed",
          attention: "none",
          lastActiveAt: 1_780_639_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: 1_780_640_000_000,
          projectId: 1,
          issueStatus: null,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: false,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={601} projectId={1} />);

    const sessionList = await findSessionList();
    expect(
      within(sessionList).getByRole("button", {
        name: /Finished scratch session/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("separator", { name: "Resize session info" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("complementary", { name: "Linked issue" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/^Issue$/)).not.toBeInTheDocument();
    expect(screen.queryByText("No linked issue")).not.toBeInTheDocument();
  });

  it("shows linked issue details in the session header without an inspector pane", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          number: 301,
          issueId: 20,
          issueNumber: 20,
          issueTitle: "Existing issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
          projectId: 1,
          issueStatus: null,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    expect(
      await screen.findByRole("heading", { name: "#20 Existing issue" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("separator", { name: "Resize session info" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("complementary", { name: "Issue details" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("Agent session message stream"),
    ).toBeInTheDocument();
  });

  it("keeps abnormal linked sessions on the terminal without a header log opener", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          number: 301,
          issueId: 20,
          issueNumber: 20,
          issueTitle: "Existing issue",
          title: null,
          agentType: "codex",
          status: "stopped",
          attention: "none",
          logPath: "/tmp/stopped.log",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: 1_780_638_000_000,
          projectId: 1,
          issueStatus: null,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: false,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    expect(
      await screen.findByRole("heading", { name: "#20 Existing issue" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open Log" }),
    ).not.toBeInTheDocument();
    expect(openPathMock).not.toHaveBeenCalled();
  });

  it("opens the session side panel from the split action", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          number: 301,
          issueId: 20,
          issueNumber: 20,
          issueTitle: "Existing issue",
          issueStatus: "running",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    expect(
      await screen.findByRole("heading", { name: "#20 Existing issue" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open Issue" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("separator", { name: "Resize session info" }),
    ).not.toBeInTheDocument();

    const splitButton = screen.getByRole("button", {
      name: "Open session side panel",
    });
    expect(splitButton).toHaveAttribute("aria-pressed", "false");

    await user.click(splitButton);

    expect(splitButton).toHaveAttribute("aria-pressed", "true");
    const panel = await screen.findByRole("complementary", {
      name: "Session side panel",
    });
    expect(
      within(panel).getByRole("tab", { name: "Issue" }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("tab", { name: "Changes" }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("tab", { name: "Files" }),
    ).toBeInTheDocument();
    expect(within(panel).getByText("Existing issue")).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "View issue" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("separator", { name: "Resize session side panel" }),
    ).toHaveAttribute("aria-valuenow", "400");
    expect(
      screen.getByLabelText("Agent session message stream"),
    ).toBeInTheDocument();
  });

  it("resizes the session side panel with the keyboard separator control", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          number: 301,
          issueId: 20,
          issueNumber: 20,
          issueTitle: "Existing issue",
          issueStatus: "running",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    await screen.findByRole("heading", { name: "#20 Existing issue" });
    await user.click(
      screen.getByRole("button", { name: "Open session side panel" }),
    );

    const activity = screen
      .getByRole("separator", { name: "Resize session list" })
      .closest(".activity-surface--agents");
    const separator = await screen.findByRole("separator", {
      name: "Resize session side panel",
    });

    expect(activity).toHaveStyle({ "--session-side-panel-width": "400px" });
    separator.focus();
    await user.keyboard("{ArrowLeft}");
    expect(separator).toHaveAttribute("aria-valuenow", "416");
    expect(activity).toHaveStyle({ "--session-side-panel-width": "416px" });

    await user.keyboard("{ArrowRight}");
    expect(separator).toHaveAttribute("aria-valuenow", "400");
    expect(activity).toHaveStyle({ "--session-side-panel-width": "400px" });
  });

  it("resizes the session side panel when dragging the separator", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          number: 301,
          issueId: 20,
          issueNumber: 20,
          issueTitle: "Existing issue",
          issueStatus: "running",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    await screen.findByRole("heading", { name: "#20 Existing issue" });
    await user.click(
      screen.getByRole("button", { name: "Open session side panel" }),
    );

    const activity = screen
      .getByRole("separator", { name: "Resize session list" })
      .closest(".activity-surface--agents");
    const separator = await screen.findByRole("separator", {
      name: "Resize session side panel",
    });

    fireEvent.mouseDown(separator, { button: 0, clientX: 800 });
    fireEvent.mouseMove(window, { clientX: 760 });

    expect(separator).toHaveAttribute("aria-valuenow", "440");
    expect(activity).toHaveStyle({ "--session-side-panel-width": "440px" });

    fireEvent.mouseUp(window);
  });

  it("opens a single replaceable changed-file tab from the session side panel", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          number: 301,
          issueId: 20,
          issueNumber: 20,
          issueTitle: "Existing issue",
          issueStatus: "running",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    await screen.findByRole("heading", { name: "#20 Existing issue" });
    await user.click(
      screen.getByRole("button", { name: "Open session side panel" }),
    );

    const panel = await screen.findByRole("complementary", {
      name: "Session side panel",
    });
    await user.click(within(panel).getByRole("tab", { name: "Changes" }));
    expect(within(panel).queryByRole("combobox")).not.toBeInTheDocument();
    // Session 变更页改为两折叠面板：未提交默认展开、已提交默认收起，无 Tabs、无刷新按钮。
    const uncommittedHeader = within(panel).getByRole("button", {
      name: "Uncommitted changes",
    });
    expect(uncommittedHeader).toHaveAttribute("aria-expanded", "true");
    expect(
      within(panel).getByRole("button", { name: "Committed changes" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      within(panel).queryByRole("button", { name: "Refresh changes" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("heading", { name: "#20 Existing issue" }),
    );
    expect(
      within(panel).getByRole("button", { name: "Uncommitted changes" }),
    ).toBeInTheDocument();

    await user.hover(
      within(panel).getByRole("button", { name: /agents-activity\.tsx/ }),
    );
    expect(
      await screen.findByText("src/features/agents/agents-activity.tsx"),
    ).toBeInTheDocument();

    await user.click(
      within(panel).getByRole("button", { name: /agents-activity\.tsx/ }),
    );

    expect(
      screen.getByRole("tab", { name: "agents-activity.tsx" }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId("monaco-diff")).toHaveAttribute(
      "data-read-only",
      "true",
    );
    expect(screen.queryByRole("tab", { name: /Diff/ })).not.toBeInTheDocument();

    await user.click(
      within(panel).getByRole("button", { name: /agents-session-pane\.tsx/ }),
    );

    expect(
      screen.queryByRole("tab", { name: "agents-activity.tsx" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "agents-session-pane.tsx" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("monaco-diff")).toBeInTheDocument();
  });

  it("opens a single replaceable file preview tab from the file tree", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          number: 301,
          issueId: 20,
          issueNumber: 20,
          issueTitle: "Existing issue",
          issueStatus: "running",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    await screen.findByRole("heading", { name: "#20 Existing issue" });
    await user.click(
      screen.getByRole("button", { name: "Open session side panel" }),
    );
    const panel = await screen.findByRole("complementary", {
      name: "Session side panel",
    });
    await user.click(within(panel).getByRole("tab", { name: "Files" }));
    await user.click(within(panel).getByRole("button", { name: "src" }));

    await user.click(
      within(panel).getByRole("button", { name: /session-side-panel\.tsx/ }),
    );

    expect(
      screen.getByRole("tab", { name: "session-side-panel.tsx" }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId("monaco-editor")).toHaveAttribute(
      "data-read-only",
      "true",
    );
    expect(
      screen.getByText("src/features/agents/session-side-panel.tsx"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/代码预览占位/)).not.toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: /app\.css/ }));

    expect(
      screen.queryByRole("tab", { name: "session-side-panel.tsx" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "app.css" })).toBeInTheDocument();
    expect(screen.getByTestId("monaco-editor")).toHaveAttribute(
      "data-read-only",
      "true",
    );
  });

  it("opens the linked issue in Issues Activity from the issue tab", async () => {
    const user = userEvent.setup();
    const onOpenIssue = vi.fn();

    listAgentSessionsMock.mockResolvedValue({
      sessions: [runningSession(301)],
    });
    listIssuesMock.mockResolvedValue({
      issues: [
        {
          id: 20,
          number: 20,
          projectId: 1,
          title: "Existing issue",
          description: "Existing description",
          status: "running",
          labels: [
            {
              id: 1,
              name: "bug",
              scope: "project",
              projectId: 1,
              color: "#b42318",
              workflowSkill: null,
            },
          ],
          linkedSessionId: 301,
          linkedSessionStatus: "running",
          linkedSessionAttention: "none",
          createdAt: 1_780_637_000_000,
          updatedAt: 1_780_637_000_000,
          statusChangedAt: 1_780_637_000_000,
          attachments: [],
          linkedSessionLogPath: null,
          linkedSessionLatestOutput: null,        },
      ],
    });

    render(
      <AgentsActivity
        activeSessionId={301}
        onOpenIssue={onOpenIssue}
        projectId={1}
      />,
    );

    await user.click(await screen.findByLabelText("Open session side panel"));
    const panel = await screen.findByRole("complementary", {
      name: "Session side panel",
    });

    expect(within(panel).getByText("Existing description")).toBeInTheDocument();
    expect(within(panel).getByText("bug")).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "View issue" }));

    expect(onOpenIssue).toHaveBeenCalledWith({
      issueId: 20,
      source: "session",
      sessionId: 301,
      restoreSidePanel: true,
      sidePanelTab: "issue",
    });
  });

  it("keeps the terminal visible after linked issue header actions", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          number: 301,
          issueId: 20,
          issueNumber: 20,
          issueTitle: "Existing issue",
          issueStatus: "running",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    expect(
      await screen.findByRole("heading", { name: "#20 Existing issue" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mark review" }));

    expect(
      screen.queryByRole("complementary", { name: "Issue details" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("Agent session message stream"),
    ).toBeInTheDocument();
  });

  it("opens inline terminals for the selected agent session workspace", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          number: 301,
          issueId: 20,
          issueNumber: 20,
          issueTitle: "Existing issue",
          issueStatus: "running",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          workspaceMode: "worktree",
          workingDir: "/tmp/worktrees/issue-20-redwhisk",
          workspacePath: "/tmp/worktrees/issue-20-redwhisk",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    expect(
      await screen.findByRole("heading", { name: "#20 Existing issue" }),
    ).toBeInTheDocument();

    expect(
      screen.queryByRole("button", { name: "Open terminal" }),
    ).not.toBeInTheDocument();
    await addSessionTool(user, "Terminal");

    await waitFor(() => {
      expect(createTemporaryProjectTerminalMock).toHaveBeenCalledWith({
        projectId: 1,
        agentSessionId: 301,
      });
    });
    expect(
      screen.getByRole("region", { name: "Session terminal" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "issue-20-redwhisk" }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("inline-project-terminal:1:-11"),
    ).toBeInTheDocument();
  });

  it("adds and closes inline terminal tabs and hides after the last close", async () => {
    const user = userEvent.setup();
    createTemporaryProjectTerminalMock
      .mockResolvedValueOnce({
        sessionId: -11,
        name: "redwhisk",
        workingDir: "/tmp/redwhisk",
        launchCommand: "/bin/zsh",
      })
      .mockResolvedValueOnce({
        sessionId: -12,
        name: "redwhisk",
        workingDir: "/tmp/redwhisk",
        launchCommand: "/bin/zsh",
      });
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          number: 301,
          issueId: 20,
          issueNumber: 20,
          issueTitle: "Existing issue",
          issueStatus: "running",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          workingDir: "/tmp/redwhisk",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    await screen.findByRole("heading", { name: "#20 Existing issue" });
    await addSessionTool(user, "Terminal");
    await screen.findByTestId("inline-project-terminal:1:-11");

    await addSessionTool(user, "Terminal");

    await waitFor(() => {
      expect(createTemporaryProjectTerminalMock).toHaveBeenCalledTimes(2);
    });
    expect(
      screen.getByTestId("inline-project-terminal:1:-12"),
    ).toBeInTheDocument();

    await user.click(
      screen.getAllByRole("button", { name: "Close redwhisk" })[1],
    );
    await waitFor(() => {
      expect(closeProjectTerminalMock).toHaveBeenCalledWith({
        projectId: 1,
        sessionId: -12,
      });
    });
    await user.click(screen.getByRole("tab", { name: "redwhisk" }));
    expect(
      screen.getByTestId("inline-project-terminal:1:-11"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close redwhisk" }));

    await waitFor(() => {
      expect(closeProjectTerminalMock).toHaveBeenCalledWith({
        projectId: 1,
        sessionId: -11,
      });
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "Session terminal" }),
      ).not.toBeInTheDocument();
    });
  });

  it("keeps the inline terminal mounted when switching sessions and back", async () => {
    const user = userEvent.setup();
    createTemporaryProjectTerminalMock.mockResolvedValue({
      sessionId: -11,
      name: "redwhisk",
      workingDir: "/tmp/redwhisk",
      launchCommand: "/bin/zsh",
    });
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        runningSession(301, "Existing issue"),
        runningSession(302, "Other issue"),
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    await screen.findByRole("heading", { name: "#20 Existing issue" });
    await addSessionTool(user, "Terminal");
    const terminalBefore = await screen.findByTestId(
      "inline-project-terminal:1:-11",
    );

    // 切到另一个 session 再切回：实例池模式下 terminal 的 DOM 节点应保持同一引用
    // （未重挂载），避免 xterm 重建导致终端内容刷新 / 丢失。
    await user.click(screen.getByRole("button", { name: /Other issue/ }));
    await screen.findByRole("heading", { name: "#21 Other issue" });
    await user.click(screen.getByRole("button", { name: /Existing issue/ }));
    await screen.findByRole("heading", { name: "#20 Existing issue" });

    const terminalAfter = screen.getByTestId("inline-project-terminal:1:-11");
    expect(terminalAfter).toBe(terminalBefore);
    // 切换过程中不应再次创建 terminal（实例复用，不重挂载）。
    expect(createTemporaryProjectTerminalMock).toHaveBeenCalledTimes(1);
  });

  it("limits session terminal tabs to ten", async () => {
    const user = userEvent.setup();
    createTemporaryProjectTerminalMock.mockImplementation(async () => {
      const nextSessionId =
        -10 - createTemporaryProjectTerminalMock.mock.calls.length;
      return {
        sessionId: nextSessionId,
        name: `terminal-${Math.abs(nextSessionId)}`,
        workingDir: "/tmp/redwhisk",
        launchCommand: "/bin/zsh",
      };
    });
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          number: 301,
          issueId: 20,
          issueNumber: 20,
          issueTitle: "Existing issue",
          issueStatus: "running",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          workingDir: "/tmp/redwhisk",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    await screen.findByRole("heading", { name: "#20 Existing issue" });
    for (let index = 0; index < 10; index += 1) {
      await addSessionTool(user, "Terminal");
    }

    await waitFor(() => {
      expect(createTemporaryProjectTerminalMock).toHaveBeenCalledTimes(10);
    });

    await addSessionTool(user, "Terminal");

    expect(createTemporaryProjectTerminalMock).toHaveBeenCalledTimes(10);
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Up to 10 terminals are supported.",
    );
  });

  it("adds a browser tab and navigates from the address bar", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          number: 301,
          issueId: 20,
          issueNumber: 20,
          issueTitle: "Existing issue",
          issueStatus: "running",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          workingDir: "/tmp/redwhisk",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: true,
          workspaceMode: "current_branch",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/session.log",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    await screen.findByRole("heading", { name: "#20 Existing issue" });
    await addSessionTool(user, "Browser");

    const addressInput = await screen.findByRole("textbox", {
      name: "Browser address",
    });
    await user.type(addressInput, "example.com{Enter}");

    expect(
      screen.getByTitle("Browser page https://example.com"),
    ).toHaveAttribute("src", "https://example.com");
  });

  it("omits completed issue summary actions from the session header", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 601,
          number: 601,
          issueId: 23,
          issueNumber: 23,
          issueTitle: "Newest completed issue",
          issueStatus: "completed",
          title: null,
          agentType: "codex",
          status: "closed",
          attention: "none",
          logPath: "/tmp/completed.log",
          lastActiveAt: 1_780_639_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: 1_780_639_000_000,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: false,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={601} projectId={1} />);

    expect(
      await screen.findByRole("heading", {
        name: "#23 Newest completed issue",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "View Summary" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open Log" }),
    ).not.toBeInTheDocument();
    expect(openPathMock).not.toHaveBeenCalled();
  });

  it("omits the completed header log opener when the log path is missing", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 601,
          number: 601,
          issueId: 23,
          issueNumber: 23,
          issueTitle: "Newest completed issue",
          issueStatus: "completed",
          title: null,
          agentType: "codex",
          status: "closed",
          attention: "none",
          logPath: "/tmp/session.log",
          lastActiveAt: 1_780_639_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: 1_780_639_000_000,
          projectId: 1,
          agentProfileId: 1,
          agentProfileName: "Test Profile",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          isTurnRunning: false,
          workspaceMode: "current_branch",
          workingDir: "/tmp/repo",
          workspacePath: null,
          originBranch: null,
          workspaceBranch: null,
          worktreeOwner: "redwhisk",
          latestOutput: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={601} projectId={1} />);

    expect(
      await screen.findByRole("heading", {
        name: "#23 Newest completed issue",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "View Summary" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open Log" }),
    ).not.toBeInTheDocument();
    expect(openPathMock).not.toHaveBeenCalled();
  });

  it("shows a factual empty state when no sessions exist", async () => {
    listAgentSessionsMock.mockResolvedValue({ sessions: [] });

    render(<AgentsActivity activeSessionId={null} projectId={1} />);

    expect(await screen.findByText("No sessions.")).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Session" }),
    ).not.toBeInTheDocument();
  });
});
