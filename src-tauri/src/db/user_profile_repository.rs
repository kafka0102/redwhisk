use rusqlite::{params, Connection, OptionalExtension};

use crate::types::user_profile::UserProfileRecord;

pub struct UserProfileRepository<'connection> {
    connection: &'connection Connection,
}

impl<'connection> UserProfileRepository<'connection> {
    pub fn new(connection: &'connection Connection) -> Self {
        Self { connection }
    }

    pub fn get_profile(&self) -> rusqlite::Result<UserProfileRecord> {
        self.connection
            .query_row(
                "SELECT name, avatar_path FROM user_profiles WHERE id = 1",
                [],
                |row| {
                    Ok(UserProfileRecord {
                        name: row.get(0)?,
                        avatar_path: row.get(1)?,
                    })
                },
            )
            .optional()
            .map(|profile| {
                profile.unwrap_or(UserProfileRecord {
                    name: String::new(),
                    avatar_path: None,
                })
            })
    }

    pub fn save_name(&self, name: &str) -> rusqlite::Result<()> {
        self.connection.execute(
            "INSERT INTO user_profiles (id, name) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name",
            params![name],
        )?;
        Ok(())
    }

    pub fn save_avatar_path(&self, avatar_path: &str) -> rusqlite::Result<()> {
        self.connection.execute(
            "INSERT INTO user_profiles (id, avatar_path) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET avatar_path = excluded.avatar_path",
            params![avatar_path],
        )?;
        Ok(())
    }
}
