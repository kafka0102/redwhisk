use std::path::Path;

use crate::agent::command_detector::{AgentCommandDetector, ShellAgentCommandDetector};
use crate::db::agent_profile_repository::{
    AgentProfileRepository, AgentProfileRow, ProjectAgentOverrideRow,
};
use crate::db::connection::DatabaseConfig;
use crate::db::migrations::MigrationRunner;
use crate::db::project_repository::ProjectRepository;
use crate::types::agent_profile::{
    AgentCommandCheckResult, AgentProfileListResponse, AgentProfileRecord,
    ListProjectAgentOverridesInput, ProjectAgentOverrideListResponse, ProjectAgentOverrideRecord,
    SaveAgentProfileInput, SaveProjectAgentOverrideInput, TestAgentCommandInput,
};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};

pub struct SettingsService<'connection, TDetector> {
    repository: AgentProfileRepository<'connection>,
    project_repository: ProjectRepository<'connection>,
    detector: TDetector,
}

impl<'connection, TDetector> SettingsService<'connection, TDetector>
where
    TDetector: AgentCommandDetector,
{
    pub fn new(
        repository: AgentProfileRepository<'connection>,
        project_repository: ProjectRepository<'connection>,
        detector: TDetector,
    ) -> Self {
        Self {
            repository,
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

    pub fn list_agent_profiles(&self) -> Result<AgentProfileListResponse, CommandError> {
        let profiles = self
            .repository
            .list_profiles()
            .map_err(settings_database_error)?
            .into_iter()
            .map(agent_profile_record_from_row)
            .collect::<Result<Vec<_>, _>>()?;

        Ok(AgentProfileListResponse { profiles })
    }

    pub fn save_agent_profile(
        &self,
        input: SaveAgentProfileInput,
    ) -> Result<AgentProfileRecord, CommandError> {
        let name = validate_name(&input.name)?;
        let command = validate_command(&input.command)?;
        let default_skill = input.default_skill.trim().to_string();
        let prompt_template = input.prompt_template.trim().to_string();
        let default_args_json = serialize_default_args(&input.default_args)?;
        let command_to_save = if input.enabled {
            self.detector
                .test_command(&command)
                .map_err(agent_command_error)?
        } else {
            command
        };

        let row = self
            .repository
            .save_profile(
                input.id,
                &name,
                input.agent_type,
                &command_to_save,
                &default_args_json,
                &default_skill,
                &prompt_template,
                input.enabled,
            )
            .map_err(settings_database_error)?;

        agent_profile_record_from_row(row)
    }

    pub fn list_project_agent_overrides(
        &self,
        input: ListProjectAgentOverridesInput,
    ) -> Result<ProjectAgentOverrideListResponse, CommandError> {
        self.ensure_project_exists(input.project_id)?;
        let overrides = self
            .repository
            .list_project_agent_overrides(input.project_id)
            .map_err(settings_database_error)?
            .into_iter()
            .map(project_override_record_from_row)
            .collect::<Result<Vec<_>, _>>()?;

        Ok(ProjectAgentOverrideListResponse { overrides })
    }

    pub fn save_project_agent_override(
        &self,
        input: SaveProjectAgentOverrideInput,
    ) -> Result<ProjectAgentOverrideRecord, CommandError> {
        self.ensure_project_exists(input.project_id)?;
        let profile = self
            .repository
            .find_profile_by_id(input.agent_profile_id)
            .map_err(settings_database_error)?
            .ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::AgentProfileValidationFailed,
                    "Agent Profile 不存在。",
                )
                .with_detail(
                    ErrorDetail::new("AgentProfile")
                        .with_value("agentProfileId", input.agent_profile_id),
                )
            })?;

        if input.enabled {
            self.detector
                .test_command(&profile.command)
                .map_err(agent_command_error)?;
        }

        let row = self
            .repository
            .save_project_agent_override(
                input.project_id,
                input.agent_profile_id,
                &serialize_default_args(&input.default_args)?,
                input.default_skill.trim(),
                input.prompt_template.trim(),
                input.enabled,
            )
            .map_err(settings_database_error)?;

        project_override_record_from_row(row)
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
}

