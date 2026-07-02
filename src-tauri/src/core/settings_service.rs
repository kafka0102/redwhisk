use std::path::Path;

use crate::agent::command_detector::{AgentCommandDetector, ShellAgentCommandDetector};
use crate::db::agent_profile_repository::AgentProfileRepository;
use crate::db::connection::DatabaseConfig;
use crate::db::migrations::MigrationRunner;
use crate::db::project_label_repository::ProjectLabelRepository;
use crate::db::project_repository::ProjectRepository;
use crate::db::saved_agent_skill_repository::SavedAgentSkillRepository;
use crate::types::agent_profile::{
    AgentCommandCheckResult, AgentProfileListResponse, AgentProfileRecord, AgentScope,
    DeleteAgentProfileInput, ListAgentProfilesInput, SaveAgentProfileInput, TestAgentCommandInput,
};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::project_label::{
    DeleteProjectLabelInput, ListProjectLabelsInput, ProjectLabelListResponse, ProjectLabelRecord,
    ProjectLabelScope, SaveProjectLabelInput,
};
use crate::types::saved_agent_skill::{
    DeleteSavedAgentSkillInput, ListSavedAgentSkillsInput, SavedAgentSkillListResponse,
    SavedAgentSkillRecord, SaveSavedAgentSkillInput,
};
use crate::types::agent_skill::AgentSkillScope;

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
                )
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
                )
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
        )
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
        )
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
                )
            })?;
            self.ensure_project_exists(project_id)?;
        }

        self.ensure_saved_agent_skill_name_unique(&name, &input.scope, input.project_id, input.id)?;

        let row = self
            .saved_agent_skill_repository
            .save_skill(input.id, &name, &input.scope, input.project_id, &input.skill_paths)
            .map_err(settings_database_error)?;

        Ok(saved_agent_skill_record_from_row(row))
    }

    pub fn delete_saved_agent_skill(&self, input: DeleteSavedAgentSkillInput) -> Result<(), CommandError> {
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
        )
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
            ProjectLabelScope::Global => "全局 Label 名称必须在所有项目和全局范围内唯一。",
        };

        Err(
            CommandError::new(CommandErrorCode::AgentProfileValidationFailed, message)
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
            CommandError::new(CommandErrorCode::AgentProfileValidationFailed, message)
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

fn validate_project_label_name(name: &str) -> Result<String, CommandError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(CommandError::new(
            CommandErrorCode::AgentProfileValidationFailed,
            "Label 名称不能为空。",
        )
        .with_detail(ErrorDetail::new("Field").with_value("name", "name")));
    }

    if trimmed.chars().count() > 15 {
        return Err(CommandError::new(
            CommandErrorCode::AgentProfileValidationFailed,
            "Label 名称最多 15 个字符。",
        )
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
        )
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
        )
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::command_detector::AgentCommandDetector;
    use crate::db::connection::DatabaseConfig;
    use crate::db::migrations::MigrationRunner;
    use crate::types::agent_profile::{AgentScope, AgentType, SaveAgentProfileInput};
    use rusqlite::Connection;

    #[derive(Default)]
    struct TestDetector;

    impl AgentCommandDetector for TestDetector {
        fn detect_codex_command(&self) -> Result<String, String> {
            Ok("codex".to_string())
        }

        fn test_command(&self, command: &str) -> Result<String, String> {
            Ok(command.to_string())
        }
    }

    #[test]
    fn save_project_label_rejects_name_longer_than_fifteen_chars() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let database = test_database(temp_dir.path());
        let service = test_settings_service(&database.connection);
        let project_id = insert_project(&database.connection, "repo-a");

        let error = service
            .save_project_label(SaveProjectLabelInput {
                id: None,
                name: "1234567890abcdef".to_string(),
                scope: ProjectLabelScope::Project,
                project_id: Some(project_id),
                color: "#112233".to_string(),
                workflow_skill: None,
            })
            .expect_err("long label should fail");

        assert_eq!(error.code, CommandErrorCode::AgentProfileValidationFailed);
    }

    #[test]
    fn save_project_label_rejects_duplicate_name_within_same_project() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let database = test_database(temp_dir.path());
        let service = test_settings_service(&database.connection);
        let project_id = insert_project(&database.connection, "repo-a");

        service
            .save_project_label(SaveProjectLabelInput {
                id: None,
                name: "ops".to_string(),
                scope: ProjectLabelScope::Project,
                project_id: Some(project_id),
                color: "#112233".to_string(),
                workflow_skill: None,
            })
            .expect("first label");

        let error = service
            .save_project_label(SaveProjectLabelInput {
                id: None,
                name: "ops".to_string(),
                scope: ProjectLabelScope::Project,
                project_id: Some(project_id),
                color: "#445566".to_string(),
                workflow_skill: None,
            })
            .expect_err("duplicate should fail");

        assert_eq!(error.code, CommandErrorCode::AgentProfileValidationFailed);
    }

    #[test]
    fn save_global_project_label_rejects_duplicate_name_from_project_scope() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let database = test_database(temp_dir.path());
        let service = test_settings_service(&database.connection);
        let project_id = insert_project(&database.connection, "repo-a");

        service
            .save_project_label(SaveProjectLabelInput {
                id: None,
                name: "ops".to_string(),
                scope: ProjectLabelScope::Project,
                project_id: Some(project_id),
                color: "#112233".to_string(),
                workflow_skill: None,
            })
            .expect("project label");

        let error = service
            .save_project_label(SaveProjectLabelInput {
                id: None,
                name: "ops".to_string(),
                scope: ProjectLabelScope::Global,
                project_id: None,
                color: "#445566".to_string(),
                workflow_skill: None,
            })
            .expect_err("global duplicate should fail");

        assert_eq!(error.code, CommandErrorCode::AgentProfileValidationFailed);
    }

    #[test]
    fn save_project_label_rejects_workflow_skill_without_agent() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let database = test_database(temp_dir.path());
        let service = test_settings_service(&database.connection);
        let project_id = insert_project(&database.connection, "repo-a");

        let error = service
            .save_project_label(SaveProjectLabelInput {
                id: None,
                name: "ops".to_string(),
                scope: ProjectLabelScope::Project,
                project_id: Some(project_id),
                color: "#112233".to_string(),
                workflow_skill: Some("skill-a".to_string()),
            })
            .expect_err("workflow skill without agent should fail");

        assert_eq!(error.code, CommandErrorCode::AgentProfileValidationFailed);
    }

    #[test]
    fn save_project_label_allows_same_name_in_other_project() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let database = test_database(temp_dir.path());
        let service = test_settings_service(&database.connection);
        let project_a = insert_project(&database.connection, "repo-a");
        let project_b = insert_project(&database.connection, "repo-b");

        service
            .save_project_label(SaveProjectLabelInput {
                id: None,
                name: "ops".to_string(),
                scope: ProjectLabelScope::Project,
                project_id: Some(project_a),
                color: "#112233".to_string(),
                workflow_skill: None,
            })
            .expect("project a label");

        let saved = service
            .save_project_label(SaveProjectLabelInput {
                id: None,
                name: "ops".to_string(),
                scope: ProjectLabelScope::Project,
                project_id: Some(project_b),
                color: "#445566".to_string(),
                workflow_skill: None,
            })
            .expect("project b label");

        assert_eq!(saved.name, "ops");
        assert_eq!(saved.project_id, Some(project_b));
    }

    #[test]
    fn save_global_label_allows_no_agent_profile() {
        // agent_profile_id 字段已在 decouple-label-agent-skills 中移除；
        // global label 不再因绑定 project agent 而被拒绝。
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let database = test_database(temp_dir.path());
        let service = test_settings_service(&database.connection);
        let _project_id = insert_project(&database.connection, "repo-a");

        let saved = service
            .save_project_label(SaveProjectLabelInput {
                id: None,
                name: "release".to_string(),
                scope: ProjectLabelScope::Global,
                project_id: None,
                color: "#112233".to_string(),
                workflow_skill: None,
            })
            .expect("global label without agent profile should save");

        assert_eq!(saved.name, "release");
    }

    fn test_database(data_dir: &std::path::Path) -> crate::db::connection::Database {
        let database = DatabaseConfig::new(data_dir).open().expect("database");
        MigrationRunner::default()
            .run(&database.connection)
            .expect("migrations");
        database
    }

    fn test_settings_service<'a>(connection: &'a Connection) -> SettingsService<'a, TestDetector> {
        SettingsService::new(
            AgentProfileRepository::new(connection),
            ProjectLabelRepository::new(connection),
            SavedAgentSkillRepository::new(connection),
            ProjectRepository::new(connection),
            TestDetector,
        )
    }

    fn insert_project(connection: &Connection, repo_name: &str) -> i64 {
        ProjectRepository::new(connection)
            .insert(repo_name, &format!("/tmp/{repo_name}"))
            .expect("project")
            .id
    }

    #[allow(dead_code)]
    fn insert_agent_profile(
        service: &SettingsService<'_, TestDetector>,
        project_id: Option<i64>,
        scope: AgentScope,
    ) -> i64 {
        service
            .save_agent_profile(SaveAgentProfileInput {
                id: None,
                name: format!("agent-{scope:?}"),
                agent_type: AgentType::Codex,
                command: "codex".to_string(),
                scope,
                project_id,
                mode: "default".to_string(),
                dangerous: true,
                default_skill: "".to_string(),
                prompt_template: "".to_string(),
            })
            .expect("agent profile")
            .id
    }
}
