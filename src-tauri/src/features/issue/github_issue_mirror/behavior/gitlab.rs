use std::sync::Mutex;

use rusqlite::params;

use crate::types::issue::IssueStatus;
use crate::types::issue_mirror::IssueSyncOutcome;

use super::super::board::list_board_issues;
use super::super::gitlab::retain_issues_since;
use super::super::gitlab::{gitlab_issue_list_args, parse_gitlab_issue_list};
use super::super::port::{
    FixedForge, ForgeIssueError, ForgeIssueListQuery, ForgeIssuePort, RemoteIssue, RemoteIssueState,
};
use super::super::sync::sync_project_issues;
use super::support::{
    issue_row_count, last_sync_error, ready_github_project, ready_gitlab_project, remote_issue,
    seed_remote_issue, set_auth,
};

const GITLAB_FIXTURE: &str = r##"[
  {
    "id": 81,
    "iid": 8,
    "title": "Pipeline stuck",
    "description": "rerun the job",
    "state": "opened",
    "web_url": "https://gitlab.example.com/acme/redwhisk/-/issues/8",
    "updated_at": "2026-11-05T12:00:00Z",
    "author": { "username": "octocat" },
    "assignees": [{ "username": "ada" }],
    "labels": ["bug", { "title": "ui" }, { "name": "api" }, { "color": "#fff" }]
  },
  {
    "id": "gid-9",
    "iid": 9,
    "title": "No metadata",
    "state": "closed",
    "web_url": "https://gitlab.example.com/acme/redwhisk/-/issues/9",
    "updated_at": "2026-11-05T13:00:00Z"
  }
]"##;

