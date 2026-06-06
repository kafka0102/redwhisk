import { invokeCommand } from "../../shared/commands/command-client";

export type AgentType = "codex";
export type AgentScope = "project" | "global";

export interface AgentProfileRecord {
  id: number;
  name: string;
  agentType: AgentType;
  command: string;
  scope: AgentScope;
  projectId: number | null;
  mode: string;
  dangerous: boolean;
  defaultSkill: string;
  promptTemplate: string;
}

export interface ListAgentProfilesInput {
  scope: AgentScope;
  projectId: number | null;
}

export interface SaveAgentProfileInput {
  id?: number;
  name: string;
  agentType: AgentType;
  command: string;
  scope: AgentScope;
  projectId: number | null;
  mode: string;
  dangerous: boolean;
  defaultSkill: string;
  promptTemplate: string;
}

export interface AgentProfileListResponse {
  profiles: AgentProfileRecord[];
}

export interface AgentCommandCheckResult {
  command: string;
}

export interface TestAgentCommandInput {
  command: string;
}

export function detectCodexCommand(): Promise<AgentCommandCheckResult> {
  return invokeCommand<AgentCommandCheckResult>("detect_codex_command");
}

export function testAgentCommand(
  input: TestAgentCommandInput,
): Promise<AgentCommandCheckResult> {
  return invokeCommand<AgentCommandCheckResult>("test_agent_command", {
    input,
  });
}

export function listAgentProfiles(
  input: ListAgentProfilesInput,
): Promise<AgentProfileListResponse> {
  return invokeCommand<AgentProfileListResponse>("list_agent_profiles", {
    input,
  });
}

export function saveAgentProfile(
  input: SaveAgentProfileInput,
): Promise<AgentProfileRecord> {
  return invokeCommand<AgentProfileRecord>("save_agent_profile", {
    input,
  });
}
