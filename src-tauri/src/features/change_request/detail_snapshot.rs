use rusqlite::{params, Connection};

use crate::features::issue::RemoteChangeRequestDetails;
use crate::types::change_request::{
    ChangeRequestCheckRun, ChangeRequestDetail, ChangeRequestFileChange, ChangeRequestLinkedIssue,
    ChangeRequestReviewer,
};
use crate::types::errors::CommandError;

use super::list::query_failed;

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotMeta {
    #[serde(default)]
    files: Vec<ChangeRequestFileChange>,
    #[serde(default)]
    labels: Vec<String>,
    #[serde(default)]
    commit_count: Option<i64>,
    #[serde(default)]
    additions: Option<i64>,
    #[serde(default)]
    deletions: Option<i64>,
    #[serde(default)]
    blocking_reasons: Vec<String>,
    #[serde(default)]
    reviewers: Vec<ChangeRequestReviewer>,
    #[serde(default)]
    merge_method: Option<String>,
    #[serde(default)]
    merge_commit_sha: Option<String>,
    #[serde(default)]
    source_branch_deleted: Option<bool>,
}

#[derive(Debug, Clone)]
pub(super) struct StoredRow {
    pub id: i64,
    pub provider: String,
    pub number: i64,
    pub title: String,
    pub url: String,
    pub state: String,
    pub body: String,
    pub author_login: Option<String>,
    pub source_branch: String,
    pub target_branch: String,
    pub mergeable: Option<String>,
    pub merge_state_status: Option<String>,
    pub review_decision: Option<String>,
    pub detail_synced_at: Option<i64>,
}

#[derive(Debug, Clone)]
pub(super) struct StoredSnapshot {
    pub files_json: String,
    pub checks_json: String,
    pub reviews_json: String,
    pub comments_json: String,
}

pub(super) fn load_row(
    connection: &Connection,
    project_id: i64,
    provider: &str,
    number: i64,
) -> Result<Option<StoredRow>, CommandError> {
    connection
        .query_row(
            "SELECT id, provider, number, title, url, state, body, author_login, source_branch,
                    target_branch, mergeable, merge_state_status, review_decision, detail_synced_at
             FROM change_requests
             WHERE project_id = ?1 AND provider = ?2 AND number = ?3",
            params![project_id, provider, number],
            |row| {
                Ok(StoredRow {
                    id: row.get(0)?,
                    provider: row.get(1)?,
                    number: row.get(2)?,
                    title: row.get(3)?,
                    url: row.get(4)?,
                    state: row.get(5)?,
                    body: row.get(6)?,
                    author_login: row.get(7)?,
                    source_branch: row.get(8)?,
                    target_branch: row.get(9)?,
                    mergeable: row.get(10)?,
                    merge_state_status: row.get(11)?,
                    review_decision: row.get(12)?,
                    detail_synced_at: row.get(13)?,
                })
            },
        )
        .optional_row()
}

pub(super) fn load_snapshot(
    connection: &Connection,
    change_request_id: i64,
) -> Result<StoredSnapshot, CommandError> {
    connection
        .query_row(
            "SELECT files_json, checks_json, reviews_json, comments_json
             FROM change_request_details
             WHERE change_request_id = ?1",
            params![change_request_id],
            |row| {
                Ok(StoredSnapshot {
                    files_json: row.get(0)?,
                    checks_json: row.get(1)?,
                    reviews_json: row.get(2)?,
                    comments_json: row.get(3)?,
                })
            },
        )
        .optional_row()
        .map(|snapshot| {
            snapshot.unwrap_or(StoredSnapshot {
                files_json: "[]".to_string(),
                checks_json: "[]".to_string(),
                reviews_json: "[]".to_string(),
                comments_json: "[]".to_string(),
            })
        })
}

pub(super) fn has_snapshot(row: &StoredRow, snapshot: &StoredSnapshot) -> bool {
    row.detail_synced_at.is_some() || snapshot.files_json.trim_start().starts_with('{')
}

