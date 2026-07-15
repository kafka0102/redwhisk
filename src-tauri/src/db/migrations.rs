use std::time::Duration;

use rusqlite::config::DbConfig;
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
const AGENT_COMMIT_COMPLETION_ATTEMPTS_MIGRATION_VERSION: &str =
    "0012_agent_commit_completion_attempts";
const AGENT_COMMIT_COMPLETION_ATTEMPTS_MIGRATION_SQL: &str =
    include_str!("../../migrations/0012_agent_commit_completion_attempts.sql");
const AGENT_COMMIT_COMPLETION_RESULT_MIGRATION_VERSION: &str =
    "0013_agent_commit_completion_result";
const AGENT_COMMIT_COMPLETION_RESULT_MIGRATION_SQL: &str =
    include_str!("../../migrations/0013_agent_commit_completion_result.sql");
const COMPLETION_ATTEMPT_FAILURE_REASON_MIGRATION_VERSION: &str =
    "0014_completion_attempt_failure_reason";
const COMPLETION_ATTEMPT_FAILURE_REASON_MIGRATION_SQL: &str =
    include_str!("../../migrations/0014_completion_attempt_failure_reason.sql");
const COMPLETION_ATTEMPT_GIT_OPERATION_BLOCKED_MIGRATION_VERSION: &str =
    "0015_completion_attempt_git_operation_blocked";
const COMPLETION_ATTEMPT_GIT_OPERATION_BLOCKED_MIGRATION_SQL: &str =
    include_str!("../../migrations/0015_completion_attempt_git_operation_blocked.sql");
const AGENT_SESSION_LATEST_OUTPUT_MIGRATION_VERSION: &str = "0016_agent_session_latest_output";
const AGENT_SESSION_LATEST_OUTPUT_MIGRATION_SQL: &str =
    include_str!("../../migrations/0016_agent_session_latest_output.sql");
const ALLOW_CLAUDE_AGENT_PROFILES_MIGRATION_VERSION: &str = "0017_allow_claude_agent_profiles";
const ALLOW_CLAUDE_AGENT_PROFILES_MIGRATION_SQL: &str =
    include_str!("../../migrations/0017_allow_claude_agent_profiles.sql");
const ISSUE_ATTACHMENTS_MIGRATION_VERSION: &str = "0018_issue_attachments";
const ISSUE_ATTACHMENTS_MIGRATION_SQL: &str =
    include_str!("../../migrations/0018_issue_attachments.sql");
const AGENT_PROFILES_DEL_MIGRATION_VERSION: &str = "0019_agent_profiles_del";
const AGENT_PROFILES_DEL_MIGRATION_SQL: &str =
    include_str!("../../migrations/0019_agent_profiles_del.sql");
const ISSUES_AND_AGENT_SESSIONS_DEL_MIGRATION_VERSION: &str = "0020_issues_and_agent_sessions_del";
const ISSUES_AND_AGENT_SESSIONS_DEL_MIGRATION_SQL: &str =
    include_str!("../../migrations/0020_issues_and_agent_sessions_del.sql");
const PROJECT_TERMINAL_CONFIGS_MIGRATION_VERSION: &str = "0021_project_terminal_configs";
const PROJECT_TERMINAL_CONFIGS_MIGRATION_SQL: &str =
    include_str!("../../migrations/0021_project_terminal_configs.sql");
const AGENT_WORKTREE_EXECUTION_MIGRATION_VERSION: &str = "0022_agent_worktree_execution";
const AGENT_WORKTREE_EXECUTION_MIGRATION_SQL: &str =
    include_str!("../../migrations/0022_agent_worktree_execution.sql");
const PROJECT_LABELS_MIGRATION_VERSION: &str = "0023_project_labels";
const PROJECT_LABELS_MIGRATION_SQL: &str = include_str!("../../migrations/0023_project_labels.sql");
const ISSUE_LABELS_MIGRATION_VERSION: &str = "0024_issue_labels";
const ISSUE_LABELS_MIGRATION_SQL: &str = include_str!("../../migrations/0024_issue_labels.sql");
const AGENT_SESSION_LIST_ORDER_MIGRATION_VERSION: &str = "0025_agent_session_list_order";
const AGENT_SESSION_LIST_ORDER_MIGRATION_SQL: &str =
    include_str!("../../migrations/0025_agent_session_list_order.sql");
const AGENT_SESSIONS_ACTIVE_ISSUE_UNIQUE_INDEX_MIGRATION_VERSION: &str =
    "0026_agent_sessions_active_issue_unique_index";
