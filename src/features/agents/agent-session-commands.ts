import { invokeCommand } from "../../shared/commands/command-client";

export type AgentType = "codex";
export type AgentSessionStatus = "running" | "closed" | "crashed" | "stopped";
export type AgentSessionAttention = "none" | "requested";

export interface AgentSessionListItem {
  sessionId: number;
  issueId: number | null;
  issueTitle: string | null;
  title: string | null;
  agentType: AgentType;
  status: AgentSessionStatus;
  attention: AgentSessionAttention;
  lastActiveAt: number;
  startedAt: number;
  closedAt: number | null;
}

export interface AgentSessionListResponse {
  sessions: AgentSessionListItem[];
}

export function listAgentSessions(
  projectId: number,
): Promise<AgentSessionListResponse> {
  return invokeCommand<AgentSessionListResponse>("list_agent_sessions", {
    projectId,
  });
}
