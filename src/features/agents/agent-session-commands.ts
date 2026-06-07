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

export interface ReadAgentSessionTerminalInput {
  projectId: number;
  sessionId: number;
  maxBytes?: number;
}

export interface ReadAgentSessionTerminalResult {
  sessionId: number;
  snapshot: string;
  isActive: boolean;
}

export interface WriteAgentSessionTerminalInput {
  projectId: number;
  sessionId: number;
  data: string;
}

export type AgentSessionPromptKind = "follow_up" | "completion";

export interface InjectAgentSessionPromptInput {
  projectId: number;
  sessionId: number;
  prompt: string;
  kind: AgentSessionPromptKind;
}

export interface InjectAgentSessionPromptResult {
  sessionId: number;
  codexSessionId: string | null;
}

export interface ResizeAgentSessionTerminalInput {
  projectId: number;
  sessionId: number;
  rows: number;
  cols: number;
}

export function listAgentSessions(
  projectId: number,
): Promise<AgentSessionListResponse> {
  return invokeCommand<AgentSessionListResponse>("list_agent_sessions", {
    projectId,
  });
}

export function readAgentSessionTerminal(
  input: ReadAgentSessionTerminalInput,
): Promise<ReadAgentSessionTerminalResult> {
  return invokeCommand<ReadAgentSessionTerminalResult>(
    "read_agent_session_terminal",
    { input },
  );
}

export function writeAgentSessionTerminal(
  input: WriteAgentSessionTerminalInput,
): Promise<void> {
  return invokeCommand("write_agent_session_terminal", { input });
}

export function injectAgentSessionPrompt(
  input: InjectAgentSessionPromptInput,
): Promise<InjectAgentSessionPromptResult> {
  return invokeCommand<InjectAgentSessionPromptResult>(
    "inject_agent_session_prompt",
    { input },
  );
}

export function resizeAgentSessionTerminal(
  input: ResizeAgentSessionTerminalInput,
): Promise<void> {
  return invokeCommand("resize_agent_session_terminal", { input });
}
