use std::path::Path;

use crate::features::issue::{capture_forge_stdout, ForgeIssueError, RemoteChangeRequestDetails};

use super::detail_parse::{
    parse_github_change_request_details, parse_gitlab_change_request_details,
};

pub(crate) fn fetch_github_change_request_details(
    repo_dir: &Path,
    number: i64,
) -> Result<RemoteChangeRequestDetails, ForgeIssueError> {
    let view = capture_forge_stdout("gh", &github_view_args(number), repo_dir)?;
    let mut value: serde_json::Value =
        serde_json::from_str(view.trim()).map_err(|_| ForgeIssueError::Unparseable)?;
    if let Ok(checks) = capture_forge_stdout("gh", &github_checks_args(number), repo_dir) {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(checks.trim()) {
            if let Some(object) = value.as_object_mut() {
                object.entry("checks".to_string()).or_insert(parsed);
            }
        }
    }
    if let Ok(diff) = capture_forge_stdout("gh", &github_diff_args(number), repo_dir) {
        attach_diff_patches(&mut value, &diff);
    }
    parse_github_change_request_details(&value.to_string())
}

pub(crate) fn fetch_gitlab_change_request_details(
    repo_dir: &Path,
    number: i64,
) -> Result<RemoteChangeRequestDetails, ForgeIssueError> {
    let view = capture_forge_stdout("glab", &gitlab_view_args(number), repo_dir)?;
    let mut value: serde_json::Value =
        serde_json::from_str(view.trim()).map_err(|_| ForgeIssueError::Unparseable)?;
    if let Ok(diff) = capture_forge_stdout("glab", &gitlab_diff_args(number), repo_dir) {
        attach_diff_patches(&mut value, &diff);
    }
    parse_gitlab_change_request_details(&value.to_string())
}

fn github_view_args(number: i64) -> Vec<String> {
    vec![
        "pr".to_string(),
        "view".to_string(),
        number.to_string(),
        "--json".to_string(),
        "number,title,body,state,isDraft,url,author,commits,files,additions,deletions,reviewRequests,reviews,comments,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,labels,headRefName,baseRefName,mergeCommit,latestReviews".to_string(),
    ]
}

fn github_checks_args(number: i64) -> Vec<String> {
    vec![
        "pr".to_string(),
        "checks".to_string(),
        number.to_string(),
        "--json".to_string(),
        "name,state,bucket,startedAt,completedAt,link".to_string(),
    ]
}

fn github_diff_args(number: i64) -> Vec<String> {
    vec!["pr".to_string(), "diff".to_string(), number.to_string()]
}

fn gitlab_view_args(number: i64) -> Vec<String> {
    vec![
        "mr".to_string(),
        "view".to_string(),
        number.to_string(),
        "-F".to_string(),
        "json".to_string(),
    ]
}

fn gitlab_diff_args(number: i64) -> Vec<String> {
    vec!["mr".to_string(), "diff".to_string(), number.to_string()]
}

fn attach_diff_patches(value: &mut serde_json::Value, diff: &str) {
    let patches = split_patches(diff);
    let Some(files) = value
        .get_mut("files")
        .and_then(|files| files.as_array_mut())
    else {
        if !patches.is_empty() {
            value["files"] = serde_json::Value::Array(
                patches
                    .into_iter()
                    .map(|(path, patch)| {
                        serde_json::json!({
                            "path": path,
                            "patch": patch,
                            "additions": 0,
                            "deletions": 0,
                        })
                    })
                    .collect(),
            );
        }
        return;
    };
    for file in files {
        let Some(path) = file
            .get("path")
            .or_else(|| file.get("filename"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
        else {
            continue;
        };
        if let Some(patch) = patches.get(&path) {
            if let Some(object) = file.as_object_mut() {
                object
                    .entry("patch".to_string())
                    .or_insert(serde_json::Value::String(patch.clone()));
            }
        }
    }
}

fn split_patches(diff: &str) -> std::collections::BTreeMap<String, String> {
    let mut patches = std::collections::BTreeMap::new();
    let mut current_path: Option<String> = None;
    let mut current = String::new();
    for line in diff.lines() {
        if let Some(path) = diff_path(line) {
            if let Some(previous) = current_path.take() {
                patches.insert(previous, current);
                current = String::new();
            }
            current_path = Some(path);
        }
        if current_path.is_some() {
            current.push_str(line);
            current.push('\n');
        }
    }
    if let Some(previous) = current_path {
        patches.insert(previous, current);
    }
    patches
}

fn diff_path(line: &str) -> Option<String> {
    if let Some(rest) = line.strip_prefix("diff --git a/") {
        let path = rest.split(" b/").next().unwrap_or(rest).trim();
        if path.is_empty() {
            None
        } else {
            Some(path.to_string())
        }
    } else if let Some(rest) = line.strip_prefix("+++ b/") {
        let path = rest.trim();
        if path.is_empty() || path == "/dev/null" {
            None
        } else {
            Some(path.to_string())
        }
    } else {
        None
    }
}
