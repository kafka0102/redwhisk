use super::github_issue_mirror::FixedForge;
use super::host_attachment_fixture::{
    attachment, bytes_file, github_project, lock_uploads, remember,
};
use super::remote_create::create_issue_with_forge;
use crate::types::issue::{CreateIssueInput, IssueAttachmentInput};

const INPUT: &str = "See this\n\n![shot.png]({{issue-attachment-temp:img}})\n\nNotes\n";
const OUTPUT: &str =
    "See this\n\n![shot.png](https://github.com/user-attachments/assets/abc)\n\nNotes\n";
const MARKDOWN: &str = "![shot.png](https://github.com/user-attachments/assets/abc)";

fn forge() -> FixedForge {
    let mut issue = super::github_issue_mirror::open_issue(128, "Remote");
    issue.url = "https://github.com/acme/redwhisk/issues/128".to_string();
    issue.external_id = "issue-128".to_string();
    FixedForge::new(Vec::new()).with_created(issue)
}

fn input(
    project_id: i64,
    description: &str,
    attachments: Vec<IssueAttachmentInput>,
) -> CreateIssueInput {
    CreateIssueInput {
        project_id,
        title: "Shot".to_string(),
        description: description.to_string(),
        attachments,
        label_ids: Vec::new(),
    }
}

fn body_of(forge: &FixedForge) -> String {
    forge
        .create_calls
        .lock()
        .expect("calls")
        .last()
        .expect("draft")
        .body
        .clone()
}

#[test]
fn remote_create_replaces_uploaded_image_token_in_forge_body_and_saved_description() {
    let _lock = lock_uploads();
    let project = github_project(true, "ready");
    let shot = bytes_file(project.temp.path(), "shot.png", b"png-bytes");
    let _upload = remember(project.project_id, "img", MARKDOWN);
    let port = forge();
    let created = create_issue_with_forge(
        &project.service(),
        input(
            project.project_id,
            INPUT,
            vec![attachment(&shot, "img", "shot.png")],
        ),
        &port,
        |_| Ok(()),
    )
    .expect("created");
    assert_eq!(body_of(&port), OUTPUT);
    assert_eq!(created.description, OUTPUT);
    assert_eq!(created.attachments.len(), 1);
    assert_eq!(created.attachments[0].display_name, "shot.png");
    assert_eq!(
        std::fs::read(&created.attachments[0].absolute_path).expect("agent file"),
        b"png-bytes"
    );
}

#[test]
fn github_keeps_uploaded_image_and_drops_unaccepted_pdf_line() {
    let _lock = lock_uploads();
    let project = github_project(true, "ready");
    let shot = bytes_file(project.temp.path(), "shot.png", b"png");
    let pdf = bytes_file(project.temp.path(), "notes.pdf", b"pdf");
    let _upload = remember(project.project_id, "img", MARKDOWN);
    let port = forge();
    let description = format!("{INPUT}{{{{issue-attachment-temp:pdf}}}}\n");
    let created = create_issue_with_forge(
        &project.service(),
        input(
            project.project_id,
            &description,
            vec![
                attachment(&shot, "img", "shot.png"),
                attachment(&pdf, "pdf", "notes.pdf"),
            ],
        ),
        &port,
        |_| Ok(()),
    )
    .expect("created");
    assert_eq!(body_of(&port), OUTPUT);
    assert_eq!(created.description, OUTPUT);
    assert!(!created.description.contains("issue-attachment"));
    assert_eq!(created.attachments.len(), 2);
    assert!(created
        .attachments
        .iter()
        .any(|item| item.display_name == "notes.pdf"));
    assert_eq!(port.create_calls.lock().expect("calls").len(), 1);
}

#[test]
fn github_drops_unaccepted_bmp_image_syntax_without_upload() {
    let _lock = lock_uploads();
    let project = github_project(true, "ready");
    let bmp = bytes_file(project.temp.path(), "diagram.bmp", b"bmp");
    let port = forge();
    let created = create_issue_with_forge(
        &project.service(),
        input(
            project.project_id,
            "See this\n\n![diagram.bmp]({{issue-attachment-temp:bmp}})\n\nNotes\n",
            vec![attachment(&bmp, "bmp", "diagram.bmp")],
        ),
        &port,
        |_| Ok(()),
    )
    .expect("created");
    let body = body_of(&port);
    assert!(!body.contains("issue-attachment"));
    assert!(!body.contains("![diagram.bmp]"));
    assert_eq!(created.description, body);
    assert_eq!(created.attachments.len(), 1);
}

