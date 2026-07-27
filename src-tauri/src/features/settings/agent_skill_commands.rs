use std::path::PathBuf;

use tauri::{Emitter, State};

use crate::agent_skill::index::AgentSkillIndex;
use crate::agent_skill::reconcile::{
    reconcile_saved_skills_in_data_dir, scanned_skills_for_reconcile,
};
use crate::agent_skill::service::AgentSkillService;
use crate::app_state::AppState;
use crate::features::project::ProjectService;
use crate::types::agent_skill::{
    AgentSkillListResponse, AgentSkillScope, AgentSkillsUpdatedEvent, ListAgentSkillsInput,
    ReconcileSavedAgentSkillsInput, RefreshAgentSkillsInput, RefreshAgentSkillsResult,
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

/// 手动刷新：等待扫描 + 对账完成，返回变更的已添加技能行数。
///
/// - `project_id = Some`：重扫全局 + 指定项目，并对两范围已添加技能对账
/// - `project_id = None`：仅重扫全局并对其已添加技能对账
#[tauri::command]
pub async fn refresh_agent_skills(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: RefreshAgentSkillsInput,
) -> Result<RefreshAgentSkillsResult, CommandError> {
    let data_dir = prepare_agent_skill_data_dir(&app, &state)?;
    let index = state.agent_skills.clone();
    let project = match input.project_id {
        Some(project_id) => {
            let project = ProjectService::open_project_for_window_in_data_dir(
                &data_dir,
                OpenProjectInput { project_id },
            )?;
            Some((project.id, PathBuf::from(project.repo_path)))
        }
        None => None,
    };

    let data_dir_for_worker = data_dir.clone();
    let index_for_worker = index.clone();
    let project_for_worker = project.clone();
    let changed_count = tauri::async_runtime::spawn_blocking(move || {
        refresh_and_reconcile_blocking(
            &index_for_worker,
            &data_dir_for_worker,
            project_for_worker.as_ref().map(|(id, path)| (*id, path.as_path())),
        )
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::SettingsPersistenceFailed,
            "Skill 刷新失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })??;

    let _ = app.emit(
        AGENT_SKILLS_UPDATED_EVENT,
        AgentSkillsUpdatedEvent {
            scope: AgentSkillScope::Global,
            project_id: None,
        },
    );
    if let Some((project_id, _)) = project {
        let _ = app.emit(
            AGENT_SKILLS_UPDATED_EVENT,
            AgentSkillsUpdatedEvent {
                scope: AgentSkillScope::Project,
                project_id: Some(project_id),
            },
        );
    }

    Ok(RefreshAgentSkillsResult { changed_count })
}

/// 静默对账：按当前内存索引重写指定 scope 的已添加技能 skill_paths。
/// 项目 scope 在索引尚无该项目缓存时会先扫描项目再对账。
#[tauri::command]
pub async fn reconcile_saved_agent_skills(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ReconcileSavedAgentSkillsInput,
) -> Result<RefreshAgentSkillsResult, CommandError> {
    let data_dir = prepare_agent_skill_data_dir(&app, &state)?;
    let index = state.agent_skills.clone();

    match input.scope {
        AgentSkillScope::Global => {
            let data_dir_for_worker = data_dir.clone();
            let index_for_worker = index.clone();
            let changed_count = tauri::async_runtime::spawn_blocking(move || {
                if matches!(
                    index_for_worker.global_status(),
                    crate::types::agent_skill::AgentSkillRefreshStatus::Idle
                ) {
                    AgentSkillService::refresh_global_from_home(&index_for_worker, None);
                }
                let scanned = index_for_worker.snapshot_global();
                reconcile_saved_skills_in_data_dir(
                    &data_dir_for_worker,
                    &scanned,
                    &AgentSkillScope::Global,
                    None,
                )
            })
            .await
            .map_err(|error| {
                CommandError::new(
                    CommandErrorCode::SettingsPersistenceFailed,
                    "Skill 对账失败。",
                )
                .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
            })??;
            Ok(RefreshAgentSkillsResult { changed_count })
        }
        AgentSkillScope::Project => {
            let project_id = input.project_id.ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::AgentProfileValidationFailed,
                    "项目级 Skill 对账必须指定 project_id。",
                )
                .with_reason("projectSkillRequiresProjectId")
            })?;
            let project = ProjectService::open_project_for_window_in_data_dir(
                &data_dir,
                OpenProjectInput { project_id },
            )?;
            let repo_path = PathBuf::from(project.repo_path);
            let data_dir_for_worker = data_dir.clone();
            let index_for_worker = index.clone();
            let changed_count = tauri::async_runtime::spawn_blocking(move || {
                if matches!(
                    index_for_worker.project_status(project_id),
                    crate::types::agent_skill::AgentSkillRefreshStatus::Idle
                ) {
                    AgentSkillService::refresh_project(
                        &index_for_worker,
                        project_id,
                        &repo_path,
                    );
                }
                if matches!(
                    index_for_worker.global_status(),
                    crate::types::agent_skill::AgentSkillRefreshStatus::Idle
                ) {
                    AgentSkillService::refresh_global_from_home(&index_for_worker, None);
                }
                let scanned = scanned_skills_for_reconcile(
                    &AgentSkillScope::Project,
                    &index_for_worker.snapshot_global(),
                    &index_for_worker.snapshot_project(project_id),
                );
                reconcile_saved_skills_in_data_dir(
                    &data_dir_for_worker,
                    &scanned,
                    &AgentSkillScope::Project,
                    Some(project_id),
                )
            })
            .await
            .map_err(|error| {
                CommandError::new(
                    CommandErrorCode::SettingsPersistenceFailed,
                    "Skill 对账失败。",
                )
                .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
            })??;
            Ok(RefreshAgentSkillsResult { changed_count })
        }
    }
}

