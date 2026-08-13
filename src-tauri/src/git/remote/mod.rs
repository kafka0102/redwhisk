use std::path::Path;

use super::command::{self, GitCommandError};

/// 有 upstream 且相对远端分叉/无法快进时，`push` 返回的稳定 reason 文案（service 映射用）。
pub const PUSH_REQUIRES_MANUAL_SYNC: &str = "pushRequiresManualSync";

/// 在指定仓库路径拉取主上游。
///
/// 有 `@{upstream}` 时：只 fetch 主上游 tracking ref，再对单个
/// `<remote>/<branch>` rebase/merge。不调用 `git pull`。
/// `git pull` 会读取 FETCH_HEAD 里全部 for-merge；`pull.rebase=true`
/// 且存在多个 `branch.*.merge`，或变更页后台 `fetch --all` 与拉取竞态时，
/// 会 `fatal: Cannot rebase onto multiple branches`。
pub fn pull(repo_path: impl AsRef<Path>) -> Result<(), GitCommandError> {
    let repo_path = repo_path.as_ref();
    match resolve_primary_upstream(repo_path)? {
        Some(upstream) => {
            fetch_primary_upstream(repo_path, &upstream)?;
            integrate_primary_upstream(repo_path, &upstream)
        }
        None => command::run_git(repo_path, &["pull"]).map(|_| ()),
    }
}