#[test]
fn github_deletes_only_an_unaccepted_marker_inside_a_sentence() {
    let _lock = lock_uploads();
    let project = github_project(true, "ready");
    let pdf = bytes_file(project.temp.path(), "notes.pdf", b"pdf");
    let port = forge();
    let created = create_issue_with_forge(
        &project.service(),
        input(
            project.project_id,
            "see {{issue-attachment-temp:pdf}} here",
            vec![attachment(&pdf, "pdf", "notes.pdf")],
        ),
        &port,
        |_| Ok(()),
    )
    .expect("created");
    assert_eq!(body_of(&port), "see  here");
    assert_eq!(created.description, "see  here");
}

#[test]
fn github_creates_an_empty_body_when_only_an_unaccepted_pdf_is_attached() {
    let _lock = lock_uploads();
    let project = github_project(true, "ready");
    let pdf = bytes_file(project.temp.path(), "notes.pdf", b"pdf");
    let port = forge();
    let created = create_issue_with_forge(
        &project.service(),
        input(
            project.project_id,
            "{{issue-attachment-temp:pdf}}",
            vec![attachment(&pdf, "pdf", "notes.pdf")],
        ),
        &port,
        |_| Ok(()),
    )
    .expect("created");
    assert_eq!(body_of(&port), "");
    assert_eq!(created.description, "");
    assert_eq!(created.attachments[0].display_name, "notes.pdf");
}

#[test]
fn accepted_image_without_upload_does_not_create_even_if_the_body_contains_a_link() {
    let _lock = lock_uploads();
    let project = github_project(true, "ready");
    let shot = bytes_file(project.temp.path(), "shot.png", b"png");
    let port = forge();
    let error = create_issue_with_forge(
        &project.service(),
        input(
            project.project_id,
            OUTPUT,
            vec![attachment(&shot, "img", "shot.png")],
        ),
        &port,
        |_| Ok(()),
    )
    .expect_err("missing upload");
    assert_eq!(
        error.reason.as_deref(),
        Some("hostAttachmentUploadRequired")
    );
    assert!(port.create_calls.lock().expect("calls").is_empty());
    assert_eq!(project.count("issues"), 0);
}

#[test]
fn oversized_png_does_not_create_a_remote_issue() {
    let _lock = lock_uploads();
    let project = github_project(true, "ready");
    let shot =
        super::host_attachment_fixture::len_file(project.temp.path(), "shot.png", 10_485_761);
    let _upload = remember(project.project_id, "img", MARKDOWN);
    let port = forge();
    let error = create_issue_with_forge(
        &project.service(),
        input(
            project.project_id,
            OUTPUT,
            vec![attachment(&shot, "img", "shot.png")],
        ),
        &port,
        |_| Ok(()),
    )
    .expect_err("too large");
    assert_eq!(error.reason.as_deref(), Some("hostAttachmentTooLarge"));
    assert!(port.create_calls.lock().expect("calls").is_empty());
    assert_eq!(project.count("issues"), 0);
}

#[test]
fn local_create_keeps_the_attachment_marker_instead_of_the_host_url() {
    let _lock = lock_uploads();
    let project = github_project(false, "ready");
    let shot = bytes_file(project.temp.path(), "shot.png", b"png");
    let _upload = remember(project.project_id, "img", MARKDOWN);
    let port = forge();
    let created = create_issue_with_forge(
        &project.service(),
        input(
            project.project_id,
            INPUT,
            vec![attachment(&shot, "img", "shot.png")],
        ),
        &port,
        |_| Ok(()),
    )
    .expect("local");
    assert!(port.create_calls.lock().expect("calls").is_empty());
    assert!(created.description.contains("{{issue-attachment:"));
    assert!(!created.description.contains("issue-attachment-temp"));
    assert!(!created
        .description
        .contains("https://github.com/user-attachments/assets/abc"));
}

#[test]
fn switching_back_to_local_before_submit_does_not_write_the_host_url() {
    let _lock = lock_uploads();
    let project = github_project(false, "ready");
    let shot = bytes_file(project.temp.path(), "shot.png", b"png");
    let _upload = remember(project.project_id, "img", MARKDOWN);
    let port = forge();
    let created = create_issue_with_forge(
        &project.service(),
        input(
            project.project_id,
            INPUT,
            vec![attachment(&shot, "img", "shot.png")],
        ),
        &port,
        |_| Ok(()),
    )
    .expect("local after switch");
    assert!(created.description.contains("{{issue-attachment:"));
    assert!(!created.description.contains(MARKDOWN));
    assert!(port.create_calls.lock().expect("calls").is_empty());
}
