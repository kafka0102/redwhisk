use serde_json::{json, Value};
use tempfile::TempDir;

use super::issue_source::{
    get_project_issue_source_settings_in_data_dir, update_project_issue_source_settings_in_data_dir,
};
use super::issue_source_settings_tests::{create_project, git_repo, input_from};
use crate::types::errors::CommandErrorCode;
use crate::types::project_issue_source::IssueDisplayMode;

#[test]
fn issue_display_mode_defaults_to_board_and_round_trips_list() {
    let data_dir = TempDir::new().expect("data dir");
    let repos = TempDir::new().expect("repos");
    let repo = git_repo(&repos, "app", "git@github.com:acme/redwhisk.git");
    let project_id = create_project(data_dir.path(), repo);

    assert_eq!(
        get_project_issue_source_settings_in_data_dir(data_dir.path(), project_id)
            .expect("default settings")
            .issue_display_mode,
        IssueDisplayMode::Board
    );

    let updated = update_project_issue_source_settings_in_data_dir(
        data_dir.path(),
        input_from(json!({
            "projectId": project_id,
            "issueDisplayMode": "list"
        })),
    )
    .expect("save list mode");
    assert_eq!(updated.issue_display_mode, IssueDisplayMode::List);

    assert_eq!(
        get_project_issue_source_settings_in_data_dir(data_dir.path(), project_id)
            .expect("reload settings")
            .issue_display_mode,
        IssueDisplayMode::List
    );
}

#[test]
fn issue_display_mode_rejects_unsupported_values_without_writing() {
    let data_dir = TempDir::new().expect("data dir");
    let repos = TempDir::new().expect("repos");
    let repo = git_repo(&repos, "app", "git@github.com:acme/redwhisk.git");
    let project_id = create_project(data_dir.path(), repo);
    update_project_issue_source_settings_in_data_dir(
        data_dir.path(),
        input_from(json!({
            "projectId": project_id,
            "issueDisplayMode": "list"
        })),
    )
    .expect("seed list mode");
    let before =
        get_project_issue_source_settings_in_data_dir(data_dir.path(), project_id).expect("before");

    for invalid in [Value::Null, json!(""), json!("grid"), json!(1)] {
        let error = update_project_issue_source_settings_in_data_dir(
            data_dir.path(),
            input_from(json!({
                "projectId": project_id,
                "issueDisplayMode": invalid
            })),
        )
        .expect_err("invalid display mode");
        assert_eq!(error.code, CommandErrorCode::ProjectValidationFailed);
        assert_eq!(error.reason.as_deref(), Some("issueDisplayModeInvalid"));
        assert_eq!(
            error.message,
            "Issue display mode must be either board or list."
        );
    }

    let after =
        get_project_issue_source_settings_in_data_dir(data_dir.path(), project_id).expect("after");
    assert_eq!(after, before);
}
