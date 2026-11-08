//! 完成动作 C：push + gh/glab 创建请求，并记下 URL。

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};

use super::effect_interpreter::EffectContext;
use crate::db::project_repository::ProjectRepository;
use crate::git::change_request::{publish_change_request, ChangeRequestInput};
use crate::git::forge::{cli_is_installed, inspect_forge_remote, ForgeHost, ForgeRemoteStatus};
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
    record_published_link(
        connection,
        project.id,
        &forge,
        &head,
        &resolved_base,
        &ctx.issue.title,
        &ctx.issue.description,
        draft,
        &url,
        Some((ctx.issue.id, "manual")),
    )?;
    Ok(())
}

pub(crate) fn record_published_link(
    connection: &Connection,
    project_id: i64,
    forge: &ForgeRemoteStatus,
    head: &str,
    base: &str,
    title: &str,
    body: &str,
    draft: bool,
    url: &str,
    link: Option<(i64, &str)>,
) -> Result<(), String> {
    let label = forge
        .remote_label
        .as_deref()
        .ok_or_else(|| "forgeUnknown".to_string())?;
    let (host, repo) = label
        .split_once('/')
        .ok_or_else(|| "forgeUnknown".to_string())?;
    let provider = match forge.host {
        ForgeHost::Github => "github",
        ForgeHost::Gitlab => "gitlab",
        ForgeHost::None => return Err("forgeUnknown".to_string()),
    };
    let number = url
        .rsplit('/')
        .next()
        .and_then(|part| part.parse::<i64>().ok())
        .ok_or_else(|| "changeRequestNumberMissing".to_string())?;
    let state = if draft { "draft" } else { "open" };
    let now =
        crate::features::issue::time::current_epoch_millis().map_err(|error| error.message)?;
    let existing_id = connection
        .query_row(
            "SELECT id FROM change_requests
             WHERE project_id = ?1 AND provider = ?2 AND host = ?3 AND repo = ?4 AND number = ?5",
            params![project_id, provider, host, repo, number],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let change_request_id = if let Some(id) = existing_id {
        connection
            .execute(
                "UPDATE change_requests
                 SET url = ?1, title = ?2, body = ?3, state = ?4, source_branch = ?5,
                     target_branch = ?6, synced_at = ?7
                 WHERE id = ?8",
                params![url, title, body, state, head, base, now, id],
            )
            .map_err(|error| error.to_string())?;
        id
    } else {
        connection
            .execute(
                "INSERT INTO change_requests (
                    project_id, provider, host, repo, external_id, number, url, title, body,
                    state, source_branch, target_branch, remote_updated_at, synced_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)",
                params![
                    project_id, provider, host, repo, url, number, url, title, body, state, head,
                    base, now
                ],
            )
            .map_err(|error| error.to_string())?;
        connection.last_insert_rowid()
    };
    if let Some((issue_id, link_kind)) = link {
        connection
            .execute(
                "INSERT INTO change_request_issue_links (
                    change_request_id, issue_id, link_kind, created_at
                 ) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(change_request_id, issue_id) DO NOTHING",
                params![change_request_id, issue_id, link_kind, now],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}
