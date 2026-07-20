use std::path::Path;

use crate::agent::command_detector::{AgentCommandDetector, ShellAgentCommandDetector};
use crate::agent::provider_descriptor::descriptor_for;
use crate::db::agent_profile_repository::AgentProfileRepository;
use crate::db::connection::DatabaseConfig;
use crate::db::migrations::MigrationRunner;
use crate::db::project_label_repository::ProjectLabelRepository;
use crate::db::project_repository::ProjectRepository;
use crate::db::saved_agent_skill_repository::SavedAgentSkillRepository;
use crate::types::agent_profile::{
    AgentCommandCheckResult, AgentProfileListResponse, AgentProfileRecord, AgentScope, AgentType,
    DeleteAgentProfileInput, ListAgentProfilesInput, PreviewAgentCommandArgsInput,
    SaveAgentProfileInput, TestAgentCommandInput,
};
use crate::types::agent_skill::AgentSkillScope;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::project_label::{
    DeleteProjectLabelInput, ListProjectLabelsInput, ProjectLabelListResponse, ProjectLabelRecord,
    ProjectLabelScope, SaveProjectLabelInput,
};
use crate::types::saved_agent_skill::{
    DeleteSavedAgentSkillInput, ListSavedAgentSkillsInput, SaveSavedAgentSkillInput,
    SavedAgentSkillListResponse, SavedAgentSkillRecord,
};

pub struct SettingsService<'connection, TDetector> {
    repository: AgentProfileRepository<'connection>,
    project_label_repository: ProjectLabelRepository<'connection>,
    saved_agent_skill_repository: SavedAgentSkillRepository<'connection>,
    project_repository: ProjectRepository<'connection>,
    detector: TDetector,
}

