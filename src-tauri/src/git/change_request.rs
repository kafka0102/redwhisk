//! 推送当前分支并用 gh / glab 创建草稿 PR 或 MR。

use std::io::Write;
use std::path::Path;
use std::process::Command;

use super::command::{apply_interactive_path, run_git};
use super::forge::ForgeHost;

pub use super::forge::repo_default_branch;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChangeRequestInput<'a> {
    pub repo_path: &'a Path,
    pub host: ForgeHost,
    pub head: &'a str,
    pub base: &'a str,
    pub title: &'a str,
    pub body: &'a str,
    pub draft: bool,
}

pub fn publish_change_request(input: ChangeRequestInput<'_>) -> Result<String, String> {
    run_git(input.repo_path, &["push", "-u", "origin", "HEAD"])
        .map_err(|error| error.to_string())?;
    if let Some(url) = find_open_change_request(input.repo_path, input.host, input.head) {
        return Ok(url);
    }
    match input.host {
        ForgeHost::Github => gh_create(input),
        ForgeHost::Gitlab => glab_create(input),
        ForgeHost::None => Err("GitHub or GitLab remote was not recognized.".to_string()),
    }
}

pub fn current_branch_name(repo_path: &Path) -> Option<String> {
    let name = run_git(repo_path, &["rev-parse", "--abbrev-ref", "HEAD"]).ok()?;
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed == "HEAD" {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub fn local_branch_names(repo_path: &Path) -> Vec<String> {
    let Ok(output) = run_git(
        repo_path,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    ) else {
        return Vec::new();
    };
    output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

pub fn suggested_change_request_text(repo_path: &Path) -> (String, String) {
    let title = run_git(repo_path, &["log", "-1", "--pretty=%s"]).unwrap_or_default();
    let body = run_git(repo_path, &["log", "-1", "--pretty=%b"]).unwrap_or_default();
    (title.trim().to_string(), body.trim().to_string())
}

pub fn find_open_change_request(repo_path: &Path, host: ForgeHost, head: &str) -> Option<String> {
    let mut command = match host {
        ForgeHost::Github => {
            let mut command = Command::new("gh");
            command.args([
                "pr", "list", "--head", head, "--state", "open", "--json", "url", "--limit", "1",
            ]);
            command
        }
        ForgeHost::Gitlab => {
            let mut command = Command::new("glab");
            command.args(["mr", "list", "--source-branch", head]);
            command
        }
        ForgeHost::None => return None,
    };
    command.current_dir(repo_path);
    apply_interactive_path(&mut command);
    let output = command.output().ok()?;
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    first_http_url(&text)
}

pub fn workspace_belongs_to_repo(repo_path: &Path, workspace_path: &Path) -> bool {
    match (git_common_dir(repo_path), git_common_dir(workspace_path)) {
        (Some(left), Some(right)) => left == right,
        _ => false,
    }
}

fn git_common_dir(path: &Path) -> Option<std::path::PathBuf> {
    let output = run_git(path, &["rev-parse", "--git-common-dir"]).ok()?;
    let raw = std::path::PathBuf::from(output.trim());
    if raw.as_os_str().is_empty() {
        return None;
    }
    let absolute = if raw.is_absolute() {
        raw
    } else {
        path.join(raw)
    };
    Some(std::fs::canonicalize(&absolute).unwrap_or(absolute))
}

pub fn first_http_url(text: &str) -> Option<String> {
    for token in text.split(|character: char| {
        character.is_whitespace()
            || character == '"'
            || character == '\''
            || character == ','
            || character == ']'
            || character == '}'
            || character == ')'
    }) {
        let trimmed = token.trim_matches(|character: char| {
            character == '[' || character == '{' || character == ':' || character == '('
        });
        if trimmed.starts_with("https://") || trimmed.starts_with("http://") {
            return Some(trimmed.trim_end_matches(['.', ',', ';']).to_string());
        }
    }
    None
}

fn gh_create(input: ChangeRequestInput<'_>) -> Result<String, String> {
    let body_file = write_body(input.body)?;
    let mut command = Command::new("gh");
    apply_interactive_path(&mut command);
    command
        .current_dir(input.repo_path)
        .arg("pr")
        .arg("create")
        .arg("--base")
        .arg(input.base)
        .arg("--head")
        .arg(input.head)
        .arg("--title")
        .arg(input.title)
        .arg("--body-file")
        .arg(&body_file);
    if input.draft {
        command.arg("--draft");
    }
    command_url(command)
}

fn glab_create(input: ChangeRequestInput<'_>) -> Result<String, String> {
    let mut command = Command::new("glab");
    apply_interactive_path(&mut command);
    command
        .current_dir(input.repo_path)
        .arg("mr")
        .arg("create")
        .arg("--yes")
        .arg("--no-push")
        .arg("--source-branch")
        .arg(input.head)
        .arg("--target-branch")
        .arg(input.base)
        .arg("--title")
        .arg(input.title)
        .arg("--description")
        .arg(input.body);
    if input.draft {
        command.arg("--draft");
    }
    command_url(command)
}

fn write_body(body: &str) -> Result<std::path::PathBuf, String> {
    let mut path = std::env::temp_dir();
    path.push(format!("redwhisk-change-request-{}.md", std::process::id()));
    let mut file = std::fs::File::create(&path).map_err(|error| error.to_string())?;
    file.write_all(body.as_bytes())
        .map_err(|error| error.to_string())?;
    Ok(path)
}

fn command_url(mut command: Command) -> Result<String, String> {
    let output = command.output().map_err(|error| error.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        let message = if stderr.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            stderr.trim().to_string()
        };
        return Err(if message.is_empty() {
            "Failed to create the pull request or merge request.".to_string()
        } else {
            message
        });
    }
    stdout
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with("http://") || line.starts_with("https://"))
        .map(str::to_string)
        .ok_or_else(|| stdout.trim().to_string())
}

pub fn save_issue_pull_request(
    connection: &rusqlite::Connection,
    issue_id: i64,
    url: &str,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO issue_pull_requests (issue_id, url, created_at)
         VALUES (?1, ?2, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
         ON CONFLICT(issue_id) DO UPDATE SET url = excluded.url, created_at = excluded.created_at",
        rusqlite::params![issue_id, url],
    )?;
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeRequestStatus {
    pub title: String,
    pub state: String,
    pub checks: Vec<ChangeRequestCheck>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeRequestCheck {
    pub name: String,
    pub status: String,
}

pub fn view_change_request(
    repo_path: &Path,
    host: ForgeHost,
    reference: &str,
) -> Result<ChangeRequestStatus, String> {
    match host {
        ForgeHost::Github => run_json_view(
            repo_path,
            "gh",
            &[
                "pr",
                "view",
                reference,
                "--json",
                "title,state,isDraft,statusCheckRollup",
            ],
            parse_github_pr_view,
        ),
        ForgeHost::Gitlab => {
            let target = gitlab_reference(reference);
            run_json_view(
                repo_path,
                "glab",
                &["mr", "view", &target, "-F", "json"],
                parse_gitlab_mr_view,
            )
        }
        ForgeHost::None => Err("GitHub or GitLab remote was not recognized.".to_string()),
    }
}

fn run_json_view(
    repo_path: &Path,
    program: &str,
    args: &[&str],
    parse: fn(&str) -> Option<ChangeRequestStatus>,
) -> Result<ChangeRequestStatus, String> {
    let mut command = Command::new(program);
    apply_interactive_path(&mut command);
    command.current_dir(repo_path).args(args);
    let output = command.output().map_err(|error| error.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        let message = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        return Err(if message.is_empty() {
            "Failed to read the pull request or merge request.".to_string()
        } else {
            message.to_string()
        });
    }
    parse(stdout.trim())
        .ok_or_else(|| "Failed to read the pull request or merge request.".to_string())
}

pub fn parse_github_pr_view(text: &str) -> Option<ChangeRequestStatus> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    let title = value.get("title")?.as_str()?.trim().to_string();
    if title.is_empty() {
        return None;
    }
    let mut state = normalize_request_state(value.get("state").and_then(|item| item.as_str()));
    if value.get("isDraft").and_then(|item| item.as_bool()) == Some(true) {
        state = "DRAFT".to_string();
    }
    let checks = value
        .get("statusCheckRollup")
        .map(checks_from_json)
        .unwrap_or_default();
    Some(ChangeRequestStatus {
        title,
        state,
        checks,
    })
}

pub fn parse_gitlab_mr_view(text: &str) -> Option<ChangeRequestStatus> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    let title = value.get("title")?.as_str()?.trim().to_string();
    if title.is_empty() {
        return None;
    }
    let mut state = normalize_request_state(value.get("state").and_then(|item| item.as_str()));
    if value.get("draft").and_then(|item| item.as_bool()) == Some(true)
        || value
            .get("work_in_progress")
            .and_then(|item| item.as_bool())
            == Some(true)
    {
        state = "DRAFT".to_string();
    }
    let pipeline = value.get("head_pipeline").or_else(|| value.get("pipeline"));
    let checks = pipeline
        .and_then(|item| item.get("status"))
        .and_then(|item| item.as_str())
        .map(|status| {
            vec![ChangeRequestCheck {
                name: "pipeline".to_string(),
                status: status.to_string(),
            }]
        })
        .unwrap_or_default();
    Some(ChangeRequestStatus {
        title,
        state,
        checks,
    })
}

fn checks_from_json(value: &serde_json::Value) -> Vec<ChangeRequestCheck> {
    let Some(items) = value.as_array() else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let name = item
                .get("name")
                .and_then(|field| field.as_str())
                .unwrap_or("");
            if name.is_empty() {
                return None;
            }
            let status = item
                .get("conclusion")
                .and_then(|field| field.as_str())
                .or_else(|| item.get("status").and_then(|field| field.as_str()))
                .unwrap_or("")
                .to_string();
            Some(ChangeRequestCheck {
                name: name.to_string(),
                status,
            })
        })
        .collect()
}

fn normalize_request_state(state: Option<&str>) -> String {
    match state.unwrap_or("").to_ascii_lowercase().as_str() {
        "open" | "opened" => "OPEN".to_string(),
        "closed" | "close" => "CLOSED".to_string(),
        "merged" => "MERGED".to_string(),
        "draft" => "DRAFT".to_string(),
        other => other.to_ascii_uppercase(),
    }
}

fn gitlab_reference(reference: &str) -> String {
    let tail = reference
        .rsplit(['/', '?'])
        .find(|part| !part.is_empty())
        .unwrap_or(reference);
    if tail.chars().all(|character| character.is_ascii_digit()) {
        tail.to_string()
    } else {
        reference.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::{first_http_url, parse_github_pr_view, parse_gitlab_mr_view};

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
}
