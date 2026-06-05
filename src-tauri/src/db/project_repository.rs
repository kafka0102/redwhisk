use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};

use crate::types::project::ProjectSummary;

const GENERATED_ID_ATTEMPTS: usize = 3;

pub struct ProjectRepository<'connection> {
    connection: &'connection Connection,
}

impl<'connection> ProjectRepository<'connection> {
    pub fn new(connection: &'connection Connection) -> Self {
        Self { connection }
    }

    pub fn find_by_repo_path(&self, repo_path: &str) -> rusqlite::Result<Option<ProjectSummary>> {
        self.connection
            .query_row(
                "SELECT id, name, repo_path, created_at, last_opened_at FROM projects WHERE repo_path = ?1",
                params![repo_path],
                project_from_row,
            )
            .optional()
    }

    pub fn find_by_id(&self, id: &str) -> rusqlite::Result<Option<ProjectSummary>> {
        self.connection
            .query_row(
                "SELECT id, name, repo_path, created_at, last_opened_at FROM projects WHERE id = ?1",
                params![id],
                project_from_row,
            )
            .optional()
    }

    pub fn list_recent(&self) -> rusqlite::Result<Vec<ProjectSummary>> {
        let mut statement = self.connection.prepare(
            "SELECT id, name, repo_path, created_at, last_opened_at
             FROM projects
             ORDER BY last_opened_at DESC, created_at DESC, name ASC",
        )?;

        let projects = statement
            .query_map([], project_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        Ok(projects)
    }

    pub fn insert(
        &self,
        id: &str,
        name: &str,
        repo_path: &str,
    ) -> rusqlite::Result<ProjectSummary> {
        self.connection.execute(
            "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
             VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
            params![id, name, repo_path],
        )?;

        self.find_by_repo_path(repo_path)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn insert_or_get_existing(
        &self,
        id: &str,
        name: &str,
        repo_path: &str,
    ) -> rusqlite::Result<ProjectSummary> {
        self.connection.execute(
            "INSERT OR IGNORE INTO projects (id, name, repo_path, created_at, last_opened_at)
             VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
            params![id, name, repo_path],
        )?;

        self.find_by_repo_path(repo_path)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn insert_or_get_existing_generated_id(
        &self,
        name: &str,
        repo_path: &Path,
    ) -> rusqlite::Result<ProjectSummary> {
        let repo_path = repo_path.to_string_lossy().to_string();

        if let Some(project) = self.find_by_repo_path(&repo_path)? {
            return Ok(project);
        }

        for _ in 0..GENERATED_ID_ATTEMPTS {
            let id: String = self.connection.query_row(
                "SELECT 'project-' || lower(hex(randomblob(16)))",
                [],
                |row| row.get(0),
            )?;
            self.insert_or_get_existing(&id, name, &repo_path)?;

            if let Some(project) = self.find_by_repo_path(&repo_path)? {
                return Ok(project);
            }
        }

        Err(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn update_last_opened_at(&self, id: &str) -> rusqlite::Result<ProjectSummary> {
        self.connection.execute(
            "UPDATE projects
             SET last_opened_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1",
            params![id],
        )?;

        self.find_by_id(id)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }
}

fn project_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectSummary> {
    Ok(ProjectSummary {
        id: row.get(0)?,
        name: row.get(1)?,
        repo_path: row.get(2)?,
        created_at: row.get(3)?,
        last_opened_at: row.get(4)?,
    })
}
