import type { AgentSessionListItem } from "../agent-session-commands";
import { invokeCommand } from "../../../shared/commands/command-client";

export const OPEN_AGENT_SESSION_EVENT = "open-agent-session";

export interface OpenSessionMonitorWindowInput {
  ownerWindowLabel: string;
}

export interface OpenSessionMonitorWindowResponse {
  windowLabel: string;
}

export interface CloseSessionMonitorWindowInput {
  ownerWindowLabel: string;
}

export interface CloseSessionMonitorWindowResponse {
  windowLabel: string;
}

export interface OpenMonitoredAgentSessionInput {
  ownerWindowLabel: string;
  projectId: number;
  sessionId: number;
}

export interface OpenMonitoredAgentSessionResponse {
  emitted: boolean;
  windowLabel: string;
}

export interface OpenAgentSessionEventPayload {
  projectId: number;
  sessionId: number;
}

export interface MonitoredAgentSessionListResponse {
  sessions: AgentSessionListItem[];
}

export function openSessionMonitorWindow(
  input: OpenSessionMonitorWindowInput,
): Promise<OpenSessionMonitorWindowResponse> {
  return invokeCommand<OpenSessionMonitorWindowResponse>(
    "open_session_monitor_window",
    { input },
  );
}

export function closeSessionMonitorWindow(
  input: CloseSessionMonitorWindowInput,
): Promise<CloseSessionMonitorWindowResponse> {
  return invokeCommand<CloseSessionMonitorWindowResponse>(
    "close_session_monitor_window",
    { input },
  );
}

export function openMonitoredAgentSession(
  input: OpenMonitoredAgentSessionInput,
): Promise<OpenMonitoredAgentSessionResponse> {
  return invokeCommand<OpenMonitoredAgentSessionResponse>(
    "open_monitored_agent_session",
    { input },
  );
}

export function listMonitoredAgentSessions(): Promise<MonitoredAgentSessionListResponse> {
  return invokeCommand<MonitoredAgentSessionListResponse>(
    "list_monitored_agent_sessions",
  );
}
