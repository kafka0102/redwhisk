import { invokeCommand } from "../../shared/commands/command-client";

export type AgentType = "codex";

export interface AgentProfileRecord {
  id: number;
  name: string;
  agentType: AgentType;
  command: string;
  defaultArgs: string[];
  defaultSkill: string;
  promptTemplate: string;
  enabled: boolean;
}

export interface SaveAgentProfileInput {
  id?: number;
  name: string;
  agentType: AgentType;
  command: string;
  defaultArgs: string[];
  defaultSkill: string;
  promptTemplate: string;
  enabled: boolean;
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

export interface ProjectAgentOverrideRecord {
  id: number;
  projectId: number;
  agentProfileId: number;
  defaultArgs: string[];
  defaultSkill: string;
  promptTemplate: string;
  enabled: boolean;
}

export interface ProjectAgentOverrideListResponse {
  overrides: ProjectAgentOverrideRecord[];
}

export interface ListProjectAgentOverridesInput {
  projectId: number;
}

export interface SaveProjectAgentOverrideInput {
  projectId: number;
  agentProfileId: number;
  defaultArgs: string[];
  defaultSkill: string;
  promptTemplate: string;
  enabled: boolean;
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

export function listAgentProfiles(): Promise<AgentProfileListResponse> {
  return invokeCommand<AgentProfileListResponse>("list_agent_profiles");
}

export function saveAgentProfile(
  input: SaveAgentProfileInput,
): Promise<AgentProfileRecord> {
  return invokeCommand<AgentProfileRecord>("save_agent_profile", {
    input,
  });
}

export function listProjectAgentOverrides(
  input: ListProjectAgentOverridesInput,
): Promise<ProjectAgentOverrideListResponse> {
  return invokeCommand<ProjectAgentOverrideListResponse>(
    "list_project_agent_overrides",
    {
      input,
    },
  );
}

export function saveProjectAgentOverride(
  input: SaveProjectAgentOverrideInput,
): Promise<ProjectAgentOverrideRecord> {
  return invokeCommand<ProjectAgentOverrideRecord>(
    "save_project_agent_override",
    {
      input,
    },
  );
}
