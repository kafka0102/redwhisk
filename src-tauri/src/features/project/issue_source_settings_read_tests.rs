use super::*;

#[test]
fn get_project_issue_source_settings_is_unknown_without_cli() {
    let data_dir = TempDir::new().expect("data dir");
    let repos = TempDir::new().expect("repos");
    let repo = git_repo(&repos, "app", "git@github.com:acme/redwhisk.git");
    let project_id = create_project(data_dir.path(), repo);

    let settings = get_project_issue_source_settings_in_data_dir(data_dir.path(), project_id)
        .expect("get settings");

    assert_eq!(settings.issue_source_mode, IssueSourceMode::Local);
    assert_eq!(settings.connection.auth_status, ForgeAuthStatus::Unknown);
    assert_eq!(settings.connection.provider, None);
    let connection =
        rusqlite::Connection::open(data_dir.path().join(DATABASE_FILE_NAME)).expect("open db");
    let rows: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM project_forge_connections",
            [],
            |row| row.get(0),
        )
        .expect("connection rows");
    assert_eq!(rows, 0);
}

#[test]
fn get_project_issue_source_settings_returns_not_found() {
    let data_dir = TempDir::new().expect("data dir");
    let repos = TempDir::new().expect("repos");
    let repo = git_repo(&repos, "app", "git@github.com:acme/redwhisk.git");
    let _project_id = create_project(data_dir.path(), repo);

    let missing = get_project_issue_source_settings_in_data_dir(data_dir.path(), 404)
        .expect_err("missing project");

    assert_eq!(missing.code, CommandErrorCode::ProjectNotFound);
}
