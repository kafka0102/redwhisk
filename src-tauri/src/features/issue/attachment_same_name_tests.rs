use super::attachment::save_issue_attachment_draft_in_data_dir;
use super::attachment::stored_attachment_name;
use super::service::IssueService;
use crate::features::project::ProjectService;
use crate::types::issue::{CreateIssueInput, IssueAttachmentInput, SaveIssueAttachmentDraftInput};
use crate::types::project::{
    CreateProjectInput, ProjectCompletionAction, ProjectPrTarget, ProjectWorktreeLocation,
};
use std::fs;

#[test]
fn same_millisecond_stored_names_differ_for_draft_and_issue() {
    let millis = 1_735_000_000_000;
    let draft_first = stored_attachment_name("draft", 0, "screenshot.png");
    let draft_second = stored_attachment_name("draft", 0, "screenshot.png");
    assert_ne!(draft_first, draft_second);
    assert_ne!(
        (draft_first.as_str(), draft_second.as_str()),
        ("1-screenshot.png", "1-screenshot.png"),
    );

    let issue_first = stored_attachment_name("pending", millis, "screenshot.png");
    let issue_second = stored_attachment_name("pending", millis, "screenshot.png");
    assert_ne!(issue_first, issue_second);
    assert_ne!(
        (issue_first.as_str(), issue_second.as_str()),
        ("1-screenshot.png", "1-screenshot.png"),
    );
}

#[test]
fn same_millisecond_same_display_name_keeps_distinct_bytes() {
    let temp = tempfile::tempdir().expect("temp");
    let data_dir = temp.path().join("data");
    let repo = temp.path().join("repo");
    fs::create_dir_all(&repo).expect("repo");
    let git = |args: &[&str]| {
        let status = std::process::Command::new("git")
            .args(args)
            .current_dir(&repo)
            .status()
            .expect("git");
        assert!(status.success());
    };
    git(&["init"]);
    git(&["config", "user.email", "redwhisk@example.test"]);
    git(&["config", "user.name", "RedWhisk Test"]);
    fs::write(repo.join("base.txt"), "base\n").expect("base");
    git(&["add", "base.txt"]);
    git(&["commit", "-m", "initial"]);
    let source_a = temp.path().join("a");
    let source_b = temp.path().join("b");
    fs::create_dir_all(&source_a).expect("source a");
    fs::create_dir_all(&source_b).expect("source b");
    let first_source = source_a.join("screenshot.png");
    let second_source = source_b.join("screenshot.png");
    fs::write(&first_source, b"first-bytes").expect("write first");
    fs::write(&second_source, b"second-bytes").expect("write second");

    let first = save_issue_attachment_draft_in_data_dir(
        &data_dir,
        SaveIssueAttachmentDraftInput {
            source_path: first_source.to_string_lossy().to_string(),
            display_name: "screenshot.png".to_string(),
        },
    )
    .expect("first draft");
    let second = save_issue_attachment_draft_in_data_dir(
        &data_dir,
        SaveIssueAttachmentDraftInput {
            source_path: second_source.to_string_lossy().to_string(),
            display_name: "screenshot.png".to_string(),
        },
    )
    .expect("second draft");

    assert_ne!(first.path, second.path);
    assert_eq!(fs::read(&first.path).expect("read first"), b"first-bytes");
    assert_eq!(
        fs::read(&second.path).expect("read second"),
        b"second-bytes"
    );

    let project_id = ProjectService::create_project_in_data_dir(
        &data_dir,
        CreateProjectInput {
            name: "App".to_string(),
            repo_path: repo.to_string_lossy().to_string(),
            worktree_location: ProjectWorktreeLocation::RepoSibling,
            worktree_setup_command: String::new(),
            completion_action: Some(ProjectCompletionAction::MergeToBase),
            pr_target: Some(ProjectPrTarget::RepoDefault),
            pr_draft: Some(true),
            confirm_completion_action: Some(false),
            issue_source: Default::default(),
        },
    )
    .expect("project")
    .id;
    let issue = IssueService::create_issue_in_data_dir(
        &data_dir,
        CreateIssueInput {
            project_id,
            title: "shots".to_string(),
            description: "![screenshot.png]({{issue-attachment-temp:T1}})\n![screenshot.png]({{issue-attachment-temp:T2}})".to_string(),
            attachments: vec![
                IssueAttachmentInput {
                    attachment_id: None,
                    temp_token: Some("T1".to_string()),
                    source_path: Some(first.path.clone()),
                    display_name: "screenshot.png".to_string(),
                    mime_type: None,
                },
                IssueAttachmentInput {
                    attachment_id: None,
                    temp_token: Some("T2".to_string()),
                    source_path: Some(second.path.clone()),
                    display_name: "screenshot.png".to_string(),
                    mime_type: None,
                },
            ],
            label_ids: Vec::new(),
        },
    )
    .expect("create issue");

    assert_eq!(issue.attachments.len(), 2);
    assert_ne!(
        issue.attachments[0].absolute_path,
        issue.attachments[1].absolute_path
    );
    assert_eq!(
        fs::read(&issue.attachments[0].absolute_path).expect("persisted first"),
        b"first-bytes"
    );
    assert_eq!(
        fs::read(&issue.attachments[1].absolute_path).expect("persisted second"),
        b"second-bytes"
    );
}
