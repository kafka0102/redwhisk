use std::path::Path;

use crate::db::agent_profile_repository::AgentProfileRepository;
use crate::db::connection::DatabaseConfig;
use crate::db::issue_repository::IssueRepository;
use crate::db::migrations::MigrationRunner;
use crate::db::project_repository::ProjectRepository;
use crate::types::agent_profile::AgentScope;
use crate::types::agent_session::StartAgentSessionInput;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::issue::IssueStatus;

pub struct AgentSessionService<'connection> {
    issue_repository: IssueRepository<'connection>,
    project_repository: ProjectRepository<'connection>,
    agent_profile_repository: AgentProfileRepository<'connection>,
}

impl<'connection> AgentSessionService<'connection> {
    pub fn new(
        issue_repository: IssueRepository<'connection>,
        project_repository: ProjectRepository<'connection>,
        agent_profile_repository: AgentProfileRepository<'connection>,
    ) -> Self {
        Self {
            issue_repository,
            project_repository,
            agent_profile_repository,
        }
    }

    pub fn start_agent_session(&self, input: StartAgentSessionInput) -> Result<(), CommandError> {
        let prompt_snapshot = validate_prompt_snapshot(&input.prompt_snapshot)?;

        self.project_repository
            .find_by_id(input.project_id)
            .map_err(agent_session_database_error)?
            .ok_or_else(|| {
                CommandError::new(CommandErrorCode::ProjectNotFound, "Project 不存在。")
                    .with_detail(
                        ErrorDetail::new("Project").with_value("projectId", input.project_id),
                    )
            })?;

        let issue = self
            .issue_repository
            .find_by_id(input.issue_id)
            .map_err(agent_session_database_error)?
            .ok_or_else(|| {
                CommandError::new(CommandErrorCode::IssueNotFound, "Issue 不存在。")
                    .with_detail(ErrorDetail::new("Issue").with_value("issueId", input.issue_id))
            })?;

        if issue.project_id != input.project_id {
            return Err(CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "Issue 不属于当前 Project。",
            )
            .with_detail(ErrorDetail::new("Issue").with_value("issueId", input.issue_id))
            .with_detail(ErrorDetail::new("Project").with_value("projectId", input.project_id)));
        }

        if issue.status != IssueStatus::Backlog {
            return Err(CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "只有 backlog Issue 可以启动 Agent Session。",
            )
            .with_detail(ErrorDetail::new("Issue").with_value("issueId", input.issue_id))
            .with_detail(
                ErrorDetail::new("IssueStatus")
                    .with_value("status", format!("{:?}", issue.status).to_lowercase()),
            ));
        }

        let profile = self
            .agent_profile_repository
            .find_profile_by_id(input.agent_profile_id)
            .map_err(agent_session_database_error)?
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

        match profile.scope {
            AgentScope::Global => {}
            AgentScope::Project => {
                if profile.project_id != Some(input.project_id) {
                    return Err(CommandError::new(
                        CommandErrorCode::AgentSessionValidationFailed,
                        "项目级 Agent Profile 不属于当前 Project。",
                    )
                    .with_detail(
                        ErrorDetail::new("AgentProfile")
                            .with_value("agentProfileId", input.agent_profile_id),
                    )
                    .with_detail(
                        ErrorDetail::new("Project").with_value("projectId", input.project_id),
                    ));
                }
            }
        }

        Err(CommandError::new(
            CommandErrorCode::AgentSessionStartNotReady,
            "Agent Session 启动将在 Story 2.3 接入。",
        )
        .with_detail(
            ErrorDetail::new("PromptSnapshot")
                .with_value("length", prompt_snapshot.chars().count() as i64),
        ))
    }
}

impl AgentSessionService<'_> {
    pub fn start_agent_session_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: StartAgentSessionInput,
    ) -> Result<(), CommandError> {
        let database = DatabaseConfig::new(data_dir)
            .open()
            .map_err(CommandError::from)?;
        MigrationRunner::default()
            .run(&database.connection)
            .map_err(agent_session_database_error)?;

        AgentSessionService::new(
            IssueRepository::new(&database.connection),
            ProjectRepository::new(&database.connection),
            AgentProfileRepository::new(&database.connection),
        )
        .start_agent_session(input)
    }
}

fn validate_prompt_snapshot(prompt_snapshot: &str) -> Result<String, CommandError> {
    let trimmed = prompt_snapshot.trim();
    if trimmed.is_empty() {
        return Err(CommandError::new(
            CommandErrorCode::AgentSessionValidationFailed,
            "最终 prompt 不能为空。",
        )
        .with_detail(ErrorDetail::new("Field").with_value("name", "promptSnapshot")));
    }

    Ok(trimmed.to_string())
}

fn agent_session_database_error(error: impl std::fmt::Display) -> CommandError {
    CommandError::new(
        CommandErrorCode::AgentSessionPersistenceFailed,
        "Agent Session 启动失败。",
    )
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}