#[test]
fn gitlab_fixture_imports_optional_fields_and_a_closed_issue() {
    let harness = ready_gitlab_project("all", None);
    let parsed = parse_gitlab_issue_list(GITLAB_FIXTURE).expect("fixture");
    let forge = FixedForge::new(parsed);
    let result =
        sync_project_issues(&harness.connection, harness.project_id, &forge, 5_000).expect("sync");
    assert_eq!(result.outcome, IssueSyncOutcome::Synced);
    assert_eq!(forge.calls().len(), 1);
    let mut listed = list_board_issues(&harness.connection, harness.project_id).expect("list");
    listed.sort_by_key(|issue| issue.external_number);
    assert_eq!(listed.len(), 2);
    assert_eq!(listed[0].provider.as_deref(), Some("gitlab"));
    assert_eq!(listed[0].external_number, Some(8));
    assert_eq!(listed[0].title, "Pipeline stuck");
    assert_eq!(listed[0].status, IssueStatus::Backlog);
    assert_eq!(
        listed[0].remote_labels,
        vec!["bug".to_string(), "ui".to_string(), "api".to_string()]
    );
    assert_eq!(listed[1].external_number, Some(9));
    assert_eq!(listed[1].title, "No metadata");
    assert_eq!(listed[1].status, IssueStatus::Completed);
    assert!(listed[1].remote_labels.is_empty());
    let stored: (String, String, String, i64) = harness
        .connection
        .query_row(
            "SELECT i.description, r.external_url, r.remote_state, r.remote_updated_at
             FROM issues i
             JOIN issue_external_refs r ON r.issue_id = i.id
             WHERE r.external_number = 8",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .expect("stored");
    assert_eq!(stored.0, "rerun the job");
    assert_eq!(
        stored.1,
        "https://gitlab.example.com/acme/redwhisk/-/issues/8"
    );
    assert_eq!(stored.2, "open");
    assert_eq!(stored.3, utc_millis("2026-11-05T12:00:00Z"));
}

#[test]
fn gitlab_failures_keep_existing_rows_and_record_sync_error() {
    let cases = [
        (
            "expired",
            Some(ForgeIssueError::Unauthenticated),
            IssueSyncOutcome::CredentialExpired,
            "credential_expired",
            1,
        ),
        (
            "unauthenticated",
            Some(ForgeIssueError::Unauthenticated),
            IssueSyncOutcome::CredentialExpired,
            "credential_expired",
            1,
        ),
        (
            "cli_missing",
            Some(ForgeIssueError::CliMissing),
            IssueSyncOutcome::CacheFailed,
            "cli_missing",
            1,
        ),
        (
            "ready",
            Some(ForgeIssueError::Unparseable),
            IssueSyncOutcome::CacheFailed,
            "cache_failed",
            1,
        ),
        (
            "ready",
            Some(ForgeIssueError::CliMissing),
            IssueSyncOutcome::CacheFailed,
            "cli_missing",
            1,
        ),
        (
            "ready",
            Some(ForgeIssueError::Offline),
            IssueSyncOutcome::CacheFailed,
            "offline",
            1,
        ),
        (
            "ready",
            Some(ForgeIssueError::RateLimited),
            IssueSyncOutcome::CacheFailed,
            "rate_limited",
            1,
        ),
        (
            "ready",
            Some(ForgeIssueError::CommandFailed),
            IssueSyncOutcome::CacheFailed,
            "cache_failed",
            1,
        ),
    ];
    for (auth, error, outcome, code, calls) in cases {
        let harness = ready_gitlab_project("all_open", None);
        seed_remote_issue(
            &harness.connection,
            harness.project_id,
            "backlog",
            "issue-4",
            4,
            "open",
            false,
        );
        if auth != "ready" {
            set_auth(&harness.connection, harness.project_id, "gitlab", auth);
        }
        let before = issue_row_count(&harness.connection, harness.project_id);
        let forge = match error {
            Some(error) => FixedForge::failing(error),
            None => FixedForge::new(vec![remote_issue(8, RemoteIssueState::Open, "New")]),
        };
        let result = sync_project_issues(&harness.connection, harness.project_id, &forge, 5_000)
            .expect("sync");
        assert_eq!(result.outcome, outcome, "{auth} {code}");
        assert_eq!(forge.calls().len(), calls, "{auth} {code}");
        assert_eq!(
            issue_row_count(&harness.connection, harness.project_id),
            before,
            "{auth} {code}"
        );
        assert_eq!(
            last_sync_error(&harness.connection, harness.project_id).as_deref(),
            Some(code),
            "{auth} {code}"
        );
    }
}

#[test]
fn gitlab_external_id_and_number_do_not_create_a_second_issue() {
    let harness = ready_gitlab_project("all_open", None);
    let mut first = remote_issue(7, RemoteIssueState::Open, "Once");
    first.external_id = "gid-7".to_string();
    sync_project_issues(
        &harness.connection,
        harness.project_id,
        &FixedForge::new(vec![first]),
        5_000,
    )
    .expect("first");
    let mut same_id = remote_issue(8, RemoteIssueState::Open, "Retitled");
    same_id.external_id = "gid-7".to_string();
    sync_project_issues(
        &harness.connection,
        harness.project_id,
        &FixedForge::new(vec![same_id]),
        6_000,
    )
    .expect("same id");
    assert_eq!(issue_row_count(&harness.connection, harness.project_id), 1);
    assert_eq!(
        list_board_issues(&harness.connection, harness.project_id).expect("list")[0].title,
        "Retitled"
    );

    let harness = ready_gitlab_project("all_open", None);
    let mut by_number = remote_issue(7, RemoteIssueState::Open, "Number");
    by_number.external_id = "gid-a".to_string();
    sync_project_issues(
        &harness.connection,
        harness.project_id,
        &FixedForge::new(vec![by_number]),
        5_000,
    )
    .expect("number");
    let mut same_number = remote_issue(7, RemoteIssueState::Open, "Same number");
    same_number.external_id = "gid-b".to_string();
    sync_project_issues(
        &harness.connection,
        harness.project_id,
        &FixedForge::new(vec![same_number]),
        6_000,
    )
    .expect("same number");
    assert_eq!(issue_row_count(&harness.connection, harness.project_id), 1);
    assert_eq!(
        list_board_issues(&harness.connection, harness.project_id).expect("list")[0].title,
        "Same number"
    );
}

#[test]
fn self_hosted_gitlab_host_is_stored_as_the_lowercase_hostname() {
    let harness = ready_gitlab_project("all_open", None);
    harness
        .connection
        .execute(
            "UPDATE project_forge_connections
             SET host_url = 'https://GitLab.Example.com/group/redwhisk.git'
             WHERE project_id = ?1",
            params![harness.project_id],
        )
        .expect("host");
    sync_project_issues(
        &harness.connection,
        harness.project_id,
        &FixedForge::new(vec![remote_issue(7, RemoteIssueState::Open, "Host")]),
        5_000,
    )
    .expect("sync");
    let host: String = harness
        .connection
        .query_row(
            "SELECT host FROM issue_external_refs WHERE project_id = ?1",
            params![harness.project_id],
            |row| row.get(0),
        )
        .expect("host");
    assert_eq!(host, "gitlab.example.com");
}

#[test]
fn non_forge_connection_does_not_import_a_gitlab_provider() {
    let harness = ready_github_project("all_open", None);
    harness
        .connection
        .execute(
            "UPDATE project_forge_connections
             SET provider = NULL, auth_status = 'ready'
             WHERE project_id = ?1",
            params![harness.project_id],
        )
        .expect("clear provider");
    let forge = FixedForge::new(vec![remote_issue(3, RemoteIssueState::Open, "Nope")]);
    let result =
        sync_project_issues(&harness.connection, harness.project_id, &forge, 5_000).expect("sync");
    assert_eq!(result.outcome, IssueSyncOutcome::CacheFailed);
    assert!(forge.calls().is_empty());
    assert_eq!(issue_row_count(&harness.connection, harness.project_id), 0);
    let gitlab_rows: i64 = harness
        .connection
        .query_row(
            "SELECT COUNT(*) FROM issue_external_refs WHERE provider = 'gitlab'",
            [],
            |row| row.get(0),
        )
        .expect("refs");
    assert_eq!(gitlab_rows, 0);
}

#[test]
fn gitlab_watermark_keeps_the_success_instant_and_drops_the_same_morning() {
    let success_at = utc_millis("2026-11-05T12:00:00Z");
    let morning = utc_millis("2026-11-05T09:00:00Z");
    let harness = ready_gitlab_project("all_open", None);
    harness
        .connection
        .execute(
            "UPDATE projects SET last_issue_synced_at = ?1 WHERE id = ?2",
            params![success_at, harness.project_id],
        )
        .expect("clock");
    let mut early = remote_issue(9, RemoteIssueState::Open, "morning");
    early.updated_at = morning;
    let mut noon = remote_issue(12, RemoteIssueState::Open, "noon");
    noon.updated_at = success_at;
    let forge = WatermarkForge::new(vec![early, noon]);
    sync_project_issues(&harness.connection, harness.project_id, &forge, success_at).expect("sync");
    let query = forge.calls()[0].clone();
    assert_eq!(query.updated_after, Some(success_at));
    assert_eq!(query.limit, 200);
    assert_eq!(forge.calls().len(), 1);
    let args = gitlab_issue_list_args(&query);
    assert_eq!(arg_value(&args, "--per-page"), Some("200"));
    assert_eq!(
        arg_value(&args, "--updated-after"),
        Some("2026-11-05T12:00:00Z")
    );
    assert!(args
        .windows(2)
        .any(|pair| pair[0] == "--output" && pair[1] == "json"));
    assert!(args
        .windows(2)
        .any(|pair| pair[0] == "--order" && pair[1] == "updated_at"));
    assert!(args
        .windows(2)
        .any(|pair| pair[0] == "--sort" && pair[1] == "desc"));
    assert!(!args.windows(2).any(|pair| pair[0] == "-F"));
    assert!(!args.iter().any(|arg| arg.contains("gitlab.com")));
    let numbers: Vec<i64> = list_board_issues(&harness.connection, harness.project_id)
        .expect("list")
        .into_iter()
        .filter_map(|issue| issue.external_number)
        .collect();
    assert_eq!(numbers, vec![12]);
}

#[test]
fn earlier_same_day_issue_does_not_spend_a_one_item_limit() {
    let noon = utc_millis("2026-11-05T12:00:00Z");
    let mut early = remote_issue(9, RemoteIssueState::Open, "morning");
    early.updated_at = utc_millis("2026-11-05T09:00:00Z");
    let mut on_time = remote_issue(12, RemoteIssueState::Open, "noon");
    on_time.updated_at = noon;
    let kept = retain_issues_since(vec![early, on_time], Some(noon), 1);
    assert_eq!(kept.len(), 1);
    assert_eq!(kept[0].number, 12);
}

fn arg_value<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.windows(2)
        .find(|pair| pair[0] == name)
        .map(|pair| pair[1].as_str())
}

struct WatermarkForge {
    issues: Vec<RemoteIssue>,
    calls: Mutex<Vec<ForgeIssueListQuery>>,
}

impl WatermarkForge {
    fn new(issues: Vec<RemoteIssue>) -> Self {
        Self {
            issues,
            calls: Mutex::new(Vec::new()),
        }
    }

    fn calls(&self) -> Vec<ForgeIssueListQuery> {
        self.calls.lock().expect("calls").clone()
    }
}

impl ForgeIssuePort for WatermarkForge {
    fn list_issues(
        &self,
        query: &ForgeIssueListQuery,
    ) -> Result<Vec<RemoteIssue>, ForgeIssueError> {
        self.calls.lock().expect("calls").push(query.clone());
        Ok(retain_issues_since(
            self.issues.clone(),
            query.updated_after,
            query.limit,
        ))
    }
}

fn utc_millis(value: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(value)
        .expect("rfc3339")
        .timestamp_millis()
}
