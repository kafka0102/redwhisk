import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentSessionListChangedEvent } from "../../agents/agent-session-events";

import type { AgentSessionListItem } from "../../agents/agent-session-commands";
import { listAgentSessions } from "../../agents/agent-session-commands";
import { I18nProvider } from "../../../shared/i18n/i18n";
import { IssueReadonlySessionPanel } from "./issue-readonly-session-panel";

const eventMocks = vi.hoisted(() => ({
  listeners: [] as Array<{
    eventName: string;
    callback: (event: { payload: AgentSessionListChangedEvent }) => void;
  }>,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    (
      eventName: string,
      callback: (event: { payload: AgentSessionListChangedEvent }) => void,
    ) => {
      eventMocks.listeners.push({ eventName, callback });
      return Promise.resolve(() => undefined);
    },
  ),
}));

vi.mock("../../agents/agent-session-commands", () => ({
  listAgentSessions: vi.fn(),
}));

const listAgentSessionsMock = vi.mocked(listAgentSessions);

function makeSession(
  overrides: Partial<AgentSessionListItem> = {},
): AgentSessionListItem {
  return {
    sessionId: 12,
    number: 1,
    projectId: 1,
    issueId: 8,
    issueNumber: 8,
    issueTitle: "Demo",
    issueStatus: "running",
    agentProfileId: 3,
    agentProfileName: "Codex",
    workflowSkillName: null,
    canCompleteClean: false,
    canCompleteAgentCommit: false,
    title: null,
    agentType: "codex",
    displayMode: "json",
    status: "running",
    attention: "none",
    isTurnRunning: false,
    workspaceMode: "current_branch",
    workingDir: "/tmp/repo",
    workspacePath: null,
    originBranch: "main",
    workspaceBranch: "main",
    worktreeOwner: "redwhisk",
    logPath: "/tmp/session.log",
    latestOutput: null,
    lastActiveAt: 0,
    startedAt: 1_700_000_000_000,
    closedAt: null,
    processingMs: 0,
    lastOutputAt: null,
    startupModel: "gpt-5.5",
    tokenInput: null,
    tokenOutput: null,
    tokenCache: null,
    ...overrides,
  };
}

function renderPanel(session: AgentSessionListItem): void {
  listAgentSessionsMock.mockResolvedValue({ sessions: [session] });
  render(
    <I18nProvider fixedLocale="zh">
      <IssueReadonlySessionPanel
        linkedSessionId={session.sessionId}
        projectId={1}
        canOpenSession
        onOpenSession={() => undefined}
      />
    </I18nProvider>,
  );
}

function runParameterLabels(): string[] {
  const heading = screen.getByRole("heading", { name: "运行参数" });
  const card = heading.closest("section");
  if (!card) {
    throw new Error("运行参数卡片不存在");
  }
  return Array.from(card.querySelectorAll("dt")).map(
    (item) => item.textContent ?? "",
  );
}

function sessionInfoLabels(): string[] {
  const heading = screen.getByRole("heading", { name: "会话信息" });
  const card = heading.closest("section");
  if (!card) {
    throw new Error("会话信息卡片不存在");
  }
  return Array.from(card.querySelectorAll("dt")).map(
    (item) => item.textContent ?? "",
  );
}

function sessionInfoValue(label: string): string {
  const heading = screen.getByRole("heading", { name: "会话信息" });
  const card = heading.closest("section");
  if (!card) {
    throw new Error("会话信息卡片不存在");
  }
  const row = Array.from(card.querySelectorAll("div")).find(
    (item) => item.querySelector("dt")?.textContent === label,
  );
  return row?.querySelector("dd")?.textContent ?? "";
}

function runParameterValue(label: string): string {
  const heading = screen.getByRole("heading", { name: "运行参数" });
  const card = heading.closest("section");
  if (!card) {
    throw new Error("运行参数卡片不存在");
  }
  const row = Array.from(card.querySelectorAll("div")).find(
    (item) => item.querySelector("dt")?.textContent === label,
  );
  return row?.querySelector("dd")?.textContent ?? "";
}

describe("IssueReadonlySessionPanel 运行参数模型", () => {
  it("shows startup model under agent", async () => {
    renderPanel(makeSession());
    await waitFor(() => {
      expect(screen.getByText("Codex")).toBeInTheDocument();
    });
    const labels = runParameterLabels();
    expect(labels.indexOf("模型")).toBe(labels.indexOf("智能体") + 1);
    expect(runParameterValue("模型")).toBe("gpt-5.5");
  });

  it("shows a dash when startup model is empty", async () => {
    renderPanel(makeSession({ startupModel: null }));
    await waitFor(() => {
      expect(screen.getByText("Codex")).toBeInTheDocument();
    });
    expect(runParameterValue("模型")).toBe("-");
  });
});

describe("IssueReadonlySessionPanel Session Token 消耗", () => {
  it("shows five token rows under session status as dashes when usage is missing", async () => {
    renderPanel(makeSession());
    await waitFor(() => {
      expect(screen.getByText("Codex")).toBeInTheDocument();
    });
    const labels = sessionInfoLabels();
    const statusIndex = labels.indexOf("会话状态");
    expect(labels.slice(statusIndex + 1, statusIndex + 6)).toEqual([
      "总计",
      "输入",
      "输出",
      "缓存",
      "缓存命中率",
    ]);
    expect(sessionInfoValue("总计")).toBe("-");
    expect(sessionInfoValue("输入")).toBe("-");
    expect(sessionInfoValue("输出")).toBe("-");
    expect(sessionInfoValue("缓存")).toBe("-");
    expect(sessionInfoValue("缓存命中率")).toBe("-");
  });

  it("formats received usage including zero", async () => {
    renderPanel(
      makeSession({
        tokenInput: 3000,
        tokenOutput: 0,
        tokenCache: 1000,
      }),
    );
    await waitFor(() => {
      expect(screen.getByText("Codex")).toBeInTheDocument();
    });
    expect(sessionInfoValue("总计")).toBe("4K");
    expect(sessionInfoValue("输入")).toBe("3K");
    expect(sessionInfoValue("输出")).toBe("0K");
    expect(sessionInfoValue("缓存")).toBe("1K");
    expect(sessionInfoValue("缓存命中率")).toBe("25%");
  });

  it("refreshes token rows while the session is still running", async () => {
    eventMocks.listeners.length = 0;
    const initial = makeSession();
    const updated = makeSession({
      tokenInput: 3000,
      tokenOutput: 0,
      tokenCache: 1000,
    });
    listAgentSessionsMock.mockReset();
    listAgentSessionsMock
      .mockResolvedValueOnce({ sessions: [initial] })
      .mockResolvedValueOnce({ sessions: [updated] });
    render(
      <I18nProvider fixedLocale="zh">
        <IssueReadonlySessionPanel
          linkedSessionId={initial.sessionId}
          projectId={1}
          canOpenSession
          onOpenSession={() => undefined}
        />
      </I18nProvider>,
    );
    await waitFor(() => {
      expect(sessionInfoValue("总计")).toBe("-");
    });

    const listener = eventMocks.listeners.find(
      (item) => item.eventName === "agent-session-list-changed",
    );
    expect(listener).toBeDefined();
    await act(async () => {
      listener?.callback({
        payload: {
          projectId: 1,
          sessionId: initial.sessionId,
          reason: "session_stream_updated",
        },
      });
    });

    await waitFor(() => {
      expect(sessionInfoValue("总计")).toBe("4K");
    });
    expect(sessionInfoValue("输出")).toBe("0K");
    expect(sessionInfoValue("缓存命中率")).toBe("25%");
  });
});
