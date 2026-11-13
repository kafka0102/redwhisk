//! 把完成写回记到 SQLite，并在本地完成提交之后调用。

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};

use super::effect_interpreter::EffectContext;
use super::state_machine::CompletionState;
use super::use_case::CompletionFlow;
use super::writeback::{
    apply_completion_writeback, error_reason, CompletionForge, CompletionMethod,
    CompletionWriteback, WritebackBook,
};
use crate::features::issue::archive::open_issue_database;
use crate::features::issue::github_issue_mirror::ForgeIssueError;
use crate::features::issue::github_issue_mirror::{
    close_remote_issue, comment_remote_issue, RemoteIssueState,
};
use crate::git::change_request::find_open_change_request;
use crate::git::forge::ForgeHost;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::issue_completion::CloseoutAction;
use crate::types::issue_detail::RetryIssueCompletionWritebackInput;

struct RemoteRef {
    project_id: i64,
    provider: String,
    number: i64,
    remote_state: String,
}

struct CliForge<'a> {
    provider: &'a str,
    repo_dir: &'a Path,
    number: i64,
}

impl CompletionForge for CliForge<'_> {
    fn close_issue(&self) -> Result<(), ForgeIssueError> {
        close_remote_issue(self.provider, self.repo_dir, self.number)
    }

    fn comment_issue(&self, body: &str) -> Result<(), ForgeIssueError> {
        comment_remote_issue(self.provider, self.repo_dir, self.number, body)
    }
}

impl<'service, 'connection> CompletionFlow<'service, 'connection> {
    pub(crate) fn write_back_completion(
        &self,
        ctx: &EffectContext<'_>,
        state: &CompletionState,
    ) -> Result<(), CommandError> {
        after_local_completion(
            self.service.issue_repository.connection(),
            ctx.issue.id,
            &ctx.session.working_dir,
            ctx.world.current_branch.as_deref(),
            state.closeout_action,
        )
    }
}

pub(crate) fn after_local_completion(
    connection: &Connection,
    issue_id: i64,
    working_dir: &str,
    branch: Option<&str>,
    closeout: Option<CloseoutAction>,
) -> Result<(), CommandError> {
    let Some(remote) = load_remote(connection, issue_id)? else {
        return Ok(());
    };
    if !issue_is_completed(connection, issue_id)? {
        return Ok(());
    }
    let method = match closeout {
        Some(CloseoutAction::OpenPullRequest) => CompletionMethod::OpenPullRequest,
        _ => CompletionMethod::MergeToBase,
    };
    let mut existing = load_pull_request(connection, issue_id)?;
    if method == CompletionMethod::OpenPullRequest && existing.is_none() {
        if let Some(branch) = branch {
            let host = if remote.provider == "gitlab" {
                ForgeHost::Gitlab
            } else {
                ForgeHost::Github
            };
            existing = find_open_change_request(Path::new(working_dir), host, branch);
        }
    }
    let (close_switch, comment_switch) = load_switches(connection, remote.project_id)?;
    let request = CompletionWriteback {
        remote_state: parse_remote_state(&remote.remote_state),
        close_remote_after_completion: close_switch,
        comment_summary: comment_switch,
        completion: method,
        local_completed: true,
        summary: load_summary(connection, issue_id)?,
        existing_open_pull_request: existing,
        merged_change_request: false,
    };
    // 合并完成会先删除 RedWhisk worktree。写回必须用仍在的项目仓库，不能用已删除的会话目录。
    let repo_path = project_repo_path(connection, remote.project_id)?;
    let forge = CliForge {
        provider: &remote.provider,
        repo_dir: Path::new(&repo_path),
        number: remote.number,
    };
    apply_persisted_writeback(connection, &forge, issue_id, method, &request)
}

