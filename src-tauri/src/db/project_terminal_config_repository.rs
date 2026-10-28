use rusqlite::{params, OptionalExtension};

use super::ProjectRepository;
use crate::types::project_terminal_config::ProjectTerminalConfig;

impl ProjectRepository<'_> {
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
