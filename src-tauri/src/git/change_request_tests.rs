use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use tempfile::tempdir;

use super::{
    first_http_url, glab_create, is_forge_auth_failure, link_existing_or_create,
    parse_github_pr_view, parse_gitlab_mr_view, ChangeRequestInput,
};
use crate::git::command::with_interactive_path;
use crate::git::forge::ForgeHost;

#[test]
fn extracts_the_first_http_url() {
    assert_eq!(
        first_http_url("[{\"url\":\"https://github.com/acme/redwhisk/pull/128\"}]"),
        Some("https://github.com/acme/redwhisk/pull/128".to_string())
    );
    assert!(first_http_url("no request").is_none());
}

#[test]
fn parses_github_and_gitlab_request_status() {
    let github = parse_github_pr_view(
        r#"{"title":"Fix closeout","state":"OPEN","isDraft":true,"statusCheckRollup":[{"name":"ci","status":"COMPLETED","conclusion":"SUCCESS"}]}"#,
    )
    .expect("github view");
    assert_eq!(github.title, "Fix closeout");
    assert_eq!(github.state, "DRAFT");
    assert_eq!(github.checks[0].name, "ci");
    assert_eq!(github.checks[0].status, "SUCCESS");

    let gitlab = parse_gitlab_mr_view(
        r#"{"title":"Fix closeout","state":"opened","head_pipeline":{"status":"success"}}"#,
    )
    .expect("gitlab view");
    assert_eq!(gitlab.state, "OPEN");
    assert_eq!(gitlab.checks[0].status, "success");
}

#[test]
fn glab_create_skips_push_with_the_supported_flag() {
    let temp = tempdir().expect("temp dir");
    let args_log = temp.path().join("glab-args.log");
    let bin_dir = write_fake_cli(
        temp.path(),
        "glab",
        &format!(
            "#!/bin/sh\nprintf '%s\\n' \"$@\" > '{}'\necho https://gitlab.example.com/group/project/-/merge_requests/7\n",
            args_log.display()
        ),
    );

    let repo = temp.path().join("repo");
    fs::create_dir_all(&repo).expect("repo dir");
    let url = with_interactive_path(Some(bin_dir.into_os_string()), || {
        glab_create(ChangeRequestInput {
            repo_path: &repo,
            host: ForgeHost::Gitlab,
            head: "feature",
            base: "main",
            title: "Title",
            body: "Body",
            draft: false,
        })
    })
    .expect("glab create");

    assert_eq!(
        url,
        "https://gitlab.example.com/group/project/-/merge_requests/7"
    );
    let args = fs::read_to_string(&args_log).expect("args log");
    assert!(
        args.lines().any(|line| line == "--push=false"),
        "expected --push=false, got {args}"
    );
    assert!(!args.contains("--no-push"), "stale flag in {args}");
}

#[test]
fn glab_create_surfaces_login_failure_text() {
    let temp = tempdir().expect("temp dir");
    let bin_dir = write_fake_cli(
        temp.path(),
        "glab",
        "#!/bin/sh\necho 'None of the git remotes configured for this repository point to a known GitLab host. Please use `glab auth login` to authenticate.' >&2\nexit 1\n",
    );

    let repo = temp.path().join("repo");
    fs::create_dir_all(&repo).expect("repo dir");
    let error = with_interactive_path(Some(bin_dir.into_os_string()), || {
        glab_create(ChangeRequestInput {
            repo_path: &repo,
            host: ForgeHost::Gitlab,
            head: "feature",
            base: "main",
            title: "Title",
            body: "Body",
            draft: false,
        })
    })
    .expect_err("missing login must fail");

    assert!(error.contains("glab auth login"), "{error}");
    assert!(is_forge_auth_failure(&error), "{error}");
}

#[test]
fn classifies_auth_failures_only() {
    assert!(is_forge_auth_failure(
        "To get started with GitHub CLI, please run: gh auth login"
    ));
    assert!(is_forge_auth_failure(
        "You are not logged into any GitHub hosts."
    ));
    assert!(is_forge_auth_failure("HTTP 401: Unauthorized"));
    assert!(!is_forge_auth_failure(
        "fatal: unable to access remote: Could not resolve host"
    ));
}

#[test]
fn existing_open_pull_request_is_linked_without_a_second_create() {
    let mut created = 0;
    let url = link_existing_or_create(
        Some("https://github.com/acme/redwhisk/pull/9".to_string()),
        || {
            created += 1;
            Ok("https://github.com/acme/redwhisk/pull/10".to_string())
        },
    )
    .expect("link");
    assert_eq!(url, "https://github.com/acme/redwhisk/pull/9");
    assert_eq!(created, 0);
}

fn write_fake_cli(dir: &Path, name: &str, body: &str) -> std::path::PathBuf {
    let bin_dir = dir.join("bin");
    fs::create_dir_all(&bin_dir).expect("bin dir");
    let path = bin_dir.join(name);
    fs::write(&path, body).expect("write fake cli");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("chmod fake cli");
    bin_dir
}