impl<'connection, TDetector> SettingsService<'connection, TDetector>
where
    TDetector: AgentCommandDetector,
{
    pub fn new(
        repository: AgentProfileRepository<'connection>,
        project_label_repository: ProjectLabelRepository<'connection>,
        saved_agent_skill_repository: SavedAgentSkillRepository<'connection>,
        project_repository: ProjectRepository<'connection>,
        detector: TDetector,
    ) -> Self {
        Self {
            repository,
            project_label_repository,
            saved_agent_skill_repository,
            project_repository,
            detector,
        }
    }

    pub fn detect_codex_command(&self) -> Result<AgentCommandCheckResult, CommandError> {
        self.detector
            .detect_codex_command()
            .map(|command| AgentCommandCheckResult { command })
            .map_err(agent_command_error)
    }

    /// 启动时异步检测 + 幂等播种四内置 agent（ADR-0020）。
    ///
    /// 按 `[codex, claude, opencode, grok]` 顺序逐个探测命令；探测成功且库中**无任何
    /// 记录（含软删 `del=1`）**则按内置默认值表插入一条 global profile。探测失败（未装）
    /// 或已存在记录则静默跳过。单条 profile 写入失败会记 stderr 但不阻断其余 agent 播种。
    pub fn seed_builtin_agents(&self) -> Result<(), CommandError> {
        for agent_type in BUILTIN_AGENT_SEED_ORDER {
            let command_name = builtin_agent_command_name(&agent_type);
            let detected_command = match self.detector.detect_command(command_name) {
                Ok(command) => command,
                Err(_) => continue,
            };

            let already_seeded = self
                .repository
                .exists_profile_by_agent_type(agent_type.clone())
                .map_err(settings_database_error)?;
            if already_seeded {
                continue;
            }

            let default_input = default_builtin_profile_input(agent_type.clone(), &detected_command);
            if let Err(error) = self.repository.save_profile(
                default_input.id,
                &default_input.name,
                default_input.agent_type,
                &default_input.command,
                &default_input.scope,
                default_input.project_id,
                &default_input.mode,
                default_input.dangerous,
                default_input.default_skill.trim(),
                default_input.prompt_template.trim(),
                &default_input.display_mode,
                default_input.enabled,
            ) {
                // 单条失败不阻断其余 agent 播种；上层 setup 钩子只关心整体是否 OK。
                eprintln!(
                    "[settings] 内置 agent {agent_type:?} 播种失败：{error}"
                );
            }
        }
        Ok(())
    }

    /// 预览给定 profile 启动 PTY 时实际带上的 CLI 参数（ADR-0020）。
    ///
    /// 复用 `provider_descriptor::descriptor_for(agent_type).build_command_snapshot_with_bypass`
    /// 计算命令行，再剥掉命令本身只返回参数部分。`dangerous=false` 时不补 bypass 参数；
    /// opencode/grok 的占位 descriptor 不加任何参数，返回空 Vec。
    pub fn preview_agent_command_args(
        &self,
        input: PreviewAgentCommandArgsInput,
    ) -> Result<Vec<String>, CommandError> {
        let command = validate_command(&input.command)?;
        let descriptor = descriptor_for(&input.agent_type);
        let command_line = if input.dangerous {
            descriptor.build_command_snapshot_with_bypass(&command)
        } else {
            command.trim().to_string()
        };

        let mut parts = command_line.split_whitespace();
        let _ = parts.next();
        Ok(parts.map(String::from).collect())
    }

    pub fn test_agent_command(
        &self,
        input: TestAgentCommandInput,
    ) -> Result<AgentCommandCheckResult, CommandError> {
        let command = validate_command(&input.command)?;

        self.detector
            .test_command(&command)
            .map(|resolved_command| AgentCommandCheckResult {
                command: resolved_command,
            })
            .map_err(agent_command_error)
    }

    pub fn list_agent_profiles(
        &self,
        input: ListAgentProfilesInput,
    ) -> Result<AgentProfileListResponse, CommandError> {
        if input.scope == AgentScope::Project {
            if let Some(project_id) = input.project_id {
                self.ensure_project_exists(project_id)?;
            }
        }

        let profiles = self
            .repository
            .list_profiles_by_scope(&input.scope, input.project_id)
            .map_err(settings_database_error)?
            .into_iter()
            .map(agent_profile_record_from_row)
            .collect();

        Ok(AgentProfileListResponse { profiles })
    }

    pub fn list_project_labels(
        &self,
        input: ListProjectLabelsInput,
    ) -> Result<ProjectLabelListResponse, CommandError> {
        if input.scope == ProjectLabelScope::Project {
            let project_id = input.project_id.ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::AgentProfileValidationFailed,
                    "项目级 Label 必须指定 project_id。",
                ).with_reason("projectLabelRequiresProjectId")
            })?;
            self.ensure_project_exists(project_id)?;
        }

        let labels = self
            .project_label_repository
            .list_labels_by_scope(&input.scope, input.project_id)
            .map_err(settings_database_error)?
            .into_iter()
            .map(project_label_record_from_row)
            .collect();

        Ok(ProjectLabelListResponse { labels })
    }

    pub fn save_agent_profile(
        &self,
        input: SaveAgentProfileInput,
    ) -> Result<AgentProfileRecord, CommandError> {
        let name = validate_name(&input.name)?;
        let command = validate_command(&input.command)?;

        if input.scope == AgentScope::Project {
            let project_id = input.project_id.ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::AgentProfileValidationFailed,
                    "项目级 Agent 必须指定 project_id。",
                ).with_reason("projectAgentRequiresProjectId")
            })?;
            self.ensure_project_exists(project_id)?;
        }

        self.detector
            .test_command(&command)
            .map_err(agent_command_error)?;

        let row = self
            .repository
            .save_profile(
                input.id,
                &name,
                input.agent_type,
                &command,
                &input.scope,
                input.project_id,
                &input.mode,
                input.dangerous,
                input.default_skill.trim(),
                input.prompt_template.trim(),
                &input.display_mode,
                input.enabled,
            )
            .map_err(settings_database_error)?;

        Ok(agent_profile_record_from_row(row))
    }

    pub fn save_project_label(
        &self,
        input: SaveProjectLabelInput,
    ) -> Result<ProjectLabelRecord, CommandError> {
        let name = validate_project_label_name(&input.name)?;
        let color = validate_project_label_color(&input.color)?;
        let workflow_skill = normalize_optional_string(input.workflow_skill.as_deref());
        let project_id = match input.scope {
            ProjectLabelScope::Project => Some(input.project_id.ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::AgentProfileValidationFailed,
                    "项目级 Label 必须指定 project_id。",
                ).with_reason("projectLabelRequiresProjectId")
                .with_detail(ErrorDetail::new("Field").with_value("name", "projectId"))
            })?),
            ProjectLabelScope::Global => None,
        };

        if let Some(project_id) = project_id {
            self.ensure_project_exists(project_id)?;
        }

        self.ensure_label_name_unique(&name, &input.scope, project_id, input.id)?;

        let row = self
            .project_label_repository
            .save_label(
                input.id,
                &name,
                &input.scope,
                project_id,
                &color,
                workflow_skill.as_deref(),
            )
            .map_err(settings_database_error)?;

        Ok(project_label_record_from_row(row))
    }

    pub fn delete_agent_profile(&self, input: DeleteAgentProfileInput) -> Result<(), CommandError> {
        let deleted = self
            .repository
            .soft_delete_profile(input.id)
            .map_err(settings_database_error)?;

        if deleted {
            return Ok(());
        }

        Err(CommandError::new(
            CommandErrorCode::AgentProfileValidationFailed,
            "Agent Profile 不存在或已删除。",
        ).with_reason("profileNotFound")
        .with_detail(ErrorDetail::new("AgentProfile").with_value("agentProfileId", input.id)))
    }

    pub fn delete_project_label(&self, input: DeleteProjectLabelInput) -> Result<(), CommandError> {
        let deleted = self
            .project_label_repository
            .soft_delete_label(input.id)
            .map_err(settings_database_error)?;

        if deleted {
            return Ok(());
        }

        Err(CommandError::new(
            CommandErrorCode::AgentProfileValidationFailed,
            "Label 不存在或已删除。",
        ).with_reason("labelNotFound")
        .with_detail(ErrorDetail::new("ProjectLabel").with_value("labelId", input.id)))
    }

    pub fn list_saved_agent_skills(
        &self,
        input: ListSavedAgentSkillsInput,
    ) -> Result<SavedAgentSkillListResponse, CommandError> {
        let skills = self
            .saved_agent_skill_repository
            .list_skills(input.scope.as_ref(), input.project_id)
            .map_err(settings_database_error)?
            .into_iter()
            .map(saved_agent_skill_record_from_row)
            .collect();

        Ok(SavedAgentSkillListResponse { skills })
    }

    pub fn save_saved_agent_skill(
        &self,
        input: SaveSavedAgentSkillInput,
    ) -> Result<SavedAgentSkillRecord, CommandError> {
        let name = validate_saved_agent_skill_name(&input.name)?;

        if input.scope == AgentSkillScope::Project {
            let project_id = input.project_id.ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::AgentProfileValidationFailed,
                    "项目级 Skill 必须指定 project_id。",
                ).with_reason("projectSkillRequiresProjectId")
            })?;
            self.ensure_project_exists(project_id)?;
        }

        self.ensure_saved_agent_skill_name_unique(&name, &input.scope, input.project_id, input.id)?;

        let row = self
            .saved_agent_skill_repository
            .save_skill(
                input.id,
                &name,
                &input.scope,
                input.project_id,
                &input.skill_paths,
            )
            .map_err(settings_database_error)?;

        Ok(saved_agent_skill_record_from_row(row))
    }

    pub fn delete_saved_agent_skill(
        &self,
        input: DeleteSavedAgentSkillInput,
    ) -> Result<(), CommandError> {
        let deleted = self
            .saved_agent_skill_repository
            .soft_delete_skill(input.id)
            .map_err(settings_database_error)?;

        if deleted {
            return Ok(());
        }

        Err(CommandError::new(
            CommandErrorCode::AgentProfileValidationFailed,
            "Skill 不存在或已删除。",
        ).with_reason("skillNotFound")
        .with_detail(ErrorDetail::new("SavedAgentSkill").with_value("savedAgentSkillId", input.id)))
    }

    fn ensure_project_exists(&self, project_id: i64) -> Result<(), CommandError> {
        self.project_repository
            .find_by_id(project_id)
            .map_err(settings_database_error)?
            .map(|_| ())
            .ok_or_else(|| {
                CommandError::new(CommandErrorCode::ProjectNotFound, "Project 不存在。")
                    .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id))
            })
    }

    fn ensure_label_name_unique(
        &self,
        name: &str,
        scope: &ProjectLabelScope,
        project_id: Option<i64>,
        excluding_id: Option<i64>,
    ) -> Result<(), CommandError> {
        let duplicate = self
            .project_label_repository
            .find_duplicate_name(name, scope, project_id, excluding_id)
            .map_err(settings_database_error)?;

        if duplicate.is_none() {
            return Ok(());
        }

        let message = match scope {
            ProjectLabelScope::Project => "同一项目内的 Label 名称必须唯一。",
            ProjectLabelScope::Global => "全局 Label 名称必须唯一。",
        };

        Err(
            CommandError::new(CommandErrorCode::AgentProfileValidationFailed, message).with_reason("labelNameNotUnique")
                .with_detail(ErrorDetail::new("Field").with_value("name", "name")),
        )
    }

    fn ensure_saved_agent_skill_name_unique(
        &self,
        name: &str,
        scope: &AgentSkillScope,
        project_id: Option<i64>,
        excluding_id: Option<i64>,
    ) -> Result<(), CommandError> {
        let duplicate = self
            .saved_agent_skill_repository
            .find_duplicate_name(name, scope, project_id, excluding_id)
            .map_err(settings_database_error)?;

        if duplicate.is_none() {
            return Ok(());
        }

        let message = match scope {
            AgentSkillScope::Project => "同一项目内的 Skill 名称必须唯一。",
            AgentSkillScope::Global => "全局 Skill 名称必须唯一。",
        };

        Err(
            CommandError::new(CommandErrorCode::AgentProfileValidationFailed, message).with_reason("skillNameNotUnique")
                .with_detail(ErrorDetail::new("Field").with_value("name", "name")),
        )
    }
}

