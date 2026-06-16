use std::path::Path;

use crate::agent::command_detector::{AgentCommandDetector, ShellAgentCommandDetector};
use crate::db::agent_profile_repository::AgentProfileRepository;
use crate::db::connection::DatabaseConfig;
use crate::db::migrations::MigrationRunner;
use crate::db::project_repository::ProjectRepository;
use crate::types::agent_profile::{
    AgentCommandCheckResult, AgentProfileListResponse, AgentProfileRecord, AgentScope,
    DeleteAgentProfileInput, ListAgentProfilesInput, SaveAgentProfileInput, TestAgentCommandInput,
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
                )
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
            )
            .map_err(settings_database_error)?;

        Ok(agent_profile_record_from_row(row))
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
        )
        .with_detail(ErrorDetail::new("AgentProfile").with_value("agentProfileId", input.id)))
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
        input: ListAgentProfilesInput,
    ) -> Result<AgentProfileListResponse, CommandError> {
        let database = open_settings_database(data_dir)?;
        let repository = AgentProfileRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        SettingsService::new(
            repository,
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
        let project_repository = ProjectRepository::new(&database.connection);
        SettingsService::new(
            repository,
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
        let project_repository = ProjectRepository::new(&database.connection);
        SettingsService::new(
            repository,
            project_repository,
            ShellAgentCommandDetector::new(),
        )
        .delete_agent_profile(input)
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
    }
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
