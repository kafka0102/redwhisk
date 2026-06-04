use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use thiserror::Error;

pub const DATABASE_FILE_NAME: &str = "redwhisk.sqlite3";

#[derive(Debug, Error)]
pub enum DatabaseError {
    #[error("failed to create local data directory at {path}: {source}")]
    CreateDataDir {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("failed to open SQLite database at {path}: {source}")]
    OpenDatabase {
        path: PathBuf,
        source: rusqlite::Error,
    },
    #[error("failed to run database migration: {0}")]
    Migration(#[from] rusqlite::Error),
}

pub struct Database {
    pub path: PathBuf,
    pub connection: Connection,
}

pub struct DatabaseConfig {
    data_dir: PathBuf,
}

impl DatabaseConfig {
    pub fn new(data_dir: impl AsRef<Path>) -> Self {
        Self {
            data_dir: data_dir.as_ref().to_path_buf(),
        }
    }

    pub fn open(&self) -> Result<Database, DatabaseError> {
        fs::create_dir_all(&self.data_dir).map_err(|source| DatabaseError::CreateDataDir {
            path: self.data_dir.clone(),
            source,
        })?;

        let path = self.data_dir.join(DATABASE_FILE_NAME);
        let connection = Connection::open(&path).map_err(|source| DatabaseError::OpenDatabase {
            path: path.clone(),
            source,
        })?;

        Ok(Database { path, connection })
    }
}
