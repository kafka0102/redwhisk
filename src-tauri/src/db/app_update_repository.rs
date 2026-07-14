use rusqlite::{params, Connection, OptionalExtension};

use crate::types::app_update::AppUpdateStateRecord;

pub struct AppUpdateRepository<'connection> {
    connection: &'connection Connection,
}

impl<'connection> AppUpdateRepository<'connection> {
    pub fn new(connection: &'connection Connection) -> Self {
        Self { connection }
    }

    pub fn get_state(&self) -> rusqlite::Result<AppUpdateStateRecord> {
        self.connection
            .query_row(
                "SELECT snooze_until, ignored_version, last_checked_at,
                        cached_latest_version, cached_release_url
                 FROM app_update_state WHERE id = 1",
                [],
                |row| {
                    Ok(AppUpdateStateRecord {
                        snooze_until: row.get(0)?,
                        ignored_version: row.get(1)?,
                        last_checked_at: row.get(2)?,
                        cached_latest_version: row.get(3)?,
                        cached_release_url: row.get(4)?,
                    })
                },
            )
            .optional()
            .map(|state| state.unwrap_or_default())
    }

    pub fn save_snooze_until(&self, snooze_until: Option<&str>) -> rusqlite::Result<()> {
        self.ensure_row()?;
        self.connection.execute(
            "UPDATE app_update_state SET snooze_until = ?1 WHERE id = 1",
            params![snooze_until],
        )?;
        Ok(())
    }

    pub fn save_ignored_version(&self, ignored_version: Option<&str>) -> rusqlite::Result<()> {
        self.ensure_row()?;
        self.connection.execute(
            "UPDATE app_update_state SET ignored_version = ?1 WHERE id = 1",
            params![ignored_version],
        )?;
        Ok(())
    }

    pub fn save_cache(
        &self,
        last_checked_at: &str,
        latest_version: Option<&str>,
        release_url: Option<&str>,
    ) -> rusqlite::Result<()> {
        self.ensure_row()?;
        self.connection.execute(
            "UPDATE app_update_state
             SET last_checked_at = ?1,
                 cached_latest_version = ?2,
                 cached_release_url = ?3
             WHERE id = 1",
            params![last_checked_at, latest_version, release_url],
        )?;
        Ok(())
    }

    fn ensure_row(&self) -> rusqlite::Result<()> {
        self.connection.execute(
            "INSERT INTO app_update_state (id) VALUES (1)
             ON CONFLICT(id) DO NOTHING",
            [],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::AppUpdateRepository;
    use crate::db::migrations::MigrationRunner;

    fn open_migrated() -> Connection {
        let connection = Connection::open_in_memory().expect("connection");
        MigrationRunner::default()
            .run(&connection)
            .expect("migrations");
        connection
    }

    #[test]
    fn get_state_defaults_when_row_missing() {
        let connection = open_migrated();
        let repository = AppUpdateRepository::new(&connection);
        let state = repository.get_state().expect("get");
        assert!(state.snooze_until.is_none());
        assert!(state.ignored_version.is_none());
        assert!(state.last_checked_at.is_none());
        assert!(state.cached_latest_version.is_none());
        assert!(state.cached_release_url.is_none());
    }

    #[test]
    fn persists_snooze_ignore_and_cache() {
        let connection = open_migrated();
        let repository = AppUpdateRepository::new(&connection);

        repository
            .save_snooze_until(Some("2030-01-01T00:00:00.000Z"))
            .expect("snooze");
        repository
            .save_ignored_version(Some("0.1.0"))
            .expect("ignore");
        repository
            .save_cache(
                "2026-07-14T10:00:00.000Z",
                Some("0.2.0"),
                Some("https://github.com/kafka0102/redwhisk/releases/tag/v0.2.0"),
            )
            .expect("cache");

        let state = repository.get_state().expect("get");
        assert_eq!(
            state.snooze_until.as_deref(),
            Some("2030-01-01T00:00:00.000Z")
        );
        assert_eq!(state.ignored_version.as_deref(), Some("0.1.0"));
        assert_eq!(
            state.last_checked_at.as_deref(),
            Some("2026-07-14T10:00:00.000Z")
        );
        assert_eq!(state.cached_latest_version.as_deref(), Some("0.2.0"));
        assert_eq!(
            state.cached_release_url.as_deref(),
            Some("https://github.com/kafka0102/redwhisk/releases/tag/v0.2.0")
        );

        repository.save_snooze_until(None).expect("clear snooze");
        let cleared = repository.get_state().expect("get cleared");
        assert!(cleared.snooze_until.is_none());
        assert_eq!(cleared.ignored_version.as_deref(), Some("0.1.0"));
    }
}