pub(super) fn write_fresh_snapshot(
    connection: &Connection,
    row_id: i64,
    details: &RemoteChangeRequestDetails,
    now_ms: i64,
) -> Result<(), CommandError> {
    let meta = SnapshotMeta {
        files: details.files.clone(),
        labels: details.labels.clone(),
        commit_count: details.commit_count,
        additions: details.additions,
        deletions: details.deletions,
        blocking_reasons: details.blocking_reasons.clone(),
        reviewers: details.reviewers.clone(),
        merge_method: details.merge_method.clone(),
        merge_commit_sha: details.merge_commit_sha.clone(),
        source_branch_deleted: details.source_branch_deleted,
    };
    let files_json = serde_json::to_string(&meta).map_err(json_failed)?;
    let checks_json = serde_json::to_string(&details.checks).map_err(json_failed)?;
    let reviews_json = serde_json::to_string(&details.reviews).map_err(json_failed)?;
    let comments_json = serde_json::to_string(&details.comments).map_err(json_failed)?;
    let reviewers_json = serde_json::to_string(&details.reviewers).map_err(json_failed)?;
    let (ok, failed, pending) = check_counts(&details.checks);
    connection
        .execute(
            "UPDATE change_requests
             SET title = ?1, body = ?2, state = ?3, url = ?4, author_login = ?5,
                 source_branch = ?6, target_branch = ?7, mergeable = ?8,
                 merge_state_status = ?9, review_decision = ?10,
                 requested_reviewers_json = ?11, checks_ok = ?12, checks_failed = ?13,
                 checks_pending = ?14, detail_synced_at = ?15
             WHERE id = ?16",
            params![
                details.title,
                details.body,
                details.state,
                details.url,
                details.author_login,
                details.source_branch,
                details.target_branch,
                details.mergeable,
                details.merge_state_status,
                details.review_decision,
                reviewers_json,
                ok,
                failed,
                pending,
                now_ms,
                row_id,
            ],
        )
        .map_err(query_failed)?;
    let updated = connection
        .execute(
            "UPDATE change_request_details
             SET files_json = ?1, checks_json = ?2, reviews_json = ?3, comments_json = ?4,
                 fetched_at = ?5
             WHERE change_request_id = ?6",
            params![
                files_json,
                checks_json,
                reviews_json,
                comments_json,
                now_ms,
                row_id
            ],
        )
        .map_err(query_failed)?;
    if updated == 0 {
        connection
            .execute(
                "INSERT INTO change_request_details (
                    change_request_id, files_json, checks_json, reviews_json, comments_json, fetched_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    row_id,
                    files_json,
                    checks_json,
                    reviews_json,
                    comments_json,
                    now_ms
                ],
            )
            .map_err(query_failed)?;
    }
    Ok(())
}

pub(super) fn detail_from_snapshot(
    row: StoredRow,
    snapshot: StoredSnapshot,
    linked_issues: Vec<ChangeRequestLinkedIssue>,
    detail_status: &str,
    detail_error: Option<String>,
) -> ChangeRequestDetail {
    let meta = parse_meta(&snapshot.files_json);
    ChangeRequestDetail {
        id: row.id,
        provider: row.provider,
        number: row.number,
        title: row.title,
        url: row.url,
        state: row.state,
        body: row.body,
        author_login: row.author_login,
        source_branch: row.source_branch,
        target_branch: row.target_branch,
        commit_count: meta.commit_count,
        additions: meta.additions,
        deletions: meta.deletions,
        labels: meta.labels,
        reviewers: meta.reviewers,
        mergeable: row.mergeable,
        merge_state_status: row.merge_state_status,
        review_decision: row.review_decision,
        blocking_reasons: meta.blocking_reasons,
        merge_method: meta.merge_method,
        merge_commit_sha: meta.merge_commit_sha,
        detail_status: detail_status.to_string(),
        detail_error,
        files: meta.files,
        checks: parse_vec(&snapshot.checks_json),
        reviews: parse_vec(&snapshot.reviews_json),
        comments: parse_vec(&snapshot.comments_json),
        linked_issues,
        ready_supported: false,
        review_supported: false,
        supported_merge_methods: Vec::new(),
        source_branch_deleted: meta.source_branch_deleted,
    }
}