pub(crate) fn apply_persisted_writeback(
    connection: &Connection,
    forge: &impl CompletionForge,
    issue_id: i64,
    method: CompletionMethod,
    request: &CompletionWriteback,
) -> Result<(), CommandError> {
    let mut book = load_book(connection, issue_id)?;
    let closed_before = book.close_done;
    let result = apply_completion_writeback(forge, &mut book, request);
    if !closed_before && book.close_done && request.remote_state == RemoteIssueState::Open {
        connection
            .execute(
                "UPDATE issue_external_refs SET remote_state = 'closed' WHERE issue_id = ?1",
                params![issue_id],
            )
            .map_err(persistence)?;
    }
    if let Some(url) = book.linked_pull_request.clone() {
        connection
            .execute(
                "INSERT INTO issue_pull_requests (issue_id, url, created_at)
                 VALUES (?1, ?2, CAST(strftime('%s','now') AS INTEGER))
                 ON CONFLICT(issue_id) DO NOTHING",
                params![issue_id, url],
            )
            .map_err(persistence)?;
    }
    save_book(connection, issue_id, method, &book)?;
    result.map_err(|error| {
        CommandError::new(
            CommandErrorCode::ForgeUnavailable,
            "Completion write-back failed.",
        )
        .with_reason(error_reason(&error))
    })
}

pub(crate) fn apply_change_request_merge_writeback(
    connection: &Connection,
    issue_id: i64,
    forge: &impl CompletionForge,
) -> Result<(), CommandError> {
    let existing = load_book(connection, issue_id)?;
    if existing.pending_error.is_some() {
        return Ok(());
    }
    if !issue_is_completed(connection, issue_id)? {
        let method =
            load_method(connection, issue_id)?.unwrap_or(CompletionMethod::OpenPullRequest);
        let mut waiting = existing;
        waiting.pending_error = Some("writebackUnavailable".to_string());
        save_book(connection, issue_id, method, &waiting)?;
        return Ok(());
    }
    let Some(remote) = load_remote(connection, issue_id)? else {
        return Ok(());
    };
    let method = load_method(connection, issue_id)?.unwrap_or(CompletionMethod::OpenPullRequest);
    let (close_switch, comment_switch) = load_switches(connection, remote.project_id)?;
    let request = CompletionWriteback {
        remote_state: parse_remote_state(&remote.remote_state),
        close_remote_after_completion: close_switch,
        comment_summary: comment_switch,
        completion: method,
        local_completed: true,
        summary: load_summary(connection, issue_id)?,
        existing_open_pull_request: load_pull_request(connection, issue_id)?,
        merged_change_request: true,
    };
    apply_persisted_writeback(connection, forge, issue_id, method, &request)
}

pub(crate) fn apply_change_request_merge_writeback_with_cli(
    connection: &Connection,
    issue_id: i64,
    repo_dir: &Path,
) -> Result<(), CommandError> {
    let Some(remote) = load_remote(connection, issue_id)? else {
        return Ok(());
    };
    let forge = CliForge {
        provider: &remote.provider,
        repo_dir,
        number: remote.number,
    };
    apply_change_request_merge_writeback(connection, issue_id, &forge)
}

pub(crate) fn retry_issue_completion_writeback_in_data_dir(
    data_dir: &Path,
    input: RetryIssueCompletionWritebackInput,
) -> Result<(), CommandError> {
    let database = open_issue_database(data_dir)?;
    retry_issue_completion_writeback_on(&database.connection, input.project_id, input.issue_id)
}

