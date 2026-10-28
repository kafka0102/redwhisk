//! 从 git remote 识别 GitHub / GitLab，并查看本机 gh / glab 是否可用。

use std::path::Path;
use std::process::Command;

use super::command::{apply_interactive_path, run_git, GitCommandError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ForgeHost {
    Github,
    Gitlab,
    None,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForgeStatus {
    pub host: ForgeHost,
    pub remote_label: Option<String>,
    pub cli_installed: bool,
    pub cli_authenticated: bool,
    pub repo_default_branch: Option<String>,
}

impl ForgeHost {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Github => "github",
            Self::Gitlab => "gitlab",
            Self::None => "none",
        }
    }

    /// 持久化来源类别。无 remote 与非 GitHub/GitLab 记为 other，不使用响应里的 none。
    pub fn stored_class(self) -> &'static str {
        match self {
            Self::Github => "github",
            Self::Gitlab => "gitlab",
            Self::None => "other",
        }
    }
}

impl ForgeStatus {
    pub fn ready(&self) -> bool {
        self.host != ForgeHost::None && self.cli_installed && self.cli_authenticated
    }

    pub fn known(&self) -> bool {
        self.host != ForgeHost::None
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeStatusDto {
    pub host: String,
    pub remote_label: Option<String>,
    pub cli_installed: bool,
    pub cli_authenticated: bool,
    pub repo_default_branch: Option<String>,
}

impl From<ForgeStatus> for ForgeStatusDto {
    fn from(status: ForgeStatus) -> Self {
        Self {
            host: status.host.as_str().to_string(),
            remote_label: status.remote_label,
            cli_installed: status.cli_installed,
            cli_authenticated: status.cli_authenticated,
            repo_default_branch: status.repo_default_branch,
        }
    }
}

pub fn inspect_forge(repo_path: &Path) -> ForgeStatus {
    let remote = resolve_remote_url(repo_path).ok().flatten();
    let parsed = remote.as_deref().and_then(parse_forge_url);
    let Some((host, label)) = parsed else {
        return forge_status(repo_path, ForgeHost::None, None, false, false);
    };
    let cli = match host {
        ForgeHost::Github => "gh",
        ForgeHost::Gitlab => "glab",
        ForgeHost::None => {
            return forge_status(repo_path, host, Some(label), false, false);
        }
    };
    let cli_installed = cli_is_installed(cli);
    let cli_authenticated = cli_installed && cli_is_authenticated(cli);
    forge_status(
        repo_path,
        host,
        Some(label),
        cli_installed,
        cli_authenticated,
    )
}

/// 只识别 remote 宿主，不检查命令行。无 remote、解析失败和 GitHub Enterprise 都是 None。
pub fn forge_host(repo_path: &Path) -> ForgeHost {
    resolve_remote_url(repo_path)
        .ok()
        .flatten()
        .as_deref()
        .and_then(parse_forge_url)
        .map(|(host, _)| host)
        .unwrap_or(ForgeHost::None)
}

fn forge_status(
    repo_path: &Path,
    host: ForgeHost,
    remote_label: Option<String>,
    cli_installed: bool,
    cli_authenticated: bool,
) -> ForgeStatus {
    ForgeStatus {
        host,
        remote_label,
        cli_installed,
        cli_authenticated,
        repo_default_branch: if host == ForgeHost::None {
            None
        } else {
            repo_default_branch(repo_path)
        },
    }
}

pub fn repo_default_branch(repo_path: &Path) -> Option<String> {
    let symbolic = run_git(
        repo_path,
        &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    )
    .ok()?;
    let name = symbolic.trim();
    name.strip_prefix("origin/")
        .map(str::to_string)
        .or_else(|| (!name.is_empty()).then(|| name.to_string()))
}

fn resolve_remote_url(repo_path: &Path) -> Result<Option<String>, GitCommandError> {
    let output = run_git(repo_path, &["remote"])?;
    let names: Vec<&str> = output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    if names.is_empty() {
        return Ok(None);
    }
    let preferred = if names.iter().any(|name| *name == "origin") {
        "origin"
    } else {
        names[0]
    };
    Ok(Some(run_git(repo_path, &["remote", "get-url", preferred])?))
}

pub fn parse_forge_url(url: &str) -> Option<(ForgeHost, String)> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return None;
    }
    let (host, path) = split_remote(trimmed)?;
    let host_name = host.split('@').next_back()?.trim();
    let forge = if host_name.eq_ignore_ascii_case("github.com")
        || host_name.eq_ignore_ascii_case("www.github.com")
    {
        ForgeHost::Github
    } else if host_name.eq_ignore_ascii_case("gitlab.com")
        || host_name.to_ascii_lowercase().contains("gitlab.")
        || host_name.to_ascii_lowercase().starts_with("gitlab")
    {
        ForgeHost::Gitlab
    } else {
        return None;
    };
    let label_path = path
        .trim_matches('/')
        .trim_end_matches(".git")
        .trim_matches('/');
    if label_path.is_empty() {
        return None;
    }
    Some((forge, format!("{host_name}/{label_path}")))
}

fn split_remote(url: &str) -> Option<(String, String)> {
    if let Some(rest) = url.strip_prefix("git@") {
        let (host, path) = rest.split_once(':')?;
        return Some((host.to_string(), path.to_string()));
    }
    let without_scheme = url.split_once("://").map(|(_, rest)| rest).unwrap_or(url);
    let (host, path) = without_scheme.split_once('/')?;
    let host = host.split('@').next_back()?.to_string();
    Some((host, path.to_string()))
}

fn cli_command(cli: &str, args: &[&str]) -> Command {
    let mut command = Command::new(cli);
    command.args(args);
    apply_interactive_path(&mut command);
    command
}

fn cli_is_installed(cli: &str) -> bool {
    cli_command(cli, &["--version"])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn cli_is_authenticated(cli: &str) -> bool {
    cli_command(cli, &["auth", "status"])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::{parse_forge_url, ForgeHost};

    #[test]
    fn parses_github_and_gitlab_urls() {
        assert_eq!(
            parse_forge_url("git@github.com:acme/redwhisk.git").map(|(_, label)| label),
            Some("github.com/acme/redwhisk".to_string())
        );
        assert_eq!(
            parse_forge_url("https://gitlab.example.com/acme/redwhisk.git").map(|(host, _)| host),
            Some(ForgeHost::Gitlab)
        );
        assert!(parse_forge_url("https://bitbucket.org/acme/redwhisk.git").is_none());
    }
}