impl SettingsService<'_, ShellAgentCommandDetector> {
    pub fn detect_codex_command_in_data_dir(
        data_dir: impl AsRef<Path>,
    ) -> Result<AgentCommandCheckResult, CommandError> {
        let database = open_settings_database(data_dir)?;
        let repository = AgentProfileRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        SettingsService::new(
            repository,
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
        let project_repository = ProjectRepository::new(&database.connection);
        SettingsService::new(
            repository,
            project_repository,
            ShellAgentCommandDetector::new(),
        )
        .test_agent_command(input)
    }

    pub fn list_agent_profiles_in_data_dir(
        data_dir: impl AsRef<Path>,
    ) -> Result<AgentProfileListResponse, CommandError> {
        let database = open_settings_database(data_dir)?;
        let repository = AgentProfileRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        SettingsService::new(
            repository,
            project_repository,
            ShellAgentCommandDetector::new(),
        )
        .list_agent_profiles()
    }

    pub fn save_agent_profile_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: SaveAgentProfileInput,
    ) -> Result<AgentProfileRecord, CommandError> {
        let database = open_settings_database(data_dir)?;
        let repository = AgentProfileRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        SettingsService::new(
            repository,
            project_repository,
            ShellAgentCommandDetector::new(),
        )
        .save_agent_profile(input)
    }

    pub fn list_project_agent_overrides_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: ListProjectAgentOverridesInput,
    ) -> Result<ProjectAgentOverrideListResponse, CommandError> {
        let database = open_settings_database(data_dir)?;
        let repository = AgentProfileRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        SettingsService::new(
            repository,
            project_repository,
            ShellAgentCommandDetector::new(),
        )
        .list_project_agent_overrides(input)
    }

    pub fn save_project_agent_override_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: SaveProjectAgentOverrideInput,
    ) -> Result<ProjectAgentOverrideRecord, CommandError> {
        let database = open_settings_database(data_dir)?;
        let repository = AgentProfileRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        SettingsService::new(
            repository,
            project_repository,
            ShellAgentCommandDetector::new(),
        )
        .save_project_agent_override(input)
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

fn agent_profile_record_from_row(row: AgentProfileRow) -> Result<AgentProfileRecord, CommandError> {
    Ok(AgentProfileRecord {
        id: row.id,
        name: row.name,
        agent_type: row.agent_type,
        command: row.command,
        default_args: parse_default_args(&row.default_args)?,
        default_skill: row.default_skill,
        prompt_template: row.prompt_template,
        enabled: row.enabled,
    })
}

fn project_override_record_from_row(
    row: ProjectAgentOverrideRow,
) -> Result<ProjectAgentOverrideRecord, CommandError> {
    Ok(ProjectAgentOverrideRecord {
        id: row.id,
        project_id: row.project_id,
        agent_profile_id: row.agent_profile_id,
        default_args: parse_default_args(&row.default_args)?,
        default_skill: row.default_skill,
        prompt_template: row.prompt_template,
        enabled: row.enabled,
    })
}

fn validate_name(name: &str) -> Result<String, CommandError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(CommandError::new(
            CommandErrorCode::AgentProfileValidationFailed,
            "Agent Profile 名称不能为空。",
        )
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
        )
        .with_detail(ErrorDetail::new("Field").with_value("name", "command")));
    }

    Ok(trimmed.to_string())
}

fn serialize_default_args(default_args: &[String]) -> Result<String, CommandError> {
    serde_json::to_string(default_args).map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentProfileValidationFailed,
            "默认参数格式无效。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })
}

fn parse_default_args(default_args: &str) -> Result<Vec<String>, CommandError> {
    serde_json::from_str(default_args).map_err(|error| {
        CommandError::new(
            CommandErrorCode::SettingsPersistenceFailed,
            "设置保存失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
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
