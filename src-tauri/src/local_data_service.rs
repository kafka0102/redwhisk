use crate::db::connection::{DatabaseConfig, DatabaseError};
use crate::db::migrations::MigrationRunner;
use crate::types::local_data::LocalDataStatus;

pub struct LocalDataService {
    migration_runner: MigrationRunner,
}

impl LocalDataService {
    pub fn new() -> Self {
        Self {
            migration_runner: MigrationRunner::default(),
        }
    }

    pub fn initialize(
        &mut self,
        data_dir: impl AsRef<std::path::Path>,
    ) -> Result<LocalDataStatus, DatabaseError> {
        let database = DatabaseConfig::new(data_dir).open()?;
        let migration_status = self.migration_runner.run(&database.connection)?;

        Ok(LocalDataStatus {
            database_exists: database.path.exists(),
            current_version: migration_status.current_version,
            applied_versions: migration_status.applied_versions,
        })
    }
}

impl Default for LocalDataService {
    fn default() -> Self {
        Self::new()
    }
}
