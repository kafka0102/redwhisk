use rusqlite::{params, Connection, OptionalExtension};

use crate::types::project::{ProjectSummary, ProjectWorktreeLocation};
use crate::types::project_terminal_config::ProjectTerminalConfig;

pub struct ProjectRepository<'connection> {
    connection: &'connection Connection,
}

impl<'connection> ProjectRepository<'connection> {
    pub fn new(connection: &'connection Connection) -> Self {
        Self { connection }
    }

    pub fn connection(&self) -> &'connection Connection {
        self.connection
    }

    pub fn find_by_repo_path(&self, repo_path: &str) -> rusqlite::Result<Option<ProjectSummary>> {
        self.connection
            .query_row(
                "SELECT id, name, repo_path, worktree_location, worktree_setup_command, created_at, last_opened_at, removed_at
                 FROM projects
                 WHERE repo_path = ?1
                   AND removed_at IS NULL",
                params![repo_path],
                project_from_row,
            )
            .optional()
    }

    pub fn find_by_repo_path_including_removed(
        &self,
        repo_path: &str,
    ) -> rusqlite::Result<Option<ProjectSummary>> {
        self.connection
            .query_row(
                "SELECT id, name, repo_path, worktree_location, worktree_setup_command, created_at, last_opened_at, removed_at
                 FROM projects
                 WHERE repo_path = ?1",
                params![repo_path],
                project_from_row,
            )
            .optional()
    }

    pub fn find_by_id(&self, id: i64) -> rusqlite::Result<Option<ProjectSummary>> {
        self.connection
            .query_row(
                "SELECT id, name, repo_path, worktree_location, worktree_setup_command, created_at, last_opened_at, removed_at
                 FROM projects
                 WHERE id = ?1
                   AND removed_at IS NULL",
                params![id],
                project_from_row,
            )
            .optional()
    }

    pub fn list_recent(&self) -> rusqlite::Result<Vec<ProjectSummary>> {
        let mut statement = self.connection.prepare(
            "SELECT id, name, repo_path, worktree_location, worktree_setup_command, created_at, last_opened_at, removed_at
             FROM projects
             WHERE removed_at IS NULL
             ORDER BY last_opened_at DESC, created_at DESC, name ASC",
        )?;

        let projects = statement
            .query_map([], project_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        Ok(projects)
    }

    pub fn delete_project(&self, id: i64) -> rusqlite::Result<()> {
        let tx = self.connection.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM project_labels WHERE project_id = ?1",
            params![id],
        )?;
        tx.execute(
            "DELETE FROM saved_agent_skills WHERE project_id = ?1",
            params![id],
        )?;
        let deleted = tx.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
        if deleted == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        tx.commit()?;
        Ok(())
    }

    pub fn mark_removed(&self, id: i64) -> rusqlite::Result<ProjectSummary> {
        let updated = self.connection.execute(
            "UPDATE projects
             SET removed_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
             WHERE id = ?1
               AND removed_at IS NULL",
            params![id],
        )?;
        if updated == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        // 刚标记移除后 find_by_id 会过滤；用 including id 查询。
        self.find_by_id_including_removed(id)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn find_by_id_including_removed(
        &self,
        id: i64,
    ) -> rusqlite::Result<Option<ProjectSummary>> {
        self.connection
            .query_row(
                "SELECT id, name, repo_path, worktree_location, worktree_setup_command, created_at, last_opened_at, removed_at
                 FROM projects
                 WHERE id = ?1",
                params![id],
                project_from_row,
            )
            .optional()
    }

    pub fn restore_removed_with_settings(
        &self,
        id: i64,
        name: &str,
        repo_path: &str,
        worktree_location: ProjectWorktreeLocation,
        worktree_setup_command: &str,
    ) -> rusqlite::Result<ProjectSummary> {
        let updated = self.connection.execute(
            "UPDATE projects
             SET name = ?1,
                 repo_path = ?2,
                 worktree_location = ?3,
                 worktree_setup_command = ?4,
                 removed_at = NULL,
                 last_opened_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
             WHERE id = ?5",
            params![
                name,
                repo_path,
                project_worktree_location_to_str(&worktree_location),
                worktree_setup_command,
                id
            ],
        )?;
        if updated == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        self.find_by_id(id)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn insert(&self, name: &str, repo_path: &str) -> rusqlite::Result<ProjectSummary> {
        self.connection.execute(
            "INSERT INTO projects (name, repo_path, created_at, last_opened_at, worktree_location, worktree_setup_command)
             VALUES (?1, ?2, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER), CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER), 'repo_sibling', '')",
            params![name, repo_path],
        )?;

        self.find_by_repo_path(repo_path)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn insert_or_get_existing(
        &self,
        name: &str,
        repo_path: &str,
    ) -> rusqlite::Result<ProjectSummary> {
        self.insert_or_get_existing_with_settings(
            name,
            repo_path,
            ProjectWorktreeLocation::RepoSibling,
            "",
        )
    }

    pub fn insert_or_get_existing_with_settings(
        &self,
        name: &str,
        repo_path: &str,
        worktree_location: ProjectWorktreeLocation,
        worktree_setup_command: &str,
    ) -> rusqlite::Result<ProjectSummary> {
        self.connection.execute(
            "INSERT OR IGNORE INTO projects (name, repo_path, created_at, last_opened_at, worktree_location, worktree_setup_command)
             VALUES (?1, ?2, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER), CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER), ?3, ?4)",
            params![
                name,
                repo_path,
                project_worktree_location_to_str(&worktree_location),
                worktree_setup_command,
            ],
        )?;

        self.find_by_repo_path(repo_path)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn insert_or_get_existing_for_path(
        &self,
        name: &str,
        repo_path: &std::path::Path,
        worktree_location: ProjectWorktreeLocation,
        worktree_setup_command: &str,
    ) -> rusqlite::Result<ProjectSummary> {
        let repo_path = repo_path.to_string_lossy().to_string();

        if let Some(project) = self.find_by_repo_path(&repo_path)? {
            return Ok(project);
        }

        self.insert_or_get_existing_with_settings(
            name,
            &repo_path,
            worktree_location,
            worktree_setup_command,
        )
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

    pub fn update_settings(
        &self,
        id: i64,
        name: &str,
        repo_path: &str,
        worktree_location: ProjectWorktreeLocation,
        worktree_setup_command: &str,
    ) -> rusqlite::Result<ProjectSummary> {
        self.connection.execute(
            "UPDATE projects
             SET name = ?1,
                 repo_path = ?2,
                 worktree_location = ?3,
                 worktree_setup_command = ?4,
                 removed_at = NULL
             WHERE id = ?5",
            params![
                name,
                repo_path,
                project_worktree_location_to_str(&worktree_location),
                worktree_setup_command,
                id
            ],
        )?;

        self.find_by_id(id)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn list_project_terminal_configs(
        &self,
        project_id: i64,
    ) -> rusqlite::Result<Vec<ProjectTerminalConfig>> {
        let mut statement = self.connection.prepare(
            "SELECT id, project_id, name, working_dir, launch_command, created_at, updated_at
             FROM project_terminal_configs
             WHERE project_id = ?1
             ORDER BY created_at ASC, id ASC",
        )?;

        let configs = statement
            .query_map(params![project_id], project_terminal_config_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        Ok(configs)
    }

    pub fn insert_project_terminal_config(
        &self,
        project_id: i64,
        name: &str,
        working_dir: &str,
        launch_command: &str,
    ) -> rusqlite::Result<ProjectTerminalConfig> {
        self.connection.execute(
            "INSERT INTO project_terminal_configs (
                project_id,
                name,
                working_dir,
                launch_command,
                created_at,
                updated_at
             ) VALUES (
                ?1,
                ?2,
                ?3,
                ?4,
                CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER),
                CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
             )",
            params![project_id, name, working_dir, launch_command],
        )?;

        self.find_project_terminal_config_by_id(project_id, self.connection.last_insert_rowid())?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn update_project_terminal_config(
        &self,
        project_id: i64,
        id: i64,
        name: &str,
        working_dir: &str,
        launch_command: &str,
    ) -> rusqlite::Result<ProjectTerminalConfig> {
        let updated_rows = self.connection.execute(
            "UPDATE project_terminal_configs
             SET name = ?1,
                 working_dir = ?2,
                 launch_command = ?3,
                 updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
             WHERE project_id = ?4
               AND id = ?5",
            params![name, working_dir, launch_command, project_id, id],
        )?;

        if updated_rows == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }

        self.find_project_terminal_config_by_id(project_id, id)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn delete_project_terminal_config(&self, project_id: i64, id: i64) -> rusqlite::Result<()> {
        let deleted_rows = self.connection.execute(
            "DELETE FROM project_terminal_configs
             WHERE project_id = ?1
               AND id = ?2",
            params![project_id, id],
        )?;

        if deleted_rows == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }

        Ok(())
    }

    fn find_project_terminal_config_by_id(
        &self,
        project_id: i64,
        id: i64,
    ) -> rusqlite::Result<Option<ProjectTerminalConfig>> {
        self.connection
            .query_row(
                "SELECT id, project_id, name, working_dir, launch_command, created_at, updated_at
                 FROM project_terminal_configs
                 WHERE project_id = ?1
                   AND id = ?2",
                params![project_id, id],
                project_terminal_config_from_row,
            )
            .optional()
    }
}

