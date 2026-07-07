use rusqlite::{params, Connection, OptionalExtension};

pub struct ProjectTerminalShortcutCommandRepository<'connection> {
    connection: &'connection Connection,
}

impl<'connection> ProjectTerminalShortcutCommandRepository<'connection> {
    pub fn new(connection: &'connection Connection) -> Self {
        Self { connection }
    }

    pub fn list_commands(
        &self,
        project_id: i64,
    ) -> rusqlite::Result<Vec<ProjectTerminalShortcutCommandRow>> {
        let mut statement = self.connection.prepare(
            "SELECT id, project_id, command, sort_order
             FROM project_terminal_shortcut_commands
             WHERE project_id = ?1
             ORDER BY sort_order ASC, id ASC",
        )?;
        let rows = statement
            .query_map(params![project_id], shortcut_command_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn count_commands(&self, project_id: i64) -> rusqlite::Result<i64> {
        self.connection.query_row(
            "SELECT COUNT(*) FROM project_terminal_shortcut_commands
                 WHERE project_id = ?1",
            params![project_id],
            |row| row.get(0),
        )
    }

    pub fn find_command_by_id(
        &self,
        id: i64,
    ) -> rusqlite::Result<Option<ProjectTerminalShortcutCommandRow>> {
        self.connection
            .query_row(
                "SELECT id, project_id, command, sort_order
                 FROM project_terminal_shortcut_commands
                 WHERE id = ?1",
                params![id],
                shortcut_command_from_row,
            )
            .optional()
    }

    pub fn insert_command(
        &self,
        project_id: i64,
        command: &str,
        sort_order: i64,
    ) -> rusqlite::Result<ProjectTerminalShortcutCommandRow> {
        self.connection.execute(
            "INSERT INTO project_terminal_shortcut_commands (
                project_id,
                command,
                sort_order,
                created_at,
                updated_at
             ) VALUES (?1, ?2, ?3, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000)",
            params![project_id, command, sort_order],
        )?;
        self.find_command_by_id(self.connection.last_insert_rowid())?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn update_command(
        &self,
        id: i64,
        command: &str,
        sort_order: i64,
    ) -> rusqlite::Result<ProjectTerminalShortcutCommandRow> {
        self.connection.execute(
            "UPDATE project_terminal_shortcut_commands
             SET command = ?1,
                 sort_order = ?2,
                 updated_at = strftime('%s', 'now') * 1000
             WHERE id = ?3",
            params![command, sort_order, id],
        )?;
        self.find_command_by_id(id)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn delete_command(&self, id: i64) -> rusqlite::Result<bool> {
        let affected = self.connection.execute(
            "DELETE FROM project_terminal_shortcut_commands WHERE id = ?1",
            params![id],
        )?;
        Ok(affected > 0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectTerminalShortcutCommandRow {
    pub id: i64,
    pub project_id: i64,
    pub command: String,
    pub sort_order: i64,
}

fn shortcut_command_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<ProjectTerminalShortcutCommandRow> {
    Ok(ProjectTerminalShortcutCommandRow {
        id: row.get(0)?,
        project_id: row.get(1)?,
        command: row.get(2)?,
        sort_order: row.get(3)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connection::DatabaseConfig;
    use crate::db::migrations::MigrationRunner;
    use crate::db::project_repository::ProjectRepository;
    use tempfile::TempDir;

    struct TestHarness {
        _temp_dir: TempDir,
        connection: Connection,
    }

    fn open_test_harness() -> TestHarness {
        let temp_dir = TempDir::new().expect("create temp dir");
        let database = DatabaseConfig::new(temp_dir.path())
            .open()
            .expect("open database");
        MigrationRunner::default()
            .run(&database.connection)
            .expect("run migrations");
        TestHarness {
            _temp_dir: temp_dir,
            connection: database.connection,
        }
    }

    fn insert_project(connection: &Connection) -> i64 {
        ProjectRepository::new(connection)
            .insert("test", "/tmp/test")
            .expect("insert project")
            .id
    }

    #[test]
    fn list_commands_returns_empty_for_unknown_project() {
        let harness = open_test_harness();
        let repository = ProjectTerminalShortcutCommandRepository::new(&harness.connection);

        let commands = repository.list_commands(999).expect("list commands");
        assert!(commands.is_empty());
    }

    #[test]
    fn insert_and_list_commands_preserves_order() {
        let harness = open_test_harness();
        let project_id = insert_project(&harness.connection);
        let repository = ProjectTerminalShortcutCommandRepository::new(&harness.connection);

        let first = repository
            .insert_command(project_id, "git status", 0)
            .expect("insert first");
        let second = repository
            .insert_command(project_id, "git diff", 1)
            .expect("insert second");

        let commands = repository.list_commands(project_id).expect("list commands");
        assert_eq!(commands.len(), 2);
        assert_eq!(commands[0], first);
        assert_eq!(commands[1], second);
    }

    #[test]
    fn count_commands_tracks_insertions_and_deletions() {
        let harness = open_test_harness();
        let project_id = insert_project(&harness.connection);
        let repository = ProjectTerminalShortcutCommandRepository::new(&harness.connection);

        assert_eq!(repository.count_commands(project_id).unwrap(), 0);
        let inserted = repository
            .insert_command(project_id, "ls -la", 0)
            .expect("insert");
        assert_eq!(repository.count_commands(project_id).unwrap(), 1);

        assert!(repository.delete_command(inserted.id).unwrap());
        assert_eq!(repository.count_commands(project_id).unwrap(), 0);
    }

    #[test]
    fn update_command_changes_command_text_and_sort_order() {
        let harness = open_test_harness();
        let project_id = insert_project(&harness.connection);
        let repository = ProjectTerminalShortcutCommandRepository::new(&harness.connection);

        let inserted = repository
            .insert_command(project_id, "git status", 0)
            .expect("insert");
        let updated = repository
            .update_command(inserted.id, "git diff --staged", 5)
            .expect("update");

        assert_eq!(updated.id, inserted.id);
        assert_eq!(updated.command, "git diff --staged");
        assert_eq!(updated.sort_order, 5);

        let reloaded = repository.find_command_by_id(inserted.id).unwrap().unwrap();
        assert_eq!(reloaded, updated);
    }

    #[test]
    fn delete_command_returns_false_for_missing_id() {
        let harness = open_test_harness();
        let repository = ProjectTerminalShortcutCommandRepository::new(&harness.connection);

        assert!(!repository.delete_command(999).unwrap());
    }

    #[test]
    fn list_commands_orders_by_sort_order_then_id() {
        let harness = open_test_harness();
        let project_id = insert_project(&harness.connection);
        let repository = ProjectTerminalShortcutCommandRepository::new(&harness.connection);

        // 故意乱序插入，验证 list 按 sort_order 排序。
        let high = repository
            .insert_command(project_id, "git push", 10)
            .expect("insert high");
        let low = repository
            .insert_command(project_id, "git pull", 1)
            .expect("insert low");

        let commands = repository.list_commands(project_id).expect("list");
        assert_eq!(commands.len(), 2);
        assert_eq!(commands[0], low);
        assert_eq!(commands[1], high);
    }
}