pub(crate) fn retry_issue_completion_writeback_on(
    connection: &Connection,
    project_id: i64,
    issue_id: i64,
) -> Result<(), CommandError> {
    let status = connection
        .query_row(
            "SELECT status FROM issues WHERE id = ?1 AND project_id = ?2 AND del = 0",
            params![issue_id, project_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(persistence)?;
    let Some(status) = status else {
        return Err(
            CommandError::new(CommandErrorCode::IssueNotFound, "Issue not found.")
                .with_reason("issueNotFound")
                .with_detail(ErrorDetail::new("Issue").with_value("issueId", issue_id)),
        );
    };
    if status != "completed" {
        return Ok(());
    }
    let Some(remote) = load_remote(connection, issue_id)? else {
        return Ok(());
    };
    let repo_path = project_repo_path(connection, remote.project_id)?;
    let forge = CliForge {
        provider: &remote.provider,
        repo_dir: Path::new(&repo_path),
        number: remote.number,
    };
    apply_retry_request(connection, issue_id, &remote, &forge)
}

#[cfg(test)]
pub(crate) fn retry_issue_completion_writeback_with(
    connection: &Connection,
    project_id: i64,
    issue_id: i64,
    forge: &impl CompletionForge,
) -> Result<(), CommandError> {
    let Some(remote) = prepare_retry(connection, project_id, issue_id)? else {
        return Ok(());
    };
    apply_retry_request(connection, issue_id, &remote, forge)
}

#[cfg(test)]
fn prepare_retry(
    connection: &Connection,
    project_id: i64,
    issue_id: i64,
) -> Result<Option<RemoteRef>, CommandError> {
    let status = connection
        .query_row(
            "SELECT status FROM issues WHERE id = ?1 AND project_id = ?2 AND del = 0",
            params![issue_id, project_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(persistence)?;
    let Some(status) = status else {
        return Err(
            CommandError::new(CommandErrorCode::IssueNotFound, "Issue not found.")
                .with_reason("issueNotFound")
                .with_detail(ErrorDetail::new("Issue").with_value("issueId", issue_id)),
        );
    };
    if status != "completed" {
        return Ok(None);
    }
    load_remote(connection, issue_id)
}

fn apply_retry_request(
    connection: &Connection,
    issue_id: i64,
    remote: &RemoteRef,
    forge: &impl CompletionForge,
) -> Result<(), CommandError> {
    let method = load_method(connection, issue_id)?.unwrap_or(CompletionMethod::MergeToBase);
    let (close_switch, comment_switch) = load_switches(connection, remote.project_id)?;
    let request = CompletionWriteback {
        remote_state: parse_remote_state(&remote.remote_state),
        close_remote_after_completion: close_switch,
        comment_summary: comment_switch,
        completion: method,
        local_completed: true,
        summary: load_summary(connection, issue_id)?,
        existing_open_pull_request: load_pull_request(connection, issue_id)?,
        merged_change_request: linked_change_request_is_merged(connection, issue_id)?,
    };
    apply_persisted_writeback(connection, forge, issue_id, method, &request)
}

fn linked_change_request_is_merged(
    connection: &Connection,
    issue_id: i64,
) -> Result<bool, CommandError> {
    let merged = connection
        .query_row(
            "SELECT 1
             FROM change_request_issue_links AS links
             JOIN change_requests AS requests ON requests.id = links.change_request_id
             WHERE links.issue_id = ?1 AND requests.state = 'merged'
             LIMIT 1",
            params![issue_id],
            |_| Ok(1_i64),
        )
        .optional()
        .map_err(persistence)?;
    Ok(merged.is_some())
}

pub(crate) fn detail_writeback(
    connection: &Connection,
    issue_id: i64,
) -> Result<(bool, Option<String>), CommandError> {
    let error_code = connection
        .query_row(
            "SELECT error_code FROM issue_completion_writebacks WHERE issue_id = ?1",
            params![issue_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(persistence)?
        .flatten();
    Ok((error_code.is_some(), error_code))
}

fn load_remote(connection: &Connection, issue_id: i64) -> Result<Option<RemoteRef>, CommandError> {
    connection
        .query_row(
            "SELECT project_id, provider, external_number, remote_state
             FROM issue_external_refs WHERE issue_id = ?1",
            params![issue_id],
            |row| {
                Ok(RemoteRef {
                    project_id: row.get(0)?,
                    provider: row.get(1)?,
                    number: row.get(2)?,
                    remote_state: row.get(3)?,
                })
            },
        )
        .optional()
        .map_err(persistence)
}

fn project_repo_path(connection: &Connection, project_id: i64) -> Result<String, CommandError> {
    connection
        .query_row(
            "SELECT repo_path FROM projects WHERE id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .map_err(persistence)
}

fn issue_is_completed(connection: &Connection, issue_id: i64) -> Result<bool, CommandError> {
    let status = connection
        .query_row(
            "SELECT status FROM issues WHERE id = ?1",
            params![issue_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(persistence)?;
    Ok(status.as_deref() == Some("completed"))
}

fn load_switches(connection: &Connection, project_id: i64) -> Result<(bool, bool), CommandError> {
    connection
        .query_row(
            "SELECT issue_writeback_close_on_complete, issue_writeback_comment
             FROM projects WHERE id = ?1",
            params![project_id],
            |row| Ok((row.get::<_, i64>(0)? != 0, row.get::<_, i64>(1)? != 0)),
        )
        .map_err(persistence)
}

pub(crate) fn load_summary(connection: &Connection, issue_id: i64) -> Result<String, CommandError> {
    let body = connection
        .query_row(
            "SELECT body FROM issue_comments
             WHERE issue_id = ?1 AND linked_session_id IS NOT NULL
             ORDER BY id DESC LIMIT 1",
            params![issue_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(persistence)?;
    Ok(body.unwrap_or_default())
}

fn load_pull_request(
    connection: &Connection,
    issue_id: i64,
) -> Result<Option<String>, CommandError> {
    connection
        .query_row(
            "SELECT url FROM issue_pull_requests WHERE issue_id = ?1",
            params![issue_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(persistence)
}

fn load_book(connection: &Connection, issue_id: i64) -> Result<WritebackBook, CommandError> {
    let row = connection
        .query_row(
            "SELECT close_done, comment_done, error_code
             FROM issue_completion_writebacks WHERE issue_id = ?1",
            params![issue_id],
            |row| {
                Ok(WritebackBook {
                    close_done: row.get::<_, i64>(0)? != 0,
                    comment_done: row.get::<_, i64>(1)? != 0,
                    pending_error: row.get(2)?,
                    linked_pull_request: None,
                })
            },
        )
        .optional()
        .map_err(persistence)?;
    Ok(row.unwrap_or_default())
}

fn load_method(
    connection: &Connection,
    issue_id: i64,
) -> Result<Option<CompletionMethod>, CommandError> {
    let value = connection
        .query_row(
            "SELECT completion_method FROM issue_completion_writebacks WHERE issue_id = ?1",
            params![issue_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(persistence)?;
    Ok(value.map(|value| CompletionMethod::parse(&value)))
}

fn save_book(
    connection: &Connection,
    issue_id: i64,
    method: CompletionMethod,
    book: &WritebackBook,
) -> Result<(), CommandError> {
    connection
        .execute(
            "INSERT INTO issue_completion_writebacks (
                issue_id, completion_method, close_done, comment_done, error_code, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, CAST(strftime('%s','now') AS INTEGER))
             ON CONFLICT(issue_id) DO UPDATE SET
                close_done = excluded.close_done,
                comment_done = excluded.comment_done,
                error_code = excluded.error_code,
                updated_at = excluded.updated_at",
            params![
                issue_id,
                method.as_str(),
                i64::from(book.close_done),
                i64::from(book.comment_done),
                book.pending_error,
            ],
        )
        .map_err(persistence)?;
    Ok(())
}

fn parse_remote_state(value: &str) -> RemoteIssueState {
    if value == "closed" {
        RemoteIssueState::Closed
    } else {
        RemoteIssueState::Open
    }
}

fn persistence(error: rusqlite::Error) -> CommandError {
    CommandError::new(
        CommandErrorCode::IssuePersistenceFailed,
        "Failed to save completion write-back.",
    )
    .with_reason("writebackSaveFailed")
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}