const AGENT_SESSIONS_ACTIVE_ISSUE_UNIQUE_INDEX_MIGRATION_SQL: &str =
    include_str!("../../migrations/0026_agent_sessions_active_issue_unique_index.sql");
const ISSUE_COMPLETION_FLOWS_MIGRATION_VERSION: &str = "0027_issue_completion_flows";
const ISSUE_COMPLETION_FLOWS_MIGRATION_SQL: &str =
    include_str!("../../migrations/0027_issue_completion_flows.sql");
const AGENT_SESSION_TURN_STATE_MIGRATION_VERSION: &str = "0028_agent_session_turn_state";
const AGENT_SESSION_TURN_STATE_MIGRATION_SQL: &str =
    include_str!("../../migrations/0028_agent_session_turn_state.sql");
const SAVED_AGENT_SKILLS_MIGRATION_VERSION: &str = "0029_saved_agent_skills";
const SAVED_AGENT_SKILLS_MIGRATION_SQL: &str =
    include_str!("../../migrations/0029_saved_agent_skills.sql");
const DROP_LABEL_AGENT_PROFILE_MIGRATION_VERSION: &str = "0030_drop_label_agent_profile";
const DROP_LABEL_AGENT_PROFILE_MIGRATION_SQL: &str =
    include_str!("../../migrations/0030_drop_label_agent_profile.sql");
const DROP_COMPLETION_POLICY_MIGRATION_VERSION: &str = "0031_drop_completion_policy";
const DROP_COMPLETION_POLICY_MIGRATION_SQL: &str =
    include_str!("../../migrations/0031_drop_completion_policy.sql");
const ISSUE_COMPLETION_FLOWS_UNIFIED_MIGRATION_VERSION: &str =
    "0032_issue_completion_flows_unified";
const ISSUE_COMPLETION_FLOWS_UNIFIED_MIGRATION_SQL: &str =
    include_str!("../../migrations/0032_issue_completion_flows_unified.sql");
const PROJECT_TERMINAL_SHORTCUT_COMMANDS_MIGRATION_VERSION: &str =
    "0033_project_terminal_shortcut_commands";
const PROJECT_TERMINAL_SHORTCUT_COMMANDS_MIGRATION_SQL: &str =
    include_str!("../../migrations/0033_project_terminal_shortcut_commands.sql");
const AGENT_SESSION_TURN_ENDED_AT_MIGRATION_VERSION: &str = "0034_agent_session_turn_ended_at";
const AGENT_SESSION_TURN_ENDED_AT_MIGRATION_SQL: &str =
    include_str!("../../migrations/0034_agent_session_turn_ended_at.sql");
const LEGACY_AGENT_SESSIONS_WORKFLOW_SKILL_NAME_MIGRATION_VERSION: &str =
    "0034_agent_sessions_workflow_skill_name";
const AGENT_SESSIONS_WORKFLOW_SKILL_NAME_MIGRATION_VERSION: &str =
    "0035_agent_sessions_workflow_skill_name";
const AGENT_SESSIONS_WORKFLOW_SKILL_NAME_MIGRATION_SQL: &str =
    include_str!("../../migrations/0035_agent_sessions_workflow_skill_name.sql");
pub(crate) const PROJECT_SCOPED_ISSUE_SESSION_NUMBERS_MIGRATION_VERSION: &str =
    "0036_project_scoped_issue_session_numbers";
pub(crate) const PROJECT_SCOPED_ISSUE_SESSION_NUMBERS_MIGRATION_SQL: &str =
    include_str!("../../migrations/0036_project_scoped_issue_session_numbers.sql");
pub(crate) const ISSUES_PROJECT_SCOPED_NUMBER_UNIQUE_MIGRATION_VERSION: &str =
    "0037_issues_project_scoped_number_unique";
pub(crate) const ISSUES_PROJECT_SCOPED_NUMBER_UNIQUE_MIGRATION_SQL: &str =
    include_str!("../../migrations/0037_issues_project_scoped_number_unique.sql");
pub(crate) const AGENT_SESSIONS_PROJECT_SCOPED_NUMBER_UNIQUE_MIGRATION_VERSION: &str =
    "0038_agent_sessions_project_scoped_number_unique";
pub(crate) const AGENT_SESSIONS_PROJECT_SCOPED_NUMBER_UNIQUE_MIGRATION_SQL: &str =
    include_str!("../../migrations/0038_agent_sessions_project_scoped_number_unique.sql");
pub(crate) const AGENT_SESSION_PROCESSING_DURATION_MIGRATION_VERSION: &str =
    "0039_agent_session_processing_duration";
