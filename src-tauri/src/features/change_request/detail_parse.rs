use crate::features::issue::{ForgeIssueError, RemoteChangeRequestDetails};
use crate::types::change_request::{
    ChangeRequestCheckRun, ChangeRequestDiscussionItem, ChangeRequestFileChange,
    ChangeRequestReviewer,
};

const TOO_LARGE_PATCH: usize = 100_000;

pub(crate) fn parse_github_change_request_details(
    stdout: &str,
) -> Result<RemoteChangeRequestDetails, ForgeIssueError> {
    let value = parse_object(stdout)?;
    Ok(RemoteChangeRequestDetails {
        title: text(&value, "title"),
        body: text(&value, "body"),
        state: github_state(&value),
        url: text(&value, "url"),
        author_login: pointer_text(&value, "/author/login"),
        source_branch: text(&value, "headRefName"),
        target_branch: text(&value, "baseRefName"),
        commit_count: count_field(&value, "commits"),
        additions: int_field(&value, "additions"),
        deletions: int_field(&value, "deletions"),
        labels: labels(&value),
        reviewers: github_reviewers(&value),
        mergeable: optional_text(&value, "mergeable"),
        merge_state_status: optional_text(&value, "mergeStateStatus"),
        review_decision: optional_text(&value, "reviewDecision"),
        blocking_reasons: blocking_reasons(&value),
        merge_method: optional_text(&value, "mergeMethod"),
        merge_commit_sha: merge_commit_sha(&value),
        source_branch_deleted: source_branch_deleted(&value),
        files: files(&value),
        checks: checks(&value),
        reviews: discussions(&value, "reviews", "review"),
        comments: discussions(&value, "comments", "comment"),
    })
}

pub(crate) fn parse_gitlab_change_request_details(
    stdout: &str,
) -> Result<RemoteChangeRequestDetails, ForgeIssueError> {
    let value = parse_object(stdout)?;
    Ok(RemoteChangeRequestDetails {
        title: text(&value, "title"),
        body: text(&value, "description"),
        state: gitlab_state(&value),
        url: first_text(&value, &["web_url", "url"]).unwrap_or_default(),
        author_login: pointer_text(&value, "/author/username")
            .or_else(|| pointer_text(&value, "/author/login")),
        source_branch: text(&value, "source_branch"),
        target_branch: text(&value, "target_branch"),
        commit_count: int_field(&value, "commits_count").or_else(|| count_field(&value, "commits")),
        additions: int_field(&value, "additions").or_else(|| {
            value
                .pointer("/diff_stats/additions")
                .and_then(serde_json::Value::as_i64)
        }),
        deletions: int_field(&value, "deletions").or_else(|| {
            value
                .pointer("/diff_stats/deletions")
                .and_then(serde_json::Value::as_i64)
        }),
        labels: labels(&value),
        reviewers: gitlab_reviewers(&value),
        // 可合并字面量只认 detailed_merge_status。merge_status 已废弃，不能写入 mergeable。
        mergeable: optional_text(&value, "detailed_merge_status")
            .or_else(|| optional_text(&value, "mergeable")),
        merge_state_status: optional_text(&value, "detailed_merge_status")
            .or_else(|| optional_text(&value, "mergeStateStatus")),
        review_decision: optional_text(&value, "reviewDecision"),
        blocking_reasons: blocking_reasons(&value),
        merge_method: optional_text(&value, "merge_method")
            .or_else(|| optional_text(&value, "mergeMethod")),
        merge_commit_sha: optional_text(&value, "merge_commit_sha")
            .or_else(|| merge_commit_sha(&value)),
        source_branch_deleted: source_branch_deleted(&value),
        files: files(&value),
        checks: checks(&value),
        reviews: discussions(&value, "reviews", "review"),
        comments: {
            let notes = discussions(&value, "notes", "comment");
            if notes.is_empty() {
                discussions(&value, "comments", "comment")
            } else {
                notes
            }
        },
    })
}

fn parse_object(stdout: &str) -> Result<serde_json::Value, ForgeIssueError> {
    let value: serde_json::Value =
        serde_json::from_str(stdout.trim()).map_err(|_| ForgeIssueError::Unparseable)?;
    if value.is_object() {
        Ok(value)
    } else {
        Err(ForgeIssueError::Unparseable)
    }
}

