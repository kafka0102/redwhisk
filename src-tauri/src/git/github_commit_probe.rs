//! 探测公共 github.com 上某 commit 页是否存在（HEAD/GET 提交页，非 REST API）。

use std::time::Duration;

use super::github_remote::GithubRemote;

const HTTP_TIMEOUT: Duration = Duration::from_secs(15);
const USER_AGENT: &str = "RedWhisk-Github-Commit-Probe";
const DEFAULT_WEB_BASE: &str = "https://github.com";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GithubCommitProbeResult {
    Exists { commit_url: String },
    NotFound,
    NetworkError,
}

pub fn build_commit_url(remote: &GithubRemote, commit_hash: &str) -> String {
    format!(
        "{}/{}/{}/commit/{}",
        DEFAULT_WEB_BASE,
        remote.owner,
        remote.repo,
        commit_hash.trim()
    )
}

/// 请求 commit 页：200 视为存在；404 未找到；其它/传输错误视为网络错误。
pub fn probe_github_commit(remote: &GithubRemote, commit_hash: &str) -> GithubCommitProbeResult {
    let commit_url = build_commit_url(remote, commit_hash);
    let response = ureq::request("HEAD", &commit_url)
        .set("User-Agent", USER_AGENT)
        .timeout(HTTP_TIMEOUT)
        .call();

    match response {
        Ok(_) => GithubCommitProbeResult::Exists { commit_url },
        Err(ureq::Error::Status(404, _)) => GithubCommitProbeResult::NotFound,
        Err(ureq::Error::Status(status, response)) => {
            // 部分路径对 HEAD 不友好时回退 GET（仅状态码，不读 body）。
            if status == 405 || status == 403 {
                return probe_with_get(&commit_url);
            }
            // 其它 4xx/5xx 仍按网络错误，避免把限流误报成 not_found。
            let _ = response;
            GithubCommitProbeResult::NetworkError
        }
        Err(_) => GithubCommitProbeResult::NetworkError,
    }
}

fn probe_with_get(commit_url: &str) -> GithubCommitProbeResult {
    let response = ureq::get(commit_url)
        .set("User-Agent", USER_AGENT)
        .timeout(HTTP_TIMEOUT)
        .call();
    match response {
        Ok(_) => GithubCommitProbeResult::Exists {
            commit_url: commit_url.to_string(),
        },
        Err(ureq::Error::Status(404, _)) => GithubCommitProbeResult::NotFound,
        Err(_) => GithubCommitProbeResult::NetworkError,
    }
}

#[cfg(test)]
mod tests {
    use super::{build_commit_url, GithubRemote};

    #[test]
    fn builds_public_github_commit_url() {
        let remote = GithubRemote {
            owner: "acme".into(),
            repo: "widgets".into(),
        };
        assert_eq!(
            build_commit_url(&remote, "abcdef1"),
            "https://github.com/acme/widgets/commit/abcdef1"
        );
    }
}
