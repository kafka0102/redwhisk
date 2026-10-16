import type { AgentSessionListItem } from "../features/agents/agent-session-commands";

/**
 * 「运行参数 / 会话信息」面板测试共用的 session fixture 工厂。
 *
 * issue 详情右侧面板与 session side panel 的用例同源（两个面板要表现一致），
 * fixture 放在这里避免两份逐字副本各自漂移。
 */
export function makeAgentSession(
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