impl SettingsService<'_, ShellAgentCommandDetector> {
    pub fn detect_codex_command_in_data_dir(
        data_dir: impl AsRef<Path>,
    ) -> Result<AgentCommandCheckResult, CommandError> {
        let database = open_settings_database(data_dir)?;
        let repository = AgentProfileRepository::new(&database.connection);
        let project_label_repository = ProjectLabelRepository::new(&database.connection);
        let saved_agent_skill_repository = SavedAgentSkillRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        SettingsService::new(
            repository,
            project_label_repository,
            saved_agent_skill_repository,
            project_repository,
            ShellAgentCommandDetector::new(),
        )
        .detect_codex_command()
    }

    pub fn test_agent_command_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: TestAgentCommandInput,
    ) -> Result<AgentCommandCheckResult, CommandError> {
        let database = open_settings_database(data_dir)?;
        let repository = AgentProfileRepository::new(&database.connection);
        let project_label_repository = ProjectLabelRepository::new(&database.connection);
        let saved_agent_skill_repository = SavedAgentSkillRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        SettingsService::new(
            repository,
            project_label_repository,
            saved_agent_skill_repository,
            project_repository,
            ShellAgentCommandDetector::new(),
        )
        .test_agent_command(input)
    }

    pub fn list_agent_profiles_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: ListAgentProfilesInput,
    ) -> Result<AgentProfileListResponse, CommandError> {
        let database = open_settings_database(data_dir)?;
        let repository = AgentProfileRepository::new(&database.connection);
        let project_label_repository = ProjectLabelRepository::new(&database.connection);
        let saved_agent_skill_repository = SavedAgentSkillRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        SettingsService::new(
            repository,
            project_label_repository,
            saved_agent_skill_repository,
            project_repository,
            ShellAgentCommandDetector::new(),
        )
        .list_agent_profiles(input)
    }

    pub fn save_agent_profile_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: SaveAgentProfileInput,
    ) -> Result<AgentProfileRecord, CommandError> {
        let database = open_settings_database(data_dir)?;
        let repository = AgentProfileRepository::new(&database.connection);
        let project_label_repository = ProjectLabelRepository::new(&database.connection);
        let saved_agent_skill_repository = SavedAgentSkillRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        SettingsService::new(
            repository,
            project_label_repository,
            saved_agent_skill_repository,
            project_repository,
            ShellAgentCommandDetector::new(),
        )
        .save_agent_profile(input)
    }

    pub fn delete_agent_profile_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: DeleteAgentProfileInput,
    ) -> Result<(), CommandError> {
        let database = open_settings_database(data_dir)?;
        let repository = AgentProfileRepository::new(&database.connection);
        let project_label_repository = ProjectLabelRepository::new(&database.connection);
        let saved_agent_skill_repository = SavedAgentSkillRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        SettingsService::new(
            repository,
            project_label_repository,
            saved_agent_skill_repository,
            project_repository,
            ShellAgentCommandDetector::new(),
        )
        .delete_agent_profile(input)
    }

    pub fn list_project_labels_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: ListProjectLabelsInput,
    ) -> Result<ProjectLabelListResponse, CommandError> {
        let database = open_settings_database(data_dir)?;
        let repository = AgentProfileRepository::new(&database.connection);
        let project_label_repository = ProjectLabelRepository::new(&database.connection);
        let saved_agent_skill_repository = SavedAgentSkillRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        SettingsService::new(
            repository,
            project_label_repository,
            saved_agent_skill_repository,
            project_repository,
            ShellAgentCommandDetector::new(),
        )
        .list_project_labels(input)
    }

    pub fn save_project_label_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: SaveProjectLabelInput,
    ) -> Result<ProjectLabelRecord, CommandError> {
        let database = open_settings_database(data_dir)?;
        let repository = AgentProfileRepository::new(&database.connection);
        let project_label_repository = ProjectLabelRepository::new(&database.connection);
        let saved_agent_skill_repository = SavedAgentSkillRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        SettingsService::new(
            repository,
            project_label_repository,
            saved_agent_skill_repository,
            project_repository,
            ShellAgentCommandDetector::new(),
        )
        .save_project_label(input)
    }

    pub fn delete_project_label_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: DeleteProjectLabelInput,
    ) -> Result<(), CommandError> {
        let database = open_settings_database(data_dir)?;
        let repository = AgentProfileRepository::new(&database.connection);
        let project_label_repository = ProjectLabelRepository::new(&database.connection);
        let saved_agent_skill_repository = SavedAgentSkillRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        SettingsService::new(
            repository,
            project_label_repository,
            saved_agent_skill_repository,
            project_repository,
            ShellAgentCommandDetector::new(),
        )
        .delete_project_label(input)
    }

    pub fn list_saved_agent_skills_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: ListSavedAgentSkillsInput,
    ) -> Result<SavedAgentSkillListResponse, CommandError> {
        let database = open_settings_database(data_dir)?;
        let repository = AgentProfileRepository::new(&database.connection);
        let project_label_repository = ProjectLabelRepository::new(&database.connection);
        let saved_agent_skill_repository = SavedAgentSkillRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        SettingsService::new(
            repository,
            project_label_repository,
            saved_agent_skill_repository,
            project_repository,
            ShellAgentCommandDetector::new(),
        )
        .list_saved_agent_skills(input)
    }

    pub fn save_saved_agent_skill_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: SaveSavedAgentSkillInput,
    ) -> Result<SavedAgentSkillRecord, CommandError> {
        let database = open_settings_database(data_dir)?;
        let repository = AgentProfileRepository::new(&database.connection);
        let project_label_repository = ProjectLabelRepository::new(&database.connection);
        let saved_agent_skill_repository = SavedAgentSkillRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        SettingsService::new(
            repository,
            project_label_repository,
            saved_agent_skill_repository,
            project_repository,
            ShellAgentCommandDetector::new(),
        )
        .save_saved_agent_skill(input)
    }

    pub fn delete_saved_agent_skill_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: DeleteSavedAgentSkillInput,
    ) -> Result<(), CommandError> {
        let database = open_settings_database(data_dir)?;
        let repository = AgentProfileRepository::new(&database.connection);
        let project_label_repository = ProjectLabelRepository::new(&database.connection);
        let saved_agent_skill_repository = SavedAgentSkillRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        SettingsService::new(
            repository,
            project_label_repository,
            saved_agent_skill_repository,
            project_repository,
            ShellAgentCommandDetector::new(),
        )
        .delete_saved_agent_skill(input)
    }

    /// 启动时播种内置 agent（ADR-0020）；开库 + 迁移 + 构造 service 后调用。
    /// 供 `lib.rs` 的 setup 钩子在 `spawn_blocking` 中调用，失败仅记日志不阻断启动。
    pub fn seed_builtin_agents_in_data_dir(
        data_dir: impl AsRef<Path>,
    ) -> Result<(), CommandError> {
        let database = open_settings_database(data_dir)?;
        let repository = AgentProfileRepository::new(&database.connection);
        let project_label_repository = ProjectLabelRepository::new(&database.connection);
        let saved_agent_skill_repository = SavedAgentSkillRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        SettingsService::new(
            repository,
            project_label_repository,
            saved_agent_skill_repository,
            project_repository,
            ShellAgentCommandDetector::new(),
        )
        .seed_builtin_agents()
    }

    /// 参数预览（ADR-0020）；无状态查询，开只读连接即可，沿用现有 `_in_data_dir` 模式。
    pub fn preview_agent_command_args_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: PreviewAgentCommandArgsInput,
    ) -> Result<Vec<String>, CommandError> {
        let database = open_settings_database(data_dir)?;
        let repository = AgentProfileRepository::new(&database.connection);
        let project_label_repository = ProjectLabelRepository::new(&database.connection);
        let saved_agent_skill_repository = SavedAgentSkillRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        SettingsService::new(
            repository,
            project_label_repository,
            saved_agent_skill_repository,
            project_repository,
            ShellAgentCommandDetector::new(),
        )
        .preview_agent_command_args(input)
    }
}

