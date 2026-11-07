use super::migrations::Migration;

const PROJECT_FORGE_HOST_MIGRATION_VERSION: &str = "0059_project_forge_host";
const PROJECT_FORGE_HOST_MIGRATION_SQL: &str =
    include_str!("../../migrations/0059_project_forge_host.sql");
const PROJECT_ISSUE_SOURCE_SETTINGS_MIGRATION_VERSION: &str = "0060_project_issue_source_settings";
const PROJECT_ISSUE_SOURCE_SETTINGS_MIGRATION_SQL: &str =
    include_str!("../../migrations/0060_project_issue_source_settings.sql");
const ISSUE_EXTERNAL_REFS_MIGRATION_VERSION: &str = "0061_issue_external_refs";
const ISSUE_EXTERNAL_REFS_MIGRATION_SQL: &str =
    include_str!("../../migrations/0061_issue_external_refs.sql");
const CHANGE_REQUESTS_MIGRATION_VERSION: &str = "0065_change_requests";
const CHANGE_REQUESTS_MIGRATION_SQL: &str =
    include_str!("../../migrations/0065_change_requests.sql");
const CHANGE_REQUEST_SYNC_STATUS_MIGRATION_VERSION: &str = "0066_change_request_sync_status";
const CHANGE_REQUEST_SYNC_STATUS_MIGRATION_SQL: &str =
    include_str!("../../migrations/0066_change_request_sync_status.sql");

pub(super) fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: PROJECT_FORGE_HOST_MIGRATION_VERSION,
            sql: PROJECT_FORGE_HOST_MIGRATION_SQL,
        },
        Migration {
            version: PROJECT_ISSUE_SOURCE_SETTINGS_MIGRATION_VERSION,
            sql: PROJECT_ISSUE_SOURCE_SETTINGS_MIGRATION_SQL,
        },
        Migration {
            version: ISSUE_EXTERNAL_REFS_MIGRATION_VERSION,
            sql: ISSUE_EXTERNAL_REFS_MIGRATION_SQL,
        },
        Migration {
            version: super::issue_remote_comments_migration::VERSION,
            sql: super::issue_remote_comments_migration::SQL,
        },
        Migration {
            version: super::issue_completion_writeback_migration::VERSION,
            sql: super::issue_completion_writeback_migration::SQL,
        },
        Migration {
            version: super::issue_external_ref_recovery_migration::VERSION,
            sql: super::issue_external_ref_recovery_migration::SQL,
        },
        Migration {
            version: CHANGE_REQUESTS_MIGRATION_VERSION,
            sql: CHANGE_REQUESTS_MIGRATION_SQL,
        },
        Migration {
            version: CHANGE_REQUEST_SYNC_STATUS_MIGRATION_VERSION,
            sql: CHANGE_REQUEST_SYNC_STATUS_MIGRATION_SQL,
        },
    ]
}
