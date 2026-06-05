pub mod app_state;
pub mod commands;
pub mod core;
pub mod db;
pub mod git;
pub mod types;

use app_state::AppState;
use core::local_data_service::LocalDataService;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new(LocalDataService::new()))
        .invoke_handler(tauri::generate_handler![
            commands::core_commands::initialize_local_data,
            commands::project_commands::create_project
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