fn open_settings_database(
    data_dir: impl AsRef<Path>,
) -> Result<crate::db::connection::Database, CommandError> {
    let database = DatabaseConfig::new(data_dir)
        .open()
        .map_err(CommandError::from)?;
    MigrationRunner::default()
        .run(&database.connection)
        .map_err(|error| {
            CommandError::new(
                CommandErrorCode::SettingsPersistenceFailed,
                "设置保存失败。",
            )
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?;

    Ok(database)
}

fn agent_profile_record_from_row(
    row: crate::db::agent_profile_repository::AgentProfileRow,
) -> AgentProfileRecord {
    AgentProfileRecord {
        id: row.id,
        name: row.name,
        agent_type: row.agent_type,
        command: row.command,
        scope: row.scope,
        project_id: row.project_id,
        mode: row.mode,
        dangerous: row.dangerous,
        default_skill: row.default_skill,
        prompt_template: row.prompt_template,
        del: row.del,
        display_mode: row.display_mode,
        enabled: row.enabled,
    }
}

fn project_label_record_from_row(
    row: crate::db::project_label_repository::ProjectLabelRow,
) -> ProjectLabelRecord {
    ProjectLabelRecord {
        id: row.id,
        name: row.name,
        scope: row.scope,
        project_id: row.project_id,
        color: row.color,
        workflow_skill: row.workflow_skill,
        del: row.del,
    }
}

fn saved_agent_skill_record_from_row(
    row: crate::db::saved_agent_skill_repository::SavedAgentSkillRow,
) -> SavedAgentSkillRecord {
    SavedAgentSkillRecord {
        id: row.id,
        name: row.name,
        scope: row.scope,
        project_id: row.project_id,
        skill_paths: row.skill_paths,
    }
}

fn validate_name(name: &str) -> Result<String, CommandError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(CommandError::new(
            CommandErrorCode::AgentProfileValidationFailed,
            "Agent Profile 名称不能为空。",
        ).with_reason("nameRequired")
        .with_detail(ErrorDetail::new("Field").with_value("name", "name")));
    }

    Ok(trimmed.to_string())
}