/// 在指定仓库路径安全推送当前分支。
///
/// - 无 `@{upstream}`：`git push -u origin HEAD`
/// - 有 upstream：先 fetch 上游远程；可快进 behind 则 `merge --ff-only <remote>/<branch>` 再
///   `push <remote> HEAD:<branch>`；ahead-only 直接 push 显式 refspec；
///   分叉/无法快进返回 `PUSH_REQUIRES_MANUAL_SYNC`，不进入 merge/rebase。
///
/// 显式 remote/branch 避免多 `branch.*.merge` 时裸 `git push` 报
/// `multiple upstream branches`。
pub fn push(repo_path: impl AsRef<Path>) -> Result<(), GitCommandError> {
    let repo_path = repo_path.as_ref();
    let Some(upstream) = resolve_primary_upstream(repo_path)? else {
        return command::run_git(repo_path, &["push", "-u", "origin", "HEAD"]).map(|_| ());
    };

    command::run_git(repo_path, &["fetch", &upstream.remote]).map(|_| ())?;
    let push_refspec = format!("HEAD:{}", upstream.branch);

    match classify_upstream_relation(repo_path)? {
        UpstreamRelation::Equal | UpstreamRelation::AheadOnly => {
            command::run_git(repo_path, &["push", &upstream.remote, &push_refspec]).map(|_| ())
        }
        UpstreamRelation::BehindOnly => {
            let onto = tracking_ref(&upstream);
            command::run_git(repo_path, &["merge", "--ff-only", &onto]).map(|_| ())?;
            command::run_git(repo_path, &["push", &upstream.remote, &push_refspec]).map(|_| ())
        }
        UpstreamRelation::Diverged => Err(GitCommandError::Failed {
            command: "git push".to_string(),
            message: PUSH_REQUIRES_MANUAL_SYNC.to_string(),
        }),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UpstreamRelation {
    Equal,
    AheadOnly,
    BehindOnly,
    Diverged,
}

fn upstream_remote_name(repo_path: &Path) -> Result<String, GitCommandError> {
    let branch = command::run_git(repo_path, &["branch", "--show-current"])?;
    let branch = branch.trim();
    if branch.is_empty() {
        return Err(GitCommandError::Failed {
            command: "git branch --show-current".to_string(),
            message: "detached HEAD has no upstream remote".to_string(),
        });
    }
    let key = format!("branch.{branch}.remote");
    let remote = command::run_git(repo_path, &["config", "--get", &key])?;
    let remote = remote.trim();
    if remote.is_empty() {
        return Err(GitCommandError::Failed {
            command: format!("git config --get {key}"),
            message: "upstream remote is empty".to_string(),
        });
    }
    Ok(remote.to_string())
}

fn tracking_ref(upstream: &PrimaryUpstream) -> String {
    format!("{}/{}", upstream.remote, upstream.branch)
}

fn fetch_primary_upstream(
    repo_path: &Path,
    upstream: &PrimaryUpstream,
) -> Result<(), GitCommandError> {
    let refspec = format!(
        "+refs/heads/{}:refs/remotes/{}/{}",
        upstream.branch, upstream.remote, upstream.branch
    );
    command::run_git(repo_path, &["fetch", &upstream.remote, &refspec]).map(|_| ())
}

fn integrate_primary_upstream(
    repo_path: &Path,
    upstream: &PrimaryUpstream,
) -> Result<(), GitCommandError> {
    let onto = tracking_ref(upstream);
    if rebase_configured(repo_path)? {
        command::run_git(repo_path, &["rebase", &onto]).map(|_| ())
    } else {
        command::run_git(repo_path, &["merge", &onto]).map(|_| ())
    }
}

fn rebase_configured(repo_path: &Path) -> Result<bool, GitCommandError> {
    let branch = command::run_git(repo_path, &["branch", "--show-current"])?;
    let branch = branch.trim();
    if !branch.is_empty() {
        if let Some(value) = git_config_get(repo_path, &format!("branch.{branch}.rebase"))? {
            return Ok(is_enabled_rebase_value(&value));
        }
    }
    if let Some(value) = git_config_get(repo_path, "pull.rebase")? {
        return Ok(is_enabled_rebase_value(&value));
    }
    Ok(false)
}

fn git_config_get(repo_path: &Path, key: &str) -> Result<Option<String>, GitCommandError> {
    let output = command::run_git_raw(repo_path, &["config", "--get", key])?;
    if output.status.success() {
        let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Ok((!value.is_empty()).then_some(value));
    }
    if output.status.code() == Some(1) {
        return Ok(None);
    }
    Err(GitCommandError::Failed {
        command: format!("git config --get {key}"),
        message: String::from_utf8_lossy(&output.stderr).trim().to_string(),
    })
}

fn is_enabled_rebase_value(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "true" | "1" | "yes" | "on" | "merges" | "interactive" | "i"
    )
}

fn classify_upstream_relation(repo_path: &Path) -> Result<UpstreamRelation, GitCommandError> {
    let head_is_ancestor_of_upstream = is_ancestor(repo_path, "HEAD", "@{upstream}")?;
    let upstream_is_ancestor_of_head = is_ancestor(repo_path, "@{upstream}", "HEAD")?;
    Ok(
        match (head_is_ancestor_of_upstream, upstream_is_ancestor_of_head) {
            (true, true) => UpstreamRelation::Equal,
            (true, false) => UpstreamRelation::BehindOnly,
            (false, true) => UpstreamRelation::AheadOnly,
            (false, false) => UpstreamRelation::Diverged,
        },
    )
}

fn is_ancestor(
    repo_path: &Path,
    maybe_ancestor: &str,
    maybe_descendant: &str,
) -> Result<bool, GitCommandError> {
    let output = command::run_git_raw(
        repo_path,
        &[
            "merge-base",
            "--is-ancestor",
            maybe_ancestor,
            maybe_descendant,
        ],
    )?;
    Ok(output.status.success())
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PrimaryUpstream {
    remote: String,
    /// 不含 `refs/heads/` 前缀的分支名（可含 `/`，如 `feature/foo`）。
    branch: String,
}

/// 解析 `@{upstream}` 对应的主上游 remote + branch。
///
/// 多 `branch.<name>.merge` 时 `@{upstream}` 仍指向主（首个）上游；
/// 这里用它而不是 `git config --get`（后者取最后一个 merge 值）。
fn resolve_primary_upstream(repo_path: &Path) -> Result<Option<PrimaryUpstream>, GitCommandError> {
    let upstream_abbrev =
        match command::run_git(repo_path, &["rev-parse", "--abbrev-ref", "@{upstream}"]) {
            Ok(value) => {
                let value = value.trim();
                if value.is_empty() {
                    return Ok(None);
                }
                value.to_string()
            }
            Err(GitCommandError::Failed { .. }) => return Ok(None),
            Err(error) => return Err(error),
        };

    let remote = upstream_remote_name(repo_path)?;
    let prefix = format!("{remote}/");
    let Some(branch) = upstream_abbrev.strip_prefix(&prefix) else {
        return Err(GitCommandError::Failed {
            command: "git rev-parse --abbrev-ref @{upstream}".to_string(),
            message: format!(
                "upstream '{upstream_abbrev}' does not start with remote prefix '{prefix}'"
            ),
        });
    };
    if branch.is_empty() {
        return Err(GitCommandError::Failed {
            command: "git rev-parse --abbrev-ref @{upstream}".to_string(),
            message: "upstream branch name is empty".to_string(),
        });
    }

    Ok(Some(PrimaryUpstream {
        remote,
        branch: branch.to_string(),
    }))
}

#[cfg(test)]
mod tests;
