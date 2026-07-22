import { invoke } from "@tauri-apps/api/core";
import type { TFunction } from "i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createProject,
  initializeLocalData,
  listProjects,
  openProject,
  openProjectWindow,
  updateProjectSettings,
  validateProjectRepoPath,
} from "../../features/project/project-commands";
import {
  injectAgentSessionPrompt,
  listAgentSessions,
} from "../../features/agents/agent-session-commands";
import {
  advanceIssueStatus,
  deleteIssue,
  detectAgentCommitCompletion,
  getProjectGitBranches,
  getIssueSummary,
  prepareAgentCommitCompletion,
  sendAgentCommitPrompt,
  startAgentSession,
} from "../../features/issues/issue-commands";
import {
  deleteAgentProfile,
  detectCodexCommand,
  previewAgentCommandArgs,
  listAgentProfiles,
  saveAgentProfile,
  testAgentCommand,
} from "../../features/settings/settings-commands";
import {
  closeProjectTerminal,
  createProjectTerminal,
  deleteProjectTerminalConfig,
  listProjectTerminals,
  readProjectTerminal,
  resizeProjectTerminal,
  restoreProjectTerminal,
  updateProjectTerminalConfig,
  writeProjectTerminal,
} from "../../features/terminals/project-terminal-commands";
import {
  getCommandErrorMessage,
  isCommandError,
  toCommandError,
} from "./command-error";

