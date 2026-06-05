use tauri::{Manager, State};

use crate::app_state::AppState;
use crate::core::project_service::ProjectService;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::project::{CreateProjectInput, ProjectSummary};

#[tauri::command]
pub fn create_project(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: CreateProjectInput,
) -> Result<ProjectSummary, CommandError> {
    let data_dir = app.path().app_data_dir().map_err(|error| {
        CommandError::new(
            CommandErrorCode::ProjectPersistenceFailed,
            "Project 保存失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    {
        let mut local_data = state.local_data.lock().map_err(|_| {
            CommandError::new(
                CommandErrorCode::ProjectPersistenceFailed,
                "Project 保存失败。",
            )
        })?;
        local_data
            .initialize(&data_dir)
            .map_err(CommandError::from)?;
    }

    ProjectService::create_project_in_data_dir(data_dir, input)
}