fn github_state(value: &serde_json::Value) -> String {
    let state = text(value, "state").to_ascii_lowercase();
    if state == "merged" || optional_text(value, "mergedAt").is_some() {
        "merged".to_string()
    } else if state == "closed" {
        "closed".to_string()
    } else if value
        .get("isDraft")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
    {
        "draft".to_string()
    } else {
        "open".to_string()
    }
}

fn gitlab_state(value: &serde_json::Value) -> String {
    let state = text(value, "state").to_ascii_lowercase();
    if state == "merged" || optional_text(value, "merged_at").is_some() {
        "merged".to_string()
    } else if state == "closed" {
        "closed".to_string()
    } else if value
        .get("draft")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
    {
        "draft".to_string()
    } else {
        "open".to_string()
    }
}

fn files(value: &serde_json::Value) -> Vec<ChangeRequestFileChange> {
    let Some(serde_json::Value::Array(items)) = value.get("files") else {
        return Vec::new();
    };
    items.iter().filter_map(parse_file).collect()
}

fn parse_file(value: &serde_json::Value) -> Option<ChangeRequestFileChange> {
    let path = first_text(value, &["path", "filename"])?;
    if path.is_empty() {
        return None;
    }
    let patch = first_text(value, &["patch", "diff"]);
    let binary = value
        .get("binary")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    let patch_status = optional_text(value, "patchStatus")
        .or_else(|| optional_text(value, "patch_status"))
        .unwrap_or_else(|| infer_patch_status(patch.as_deref(), binary).to_string());
    Some(ChangeRequestFileChange {
        path,
        additions: int_field(value, "additions").unwrap_or(0),
        deletions: int_field(value, "deletions").unwrap_or(0),
        patch: if patch_status == "ready" { patch } else { None },
        patch_status,
    })
}

fn infer_patch_status(patch: Option<&str>, binary: bool) -> &'static str {
    if binary {
        "binary"
    } else if patch.is_none() {
        "missing"
    } else if patch.map(str::len).unwrap_or(0) > TOO_LARGE_PATCH {
        "too_large"
    } else {
        "ready"
    }
}

fn checks(value: &serde_json::Value) -> Vec<ChangeRequestCheckRun> {
    let items = value
        .get("checks")
        .or_else(|| value.get("statusCheckRollup"))
        .or_else(|| value.get("pipelines"));
    let Some(serde_json::Value::Array(items)) = items else {
        return Vec::new();
    };
    items.iter().filter_map(parse_check).collect()
}

fn parse_check(value: &serde_json::Value) -> Option<ChangeRequestCheckRun> {
    let name = first_text(value, &["name", "context"])?;
    if name.is_empty() {
        return None;
    }
    Some(ChangeRequestCheckRun {
        name,
        status: normalize_check_status(
            first_text(value, &["status", "state", "bucket"]).as_deref(),
        ),
        duration_ms: int_field(value, "durationMs").or_else(|| int_field(value, "duration_ms")),
        log_url: first_text(
            value,
            &["logUrl", "log_url", "link", "detailsUrl", "details_url"],
        ),
    })
}

fn normalize_check_status(status: Option<&str>) -> String {
    match status.unwrap_or("").to_ascii_lowercase().as_str() {
        "fail" | "failed" | "failure" | "error" | "cancelled" | "timed_out" => "failed".to_string(),
        "pending" | "queued" | "in_progress" | "running" | "expected" | "waiting" => {
            "pending".to_string()
        }
        "pass" | "passed" | "success" | "skip" | "skipping" | "neutral" | "completed" => {
            "passed".to_string()
        }
        other if other.is_empty() => "pending".to_string(),
        other => other.to_string(),
    }
}

fn discussions(
    value: &serde_json::Value,
    field: &str,
    kind: &str,
) -> Vec<ChangeRequestDiscussionItem> {
    let Some(serde_json::Value::Array(items)) = value.get(field) else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| parse_discussion(item, kind))
        .collect()
}

