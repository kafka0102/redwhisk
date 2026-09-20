import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AgentSessionListItem } from "../agent-session-commands";
import { listIssues } from "../../issues/issue-commands";
import { I18nProvider } from "../../../shared/i18n/i18n";
import { SessionIssuePanel } from "./session-issue-panel";

vi.mock("../../issues/issue-commands", () => ({
  listIssues: vi.fn(),
}));

const listIssuesMock = vi.mocked(listIssues);

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
  listIssuesMock.mockResolvedValue({
    issues: [
      {
        id: 8,
        number: 8,
        projectId: 1,
        title: "Demo",
        description: "desc",
        attachments: [],
        labels: [],
        status: "running",
        linkedSessionId: 12,
        linkedSessionStatus: "running",
        linkedSessionAttention: "none",
        linkedSessionLogPath: "/tmp/session.log",
        linkedSessionLatestOutput: null,
        createdAt: 1,
        updatedAt: 1,
        statusChangedAt: 1,
      },
    ],
  });
  render(
    <I18nProvider fixedLocale="zh">
      <SessionIssuePanel
        issueId={8}
        issueTitle="Demo"
        projectId={1}
        session={session}
        onOpenIssue={() => undefined}
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

describe("SessionIssuePanel 运行参数模型", () => {
  it("shows startup model under agent", async () => {
    renderPanel(makeSession());
    await waitFor(() => {
      expect(screen.getByText("Demo")).toBeInTheDocument();
    });
    const labels = runParameterLabels();
    expect(labels.indexOf("模型")).toBe(labels.indexOf("智能体") + 1);
    expect(runParameterValue("模型")).toBe("gpt-5.5");
  });

  it("shows a dash when startup model is empty", async () => {
    renderPanel(makeSession({ startupModel: null }));
    await waitFor(() => {
      expect(screen.getByText("Demo")).toBeInTheDocument();
    });
    expect(runParameterValue("模型")).toBe("-");
  });
});

describe("SessionIssuePanel Session Token 消耗", () => {
  it("shows five token rows under session status as dashes when usage is missing", async () => {
    renderPanel(makeSession());
    await waitFor(() => {
      expect(screen.getByText("Demo")).toBeInTheDocument();
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
      expect(screen.getByText("Demo")).toBeInTheDocument();
    });
    expect(sessionInfoValue("总计")).toBe("4K");
    expect(sessionInfoValue("输入")).toBe("3K");
    expect(sessionInfoValue("输出")).toBe("0K");
    expect(sessionInfoValue("缓存")).toBe("1K");
    expect(sessionInfoValue("缓存命中率")).toBe("25%");
  });
});
