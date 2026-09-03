//! 从 git remote 解析公共 github.com 的 owner/repo。
//! 规则：优先 origin；否则取 `git remote` 列表中的第一个；仅 github.com（不含 GHE）。

use std::path::Path;

use super::command::{run_git, GitCommandError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GithubRemote {
    pub owner: String,
    pub repo: String,
}

/// 列出 remote 名，优先 origin，否则首个；解析其 URL 为 github.com owner/repo。
pub fn resolve_github_remote(repo_path: &Path) -> Result<Option<GithubRemote>, GitCommandError> {
    let names = list_remote_names(repo_path)?;
    if names.is_empty() {
        return Ok(None);
    }
    let preferred = if names.iter().any(|name| name == "origin") {
        "origin"
    } else {
        names[0].as_str()
    };
    let url = run_git(repo_path, &["remote", "get-url", preferred])?;
    Ok(parse_github_remote_url(&url))
}

fn list_remote_names(repo_path: &Path) -> Result<Vec<String>, GitCommandError> {
    let output = run_git(repo_path, &["remote"])?;
    Ok(output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect())
}

/// 解析 github.com remote URL（HTTPS / SSH / git 协议）。非 github.com 返回 None。
pub fn parse_github_remote_url(url: &str) -> Option<GithubRemote> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return None;
    }

    // SSH: git@github.com:owner/repo.git
    if let Some(rest) = trimmed.strip_prefix("git@github.com:") {
        return split_owner_repo(rest);
    }
    // SSH alternate: ssh://git@github.com/owner/repo.git
    if let Some(rest) = trimmed
        .strip_prefix("ssh://git@github.com/")
        .or_else(|| trimmed.strip_prefix("ssh://github.com/"))
    {
        return split_owner_repo(rest);
    }
    // HTTPS / git protocol
    if let Some(rest) = trimmed
        .strip_prefix("https://github.com/")
        .or_else(|| trimmed.strip_prefix("http://github.com/"))
        .or_else(|| trimmed.strip_prefix("git://github.com/"))
        .or_else(|| trimmed.strip_prefix("https://www.github.com/"))
        .or_else(|| trimmed.strip_prefix("http://www.github.com/"))
    {
        return split_owner_repo(rest);
    }

    None
}

fn split_owner_repo(path: &str) -> Option<GithubRemote> {
    let without_query = path.split(['?', '#']).next().unwrap_or(path);
    let without_git_suffix = without_query
        .trim_end_matches('/')
        .strip_suffix(".git")
        .unwrap_or_else(|| without_query.trim_end_matches('/'));
    let mut parts = without_git_suffix
        .split('/')
        .filter(|part| !part.is_empty());
    let owner = parts.next()?.trim();
    let repo = parts.next()?.trim();
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    // 拒绝额外路径段（如 owner/repo/issues）被误当 repo
    if parts.next().is_some() {
        // 仍接受 owner/repo.git/ 已 strip；多余段则不是标准 remote
        return None;
    }
    Some(GithubRemote {
        owner: owner.to_string(),
        repo: repo.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::{parse_github_remote_url, resolve_github_remote, GithubRemote};
    use std::fs;
    use std::process::Command;
    use tempfile::tempdir;

    fn git(repo: &std::path::Path, args: &[&str]) {
        let status = Command::new("git")
            .args(args)
            .current_dir(repo)
            .status()
            .expect("run git");
        assert!(status.success(), "git {:?} failed", args);
    }

    #[test]
    fn parses_https_ssh_and_rejects_non_github() {
        assert_eq!(
            parse_github_remote_url("https://github.com/acme/widgets.git"),
            Some(GithubRemote {
                owner: "acme".into(),
                repo: "widgets".into(),
            })
        );
        assert_eq!(
            parse_github_remote_url("git@github.com:acme/widgets.git"),
            Some(GithubRemote {
                owner: "acme".into(),
                repo: "widgets".into(),
            })
        );
        assert_eq!(
            parse_github_remote_url("ssh://git@github.com/acme/widgets.git"),
            Some(GithubRemote {
                owner: "acme".into(),
                repo: "widgets".into(),
            })
        );
        assert_eq!(
            parse_github_remote_url("https://gitlab.com/acme/widgets.git"),
            None
        );
        assert_eq!(
            parse_github_remote_url("https://github.enterprise.example/acme/widgets.git"),
            None
        );
    }

    #[test]
    fn prefers_origin_over_other_remotes() {
        let dir = tempdir().expect("tempdir");
        let repo = dir.path();
        git(repo, &["init"]);
        git(
            repo,
            &[
                "remote",
                "add",
                "upstream",
                "https://github.com/upstream/widgets.git",
            ],
        );
        git(
            repo,
            &[
                "remote",
                "add",
                "origin",
                "https://github.com/acme/widgets.git",
            ],
        );
        assert_eq!(
            resolve_github_remote(repo).expect("resolve"),
            Some(GithubRemote {
                owner: "acme".into(),
                repo: "widgets".into(),
            })
        );
    }

    #[test]
    fn falls_back_to_first_remote_when_no_origin() {
        let dir = tempdir().expect("tempdir");
        let repo = dir.path();
        git(repo, &["init"]);
        git(
            repo,
            &[
                "remote",
                "add",
                "fork",
                "https://github.com/fork-owner/widgets.git",
            ],
        );
        assert_eq!(
            resolve_github_remote(repo).expect("resolve"),
            Some(GithubRemote {
                owner: "fork-owner".into(),
                repo: "widgets".into(),
            })
        );
    }

    #[test]
    fn returns_none_when_no_remotes() {
        let dir = tempdir().expect("tempdir");
        let repo = dir.path();
        git(repo, &["init"]);
        assert_eq!(resolve_github_remote(repo).expect("resolve"), None);
        // silence unused import warning in some toolchains
        let _ = fs::metadata(repo);
    }
}
