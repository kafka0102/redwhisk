use std::fs;
use std::path::{Path, PathBuf};

use crate::db::connection::DatabaseConfig;
use crate::db::migrations::MigrationRunner;
use crate::features::agent_session::IssueSessionArchive;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};

pub(super) fn rollback_issue_archive(archive: Option<&IssueSessionArchive>) {
    let Some(archive) = archive else {
        return;
    };
    remove_issue_log_file(&archive.archive_path);
}

pub(super) fn cleanup_runtime_issue_log(archive: Option<&IssueSessionArchive>) {
    let Some(archive) = archive else {
        return;
    };
    if archive.runtime_path != archive.archive_path {
        remove_issue_log_file(&archive.runtime_path);
    }
}

fn remove_issue_log_file(path: &str) {
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => {}
    }
}

pub(super) fn infer_data_dir_from_connection(connection: &rusqlite::Connection) -> PathBuf {
    connection
        .path()
        .filter(|path| !path.is_empty())
        .and_then(|path| Path::new(path).parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from(".redwhisk"))
}

pub(super) fn open_issue_database(
    data_dir: impl AsRef<Path>,
) -> Result<crate::db::connection::Database, CommandError> {
    let database = DatabaseConfig::new(data_dir)
        .open()
        .map_err(CommandError::from)?;
    MigrationRunner::default()
        .run(&database.connection)
        .map_err(|error| {
            CommandError::new(CommandErrorCode::IssuePersistenceFailed, "Issue 保存失败。")
                .with_reason("saveFailed")
                .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?;

    Ok(database)
}