fn validate_command(command: &str) -> Result<String, CommandError> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err(CommandError::new(
            CommandErrorCode::AgentProfileValidationFailed,
            "Agent command 不能为空。",
        ).with_reason("commandRequired")
        .with_detail(ErrorDetail::new("Field").with_value("name", "command")));
    }

    Ok(trimmed.to_string())
}

fn validate_project_label_name(name: &str) -> Result<String, CommandError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(CommandError::new(
            CommandErrorCode::AgentProfileValidationFailed,
            "Label 名称不能为空。",
        ).with_reason("labelNameRequired")
        .with_detail(ErrorDetail::new("Field").with_value("name", "name")));
    }

    if trimmed.chars().count() > 15 {
        return Err(CommandError::new(
            CommandErrorCode::AgentProfileValidationFailed,
            "Label 名称最多 15 个字符。",
        ).with_reason("labelNameTooLong")
        .with_detail(ErrorDetail::new("Field").with_value("name", "name")));
    }

    Ok(trimmed.to_string())
}

fn validate_project_label_color(color: &str) -> Result<String, CommandError> {
    let trimmed = color.trim();
    let is_hex = trimmed.len() == 7
        && trimmed.starts_with('#')
        && trimmed.chars().skip(1).all(|char| char.is_ascii_hexdigit());

    if !is_hex {
        return Err(CommandError::new(
            CommandErrorCode::AgentProfileValidationFailed,
            "Label 颜色必须是 #RRGGBB 格式。",
        ).with_reason("labelColorInvalid")
        .with_detail(ErrorDetail::new("Field").with_value("name", "color")));
    }

    Ok(trimmed.to_uppercase())
}

