use rusqlite::{params, Connection, OptionalExtension};

pub struct TuiHookPreferenceRepository<'connection> {
    connection: &'connection Connection,
}

impl<'connection> TuiHookPreferenceRepository<'connection> {
    pub fn new(connection: &'connection Connection) -> Self {
        Self { connection }
    }

    pub fn registration_allowed(&self) -> rusqlite::Result<bool> {
        self.connection
            .query_row(
                "SELECT registration_allowed FROM tui_hook_registration_preference WHERE id = 1",
                [],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map(|value| value.unwrap_or(0) != 0)
    }

    pub fn set_registration_allowed(&self, allowed: bool) -> rusqlite::Result<()> {
        self.connection.execute(
            "INSERT INTO tui_hook_registration_preference (id, registration_allowed)
             VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET registration_allowed = excluded.registration_allowed",
            params![if allowed { 1 } else { 0 }],
        )?;
        Ok(())
    }
}
