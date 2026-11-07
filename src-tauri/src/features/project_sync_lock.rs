use std::collections::HashSet;
use std::sync::Mutex;

use rusqlite::Connection;

static HELD_PROJECTS: Mutex<Option<HashSet<String>>> = Mutex::new(None);

pub(crate) struct ProjectSyncGuard {
    key: String,
}

pub(crate) fn try_acquire_project_sync(
    connection: &Connection,
    project_id: i64,
) -> Option<ProjectSyncGuard> {
    let key = lock_key(connection, project_id);
    let mut held = HELD_PROJECTS.lock().expect("project sync lock");
    let projects = held.get_or_insert_with(HashSet::new);
    if !projects.insert(key.clone()) {
        return None;
    }
    Some(ProjectSyncGuard { key })
}

fn lock_key(connection: &Connection, project_id: i64) -> String {
    let path = connection.path().unwrap_or("");
    let scope = if path.is_empty() || path == ":memory:" {
        format!("memory:{:p}", connection)
    } else {
        path.to_string()
    };
    format!("{scope}#{project_id}")
}

impl Drop for ProjectSyncGuard {
    fn drop(&mut self) {
        if let Ok(mut held) = HELD_PROJECTS.lock() {
            if let Some(projects) = held.as_mut() {
                projects.remove(&self.key);
            }
        }
    }
}
