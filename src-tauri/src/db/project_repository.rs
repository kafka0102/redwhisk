use rusqlite::{params, Connection, OptionalExtension};

use crate::types::project::{ProjectCompletionPolicy, ProjectSummary};

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
                "SELECT id, name, repo_path, completion_policy, created_at, last_opened_at FROM projects WHERE repo_path = ?1",
                params![repo_path],
                project_from_row,
            )
            .optional()
    }

    pub fn find_by_id(&self, id: i64) -> rusqlite::Result<Option<ProjectSummary>> {
        self.connection
            .query_row(
                "SELECT id, name, repo_path, completion_policy, created_at, last_opened_at FROM projects WHERE id = ?1",
                params![id],
                project_from_row,
            )
            .optional()
    }

    pub fn list_recent(&self) -> rusqlite::Result<Vec<ProjectSummary>> {
        let mut statement = self.connection.prepare(
            "SELECT id, name, repo_path, completion_policy, created_at, last_opened_at
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
        name: &str,
        repo_path: &str,
        completion_policy: ProjectCompletionPolicy,
    ) -> rusqlite::Result<ProjectSummary> {
        self.connection.execute(
            "INSERT INTO projects (name, repo_path, created_at, last_opened_at, completion_policy)
             VALUES (?1, ?2, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER), CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER), ?3)",
            params![
                name,
                repo_path,
                project_completion_policy_to_str(&completion_policy),
            ],
        )?;

        self.find_by_repo_path(repo_path)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn insert_or_get_existing(
        &self,
        name: &str,
        repo_path: &str,
        completion_policy: ProjectCompletionPolicy,
    ) -> rusqlite::Result<ProjectSummary> {
        self.connection.execute(
            "INSERT OR IGNORE INTO projects (name, repo_path, created_at, last_opened_at, completion_policy)
             VALUES (?1, ?2, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER), CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER), ?3)",
            params![
                name,
                repo_path,
                project_completion_policy_to_str(&completion_policy),
            ],
        )?;

        self.find_by_repo_path(repo_path)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn insert_or_get_existing_for_path(
        &self,
        name: &str,
        repo_path: &std::path::Path,
        completion_policy: ProjectCompletionPolicy,
    ) -> rusqlite::Result<ProjectSummary> {
        let repo_path = repo_path.to_string_lossy().to_string();

        if let Some(project) = self.find_by_repo_path(&repo_path)? {
            return Ok(project);
        }

        self.insert_or_get_existing(name, &repo_path, completion_policy)
    }

    pub fn update_last_opened_at(&self, id: i64) -> rusqlite::Result<ProjectSummary> {
        self.connection.execute(
            "UPDATE projects
             SET last_opened_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
             WHERE id = ?1",
            params![id],
        )?;

        self.find_by_id(id)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn update_completion_policy(
        &self,
        id: i64,
        completion_policy: ProjectCompletionPolicy,
    ) -> rusqlite::Result<ProjectSummary> {
        self.connection.execute(
            "UPDATE projects
             SET completion_policy = ?1
             WHERE id = ?2",
            params![project_completion_policy_to_str(&completion_policy), id],
        )?;

        self.find_by_id(id)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn update_settings(
        &self,
        id: i64,
        name: &str,
        repo_path: &str,
        completion_policy: ProjectCompletionPolicy,
    ) -> rusqlite::Result<ProjectSummary> {
        self.connection.execute(
            "UPDATE projects
             SET name = ?1,
                 repo_path = ?2,
                 completion_policy = ?3
             WHERE id = ?4",
            params![
                name,
                repo_path,
                project_completion_policy_to_str(&completion_policy),
                id
            ],
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
        completion_policy: project_completion_policy_from_str(&row.get::<_, String>(3)?)?,
        created_at: row.get(4)?,
        last_opened_at: row.get(5)?,
    })
}

fn project_completion_policy_from_str(value: &str) -> rusqlite::Result<ProjectCompletionPolicy> {
    match value {
        "manual" => Ok(ProjectCompletionPolicy::Manual),
        "agent_auto_commit" => Ok(ProjectCompletionPolicy::AgentAutoCommit),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn project_completion_policy_to_str(value: &ProjectCompletionPolicy) -> &'static str {
    match value {
        ProjectCompletionPolicy::Manual => "manual",
        ProjectCompletionPolicy::AgentAutoCommit => "agent_auto_commit",
    }
}
