import { invokeCommand } from "../../shared/commands/command-client";

export type AgentType = "codex";
export type AgentSessionStatus = "running" | "closed" | "crashed" | "stopped";
export type AgentSessionAttention = "none" | "requested";
export type IssueStatus = "backlog" | "running" | "review" | "completed";

export interface AgentSessionListItem {
  sessionId: number;
  issueId: number | null;
  issueTitle: string | null;
  issueStatus?: IssueStatus | null;
  canCompleteClean?: boolean;
  canCompleteAgentCommit?: boolean;
  title: string | null;
  agentType: AgentType;
  status: AgentSessionStatus;
  attention: AgentSessionAttention;
  logPath?: string | null;
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

export interface SetAgentSessionAttentionInput {
  projectId: number;
  sessionId: number;
  attention: AgentSessionAttention;
}

export interface SetAgentSessionAttentionResult {
  sessionId: number;
  attention: AgentSessionAttention;
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

export interface StartStandaloneAgentSessionInput {
  projectId: number;
  title: string;
  agentProfileId: number;
  promptSnapshot: string;
}

export interface StartStandaloneAgentSessionResult {
  sessionId: number;
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

export function setAgentSessionAttention(
  input: SetAgentSessionAttentionInput,
): Promise<SetAgentSessionAttentionResult> {
  return invokeCommand<SetAgentSessionAttentionResult>(
    "set_agent_session_attention",
    { input },
  );
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

export function startStandaloneAgentSession(
  input: StartStandaloneAgentSessionInput,
): Promise<StartStandaloneAgentSessionResult> {
  return invokeCommand<StartStandaloneAgentSessionResult>(
    "start_standalone_agent_session",
    {
      input,
    },
  );
}
