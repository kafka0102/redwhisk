use std::sync::Mutex;

use crate::core::local_data_service::LocalDataService;

pub struct AppState {
    pub local_data: Mutex<LocalDataService>,
}

impl AppState {
    pub fn new(local_data: LocalDataService) -> Self {
        Self {
            local_data: Mutex::new(local_data),
        }
    }
}