pub(super) fn detail_from_fresh(
    row: StoredRow,
    details: RemoteChangeRequestDetails,
    linked_issues: Vec<ChangeRequestLinkedIssue>,
) -> ChangeRequestDetail {
    ChangeRequestDetail {
        id: row.id,
        provider: row.provider,
        number: row.number,
        title: details.title,
        url: details.url,
        state: details.state,
        body: details.body,
        author_login: details.author_login,
        source_branch: details.source_branch,
        target_branch: details.target_branch,
        commit_count: details.commit_count,
        additions: details.additions,
        deletions: details.deletions,
        labels: details.labels,
        reviewers: details.reviewers,
        mergeable: details.mergeable,
        merge_state_status: details.merge_state_status,
        review_decision: details.review_decision,
        blocking_reasons: details.blocking_reasons,
        merge_method: details.merge_method,
        merge_commit_sha: details.merge_commit_sha,
        detail_status: "fresh".to_string(),
        detail_error: None,
        files: details.files,
        checks: details.checks,
        reviews: details.reviews,
        comments: details.comments,
        linked_issues,
        ready_supported: false,
        review_supported: false,
        supported_merge_methods: Vec::new(),
        source_branch_deleted: details.source_branch_deleted,
    }
}

pub(super) fn unavailable_detail(
    row: StoredRow,
    linked_issues: Vec<ChangeRequestLinkedIssue>,
    detail_error: String,
) -> ChangeRequestDetail {
    ChangeRequestDetail {
        id: row.id,
        provider: row.provider,
        number: row.number,
        title: row.title,
        url: row.url,
        state: row.state,
        body: row.body,
        author_login: row.author_login,
        source_branch: row.source_branch,
        target_branch: row.target_branch,
        commit_count: None,
        additions: None,
        deletions: None,
        labels: Vec::new(),
        reviewers: Vec::new(),
        mergeable: row.mergeable,
        merge_state_status: row.merge_state_status,
        review_decision: row.review_decision,
        blocking_reasons: Vec::new(),
        merge_method: None,
        merge_commit_sha: None,
        detail_status: "unavailable".to_string(),
        detail_error: Some(detail_error),
        files: Vec::new(),
        checks: Vec::new(),
        reviews: Vec::new(),
        comments: Vec::new(),
        linked_issues,
        ready_supported: false,
        review_supported: false,
        supported_merge_methods: Vec::new(),
        source_branch_deleted: None,
    }
}

fn parse_meta(files_json: &str) -> SnapshotMeta {
    serde_json::from_str(files_json).unwrap_or_default()
}

fn parse_vec<T: serde::de::DeserializeOwned>(json: &str) -> Vec<T> {
    serde_json::from_str(json).unwrap_or_default()
}

fn check_counts(checks: &[ChangeRequestCheckRun]) -> (i64, i64, i64) {
    let mut ok = 0;
    let mut failed = 0;
    let mut pending = 0;
    for check in checks {
        match check.status.as_str() {
            "failed" => failed += 1,
            "pending" => pending += 1,
            "passed" => ok += 1,
            _ => {}
        }
    }
    (ok, failed, pending)
}

fn json_failed(_: serde_json::Error) -> CommandError {
    query_failed(rusqlite::Error::InvalidQuery)
}

trait OptionalRow<T> {
    fn optional_row(self) -> Result<Option<T>, CommandError>;
}

impl<T> OptionalRow<T> for Result<T, rusqlite::Error> {
    fn optional_row(self) -> Result<Option<T>, CommandError> {
        match self {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(query_failed(error)),
        }
    }
}