pub(crate) const AGENT_SESSION_PROCESSING_DURATION_MIGRATION_SQL: &str =
    include_str!("../../migrations/0039_agent_session_processing_duration.sql");
const USER_PROFILES_MIGRATION_VERSION: &str = "0040_user_profiles";
const USER_PROFILES_MIGRATION_SQL: &str = include_str!("../../migrations/0040_user_profiles.sql");
const ISSUE_TIMELINE_ACTOR_MIGRATION_VERSION: &str = "0041_issue_timeline_actor";
const ISSUE_TIMELINE_ACTOR_MIGRATION_SQL: &str =
    include_str!("../../migrations/0041_issue_timeline_actor.sql");
const APP_UPDATE_STATE_MIGRATION_VERSION: &str = "0042_app_update_state";
const APP_UPDATE_STATE_MIGRATION_SQL: &str =
    include_str!("../../migrations/0042_app_update_state.sql");
const ISSUE_ACTION_AGENT_ACTOR_MIGRATION_VERSION: &str = "0043_issue_action_agent_actor";
const ISSUE_ACTION_AGENT_ACTOR_MIGRATION_SQL: &str =
    include_str!("../../migrations/0043_issue_action_agent_actor.sql");
const ISSUE_COMMENTS_MIGRATION_VERSION: &str = "0044_issue_comments";
const ISSUE_COMMENTS_MIGRATION_SQL: &str = include_str!("../../migrations/0044_issue_comments.sql");
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
                    execute_migration(connection, &migration)?;
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
            return default_migrations();
        }

        self.migrations.clone()
    }
}