fn parse_discussion(value: &serde_json::Value, kind: &str) -> Option<ChangeRequestDiscussionItem> {
    let author = pointer_text(value, "/author/login")
        .or_else(|| pointer_text(value, "/author/username"))
        .or_else(|| optional_text(value, "author"))?;
    Some(ChangeRequestDiscussionItem {
        author,
        kind: optional_text(value, "kind").unwrap_or_else(|| kind.to_string()),
        body: text(value, "body"),
        created_at: timestamp(
            value,
            &["createdAt", "created_at", "submittedAt", "submitted_at"],
        ),
        state: optional_text(value, "state"),
    })
}

fn labels(value: &serde_json::Value) -> Vec<String> {
    let Some(serde_json::Value::Array(items)) = value.get("labels") else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| match item {
            serde_json::Value::String(name) => Some(name.clone()),
            serde_json::Value::Object(_) => item
                .get("name")
                .or_else(|| item.get("title"))
                .and_then(serde_json::Value::as_str)
                .map(str::to_string),
            _ => None,
        })
        .collect()
}

fn github_reviewers(value: &serde_json::Value) -> Vec<ChangeRequestReviewer> {
    let mut reviewers = named_reviewers(value.get("reviewers"));
    if reviewers.is_empty() {
        reviewers = named_reviewers(value.get("reviewRequests"));
    }
    reviewers
}

fn gitlab_reviewers(value: &serde_json::Value) -> Vec<ChangeRequestReviewer> {
    named_reviewers(value.get("reviewers"))
}

fn named_reviewers(value: Option<&serde_json::Value>) -> Vec<ChangeRequestReviewer> {
    let Some(serde_json::Value::Array(items)) = value else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let login = pointer_text(item, "/login")
                .or_else(|| pointer_text(item, "/username"))
                .or_else(|| pointer_text(item, "/requestedReviewer/login"))
                .or_else(|| optional_text(item, "login"))?;
            Some(ChangeRequestReviewer {
                login,
                state: optional_text(item, "state"),
            })
        })
        .collect()
}

fn blocking_reasons(value: &serde_json::Value) -> Vec<String> {
    for field in ["blockingReasons", "blocking_reasons", "merge_errors"] {
        if let Some(serde_json::Value::Array(items)) = value.get(field) {
            let reasons: Vec<String> = items
                .iter()
                .filter_map(serde_json::Value::as_str)
                .filter(|reason| !reason.is_empty())
                .map(str::to_string)
                .collect();
            if !reasons.is_empty() {
                return reasons;
            }
        }
        if let Some(reason) = optional_text(value, field) {
            return vec![reason];
        }
    }
    Vec::new()
}

fn merge_commit_sha(value: &serde_json::Value) -> Option<String> {
    pointer_text(value, "/mergeCommit/oid")
        .or_else(|| optional_text(value, "mergeCommitOid"))
        .or_else(|| optional_text(value, "merge_commit_sha"))
}

fn count_field(value: &serde_json::Value, field: &str) -> Option<i64> {
    match value.get(field) {
        Some(serde_json::Value::Array(items)) => Some(items.len() as i64),
        Some(serde_json::Value::Number(number)) => number.as_i64(),
        _ => None,
    }
}

fn int_field(value: &serde_json::Value, field: &str) -> Option<i64> {
    value.get(field).and_then(serde_json::Value::as_i64)
}

fn text(value: &serde_json::Value, field: &str) -> String {
    optional_text(value, field).unwrap_or_default()
}

fn optional_text(value: &serde_json::Value, field: &str) -> Option<String> {
    value
        .get(field)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn source_branch_deleted(value: &serde_json::Value) -> Option<bool> {
    for field in ["sourceBranchDeleted", "source_branch_deleted"] {
        if let Some(flag) = value.get(field).and_then(serde_json::Value::as_bool) {
            return Some(flag);
        }
    }
    None
}

fn first_text(value: &serde_json::Value, fields: &[&str]) -> Option<String> {
    fields.iter().find_map(|field| optional_text(value, field))
}

fn pointer_text(value: &serde_json::Value, pointer: &str) -> Option<String> {
    value
        .pointer(pointer)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn timestamp(value: &serde_json::Value, fields: &[&str]) -> i64 {
    for field in fields {
        match value.get(*field) {
            Some(serde_json::Value::Number(number)) => return number.as_i64().unwrap_or(0),
            Some(serde_json::Value::String(text)) => {
                if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(text) {
                    return parsed.timestamp_millis();
                }
            }
            _ => {}
        }
    }
    0
}
