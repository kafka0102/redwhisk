use std::time::Duration;

use rusqlite::{params, Connection};
use serde::Serialize;

const CORE_MIGRATION_VERSION: &str = "0001_core";
const CORE_MIGRATION_SQL: &str = include_str!("../../migrations/0001_core.sql");
const PROJECTS_MIGRATION_VERSION: &str = "0002_projects";
const PROJECTS_MIGRATION_SQL: &str = include_str!("../../migrations/0002_projects.sql");
const PROJECT_INTEGER_IDS_MIGRATION_VERSION: &str = "0003_project_integer_ids";
const PROJECT_INTEGER_IDS_MIGRATION_SQL: &str =
    include_str!("../../migrations/0003_project_integer_ids.sql");
const ISSUES_MIGRATION_VERSION: &str = "0004_issues";
const ISSUES_MIGRATION_SQL: &str = include_str!("../../migrations/0004_issues.sql");
const ISSUE_ACTIONS_MIGRATION_VERSION: &str = "0005_issue_actions";
const ISSUE_ACTIONS_MIGRATION_SQL: &str = include_str!("../../migrations/0005_issue_actions.sql");
const AGENT_PROFILES_AND_PROJECT_OVERRIDES_MIGRATION_VERSION: &str =
    "0006_agent_profiles_and_project_overrides";
const AGENT_PROFILES_AND_PROJECT_OVERRIDES_MIGRATION_SQL: &str =
    include_str!("../../migrations/0006_agent_profiles_and_project_overrides.sql");
const RESTRUCTURE_AGENT_PROFILES_MIGRATION_VERSION: &str = "0007_restructure_agent_profiles";
const RESTRUCTURE_AGENT_PROFILES_MIGRATION_SQL: &str =
    include_str!("../../migrations/0007_restructure_agent_profiles.sql");
const AGENT_SESSIONS_AND_SESSION_EVENTS_MIGRATION_VERSION: &str =
    "0008_agent_sessions_and_session_events";
const AGENT_SESSIONS_AND_SESSION_EVENTS_MIGRATION_SQL: &str =
    include_str!("../../migrations/0008_agent_sessions_and_session_events.sql");
const AGENT_SESSIONS_PROJECT_ID_MIGRATION_VERSION: &str = "0009_agent_sessions_project_id";
const AGENT_SESSIONS_PROJECT_ID_MIGRATION_SQL: &str =
    include_str!("../../migrations/0009_agent_sessions_project_id.sql");
const PROJECT_COMPLETION_POLICY_MIGRATION_VERSION: &str = "0010_project_completion_policy";
const PROJECT_COMPLETION_POLICY_MIGRATION_SQL: &str =
    include_str!("../../migrations/0010_project_completion_policy.sql");
const COMPLETION_ATTEMPTS_MIGRATION_VERSION: &str = "0011_completion_attempts";
const COMPLETION_ATTEMPTS_MIGRATION_SQL: &str =
    include_str!("../../migrations/0011_completion_attempts.sql");
const SCHEMA_MIGRATIONS_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL
);
"#;

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationStatus {
    pub current_version: Option<String>,
    pub applied_versions: Vec<String>,
}

#[derive(Default)]
pub struct MigrationRunner {
    migrations: Vec<Migration>,
}

impl MigrationRunner {
    pub fn from_static_migrations(migrations: Vec<(&'static str, &'static str)>) -> Self {
        Self {
            migrations: migrations
                .into_iter()
                .map(|(version, sql)| Migration { version, sql })
                .collect(),
        }
    }

    pub fn run(&self, connection: &Connection) -> rusqlite::Result<MigrationStatus> {
        let migrations = self.migrations();
        let mut applied_versions = Vec::new();

        connection.busy_timeout(Duration::from_secs(5))?;
        ensure_migration_table(connection)?;
        connection.execute_batch("BEGIN IMMEDIATE")?;

        let result = (|| {
            for migration in migrations {
                if !has_migration(connection, migration.version)? {
                    connection.execute_batch(migration.sql)?;
                    connection.execute(
                        "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                        params![migration.version],
                    )?;
                    applied_versions.push(migration.version.to_string());
                }
            }

            current_version(connection)
        })();

        match result {
            Ok(current_version) => {
                connection.execute_batch("COMMIT")?;
                Ok(MigrationStatus {
                    current_version,
                    applied_versions,
                })
            }
            Err(error) => {
                let _ = connection.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    fn migrations(&self) -> Vec<Migration> {
        if self.migrations.is_empty() {
            return vec![
                Migration {
                    version: CORE_MIGRATION_VERSION,
                    sql: CORE_MIGRATION_SQL,
                },
                Migration {
                    version: PROJECTS_MIGRATION_VERSION,
                    sql: PROJECTS_MIGRATION_SQL,
                },
                Migration {
                    version: PROJECT_INTEGER_IDS_MIGRATION_VERSION,
                    sql: PROJECT_INTEGER_IDS_MIGRATION_SQL,
                },
                Migration {
                    version: ISSUES_MIGRATION_VERSION,
                    sql: ISSUES_MIGRATION_SQL,
                },
                Migration {
                    version: ISSUE_ACTIONS_MIGRATION_VERSION,
                    sql: ISSUE_ACTIONS_MIGRATION_SQL,
                },
                Migration {
                    version: AGENT_PROFILES_AND_PROJECT_OVERRIDES_MIGRATION_VERSION,
                    sql: AGENT_PROFILES_AND_PROJECT_OVERRIDES_MIGRATION_SQL,
                },
                Migration {
                    version: RESTRUCTURE_AGENT_PROFILES_MIGRATION_VERSION,
                    sql: RESTRUCTURE_AGENT_PROFILES_MIGRATION_SQL,
                },
                Migration {
                    version: AGENT_SESSIONS_AND_SESSION_EVENTS_MIGRATION_VERSION,
                    sql: AGENT_SESSIONS_AND_SESSION_EVENTS_MIGRATION_SQL,
                },
                Migration {
                    version: AGENT_SESSIONS_PROJECT_ID_MIGRATION_VERSION,
                    sql: AGENT_SESSIONS_PROJECT_ID_MIGRATION_SQL,
                },
                Migration {
                    version: PROJECT_COMPLETION_POLICY_MIGRATION_VERSION,
                    sql: PROJECT_COMPLETION_POLICY_MIGRATION_SQL,
                },
                Migration {
                    version: COMPLETION_ATTEMPTS_MIGRATION_VERSION,
                    sql: COMPLETION_ATTEMPTS_MIGRATION_SQL,
                },
            ];
        }

        self.migrations.clone()
    }
}

#[derive(Clone)]
struct Migration {
    version: &'static str,
    sql: &'static str,
}

fn has_migration(connection: &Connection, version: &str) -> rusqlite::Result<bool> {
    let count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = ?1",
        params![version],
        |row| row.get(0),
    )?;

    Ok(count > 0)
}

fn current_version(connection: &Connection) -> rusqlite::Result<Option<String>> {
    let mut statement = connection
        .prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1")?;
    let mut rows = statement.query([])?;

    rows.next()?.map(|row| row.get::<_, String>(0)).transpose()
}

fn ensure_migration_table(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(SCHEMA_MIGRATIONS_SQL)
}
