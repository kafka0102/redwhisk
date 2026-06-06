use std::sync::Mutex;

use crate::agent::pty_session_manager::PtySessionManager;
use crate::core::local_data_service::LocalDataService;

pub struct AppState {
    pub local_data: Mutex<LocalDataService>,
    pub pty_sessions: PtySessionManager,
}

impl AppState {
    pub fn new(local_data: LocalDataService) -> Self {
        Self {
            local_data: Mutex::new(local_data),
            pty_sessions: PtySessionManager::new(),
        }
    }
}
