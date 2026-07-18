use std::path::Path;

use crate::db::agent_profile_repository::AgentProfileRow;
use crate::types::agent_profile::AgentScope;
use crate::types::errors::{
    CommandError, CommandErrorCode, ErrorDetail,
};


pub(super) fn validate_profile_scope(profile: &AgentProfileRow, project_id: i64) -> Result<(), CommandError> {
    match profile.scope {
        AgentScope::Global => Ok(()),
        AgentScope::Project => {
            if profile.project_id == Some(project_id) {
                Ok(())
            } else {
                Err(CommandError::new(
                    CommandErrorCode::AgentSessionValidationFailed,
                    "项目级 Agent Profile 不属于当前 Project。",
                ).with_reason("profileNotInProject")
                .with_detail(
                    ErrorDetail::new("AgentProfile").with_value("agentProfileId", profile.id),
                )
                .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id)))
            }
        }
    }
}


pub(super) fn validate_profile_not_deleted(profile: &AgentProfileRow) -> Result<(), CommandError> {
    if profile.del == 0 {
        return Ok(());
    }

    Err(CommandError::new(
        CommandErrorCode::AgentProfileValidationFailed,
        "Agent Profile 已删除。",
    ).with_reason("profileDeleted")
    .with_detail(ErrorDetail::new("AgentProfile").with_value("agentProfileId", profile.id)))
}


pub(super) fn validate_prompt_snapshot(prompt_snapshot: &str) -> Result<String, CommandError> {
    let trimmed = prompt_snapshot.trim();
    if trimmed.is_empty() {
        return Err(CommandError::new(
            CommandErrorCode::AgentSessionValidationFailed,
            "最终 prompt 不能为空。",
        ).with_reason("finalPromptRequired")
        .with_detail(ErrorDetail::new("Field").with_value("name", "promptSnapshot")));
    }

    Ok(trimmed.to_string())
}


pub(super) fn validate_session_title(title: &str) -> Result<String, CommandError> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err(CommandError::new(
            CommandErrorCode::AgentSessionValidationFailed,
            "Session title 不能为空。",
        ).with_reason("titleRequired")
        .with_detail(ErrorDetail::new("Field").with_value("name", "title")));
    }

    Ok(trimmed.to_string())
}

pub(super) fn validate_injected_prompt(prompt: &str) -> Result<String, CommandError> {
    let trimmed = prompt.trim();
    if trimmed.is_empty() {
        return Err(CommandError::new(
            CommandErrorCode::AgentSessionValidationFailed,
            "注入的 prompt 不能为空。",
        ).with_reason("injectedPromptRequired")
        .with_detail(ErrorDetail::new("Field").with_value("name", "prompt")));
    }

    Ok(trimmed.to_string())
}


pub(super) fn validate_working_dir(repo_path: &str) -> Result<String, CommandError> {
    let path = Path::new(repo_path);
    if !path.is_dir() {
        return Err(CommandError::new(
            CommandErrorCode::AgentSessionStartFailed,
            "Project 工作目录不可访问。",
        ).with_reason("projectWorkdirInaccessible")
        .with_detail(ErrorDetail::new("WorkingDir").with_value("path", repo_path)));
    }

    Ok(path.to_string_lossy().to_string())
}
