import { invokeCommand } from "../../shared/commands/command-client";

export type AgentType = "codex" | "claude";
export type AgentScope = "project" | "global";
export type AgentSkillScope = "project" | "global";
export type AgentSkillRefreshStatus = "idle" | "loading" | "ready" | "failed";

export interface AgentProfileRecord {
  id: number;
  name: string;
  agentType: AgentType;
  command: string;
  worktreePath?: string;
  scope: AgentScope;
  projectId: number | null;
  mode: string;
  dangerous: boolean;
  defaultSkill: string;
  promptTemplate: string;
  del: number;
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
  worktreePath: string;
  scope: AgentScope;
  projectId: number | null;
  mode: string;
  dangerous: boolean;
  defaultSkill: string;
  promptTemplate: string;
}

export interface ValidateAgentWorktreePathInput {
  path: string;
}

export interface ValidateAgentWorktreePathResult {
  path: string;
  exists: boolean;
}

export interface AgentProfileListResponse {
  profiles: AgentProfileRecord[];
}

export interface DeleteAgentProfileInput {
  id: number;
}

export interface AgentSkillRecord {
  name: string;
  path: string;
  agentType: AgentType;
  scope: AgentSkillScope;
  projectId: number | null;
  sourceRoot: string;
}

export interface ListAgentSkillsInput {
  agentType?: AgentType;
  projectId?: number | null;
}

export interface RefreshAgentSkillsInput {
  projectId?: number | null;
}

export interface AgentSkillListResponse {
  skills: AgentSkillRecord[];
  globalStatus: AgentSkillRefreshStatus;
  projectStatus: AgentSkillRefreshStatus;
  lastError: string | null;
}

export interface AgentSkillsUpdatedEvent {
  scope: AgentSkillScope;
  projectId: number | null;
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

export function validateAgentWorktreePath(
  input: ValidateAgentWorktreePathInput,
): Promise<ValidateAgentWorktreePathResult> {
  return invokeCommand<ValidateAgentWorktreePathResult>(
    "validate_agent_worktree_path",
    {
      input,
    },
  );
}

export function deleteAgentProfile(
  input: DeleteAgentProfileInput,
): Promise<void> {
  return invokeCommand("delete_agent_profile", {
    input,
  });
}

export function listAgentSkills(
  input: ListAgentSkillsInput,
): Promise<AgentSkillListResponse> {
  return invokeCommand<AgentSkillListResponse>("list_agent_skills", {
    input,
  });
}

export function refreshAgentSkills(
  input: RefreshAgentSkillsInput,
): Promise<void> {
  return invokeCommand("refresh_agent_skills", {
    input,
  });
}
