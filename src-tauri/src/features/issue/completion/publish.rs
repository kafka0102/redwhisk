//! 完成动作 C：push + gh/glab 创建请求，并记下 URL。

use std::path::Path;

use rusqlite::Connection;

use super::effect_interpreter::EffectContext;
use crate::db::project_repository::ProjectRepository;
use crate::git::change_request::{publish_change_request, repo_default_branch, ChangeRequestInput};
use crate::git::forge::inspect_forge;
use crate::types::project::ProjectPrTarget;

pub(crate) fn publish_issue_change_request(
    connection: &Connection,
    ctx: &EffectContext<'_>,
    base: &str,
    draft: bool,
) -> Result<(), String> {
    let repo_path = Path::new(&ctx.session.working_dir);
    let forge = inspect_forge(repo_path);
    if !forge.ready() {
        return Err("GitHub / GitLab 环境未就绪".to_string());
    }
    let project = ProjectRepository::new(connection)
        .find_by_repo_path(ctx.repo_path)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "项目不存在".to_string())?;
    let head = ctx
        .world
        .current_branch
        .clone()
        .ok_or_else(|| "当前分支不存在".to_string())?;
    let resolved_base = if base.is_empty() {
        match project.pr_target {
            ProjectPrTarget::RepoDefault => repo_default_branch(repo_path)
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
