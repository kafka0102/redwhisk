import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createProject,
  initializeLocalData,
  listProjects,
  openProject,
  openProjectWindow,
} from "../../features/project/project-commands";
import {
  injectAgentSessionPrompt,
  listAgentSessions,
  readAgentSessionTerminal,
  resizeAgentSessionTerminal,
  startStandaloneAgentSession,
  writeAgentSessionTerminal,
} from "../../features/agents/agent-session-commands";
import { startAgentSession } from "../../features/issues/issue-commands";
import {
  detectCodexCommand,
  listAgentProfiles,
  saveAgentProfile,
  testAgentCommand,
} from "../../features/settings/settings-commands";
import { isCommandError, toCommandError } from "./command-error";

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
        repoPath: "/Users/kafka0102/workspace/kafka/redwhisk",
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

  it("invokes Rust Core through the list agent sessions command", async () => {
    invokeMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          issueId: 20,
          issueTitle: "Existing issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
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
          status: "running",
          attention: "none",
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

  it("invokes Rust Core through the read agent session terminal command", async () => {
    invokeMock.mockResolvedValue({
      sessionId: 301,
      snapshot: "codex> ready",
      isActive: true,
    });

    await expect(
      readAgentSessionTerminal({
        projectId: 1,
        sessionId: 301,
        maxBytes: 4096,
      }),
    ).resolves.toEqual({
      sessionId: 301,
      snapshot: "codex> ready",
      isActive: true,
    });
    expect(invokeMock).toHaveBeenCalledWith("read_agent_session_terminal", {
      input: {
        projectId: 1,
        sessionId: 301,
        maxBytes: 4096,
      },
    });
  });

  it("invokes Rust Core through the write agent session terminal command", async () => {
    invokeMock.mockResolvedValue(undefined);

    await expect(
      writeAgentSessionTerminal({
        projectId: 1,
        sessionId: 301,
        data: "status\r",
      }),
    ).resolves.toBeUndefined();
    expect(invokeMock).toHaveBeenCalledWith("write_agent_session_terminal", {
      input: {
        projectId: 1,
        sessionId: 301,
        data: "status\r",
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

  it("invokes Rust Core through the resize agent session terminal command", async () => {
    invokeMock.mockResolvedValue(undefined);

    await expect(
      resizeAgentSessionTerminal({
        projectId: 1,
        sessionId: 301,
        rows: 38,
        cols: 120,
      }),
    ).resolves.toBeUndefined();
    expect(invokeMock).toHaveBeenCalledWith("resize_agent_session_terminal", {
      input: {
        projectId: 1,
        sessionId: 301,
        rows: 38,
        cols: 120,
      },
    });
  });

  it("invokes Rust Core through the start standalone agent session command", async () => {
    invokeMock.mockResolvedValue({
      sessionId: 11,
    });

    await expect(
      startStandaloneAgentSession({
        projectId: 1,
        title: "Scratch Session",
        agentProfileId: 9,
        promptSnapshot: "Help me inspect the current repo",
      }),
    ).resolves.toEqual({
      sessionId: 11,
    });
    expect(invokeMock).toHaveBeenCalledWith("start_standalone_agent_session", {
      input: {
        projectId: 1,
        title: "Scratch Session",
        agentProfileId: 9,
        promptSnapshot: "Help me inspect the current repo",
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
      },
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
      },
    });
  });
});