fn default_migrations() -> Vec<Migration> {
    vec![
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
        Migration {
            version: AGENT_COMMIT_COMPLETION_ATTEMPTS_MIGRATION_VERSION,
            sql: AGENT_COMMIT_COMPLETION_ATTEMPTS_MIGRATION_SQL,
        },
        Migration {
            version: AGENT_COMMIT_COMPLETION_RESULT_MIGRATION_VERSION,
            sql: AGENT_COMMIT_COMPLETION_RESULT_MIGRATION_SQL,
        },
        Migration {
            version: COMPLETION_ATTEMPT_FAILURE_REASON_MIGRATION_VERSION,
            sql: COMPLETION_ATTEMPT_FAILURE_REASON_MIGRATION_SQL,
        },
        Migration {
            version: COMPLETION_ATTEMPT_GIT_OPERATION_BLOCKED_MIGRATION_VERSION,
            sql: COMPLETION_ATTEMPT_GIT_OPERATION_BLOCKED_MIGRATION_SQL,
        },
        Migration {
            version: AGENT_SESSION_LATEST_OUTPUT_MIGRATION_VERSION,
            sql: AGENT_SESSION_LATEST_OUTPUT_MIGRATION_SQL,
        },
        Migration {
            version: ALLOW_CLAUDE_AGENT_PROFILES_MIGRATION_VERSION,
            sql: ALLOW_CLAUDE_AGENT_PROFILES_MIGRATION_SQL,
        },
        Migration {
            version: ISSUE_ATTACHMENTS_MIGRATION_VERSION,
            sql: ISSUE_ATTACHMENTS_MIGRATION_SQL,
        },
        Migration {
            version: AGENT_PROFILES_DEL_MIGRATION_VERSION,
            sql: AGENT_PROFILES_DEL_MIGRATION_SQL,
        },
        Migration {
            version: ISSUES_AND_AGENT_SESSIONS_DEL_MIGRATION_VERSION,
            sql: ISSUES_AND_AGENT_SESSIONS_DEL_MIGRATION_SQL,
        },
        Migration {
            version: PROJECT_TERMINAL_CONFIGS_MIGRATION_VERSION,
            sql: PROJECT_TERMINAL_CONFIGS_MIGRATION_SQL,
        },
        Migration {
            version: AGENT_WORKTREE_EXECUTION_MIGRATION_VERSION,
            sql: AGENT_WORKTREE_EXECUTION_MIGRATION_SQL,
        },
        Migration {
            version: PROJECT_LABELS_MIGRATION_VERSION,
            sql: PROJECT_LABELS_MIGRATION_SQL,
        },
        Migration {
            version: ISSUE_LABELS_MIGRATION_VERSION,
            sql: ISSUE_LABELS_MIGRATION_SQL,
        },
        Migration {
            version: AGENT_SESSION_LIST_ORDER_MIGRATION_VERSION,
            sql: AGENT_SESSION_LIST_ORDER_MIGRATION_SQL,
        },
        Migration {
            version: AGENT_SESSIONS_ACTIVE_ISSUE_UNIQUE_INDEX_MIGRATION_VERSION,
            sql: AGENT_SESSIONS_ACTIVE_ISSUE_UNIQUE_INDEX_MIGRATION_SQL,
        },
        Migration {
            version: ISSUE_COMPLETION_FLOWS_MIGRATION_VERSION,
            sql: ISSUE_COMPLETION_FLOWS_MIGRATION_SQL,
        },
        Migration {
            version: AGENT_SESSION_TURN_STATE_MIGRATION_VERSION,
            sql: AGENT_SESSION_TURN_STATE_MIGRATION_SQL,
        },
        Migration {
            version: SAVED_AGENT_SKILLS_MIGRATION_VERSION,
            sql: SAVED_AGENT_SKILLS_MIGRATION_SQL,
        },
        Migration {
            version: DROP_LABEL_AGENT_PROFILE_MIGRATION_VERSION,
            sql: DROP_LABEL_AGENT_PROFILE_MIGRATION_SQL,
        },
        Migration {
            version: DROP_COMPLETION_POLICY_MIGRATION_VERSION,
            sql: DROP_COMPLETION_POLICY_MIGRATION_SQL,
        },
        Migration {
            version: ISSUE_COMPLETION_FLOWS_UNIFIED_MIGRATION_VERSION,
            sql: ISSUE_COMPLETION_FLOWS_UNIFIED_MIGRATION_SQL,
        },
        Migration {
            version: PROJECT_TERMINAL_SHORTCUT_COMMANDS_MIGRATION_VERSION,
            sql: PROJECT_TERMINAL_SHORTCUT_COMMANDS_MIGRATION_SQL,
        },
        Migration {
            version: AGENT_SESSION_TURN_ENDED_AT_MIGRATION_VERSION,
            sql: AGENT_SESSION_TURN_ENDED_AT_MIGRATION_SQL,
        },
        Migration {
            version: AGENT_SESSIONS_WORKFLOW_SKILL_NAME_MIGRATION_VERSION,
            sql: AGENT_SESSIONS_WORKFLOW_SKILL_NAME_MIGRATION_SQL,
        },
        Migration {
            version: PROJECT_SCOPED_ISSUE_SESSION_NUMBERS_MIGRATION_VERSION,
            sql: PROJECT_SCOPED_ISSUE_SESSION_NUMBERS_MIGRATION_SQL,
        },
        Migration {
            version: ISSUES_PROJECT_SCOPED_NUMBER_UNIQUE_MIGRATION_VERSION,
            sql: ISSUES_PROJECT_SCOPED_NUMBER_UNIQUE_MIGRATION_SQL,
        },
        Migration {
            version: AGENT_SESSIONS_PROJECT_SCOPED_NUMBER_UNIQUE_MIGRATION_VERSION,
            sql: AGENT_SESSIONS_PROJECT_SCOPED_NUMBER_UNIQUE_MIGRATION_SQL,
        },
        Migration {
            version: AGENT_SESSION_PROCESSING_DURATION_MIGRATION_VERSION,
            sql: AGENT_SESSION_PROCESSING_DURATION_MIGRATION_SQL,
        },
        Migration {
            version: USER_PROFILES_MIGRATION_VERSION,
            sql: USER_PROFILES_MIGRATION_SQL,
        },
        Migration {
            version: ISSUE_TIMELINE_ACTOR_MIGRATION_VERSION,
            sql: ISSUE_TIMELINE_ACTOR_MIGRATION_SQL,
        },
        Migration {
            version: APP_UPDATE_STATE_MIGRATION_VERSION,
            sql: APP_UPDATE_STATE_MIGRATION_SQL,
        },
        Migration {
            version: ISSUE_ACTION_AGENT_ACTOR_MIGRATION_VERSION,
            sql: ISSUE_ACTION_AGENT_ACTOR_MIGRATION_SQL,
        },
        Migration {
            version: ISSUE_COMMENTS_MIGRATION_VERSION,
            sql: ISSUE_COMMENTS_MIGRATION_SQL,
        },
    ]
}

#[cfg(test)]
impl MigrationRunner {
    /// 构造一个跳过指定版本集合的 runner，用于测试单个 migration 的增量语义
    /// （例如：先跑到 N-1、插入旧数据、再单独执行第 N 个 migration 验证回填）。
    pub fn runner_skipping(skipped: &[&str]) -> Self {
        let pairs: Vec<(&'static str, &'static str)> = default_migrations()
            .into_iter()
            .filter(|migration| !skipped.contains(&migration.version))
            .map(|migration| (migration.version, migration.sql))
            .collect();
        Self::from_static_migrations(pairs)
    }
}

