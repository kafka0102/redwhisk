//! 从 git remote 识别 GitHub / GitLab，并查看本机 gh / glab 是否可用。

use std::ffi::OsString;
use std::path::Path;
use std::process::Command;
use std::time::Duration;

use super::command::{apply_interactive_path, run_git, GitCommandError};

/// `auth status` 会访问远端；离线或凭据失效时 glab 要等满 30 秒才返回。
/// 状态展示只需要一个可用/不可用的判定，给短超时避免拖住设置页。
const CLI_AUTH_TIMEOUT: Duration = Duration::from_secs(3);

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

    pub fn cli_name(self) -> Option<&'static str> {
        match self {
            Self::Github => Some("gh"),
            Self::Gitlab => Some("glab"),
            Self::None => None,
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

/// 只读 git remote 的识别结果，不启动 gh / glab。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForgeRemoteStatus {
    pub host: ForgeHost,
    pub remote_label: Option<String>,
    pub repo_default_branch: Option<String>,
}

pub fn inspect_forge(repo_path: &Path) -> ForgeStatus {
    let remote = inspect_forge_remote(repo_path);
    let Some(cli) = remote.host.cli_name() else {
        return ForgeStatus {
            host: ForgeHost::None,
            remote_label: remote.remote_label,
            cli_installed: false,
            cli_authenticated: false,
            repo_default_branch: None,
        };
    };
    let cli_installed = cli_is_installed(cli);
    let cli_authenticated = cli_installed && cli_is_authenticated(cli);
    ForgeStatus {
        host: remote.host,
        remote_label: remote.remote_label,
        cli_installed,
        cli_authenticated,
        repo_default_branch: remote.repo_default_branch,
    }
}

pub fn inspect_forge_remote(repo_path: &Path) -> ForgeRemoteStatus {
    match resolve_remote_forge(repo_path) {
        Some((host, label)) => ForgeRemoteStatus {
            host,
            remote_label: Some(label),
            repo_default_branch: repo_default_branch(repo_path),
        },
        None => ForgeRemoteStatus {
            host: ForgeHost::None,
            remote_label: None,
            repo_default_branch: None,
        },
    }
}

pub fn detect_forge_host(repo_path: &Path) -> ForgeHost {
    resolve_remote_forge(repo_path)
        .map(|(host, _)| host)
        .unwrap_or(ForgeHost::None)
}

fn resolve_remote_forge(repo_path: &Path) -> Option<(ForgeHost, String)> {
    let remote = resolve_remote_url(repo_path).ok().flatten()?;
    parse_forge_url(&remote)
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

/// 只做 PATH 查找，不启动 CLI。`auth status` / `--version` 都可能触发
/// 包装脚本、冷启动或网络等待，不能用于「是否安装」这种高频判断。
pub fn cli_is_installed(cli: &str) -> bool {
    let mut search_paths: Vec<OsString> = Vec::new();
    if let Some(path) = crate::agent::command_detector::resolved_interactive_shell_path() {
        search_paths.push(path);
    }
    if let Some(path) = std::env::var_os("PATH") {
        search_paths.push(path);
    }
    search_paths.iter().any(|path| {
        std::env::split_paths(path)
            .any(|dir| !dir.as_os_str().is_empty() && dir.join(cli).is_file())
    })
}

fn cli_is_authenticated(cli: &str) -> bool {
    crate::agent::command_lookup_process::output_with_timeout(
        cli_command(cli, &["auth", "status"]),
        CLI_AUTH_TIMEOUT,
    )
    .map(|output| output.status.success())
    .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use std::process::Command;

    use tempfile::tempdir;

    use super::{detect_forge_host, inspect_forge_remote, parse_forge_url, ForgeHost};

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

    #[test]
    fn detects_host_from_git_remote_without_cli() {
        let temp = tempdir().expect("temp dir");
        let repo = temp.path().join("repo");
        std::fs::create_dir_all(&repo).expect("repo dir");
        assert!(Command::new("git")
            .arg("init")
            .arg(&repo)
            .status()
            .expect("git init")
            .success());
        assert!(Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args([
                "remote",
                "add",
                "origin",
                "git@gitlab.com:acme/redwhisk.git",
            ])
            .status()
            .expect("git remote add")
            .success());

        assert_eq!(detect_forge_host(&repo), ForgeHost::Gitlab);
        assert_eq!(inspect_forge_remote(&repo).host, ForgeHost::Gitlab);
    }
}