fn project_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectSummary> {
    Ok(ProjectSummary {
        id: row.get(0)?,
        name: row.get(1)?,
        repo_path: row.get(2)?,
        worktree_location: project_worktree_location_from_str(&row.get::<_, String>(3)?)?,
        worktree_setup_command: row.get(4)?,
        created_at: row.get(5)?,
        last_opened_at: row.get(6)?,
        removed_at: row.get(7)?,
        code_workspaces: Vec::new(),
    })
}

fn project_terminal_config_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<ProjectTerminalConfig> {
    Ok(ProjectTerminalConfig {
        id: row.get(0)?,
        project_id: row.get(1)?,
        name: row.get(2)?,
        working_dir: row.get(3)?,
        launch_command: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

pub fn project_worktree_location_from_str(
    value: &str,
) -> rusqlite::Result<ProjectWorktreeLocation> {
    match value {
        "repo_sibling" => Ok(ProjectWorktreeLocation::RepoSibling),
        "repo_internal" => Ok(ProjectWorktreeLocation::RepoInternal),
        "user_home" => Ok(ProjectWorktreeLocation::UserHome),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

pub fn project_worktree_location_to_str(value: &ProjectWorktreeLocation) -> &'static str {
    match value {
        ProjectWorktreeLocation::RepoSibling => "repo_sibling",
        ProjectWorktreeLocation::RepoInternal => "repo_internal",
        ProjectWorktreeLocation::UserHome => "user_home",
    }
}