function makeTranslationFunction(dict: Record<string, string>): TFunction {
  return ((key: string) =>
    key in dict ? dict[key] : key) as unknown as TFunction;
}

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("command client", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invokes Rust Core through the initialize local data command", async () => {
    invokeMock.mockResolvedValue({
      databaseExists: true,
      currentVersion: "0001_core",
      appliedVersions: ["0001_core"],
    });

    await expect(initializeLocalData()).resolves.toEqual({
      databaseExists: true,
      currentVersion: "0001_core",
      appliedVersions: ["0001_core"],
    });
    expect(invokeMock).toHaveBeenCalledWith("initialize_local_data", undefined);
  });

  it("invokes Rust Core through the create project command", async () => {
    invokeMock.mockResolvedValue({
      id: 1,
      name: "redwhisk",
      repoPath: "/Users/kafka0102/workspace/kafka/redwhisk",
      createdAt: 1_780_581_600_000,
      lastOpenedAt: 1_780_581_600_000,
    });

    await expect(
      createProject({
        name: "redwhisk",
        repoPath: "/Users/kafka0102/workspace/kafka/redwhisk",
        worktreeLocation: "repo_sibling",
        worktreeSetupCommand: "pnpm install",
      }),
    ).resolves.toEqual({
      id: 1,
      name: "redwhisk",
      repoPath: "/Users/kafka0102/workspace/kafka/redwhisk",
      createdAt: 1_780_581_600_000,
      lastOpenedAt: 1_780_581_600_000,
    });
    expect(invokeMock).toHaveBeenCalledWith("create_project", {
      input: {
        name: "redwhisk",
        repoPath: "/Users/kafka0102/workspace/kafka/redwhisk",
        worktreeLocation: "repo_sibling",
        worktreeSetupCommand: "pnpm install",
      },
    });
  });

  it("invokes Rust Core through the validate project repo path command", async () => {
    invokeMock.mockResolvedValue({
      repoPath: "/Users/kafka0102/workspace/kafka/redwhisk",
      suggestedName: "redwhisk",
    });

    await expect(
      validateProjectRepoPath({
        repoPath: "/Users/kafka0102/workspace/kafka/redwhisk",
      }),
    ).resolves.toEqual({
      repoPath: "/Users/kafka0102/workspace/kafka/redwhisk",
      suggestedName: "redwhisk",
    });
    expect(invokeMock).toHaveBeenCalledWith("validate_project_repo_path", {
      input: {
        repoPath: "/Users/kafka0102/workspace/kafka/redwhisk",
      },
    });
  });

  it("invokes Rust Core through the list projects command", async () => {
    invokeMock.mockResolvedValue({
      projects: [
        {
          id: 1,
          name: "redwhisk",
          repoPath: "/Users/kafka0102/workspace/kafka/redwhisk",
          createdAt: 1_780_581_600_000,
          lastOpenedAt: 1_780_581_600_000,
          pathStatus: "available",
        },
      ],
    });

    await expect(listProjects()).resolves.toEqual({
      projects: [
        {
          id: 1,
          name: "redwhisk",
          repoPath: "/Users/kafka0102/workspace/kafka/redwhisk",
          createdAt: 1_780_581_600_000,
          lastOpenedAt: 1_780_581_600_000,
          pathStatus: "available",
        },
      ],
    });
    expect(invokeMock).toHaveBeenCalledWith("list_projects", undefined);
  });

  it("invokes Rust Core through the open project command", async () => {
    invokeMock.mockResolvedValue({
      id: 1,
      name: "redwhisk",
      repoPath: "/Users/kafka0102/workspace/kafka/redwhisk",
      createdAt: 1_780_581_600_000,
      lastOpenedAt: 1_780_624_800_000,
    });

    await expect(openProject({ projectId: 1 })).resolves.toEqual({
      id: 1,
      name: "redwhisk",
      repoPath: "/Users/kafka0102/workspace/kafka/redwhisk",
      createdAt: 1_780_581_600_000,
      lastOpenedAt: 1_780_624_800_000,
    });
    expect(invokeMock).toHaveBeenCalledWith("open_project", {
      input: { projectId: 1 },
    });
  });

  it("invokes Rust Core through the open project window command", async () => {
    invokeMock.mockResolvedValue({
      projectId: 1,
      windowLabel: "project-1",
    });

    await expect(openProjectWindow({ projectId: 1 })).resolves.toEqual({
      projectId: 1,
      windowLabel: "project-1",
    });
    expect(invokeMock).toHaveBeenCalledWith("open_project_window", {
      input: { projectId: 1 },
    });
  });

  it("invokes Rust Core through the update project settings command", async () => {
    invokeMock.mockResolvedValue({
      id: 1,
      name: "RedWhisk Desktop",
      repoPath: "/Users/kafka0102/workspace/kafka/redwhisk",
      worktreeLocation: "repo_sibling",
      worktreeSetupCommand: "",
      createdAt: 1_780_581_600_000,
      lastOpenedAt: 1_780_624_800_000,
    });

    await expect(
      updateProjectSettings({
        projectId: 1,
        name: "RedWhisk Desktop",
        repoPath: "/Users/kafka0102/workspace/kafka/redwhisk",
        worktreeLocation: "repo_sibling",
        worktreeSetupCommand: "",
      }),
    ).resolves.toEqual({
      id: 1,
      name: "RedWhisk Desktop",
      repoPath: "/Users/kafka0102/workspace/kafka/redwhisk",
      worktreeLocation: "repo_sibling",
      worktreeSetupCommand: "",
      createdAt: 1_780_581_600_000,
      lastOpenedAt: 1_780_624_800_000,
    });
    expect(invokeMock).toHaveBeenCalledWith("update_project_settings", {
      input: {
        projectId: 1,
        name: "RedWhisk Desktop",
        repoPath: "/Users/kafka0102/workspace/kafka/redwhisk",
        worktreeLocation: "repo_sibling",
        worktreeSetupCommand: "",
      },
    });
  });

  it("invokes Rust Core through the list agent sessions command", async () => {
    invokeMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          issueId: 20,
          issueTitle: "Existing issue",
          title: null,
          agentType: "codex",
          displayMode: "json",
          status: "running",
          attention: "none",
          isTurnRunning: false,
          workspaceMode: "current_branch",
          lastActiveAt: 1_780_624_800_000,
          startedAt: 1_780_624_800_000,
          closedAt: null,
        },
      ],
    });

    await expect(listAgentSessions(1)).resolves.toEqual({
      sessions: [
        {
          sessionId: 301,
          issueId: 20,
          issueTitle: "Existing issue",
          title: null,
          agentType: "codex",
          displayMode: "json",
          status: "running",
          attention: "none",
          isTurnRunning: false,
          workspaceMode: "current_branch",
          lastActiveAt: 1_780_624_800_000,
          startedAt: 1_780_624_800_000,
          closedAt: null,
        },
      ],
    });
    expect(invokeMock).toHaveBeenCalledWith("list_agent_sessions", {
      projectId: 1,
    });
  });

  it("invokes Rust Core through the create project terminal command", async () => {
    invokeMock.mockResolvedValue({
      configId: 101,
      sessionId: -1,
      name: "New Terminal",
      workingDir: "/tmp/redwhisk",
      launchCommand: "/bin/zsh",
    });

    await expect(createProjectTerminal({ projectId: 1 })).resolves.toEqual({
      configId: 101,
      sessionId: -1,
      name: "New Terminal",
      workingDir: "/tmp/redwhisk",
      launchCommand: "/bin/zsh",
    });
    expect(invokeMock).toHaveBeenCalledWith("create_project_terminal", {
      input: { projectId: 1 },
    });
  });

  it("invokes Rust Core through the read project terminal command", async () => {
    invokeMock.mockResolvedValue({
      sessionId: -1,
      snapshot: "hello",
      isActive: true,
    });

    await expect(
      readProjectTerminal({ projectId: 1, sessionId: -1, maxBytes: 128 }),
    ).resolves.toEqual({
      sessionId: -1,
      snapshot: "hello",
      isActive: true,
    });
    expect(invokeMock).toHaveBeenCalledWith("read_project_terminal", {
      input: { projectId: 1, sessionId: -1, maxBytes: 128 },
    });
  });

  it("invokes Rust Core through the list project terminals command", async () => {
    invokeMock.mockResolvedValue({
      terminals: [
        {
          configId: 101,
          sessionId: -1,
          name: "API",
          workingDir: "/tmp/redwhisk",
          launchCommand: "pnpm dev",
        },
      ],
    });

    await expect(listProjectTerminals({ projectId: 1 })).resolves.toEqual({
      terminals: [
        {
          configId: 101,
          sessionId: -1,
          name: "API",
          workingDir: "/tmp/redwhisk",
          launchCommand: "pnpm dev",
        },
      ],
    });
    expect(invokeMock).toHaveBeenCalledWith("list_project_terminals", {
      input: { projectId: 1 },
    });
  });

  it("invokes Rust Core through the restore project terminal command", async () => {
    invokeMock.mockResolvedValue({
      sessionId: -1,
      sequence: 4,
      chunks: [[65]],
      isComplete: true,
      isActive: true,
    });

    await expect(
      restoreProjectTerminal({ projectId: 1, sessionId: -1 }),
    ).resolves.toEqual({
      sessionId: -1,
      sequence: 4,
      chunks: [[65]],
      isComplete: true,
      isActive: true,
    });
    expect(invokeMock).toHaveBeenCalledWith("restore_project_terminal", {
      input: { projectId: 1, sessionId: -1 },
    });
  });

  it("invokes Rust Core through the write project terminal command", async () => {
    invokeMock.mockResolvedValue(undefined);

    await expect(
      writeProjectTerminal({ projectId: 1, sessionId: -1, data: "ls\r" }),
    ).resolves.toBeUndefined();
    expect(invokeMock).toHaveBeenCalledWith("write_project_terminal", {
      input: { projectId: 1, sessionId: -1, data: "ls\r" },
    });
  });

  it("invokes Rust Core through the resize project terminal command", async () => {
    invokeMock.mockResolvedValue(undefined);

    await expect(
      resizeProjectTerminal({
        projectId: 1,
        sessionId: -1,
        rows: 40,
        cols: 120,
      }),
    ).resolves.toBeUndefined();
    expect(invokeMock).toHaveBeenCalledWith("resize_project_terminal", {
      input: { projectId: 1, sessionId: -1, rows: 40, cols: 120 },
    });
  });

  it("invokes Rust Core through the close project terminal command", async () => {
    invokeMock.mockResolvedValue(undefined);

    await expect(
      closeProjectTerminal({ projectId: 1, sessionId: -1 }),
    ).resolves.toBeUndefined();
    expect(invokeMock).toHaveBeenCalledWith("close_project_terminal", {
      input: { projectId: 1, sessionId: -1 },
    });
  });

  it("invokes Rust Core through the update project terminal config command", async () => {
    invokeMock.mockResolvedValue({
      terminal: {
        configId: 101,
        sessionId: -1,
        name: "API",
        workingDir: "/tmp/redwhisk/apps/api",
        launchCommand: "pnpm dev",
      },
    });

    await expect(
      updateProjectTerminalConfig({
        projectId: 1,
        configId: 101,
        name: "API",
        workingDir: "/tmp/redwhisk/apps/api",
        launchCommand: "pnpm dev",
      }),
    ).resolves.toEqual({
      terminal: {
        configId: 101,
        sessionId: -1,
        name: "API",
        workingDir: "/tmp/redwhisk/apps/api",
        launchCommand: "pnpm dev",
      },
    });
    expect(invokeMock).toHaveBeenCalledWith("update_project_terminal_config", {
      input: {
        projectId: 1,
        configId: 101,
        name: "API",
        workingDir: "/tmp/redwhisk/apps/api",
        launchCommand: "pnpm dev",
      },
    });
  });

  it("invokes Rust Core through the delete project terminal config command", async () => {
    invokeMock.mockResolvedValue({
      configId: 101,
      sessionId: -1,
    });

    await expect(
      deleteProjectTerminalConfig({
        projectId: 1,
        configId: 101,
      }),
    ).resolves.toEqual({
      configId: 101,
      sessionId: -1,
    });
    expect(invokeMock).toHaveBeenCalledWith("delete_project_terminal_config", {
      input: {
        projectId: 1,
        configId: 101,
      },
    });
  });

  it("invokes Rust Core through the inject agent session prompt command", async () => {
    invokeMock.mockResolvedValue({
      sessionId: 301,
      codexSessionId: "019d8b4d-2998-7913-889d-fb3c32971610",
    });

    await expect(
      injectAgentSessionPrompt({
        projectId: 1,
        sessionId: 301,
        prompt: "please continue",
        kind: "follow_up",
      }),
    ).resolves.toEqual({
      sessionId: 301,
      codexSessionId: "019d8b4d-2998-7913-889d-fb3c32971610",
    });
    expect(invokeMock).toHaveBeenCalledWith("inject_agent_session_prompt", {
      input: {
        projectId: 1,
        sessionId: 301,
        prompt: "please continue",
        kind: "follow_up",
      },
    });
  });

  it("normalizes structured command errors", () => {
    const error = toCommandError({
      code: "LOCAL_DATA_INITIALIZATION_FAILED",
      message: "本地数据初始化失败。",
      details: [{ "@type": "DatabasePath", path: "/tmp/redwhisk" }],
    });

    expect(isCommandError(error)).toBe(true);
    expect(error).toEqual({
      code: "LOCAL_DATA_INITIALIZATION_FAILED",
      message: "本地数据初始化失败。",
      details: [{ "@type": "DatabasePath", path: "/tmp/redwhisk" }],
    });
  });

  it("rejects malformed command errors", () => {
    const error = toCommandError({
      code: "not-valid",
      message: "bad shape",
      details: [{ path: "/tmp/redwhisk" }],
    });

    expect(isCommandError(error)).toBe(true);
    expect(error).toEqual({
      code: "UNKNOWN_COMMAND_ERROR",
      message: "bad shape",
    });
  });

  it("localizes command error message by code and reason", () => {
    const t = makeTranslationFunction({
      "errors.ISSUE_VALIDATION_FAILED.mustBeRunningToAccept":
        "只有运行中的 Issue 可以标记待验收。",
    });

    expect(
      getCommandErrorMessage(
        {
          code: "ISSUE_VALIDATION_FAILED",
          message: "fallback",
          reason: "mustBeRunningToAccept",
        },
        t,
      ),
    ).toBe("只有运行中的 Issue 可以标记待验收。");
  });

  it("uses default reason when reason absent", () => {
    const t = makeTranslationFunction({
      "errors.PROJECT_NOT_FOUND.default": "Project 不存在。",
    });

    expect(
      getCommandErrorMessage(
        { code: "PROJECT_NOT_FOUND", message: "fallback" },
        t,
      ),
    ).toBe("Project 不存在。");
  });

  it("falls back to message when translation missing", () => {
    const t = makeTranslationFunction({});

    expect(
      getCommandErrorMessage(
        {
          code: "ISSUE_VALIDATION_FAILED",
          message: "原始后端文案",
          reason: "mustBeRunningToAccept",
        },
        t,
      ),
    ).toBe("原始后端文案");
  });

  it("appends Cause detail after localized message for git failures", () => {
    const t = makeTranslationFunction({
      "errors.AGENT_SESSION_VALIDATION_FAILED.gitCommandFailed":
        "Git 命令执行失败。",
    });

    expect(
      getCommandErrorMessage(
        {
          code: "AGENT_SESSION_VALIDATION_FAILED",
          message: "Git command failed: conflict",
          reason: "gitCommandFailed",
          details: [
            { "@type": "Cause", message: "CONFLICT (content): Merge conflict" },
          ],
        },
        t,
      ),
    ).toBe("Git 命令执行失败。 CONFLICT (content): Merge conflict");
  });

  it("wraps unknown invoke failures as command errors", async () => {
    invokeMock.mockRejectedValue("bridge unavailable");

    await expect(initializeLocalData()).rejects.toMatchObject({
      code: "UNKNOWN_COMMAND_ERROR",
      message: "bridge unavailable",
    });
  });

  it("invokes Rust Core through the detect codex command", async () => {
    invokeMock.mockResolvedValue({
      command: "/usr/local/bin/codex",
    });

    await expect(detectCodexCommand()).resolves.toEqual({
      command: "/usr/local/bin/codex",
    });
    expect(invokeMock).toHaveBeenCalledWith("detect_codex_command", undefined);
  });

  it("invokes Rust Core through the test agent command", async () => {
    invokeMock.mockResolvedValue({
      command: "/opt/codex/bin/codex",
    });

    await expect(
      testAgentCommand({ command: "/opt/codex/bin/codex" }),
    ).resolves.toEqual({
      command: "/opt/codex/bin/codex",
    });
    expect(invokeMock).toHaveBeenCalledWith("test_agent_command", {
      input: { command: "/opt/codex/bin/codex" },
    });
  });

  it("invokes Rust Core through the list agent profiles command", async () => {
    invokeMock.mockResolvedValue({
      profiles: [
        {
          id: 1,
          name: "Codex",
          agentType: "codex",
          command: "/usr/local/bin/codex",
          scope: "global",
          projectId: null,
          mode: "full-auto",
          dangerous: true,
          defaultSkill: "",
          promptTemplate: "",
          del: 0,
          displayMode: "json",
          enabled: true,
        },
      ],
    });

    await expect(
      listAgentProfiles({ scope: "global", projectId: null }),
    ).resolves.toEqual({
      profiles: [
        {
          id: 1,
          name: "Codex",
          agentType: "codex",
          command: "/usr/local/bin/codex",
          scope: "global",
          projectId: null,
          mode: "full-auto",
          dangerous: true,
          defaultSkill: "",
          promptTemplate: "",
          del: 0,
          displayMode: "json",
          enabled: true,
        },
      ],
    });
    expect(invokeMock).toHaveBeenCalledWith("list_agent_profiles", {
      input: { scope: "global", projectId: null },
    });
  });

  it("invokes Rust Core through the save agent profile command", async () => {
    invokeMock.mockResolvedValue({
      id: 1,
      name: "Codex",
      agentType: "codex",
      command: "/usr/local/bin/codex",
      scope: "global",
      projectId: null,
      mode: "full-auto",
      dangerous: true,
      defaultSkill: "",
      promptTemplate: "",
      del: 0,
      displayMode: "json",
      enabled: true,
    });

    await expect(
      saveAgentProfile({
        name: "Codex",
        agentType: "codex",
        command: "/usr/local/bin/codex",
        scope: "global",
        projectId: null,
        mode: "full-auto",
        dangerous: true,
        defaultSkill: "",
        promptTemplate: "",
        displayMode: "json",
        enabled: true,
      }),
    ).resolves.toEqual({
      id: 1,
      name: "Codex",
      agentType: "codex",
      command: "/usr/local/bin/codex",
      scope: "global",
      projectId: null,
      mode: "full-auto",
      dangerous: true,
      defaultSkill: "",
      promptTemplate: "",
      del: 0,
      displayMode: "json",
      enabled: true,
    });
    expect(invokeMock).toHaveBeenCalledWith("save_agent_profile", {
      input: {
        name: "Codex",
        agentType: "codex",
        command: "/usr/local/bin/codex",
        scope: "global",
        projectId: null,
        mode: "full-auto",
        dangerous: true,
        defaultSkill: "",
        promptTemplate: "",
        displayMode: "json",
        enabled: true,
      },
    });
  });

  it("invokes Rust Core through the preview agent command args command", async () => {
    invokeMock.mockResolvedValue(["exec", "--dangerously-bypass"]);

    await expect(
      previewAgentCommandArgs({
        agentType: "codex",
        command: "/usr/local/bin/codex",
        mode: "full-access",
        dangerous: true,
      }),
    ).resolves.toEqual(["exec", "--dangerously-bypass"]);
    expect(invokeMock).toHaveBeenCalledWith("preview_agent_command_args", {
      input: {
        agentType: "codex",
        command: "/usr/local/bin/codex",
        mode: "full-access",
        dangerous: true,
      },
    });
  });

  it("invokes Rust Core through the delete agent profile command", async () => {
    invokeMock.mockResolvedValue(undefined);

    await expect(deleteAgentProfile({ id: 1 })).resolves.toBeUndefined();
    expect(invokeMock).toHaveBeenCalledWith("delete_agent_profile", {
      input: { id: 1 },
    });
  });

  it("invokes Rust Core through the start agent session command", async () => {
    invokeMock.mockResolvedValue({
      sessionId: 7,
      issueId: 3,
    });

    await expect(
      startAgentSession({
        projectId: 1,
        issueId: 3,
        agentProfileId: 9,
        promptSnapshot: "Final prompt",
        workflowSkillName: "bmad-dev-story",
        workspaceMode: "worktree",
        targetBranch: "main",
        worktreeSetupCommand: "pnpm install",
      }),
    ).resolves.toEqual({
      sessionId: 7,
      issueId: 3,
    });
    expect(invokeMock).toHaveBeenCalledWith("start_agent_session", {
      input: {
        projectId: 1,
        issueId: 3,
        agentProfileId: 9,
        promptSnapshot: "Final prompt",
        workflowSkillName: "bmad-dev-story",
        workspaceMode: "worktree",
        targetBranch: "main",
        worktreeSetupCommand: "pnpm install",
      },
    });
  });

  it("invokes Rust Core through the get project git branches command", async () => {
    invokeMock.mockResolvedValue({
      currentBranch: "main",
      localBranches: ["main", "develop"],
    });

    await expect(getProjectGitBranches({ projectId: 1 })).resolves.toEqual({
      currentBranch: "main",
      localBranches: ["main", "develop"],
    });
    expect(invokeMock).toHaveBeenCalledWith("get_project_git_branches", {
      input: { projectId: 1 },
    });
  });

  it("invokes Rust Core through the prepare agent commit completion command", async () => {
    invokeMock.mockResolvedValue({
      issueId: 3,
      sessionId: 7,
      option: "complete_agent_commit",
      head: "4157f0c",
      changedFilesCount: 1,
      changedFiles: [{ status: " M", path: "src/app/app.tsx", oldPath: null }],
      completionPrompt: "请仅处理当前 Issue 相关改动，并在确认无误后提交。",
    });

    await expect(
      prepareAgentCommitCompletion({
        projectId: 1,
        issueId: 3,
      }),
    ).resolves.toEqual({
      issueId: 3,
      sessionId: 7,
      option: "complete_agent_commit",
      head: "4157f0c",
      changedFilesCount: 1,
      changedFiles: [{ status: " M", path: "src/app/app.tsx", oldPath: null }],
      completionPrompt: "请仅处理当前 Issue 相关改动，并在确认无误后提交。",
    });
    expect(invokeMock).toHaveBeenCalledWith("prepare_agent_commit_completion", {
      input: {
        projectId: 1,
        issueId: 3,
      },
    });
  });

  it("invokes Rust Core through the send agent commit prompt command", async () => {
    invokeMock.mockResolvedValue({
      issueId: 3,
      sessionId: 7,
      codexSessionId: "019d8b4d-2998-7913-889d-fb3c32971610",
    });

    await expect(
      sendAgentCommitPrompt({
        projectId: 1,
        issueId: 3,
      }),
    ).resolves.toEqual({
      issueId: 3,
      sessionId: 7,
      codexSessionId: "019d8b4d-2998-7913-889d-fb3c32971610",
    });
    expect(invokeMock).toHaveBeenCalledWith("send_agent_commit_prompt", {
      input: {
        projectId: 1,
        issueId: 3,
      },
    });
  });

  it("invokes Rust Core through the detect agent commit completion command", async () => {
    invokeMock.mockResolvedValue({
      outcome: "completed",
      issue: {
        id: 3,
        projectId: 1,
        title: "Review issue",
        description: "",
        status: "completed",
        linkedSessionId: 7,
        linkedSessionStatus: "closed",
        linkedSessionAttention: "none",
        linkedSessionLogPath: "/tmp/session.log",
        createdAt: 1_780_700_000_000,
        updatedAt: 1_780_700_100_000,
      },
      message: "已检测到新的 commit，Issue 已完成。",
    });

    await expect(
      detectAgentCommitCompletion({
        projectId: 1,
        issueId: 3,
      }),
    ).resolves.toEqual({
      outcome: "completed",
      issue: {
        id: 3,
        projectId: 1,
        title: "Review issue",
        description: "",
        status: "completed",
        linkedSessionId: 7,
        linkedSessionStatus: "closed",
        linkedSessionAttention: "none",
        linkedSessionLogPath: "/tmp/session.log",
        createdAt: 1_780_700_000_000,
        updatedAt: 1_780_700_100_000,
      },
      message: "已检测到新的 commit，Issue 已完成。",
    });
    expect(invokeMock).toHaveBeenCalledWith("detect_agent_commit_completion", {
      input: {
        projectId: 1,
        issueId: 3,
      },
    });
  });

  it("supports git operation blocked outcome from detect agent commit completion", async () => {
    invokeMock.mockResolvedValue({
      outcome: "git_operation_blocked",
      issue: {
        id: 3,
        projectId: 1,
        title: "Review issue",
        description: "",
        status: "review",
        linkedSessionId: 7,
        linkedSessionStatus: "running",
        linkedSessionAttention: "none",
        linkedSessionLogPath: "/tmp/session.log",
        createdAt: 1_780_700_000_000,
        updatedAt: 1_780_700_100_000,
      },
      message:
        "当前 Git 正在进行中的操作阻止 Agent Commit 完成，请先手动处理 Git 状态。",
    });

    await expect(
      detectAgentCommitCompletion({
        projectId: 1,
        issueId: 3,
      }),
    ).resolves.toEqual({
      outcome: "git_operation_blocked",
      issue: {
        id: 3,
        projectId: 1,
        title: "Review issue",
        description: "",
        status: "review",
        linkedSessionId: 7,
        linkedSessionStatus: "running",
        linkedSessionAttention: "none",
        linkedSessionLogPath: "/tmp/session.log",
        createdAt: 1_780_700_000_000,
        updatedAt: 1_780_700_100_000,
      },
      message:
        "当前 Git 正在进行中的操作阻止 Agent Commit 完成，请先手动处理 Git 状态。",
    });
  });

  it("invokes Rust Core through the get issue summary command", async () => {
    invokeMock.mockResolvedValue({
      issue: {
        id: 3,
        projectId: 1,
        title: "Review issue",
        description: "",
        status: "completed",
        linkedSessionId: 7,
        linkedSessionStatus: "closed",
        linkedSessionAttention: "none",
        linkedSessionLogPath: "/tmp/session.log",
        createdAt: 1_780_700_000_000,
        updatedAt: 1_780_700_100_000,
      },
      sessionStartedAt: 1_780_700_000_000,
      sessionClosedAt: 1_780_700_100_000,
      completion: {
        option: "agent_auto_commit",
        result: "completed",
        commitHash: "abc1234",
        failureReason: null,
        headBefore: "1111111",
        headAfter: "abc1234",
        changedFilesJson: "[]",
        createdAt: 1_780_700_100_000,
        source: "completion_attempt",
      },
      diagnostics: [],
    });

    await expect(
      getIssueSummary({
        projectId: 1,
        issueId: 3,
      }),
    ).resolves.toEqual({
      issue: {
        id: 3,
        projectId: 1,
        title: "Review issue",
        description: "",
        status: "completed",
        linkedSessionId: 7,
        linkedSessionStatus: "closed",
        linkedSessionAttention: "none",
        linkedSessionLogPath: "/tmp/session.log",
        createdAt: 1_780_700_000_000,
        updatedAt: 1_780_700_100_000,
      },
      sessionStartedAt: 1_780_700_000_000,
      sessionClosedAt: 1_780_700_100_000,
      completion: {
        option: "agent_auto_commit",
        result: "completed",
        commitHash: "abc1234",
        failureReason: null,
        headBefore: "1111111",
        headAfter: "abc1234",
        changedFilesJson: "[]",
        createdAt: 1_780_700_100_000,
        source: "completion_attempt",
      },
      diagnostics: [],
    });
    expect(invokeMock).toHaveBeenCalledWith("get_issue_summary", {
      input: {
        projectId: 1,
        issueId: 3,
      },
    });
  });

  it("invokes Rust Core through the advance issue status command", async () => {
    invokeMock.mockResolvedValue({
      id: 3,
      projectId: 1,
      title: "Review issue",
      description: "",
      status: "review",
      linkedSessionId: 7,
      linkedSessionStatus: "running",
      linkedSessionAttention: "none",
      linkedSessionLogPath: "/tmp/session.log",
      linkedSessionLatestOutput: "latest output",
      createdAt: 1_780_700_000_000,
      updatedAt: 1_780_700_100_000,
    });

    await expect(
      advanceIssueStatus({
        projectId: 1,
        issueId: 3,
        targetStatus: "review",
      }),
    ).resolves.toEqual({
      id: 3,
      projectId: 1,
      title: "Review issue",
      description: "",
      status: "review",
      linkedSessionId: 7,
      linkedSessionStatus: "running",
      linkedSessionAttention: "none",
      linkedSessionLogPath: "/tmp/session.log",
      linkedSessionLatestOutput: "latest output",
      createdAt: 1_780_700_000_000,
      updatedAt: 1_780_700_100_000,
    });
    expect(invokeMock).toHaveBeenCalledWith("advance_issue_status", {
      input: {
        projectId: 1,
        issueId: 3,
        targetStatus: "review",
      },
    });
  });

  it("invokes Rust Core through the delete issue command", async () => {
    invokeMock.mockResolvedValue({
      issueId: 3,
      linkedSessionId: 7,
    });

    await expect(
      deleteIssue({
        projectId: 1,
        issueId: 3,
      }),
    ).resolves.toEqual({
      issueId: 3,
      linkedSessionId: 7,
    });
    expect(invokeMock).toHaveBeenCalledWith("delete_issue", {
      input: {
        projectId: 1,
        issueId: 3,
      },
    });
  });
});
