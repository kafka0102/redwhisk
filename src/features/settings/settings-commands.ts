import { invokeCommand } from "../../shared/commands/command-client";

// AgentType 统一从 agent-session-commands 导出，避免多处定义冲突。
// 后端 AgentType 枚举（Codex/Claude）序列化为 "codex"/"claude"；
// "claude_code" 为前端 UI 别名（agent-visuals 视作 Claude）。
export type { AgentType } from "../agents/agent-session-commands";
import type { AgentType } from "../agents/agent-session-commands";

export type AgentScope = "project" | "global";
export type AgentSkillScope = "project" | "global";
export type AgentSkillRefreshStatus = "idle" | "loading" | "ready" | "failed";
export type ProjectLabelScope = "project" | "global";

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

export interface ProjectLabelRecord {
  id: number;
  name: string;
  scope: ProjectLabelScope;
  projectId: number | null;
  color: string;
  workflowSkill: string | null;
}

export interface SavedAgentSkillPath {
  agentType: AgentType;
  path: string;
}

export interface SavedAgentSkillRecord {
  id: number;
  name: string;
  scope: AgentSkillScope;
  projectId: number | null;
  skillPaths: SavedAgentSkillPath[];
}

export interface SaveSavedAgentSkillInput {
  id?: number;
  name: string;
  scope: AgentSkillScope;
  projectId: number | null;
  skillPaths: SavedAgentSkillPath[];
}

export interface ListSavedAgentSkillsInput {
  scope?: AgentSkillScope;
  projectId?: number | null;
}

export interface SavedAgentSkillListResponse {
  skills: SavedAgentSkillRecord[];
}

export interface DeleteSavedAgentSkillInput {
  id: number;
}

export interface ListProjectLabelsInput {
  scope: ProjectLabelScope;
  projectId: number | null;
}

export interface ProjectLabelListResponse {
  labels: ProjectLabelRecord[];
}

export interface SaveProjectLabelInput {
  id?: number;
  name: string;
  scope: ProjectLabelScope;
  projectId: number | null;
  color: string;
  workflowSkill: string | null;
}

export interface DeleteProjectLabelInput {
  id: number;
}

export interface AgentCommandCheckResult {
  command: string;
}

export interface UserProfileRecord {
  name: string;
  avatarPath: string | null;
}

export interface UpdateUserProfileInput {
  name?: string;
  avatarSourcePath?: string;
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

export function getUserProfile(): Promise<UserProfileRecord> {
  return invokeCommand<UserProfileRecord>("get_user_profile");
}

export function updateUserProfile(
  input: UpdateUserProfileInput,
): Promise<UserProfileRecord> {
  return invokeCommand<UserProfileRecord>("update_user_profile", { input });
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

export function listProjectLabels(
  input: ListProjectLabelsInput,
): Promise<ProjectLabelListResponse> {
  return invokeCommand<ProjectLabelListResponse>("list_project_labels", {
    input,
  });
}

export function saveProjectLabel(
  input: SaveProjectLabelInput,
): Promise<ProjectLabelRecord> {
  return invokeCommand<ProjectLabelRecord>("save_project_label", {
    input,
  });
}

export function deleteProjectLabel(
  input: DeleteProjectLabelInput,
): Promise<void> {
  return invokeCommand("delete_project_label", {
    input,
  });
}

export function listSavedAgentSkills(
  input: ListSavedAgentSkillsInput,
): Promise<SavedAgentSkillListResponse> {
  return invokeCommand("list_saved_agent_skills", {
    input,
  });
}

export function saveSavedAgentSkill(
  input: SaveSavedAgentSkillInput,
): Promise<SavedAgentSkillRecord> {
  return invokeCommand("save_saved_agent_skill", {
    input,
  });
}

export function deleteSavedAgentSkill(
  input: DeleteSavedAgentSkillInput,
): Promise<void> {
  return invokeCommand("delete_saved_agent_skill", {
    input,
  });
}
