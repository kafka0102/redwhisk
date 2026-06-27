import { invokeCommand } from "../../../shared/commands/command-client";

export const OPEN_AGENT_SESSION_EVENT = "open-agent-session";

export interface OpenSessionMonitorWindowInput {
  ownerWindowLabel: string;
  projectId: number;
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
