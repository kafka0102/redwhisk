use std::path::PathBuf;

use tauri::{Emitter, State};

use crate::agent_skill::index::AgentSkillIndex;
use crate::agent_skill::service::AgentSkillService;
use crate::app_state::AppState;
use crate::core::project_service::ProjectService;
use crate::types::agent_skill::{
    AgentSkillListResponse, AgentSkillScope, AgentSkillsUpdatedEvent, ListAgentSkillsInput,
    RefreshAgentSkillsInput,
};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::project::OpenProjectInput;

pub const AGENT_SKILLS_UPDATED_EVENT: &str = "agent-skills-updated";

#[tauri::command]
pub fn list_agent_skills(
    state: State<'_, AppState>,
    input: ListAgentSkillsInput,
) -> AgentSkillListResponse {
    list_agent_skills_from_index(&state.agent_skills, input)
}

pub fn list_agent_skills_from_index(
    index: &AgentSkillIndex,
    input: ListAgentSkillsInput,
) -> AgentSkillListResponse {
    index.list(input.agent_type, input.project_id)
}

#[tauri::command]
pub fn refresh_agent_skills(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: RefreshAgentSkillsInput,
) -> Result<(), CommandError> {
    match input.project_id {
        Some(project_id) => {
            let data_dir = prepare_agent_skill_data_dir(&app, &state)?;
            let project = ProjectService::open_project_for_window_in_data_dir(
                &data_dir,
                OpenProjectInput { project_id },
                &state.project_terminals,
                &state.pty_sessions,
            )?;
            trigger_project_skill_refresh(
                app,
                state.agent_skills.clone(),
                project.id,
                PathBuf::from(project.repo_path),
            );
        }
        None => {
            trigger_global_skill_refresh(app, state.agent_skills.clone());
        }
    }

    Ok(())
}

pub fn trigger_global_skill_refresh(app: tauri::AppHandle, index: AgentSkillIndex) {
    tauri::async_runtime::spawn(async move {
        let worker_index = index.clone();
        if let Err(error) = tauri::async_runtime::spawn_blocking(move || {
            AgentSkillService::refresh_global_from_home(&worker_index, None);
        })
        .await
        {
            index.mark_global_failed(format!("全局 skill 刷新任务失败: {error}"));
        }

        let _ = app.emit(
            AGENT_SKILLS_UPDATED_EVENT,
            AgentSkillsUpdatedEvent {
                scope: AgentSkillScope::Global,
                project_id: None,
            },
        );
    });
}

pub fn trigger_project_skill_refresh(
    app: tauri::AppHandle,
    index: AgentSkillIndex,
    project_id: i64,
    repo_path: PathBuf,
) {
    tauri::async_runtime::spawn(async move {
        let worker_index = index.clone();
        if let Err(error) = tauri::async_runtime::spawn_blocking(move || {
            AgentSkillService::refresh_project(&worker_index, project_id, &repo_path);
        })
        .await
        {
            index.mark_project_failed(project_id, format!("Project skill 刷新任务失败: {error}"));
        }

        let _ = app.emit(
            AGENT_SKILLS_UPDATED_EVENT,
            AgentSkillsUpdatedEvent {
                scope: AgentSkillScope::Project,
                project_id: Some(project_id),
            },
        );
    });
}

fn prepare_agent_skill_data_dir(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
) -> Result<PathBuf, CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(app).map_err(|error| {
        CommandError::new(
            CommandErrorCode::ProjectPersistenceFailed,
            "Project 读取失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    {
        let mut local_data = state.local_data.lock().map_err(|_| {
            CommandError::new(
                CommandErrorCode::ProjectPersistenceFailed,
                "Project 读取失败。",
            )
        })?;
        local_data
            .initialize(&data_dir)
            .map_err(CommandError::from)?;
    }

    Ok(data_dir)
}

#[cfg(test)]
mod tests {
    use crate::agent_skill::index::AgentSkillIndex;
    use crate::types::agent_profile::AgentType;
    use crate::types::agent_skill::{AgentSkillRecord, AgentSkillScope, ListAgentSkillsInput};

    use super::list_agent_skills_from_index;

    #[test]
    fn agent_skill_command_list_reads_only_cached_index() {
        let index = AgentSkillIndex::default();
        index.replace_global(vec![AgentSkillRecord {
            name: "cached".to_string(),
            path: "/tmp/cached/SKILL.md".to_string(),
            agent_type: AgentType::Codex,
            scope: AgentSkillScope::Global,
            project_id: None,
            source_root: "/tmp/cached".to_string(),
        }]);

        let response = list_agent_skills_from_index(
            &index,
            ListAgentSkillsInput {
                agent_type: Some(AgentType::Codex),
                project_id: None,
            },
        );

        assert_eq!(response.skills.len(), 1);
        assert_eq!(response.skills[0].name, "cached");
    }
}