#[derive(Clone)]
struct Migration {
    version: &'static str,
    sql: &'static str,
}

fn execute_migration(connection: &Connection, migration: &Migration) -> rusqlite::Result<()> {
    if migration.version == AGENT_SESSIONS_WORKFLOW_SKILL_NAME_MIGRATION_VERSION
        && (has_migration(
            connection,
            LEGACY_AGENT_SESSIONS_WORKFLOW_SKILL_NAME_MIGRATION_VERSION,
        )? || table_has_column(connection, "agent_sessions", "workflow_skill_name")?)
    {
        return Ok(());
    }

    if migration.version != ALLOW_CLAUDE_AGENT_PROFILES_MIGRATION_VERSION {
        return connection.execute_batch(migration.sql);
    }

    let previous_writable_schema =
        connection.db_config(DbConfig::SQLITE_DBCONFIG_WRITABLE_SCHEMA)?;
    let previous_defensive = connection.db_config(DbConfig::SQLITE_DBCONFIG_DEFENSIVE)?;
    connection.set_db_config(DbConfig::SQLITE_DBCONFIG_DEFENSIVE, false)?;
    if let Err(error) = connection.set_db_config(DbConfig::SQLITE_DBCONFIG_WRITABLE_SCHEMA, true) {
        let _ = connection.set_db_config(DbConfig::SQLITE_DBCONFIG_DEFENSIVE, previous_defensive);
        return Err(error);
    }

    let migration_result = connection.execute_batch(migration.sql);
    let restore_result = connection.set_db_config(
        DbConfig::SQLITE_DBCONFIG_WRITABLE_SCHEMA,
        previous_writable_schema,
    );
    let restore_defensive_result =
        connection.set_db_config(DbConfig::SQLITE_DBCONFIG_DEFENSIVE, previous_defensive);

    migration_result?;
    restore_result?;
    restore_defensive_result?;
    Ok(())
}

fn table_has_column(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
) -> rusqlite::Result<bool> {
    let pragma = format!("PRAGMA table_info({table_name})");
    let mut statement = connection.prepare(&pragma)?;
    let mut rows = statement.query([])?;

    while let Some(row) = rows.next()? {
        let existing_column_name: String = row.get(1)?;
        if existing_column_name == column_name {
            return Ok(true);
        }
    }

    Ok(false)
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

#[cfg(test)]
mod tests {
    use rusqlite::{params, Connection};

    use super::{
        MigrationRunner, ISSUE_TIMELINE_ACTOR_MIGRATION_SQL, ISSUE_TIMELINE_ACTOR_MIGRATION_VERSION,
    };

    #[test]
    fn issue_timeline_actor_migration_preserves_user_id_one_and_backfills_legacy_actions() {
        let connection = Connection::open_in_memory().expect("connection");
        MigrationRunner::runner_skipping(&[ISSUE_TIMELINE_ACTOR_MIGRATION_VERSION])
            .run(&connection)
            .expect("migrations before timeline actor");
        connection
            .execute(
                "INSERT INTO user_profiles (id, name) VALUES (1, 'Alice')",
                [],
            )
            .expect("legacy user profile");
        connection
            .execute(
                "INSERT INTO projects (name, repo_path, created_at, last_opened_at)
                 VALUES ('project', '/tmp/project', 1, 1)",
                [],
            )
            .expect("project");
        connection
            .execute(
                "INSERT INTO issues (project_id, number, title, description, status, created_at, updated_at)
                 VALUES (1, 1, 'issue', '', 'backlog', 1, 1)",
                [],
            )
            .expect("issue");
        connection
            .execute(
                "INSERT INTO issue_actions (issue_id, action_type, payload_json, created_at)
                 VALUES (1, 'issue_created', '{}', 1)",
                [],
            )
            .expect("legacy action");

        MigrationRunner::from_static_migrations(vec![(
            ISSUE_TIMELINE_ACTOR_MIGRATION_VERSION,
            ISSUE_TIMELINE_ACTOR_MIGRATION_SQL,
        )])
        .run(&connection)
        .expect("timeline actor migration");

        let actor_id: Option<i64> = connection
            .query_row(
                "SELECT actor_user_profile_id FROM issue_actions WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .expect("backfilled actor");
        assert_eq!(actor_id, Some(1));
        connection
            .execute(
                "INSERT INTO user_profiles (id, name) VALUES (?1, ?2)",
                params![2, "Bob"],
            )
            .expect("stable user id is no longer constrained to one");
    }
}
