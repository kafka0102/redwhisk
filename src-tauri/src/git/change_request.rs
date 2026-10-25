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
        ForgeHost::None => Err("未识别 GitHub / GitLab 远程".to_string()),
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
            "创建请求失败".to_string()
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

#[cfg(test)]
mod tests {
    use super::first_http_url;

    #[test]
    fn extracts_the_first_http_url() {
        assert_eq!(
            first_http_url("[{\"url\":\"https://github.com/acme/redwhisk/pull/128\"}]"),
            Some("https://github.com/acme/redwhisk/pull/128".to_string())
        );
        assert!(first_http_url("no request").is_none());
    }
}
