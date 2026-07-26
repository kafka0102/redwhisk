//! 工作区 GitHub remote 解析 + commit 探测的 service / 纯映射。

use crate::git::github_commit_probe::{
    build_commit_url, probe_github_commit, GithubCommitProbeResult,
};
use crate::git::github_remote::{resolve_github_remote, GithubRemote};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::session_workspace::{
    GithubCommitProbeStatus, ProbeGithubCommitInput, ProbeGithubCommitResponse,
    ProjectWorkspaceInput, ResolveWorkspaceGithubRemoteResponse, WorkspaceGithubRemote,
};

use super::workspace::SessionWorkspaceService;

impl SessionWorkspaceService<'_> {
    pub fn resolve_github_remote(
        &self,
        input: ProjectWorkspaceInput,
    ) -> Result<ResolveWorkspaceGithubRemoteResponse, CommandError> {
        let root = self.resolve_workspace_root(
            input.project_id,
            input.session_id,
            input.workspace_path.as_deref(),
        )?;
        let remote = resolve_github_remote(&root).map_err(|error| {
            CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "读取 git remote 失败。",
            )
            .with_reason("githubRemoteResolveFailed")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?;
        Ok(ResolveWorkspaceGithubRemoteResponse {
            remote: remote.map(to_dto_remote),
        })
    }
}

pub fn probe_github_commit_for_input(
    input: ProbeGithubCommitInput,
) -> ProbeGithubCommitResponse {
    let owner = input.owner.trim();
    let repo = input.repo.trim().trim_end_matches(".git");
    let commit_hash = input.commit_hash.trim();
    if owner.is_empty() || repo.is_empty() || commit_hash.is_empty() {
        return ProbeGithubCommitResponse {
            status: GithubCommitProbeStatus::NetworkError,
            commit_url: None,
        };
    }
    let remote = GithubRemote {
        owner: owner.to_string(),
        repo: repo.to_string(),
    };
    match probe_github_commit(&remote, commit_hash) {
        GithubCommitProbeResult::Exists { commit_url } => ProbeGithubCommitResponse {
            status: GithubCommitProbeStatus::Exists,
            commit_url: Some(commit_url),
        },
        GithubCommitProbeResult::NotFound => ProbeGithubCommitResponse {
            status: GithubCommitProbeStatus::NotFound,
            commit_url: None,
        },
        GithubCommitProbeResult::NetworkError => ProbeGithubCommitResponse {
            status: GithubCommitProbeStatus::NetworkError,
            commit_url: Some(build_commit_url(&remote, commit_hash)),
        },
    }
}

fn to_dto_remote(remote: GithubRemote) -> WorkspaceGithubRemote {
    WorkspaceGithubRemote {
        owner: remote.owner,
        repo: remote.repo,
    }
}

#[cfg(test)]
mod tests {
    use super::probe_github_commit_for_input;
    use crate::types::session_workspace::{GithubCommitProbeStatus, ProbeGithubCommitInput};

    #[test]
    fn empty_input_maps_to_network_error() {
        let response = probe_github_commit_for_input(ProbeGithubCommitInput {
            owner: " ".into(),
            repo: "widgets".into(),
            commit_hash: "abc".into(),
        });
        assert_eq!(response.status, GithubCommitProbeStatus::NetworkError);
    }
}