fn validate_saved_agent_skill_name(name: &str) -> Result<String, CommandError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(CommandError::new(
            CommandErrorCode::AgentProfileValidationFailed,
            "Skill 名称不能为空。",
        ).with_reason("skillNameRequired")
        .with_detail(ErrorDetail::new("Field").with_value("name", "name")));
    }

    Ok(trimmed.to_string())
}

fn normalize_optional_string(value: Option<&str>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn agent_command_error(message: String) -> CommandError {
    CommandError::new(
        CommandErrorCode::AgentCommandUnavailable,
        "Agent command 不可用。",
    )
    .with_detail(ErrorDetail::new("Cause").with_value("message", message))
}

fn settings_database_error(error: rusqlite::Error) -> CommandError {
    CommandError::new(
        CommandErrorCode::SettingsPersistenceFailed,
        "设置保存失败。",
    )
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}

/// 内置 agent 播种顺序与默认值（ADR-0020 决策清单 #1 与「内置 Agent 默认值表」）。
const BUILTIN_AGENT_SEED_ORDER: [AgentType; 4] = [
    AgentType::Codex,
    AgentType::Claude,
    AgentType::OpenCode,
    AgentType::Grok,
];

fn builtin_agent_command_name(agent_type: &AgentType) -> &'static str {
    match agent_type {
        AgentType::Codex => "codex",
        AgentType::Claude => "claude",
        AgentType::OpenCode => "opencode",
        AgentType::Grok => "grok",
    }
}

/// 按 spec 默认值表构造内置 agent 的 global profile；command 用探测解析后的命令字符串。
fn default_builtin_profile_input(agent_type: AgentType, detected_command: &str) -> SaveAgentProfileInput {
    let (name, display_mode) = match agent_type {
        AgentType::Codex => ("Codex", "json"),
        AgentType::Claude => ("Claude Code", "json"),
        AgentType::OpenCode => ("OpenCode", "tui"),
        AgentType::Grok => ("Grok", "tui"),
    };
    SaveAgentProfileInput {
        id: None,
        name: name.to_string(),
        agent_type,
        command: detected_command.to_string(),
        scope: AgentScope::Global,
        project_id: None,
        mode: "full-access".to_string(),
        dangerous: true,
        default_skill: String::new(),
        prompt_template: String::new(),
        display_mode: display_mode.to_string(),
        enabled: true,
    }
}

#[cfg(test)]
#[path = "service_label_tests.rs"]
mod label_tests;

#[cfg(test)]
#[path = "service_seed_preview_tests.rs"]
mod seed_preview_tests;
