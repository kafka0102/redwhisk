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

// ADR-0019：displayMode（json/tui）默认 json；enabled（默认 true）。
// 与 Rust `AgentProfileRecord` 字段一一对应（camelCase 跨边界）。
export type AgentDisplayMode = "json" | "tui";

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
  displayMode: AgentDisplayMode;
  enabled: boolean;
}

export interface ListAgentProfilesInput {
  scope: AgentScope;
  projectId?: number | null;
}

export interface SaveAgentProfileInput {
  id?: number;
  name: string;
  agentType: AgentType;
  command: string;
  scope: AgentScope;
  projectId?: number | null;
  mode: string;
  dangerous: boolean;
  defaultSkill: string;
  promptTemplate: string;
  displayMode: AgentDisplayMode;
  enabled: boolean;
}

// ADR-0019：参数预览入参。与 Rust `PreviewAgentCommandArgsInput` 一一对应（camelCase）。
export interface PreviewAgentCommandArgsInput {
  agentType: AgentType;
  command: string;
  mode: string;
  dangerous: boolean;
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
  // Rust ProjectLabelRecord.del: i64（始终序列化）；前端不直接消费，
  // 但需声明字段以维持 Rust→TS 契约对齐（parity gate）。
  del: number;
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
  projectId?: number | null;
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
  projectId?: number | null;
}

// 全局 Label 与项目级 Label 同名（大小写不敏感，与后端 find_duplicate_name 的 lower() 一致）
// 时，项目级覆盖全局级：本项目内该全局 Label 不再可用。该判定在设置面板（覆盖行提示）
// 与 Issue 标签下拉（隐藏被覆盖的全局 Label）共用。
export function isGlobalLabelOverridden(
  label: ProjectLabelRecord,
  projectLabels: ProjectLabelRecord[],
): boolean {
  if (label.scope !== "global") {
    return false;
  }

  const name = label.name.toLowerCase();
  return projectLabels.some(
    (projectLabel) => projectLabel.name.toLowerCase() === name,
  );
}

export interface ProjectLabelListResponse {
  labels: ProjectLabelRecord[];
}

export interface SaveProjectLabelInput {
  id?: number;
  name: string;
  scope: ProjectLabelScope;
  projectId?: number | null;
  color: string;
  workflowSkill?: string | null;
}

export interface DeleteProjectLabelInput {
  id: number;
}

export interface AgentCommandCheckResult {
  command: string;
}

export interface UserProfileRecord {
  id: number;
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

// ADR-0019：预览某 profile 启动时附带的命令行参数（不含命令本身）。
// codex/claude 在 dangerous 下返回非空参数；opencode/grok 当前为空（占位 descriptor）。
export function previewAgentCommandArgs(
  input: PreviewAgentCommandArgsInput,
): Promise<string[]> {
  return invokeCommand<string[]>("preview_agent_command_args", {
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
