use super::github_issue_mirror::{
    with_captured_forge_invocations, with_scripted_forge_output, with_simulated_forge_failure,
    ForgeIssueError,
};
use super::host_attachment::upload_issue_host_attachment_in_data_dir;
use super::host_attachment_body::forget_host_upload;
use super::host_attachment_fixture::{bytes_file, github_project, len_file, lock_uploads};
use crate::types::host_attachment::UploadIssueHostAttachmentInput;

fn upload_input(
    project_id: i64,
    path: &std::path::Path,
    name: &str,
) -> UploadIssueHostAttachmentInput {
    UploadIssueHostAttachmentInput {
        project_id,
        temp_token: "img".to_string(),
        source_path: path.to_string_lossy().to_string(),
        display_name: name.to_string(),
    }
}

fn github_stdout() -> Vec<Result<String, ForgeIssueError>> {
    vec![
        Ok("42\n".to_string()),
        Ok(r#"{"url":"https://github.com/user-attachments/assets/abc"}"#.to_string()),
    ]
}

#[test]
fn upload_issue_host_attachment_sends_the_selected_png_and_keeps_the_login_snapshot() {
    let _lock = lock_uploads();
    let project = github_project(true, "ready");
    let shot = bytes_file(project.temp.path(), "shot.png", b"png-bytes");
    let before: String = project
        .database
        .connection
        .query_row(
            "SELECT login FROM project_forge_connections WHERE project_id = ?1",
            [project.project_id],
            |row| row.get(0),
        )
        .expect("login");
    let (result, invocations) = with_scripted_forge_output(github_stdout(), || {
        upload_issue_host_attachment_in_data_dir(
            project.temp.path(),
            upload_input(project.project_id, &shot, "shot.png"),
        )
    });
    let uploaded = result.expect("uploaded");
    assert_eq!(
        uploaded.markdown,
        "![shot.png](https://github.com/user-attachments/assets/abc)"
    );
    assert_eq!(invocations.len(), 2);
    assert_eq!(invocations[0].program, "gh");
    assert!(invocations[1]
        .args
        .iter()
        .any(|arg| arg == shot.to_str().unwrap()));
    assert!(invocations[1]
        .args
        .iter()
        .any(|arg| arg.contains("name=shot.png")));
    let after: String = project
        .database
        .connection
        .query_row(
            "SELECT login FROM project_forge_connections WHERE project_id = ?1",
            [project.project_id],
            |row| row.get(0),
        )
        .expect("login");
    assert_eq!(after, before);
    assert_eq!(before, "octocat");
    let mut columns = Vec::new();
    let mut statement = project
        .database
        .connection
        .prepare("SELECT name FROM pragma_table_info('project_forge_connections')")
        .expect("pragma");
    let names = statement
        .query_map([], |row| row.get::<_, String>(0))
        .expect("names");
    for name in names {
        columns.push(name.expect("column"));
    }
    assert!(columns
        .iter()
        .all(|name| !name.to_ascii_lowercase().contains("token")));
    forget_host_upload(project.project_id, "img");
    assert_eq!(project.count("issues"), 0);
}

#[test]
fn shot_png_uploads_and_bmp_does_not_call_github() {
    let _lock = lock_uploads();
    let project = github_project(true, "ready");
    let png = bytes_file(project.temp.path(), "Shot.PNG", b"png");
    let (png_result, png_calls) = with_scripted_forge_output(github_stdout(), || {
        upload_issue_host_attachment_in_data_dir(
            project.temp.path(),
            upload_input(project.project_id, &png, "Shot.PNG"),
        )
    });
    assert!(png_result
        .expect("png")
        .markdown
        .starts_with("![Shot.PNG]("));
    assert_eq!(png_calls.len(), 2);
    forget_host_upload(project.project_id, "img");
    let bmp = bytes_file(project.temp.path(), "shot.bmp", b"bmp");
    let (bmp_result, bmp_calls) = with_captured_forge_invocations(|| {
        upload_issue_host_attachment_in_data_dir(
            project.temp.path(),
            upload_input(project.project_id, &bmp, "shot.bmp"),
        )
    });
    let error = bmp_result.expect_err("bmp");
    assert_eq!(error.reason.as_deref(), Some("hostAttachmentRejected"));
    assert!(bmp_calls.is_empty());
    assert_eq!(project.count("issues"), 0);
}

#[test]
fn ten_mebibyte_png_uploads_and_one_extra_byte_does_not() {
    let _lock = lock_uploads();
    let project = github_project(true, "ready");
    let exact = len_file(project.temp.path(), "exact.png", 10_485_760);
    let (exact_result, exact_calls) = with_scripted_forge_output(github_stdout(), || {
        upload_issue_host_attachment_in_data_dir(
            project.temp.path(),
            upload_input(project.project_id, &exact, "exact.png"),
        )
    });
    assert!(exact_result.is_ok());
    assert_eq!(exact_calls.len(), 2);
    forget_host_upload(project.project_id, "img");
    let over = len_file(project.temp.path(), "over.png", 10_485_761);
    let (over_result, over_calls) = with_captured_forge_invocations(|| {
        upload_issue_host_attachment_in_data_dir(
            project.temp.path(),
            upload_input(project.project_id, &over, "over.png"),
        )
    });
    let error = over_result.expect_err("over");
    assert_eq!(error.reason.as_deref(), Some("hostAttachmentTooLarge"));
    assert!(over_calls.is_empty());
    assert_eq!(project.count("issues"), 0);
}

fn assert_upload_failure(failure: ForgeIssueError, reason: &str) {
    let _lock = lock_uploads();
    let project = github_project(true, "ready");
    let shot = bytes_file(project.temp.path(), "shot.png", b"png");
    let (result, _) = with_simulated_forge_failure(failure, || {
        upload_issue_host_attachment_in_data_dir(
            project.temp.path(),
            upload_input(project.project_id, &shot, "shot.png"),
        )
    });
    let error = result.expect_err(reason);
    assert_eq!(error.reason.as_deref(), Some(reason));
    assert_eq!(project.count("issues"), 0);
}

#[test]
fn upload_issue_host_attachment_reports_unauthenticated_without_a_local_issue() {
    assert_upload_failure(
        ForgeIssueError::Unauthenticated,
        "hostAttachmentUnauthenticated",
    );
}

#[test]
fn upload_issue_host_attachment_reports_forbidden_without_a_local_issue() {
    assert_upload_failure(ForgeIssueError::Forbidden, "hostAttachmentForbidden");
}

#[test]
fn upload_issue_host_attachment_reports_offline_without_a_local_issue() {
    assert_upload_failure(ForgeIssueError::Offline, "hostAttachmentOffline");
}

#[test]
fn upload_issue_host_attachment_reports_missing_cli_without_a_local_issue() {
    assert_upload_failure(ForgeIssueError::CliMissing, "hostAttachmentCliMissing");
}

#[test]
fn upload_issue_host_attachment_reports_other_upload_failure_without_a_local_issue() {
    assert_upload_failure(ForgeIssueError::CommandFailed, "hostAttachmentUploadFailed");
}

#[test]
fn upload_issue_host_attachment_rejects_a_local_create_source() {
    let _lock = lock_uploads();
    let project = github_project(false, "ready");
    let shot = bytes_file(project.temp.path(), "shot.png", b"png");
    let (result, calls) = with_captured_forge_invocations(|| {
        upload_issue_host_attachment_in_data_dir(
            project.temp.path(),
            upload_input(project.project_id, &shot, "shot.png"),
        )
    });
    let error = result.expect_err("local");
    assert_eq!(error.reason.as_deref(), Some("hostAttachmentNotRemote"));
    assert!(calls.is_empty());
    assert_eq!(project.count("issues"), 0);
}

#[test]
fn upload_issue_host_attachment_rejects_a_connection_that_is_not_ready() {
    let _lock = lock_uploads();
    let project = github_project(true, "unauthenticated");
    let shot = bytes_file(project.temp.path(), "shot.png", b"png");
    let (result, calls) = with_captured_forge_invocations(|| {
        upload_issue_host_attachment_in_data_dir(
            project.temp.path(),
            upload_input(project.project_id, &shot, "shot.png"),
        )
    });
    let error = result.expect_err("not ready");
    assert_eq!(error.reason.as_deref(), Some("hostAttachmentUnavailable"));
    assert!(calls.is_empty());
    assert_eq!(project.count("issues"), 0);
}
