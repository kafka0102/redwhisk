//! 完成动作 C：push + gh/glab 创建请求，并记下 URL。

use std::path::Path;

use rusqlite::Connection;

use super::effect_interpreter::EffectContext;
use crate::db::project_repository::ProjectRepository;
use crate::git::change_request::{publish_change_request, ChangeRequestInput};
use crate::git::forge::{cli_is_installed, inspect_forge_remote, ForgeHost};
use crate::types::project::ProjectPrTarget;

pub(crate) fn publish_issue_change_request(
    connection: &Connection,
    ctx: &EffectContext<'_>,
    base: &str,
    draft: bool,
) -> Result<(), String> {
    let repo_path = Path::new(&ctx.session.working_dir);
    let forge = inspect_forge_remote(repo_path);
    if forge.host == ForgeHost::None {
        return Err("forgeUnknown".to_string());
    }
    if !forge.host.cli_name().is_some_and(cli_is_installed) {
        return Err("forgeCliMissing".to_string());
    }
    let project = ProjectRepository::new(connection)
        .find_by_repo_path(ctx.repo_path)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "projectNotFound".to_string())?;
    let head = ctx
        .world
        .current_branch
        .clone()
        .ok_or_else(|| "branchMissing".to_string())?;
    let resolved_base = if base.is_empty() {
        match project.pr_target {
            ProjectPrTarget::RepoDefault => forge
                .repo_default_branch
                .clone()
                .or_else(|| ctx.world.target_branch.clone())
                .unwrap_or_else(|| "main".to_string()),
            ProjectPrTarget::IssueBase => ctx
                .world
                .target_branch
                .clone()
                .unwrap_or_else(|| "main".to_string()),
        }
    } else {
        base.to_string()
    };
    let url = publish_change_request(ChangeRequestInput {
        repo_path,
        host: forge.host,
        head: &head,
        base: &resolved_base,
        title: &ctx.issue.title,
        body: &ctx.issue.description,
        draft,
    })?;
    crate::git::change_request::save_issue_pull_request(connection, ctx.issue.id, &url)
        .map_err(|error| error.to_string())?;
    Ok(())
}