/// 启动静默刷新：扫描全局索引后对账全局已添加技能（不向 UI 发 toast 职责）。
pub fn trigger_global_skill_refresh(app: tauri::AppHandle, index: AgentSkillIndex) {
    tauri::async_runtime::spawn(async move {
        let data_dir = crate::local_data_path::redwhisk_data_dir(&app).ok();
        let worker_index = index.clone();
        let data_dir_for_worker = data_dir.clone();
        if let Err(error) = tauri::async_runtime::spawn_blocking(move || {
            AgentSkillService::refresh_global_from_home(&worker_index, None);
            if let Some(data_dir) = data_dir_for_worker {
                let scanned = worker_index.snapshot_global();
                let _ = reconcile_saved_skills_in_data_dir(
                    &data_dir,
                    &scanned,
                    &AgentSkillScope::Global,
                    None,
                );
            }
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

fn refresh_and_reconcile_blocking(
    index: &AgentSkillIndex,
    data_dir: &std::path::Path,
    project: Option<(i64, &std::path::Path)>,
) -> Result<u32, CommandError> {
    AgentSkillService::refresh_global_from_home(index, None);
    let mut changed_count = reconcile_saved_skills_in_data_dir(
        data_dir,
        &index.snapshot_global(),
        &AgentSkillScope::Global,
        None,
    )?;

    if let Some((project_id, repo_path)) = project {
        AgentSkillService::refresh_project(index, project_id, repo_path);
        let project_scanned = scanned_skills_for_reconcile(
            &AgentSkillScope::Project,
            &index.snapshot_global(),
            &index.snapshot_project(project_id),
        );
        changed_count += reconcile_saved_skills_in_data_dir(
            data_dir,
            &project_scanned,
            &AgentSkillScope::Project,
            Some(project_id),
        )?;
    }

    Ok(changed_count)
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
        .with_reason("loadFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    {
        let mut local_data = state.local_data.lock().map_err(|_| {
            CommandError::new(
                CommandErrorCode::ProjectPersistenceFailed,
                "Project 读取失败。",
            )
            .with_reason("loadFailed")
        })?;
        local_data
            .initialize(&data_dir)
            .map_err(CommandError::from)?;
    }

    Ok(data_dir)
}

#[cfg(test)]
#[path = "agent_skill_commands_tests.rs"]
mod tests;
