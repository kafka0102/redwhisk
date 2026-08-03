use std::path::Path;

use super::service::{AgentSessionService, SessionLaunchContext};
use crate::agent::agent_event_broadcaster::AgentEventBroadcaster;
use crate::agent::provider_factory::{
    AgentSessionProviderFactory, AgentSessionStartRequest, StartedSession, ThreadIdBackfill,
};
use crate::agent::session_handle::AgentSessionError;
use crate::agent::session_registry::AgentSessionRegistry;
use crate::db::agent_session_repository::AgentSessionRepository;
use crate::db::issue_attachment_repository::IssueAttachmentRepository;
use crate::db::issue_repository::IssueRepository;
use crate::git::worktree::{
    cleanup_worktree, create_worktree_for_issue, list_local_branches,
};
use crate::git::worktree_name::issue_worktree_base_name;
use crate::types::agent_session::{
    AgentMessageAttachment, StartAgentSessionInput, WorkspaceMode, WorktreeOwner,
};
use crate::types::errors::{
    CommandError, CommandErrorCode, ErrorDetail,
};
use crate::types::issue::IssueStatus;



use crate::agent::descriptor_for;
use super::log_path::{build_log_path, remove_session_log_file};
use super::validation::{validate_profile_not_deleted, validate_profile_scope, validate_working_dir};
use super::worktree_setup::run_worktree_setup_command;
use super::service::{agent_session_database_error, agent_session_error_to_command_error, agent_session_start_error, current_epoch_millis, resolve_target_branch, resolve_worktree_root_path, worktree_create_error};

impl AgentSessionService<'_> {
    /// DB commit 之后的共享启动后半段（issue 结构化路径）。
    ///
    /// mark_starting → factory.start → thread_id 回填 → broadcast/register →
    /// initial prompt；失败 unmark/shutdown/rollback/清理自有 worktree。
    #[allow(clippy::too_many_arguments)]
    pub(super) fn finish_structured_issue_provider_start(
        &self,
        factory: &dyn AgentSessionProviderFactory,
        request: AgentSessionStartRequest,
        agent_registry: &AgentSessionRegistry,
        broadcaster: &AgentEventBroadcaster,
        prompt_snapshot: &str,
        project_id: i64,
        issue_id: i64,
        session_id: i64,
        launch: &SessionLaunchContext,
        previous_archive_path: Option<&str>,
    ) -> Result<(), CommandError> {
        // DB 事务已 commit（session 为 running），后续 handle 启动 + send_message
        // 仍耗时。mark_starting 让 contains 返回 true，reconcile 据此跳过；
        // register 真实 handle 时自动清除，失败路径需显式 unmark。
        agent_registry.mark_starting(session_id);
        let started = match start_provider_session(factory, request) {
            Ok(started) => started,
            Err(error) => {
                agent_registry.unmark_starting(session_id);
                self.cleanup_owned_worktree(project_id, launch);
                let _ = self.rollback_failed_structured_issue_session(project_id, issue_id, session_id);
                return Err(error);
            }
        };
        if let Err(error) =
            persist_started_session_thread_id(&self.agent_session_repository, session_id, &started)
        {
            agent_registry.unmark_starting(session_id);
            started.handle.shutdown();
            self.cleanup_owned_worktree(project_id, launch);
            let _ = self.rollback_failed_structured_issue_session(project_id, issue_id, session_id);
            return Err(error);
        }

        broadcaster.register_session(session_id);
        let handle = started.handle;
        // 首条派发消息标记为 initial turn 来源；写 source 同时清空 current_turn_id。
        let _ = self
            .agent_session_repository
            .update_current_turn_source(session_id, "initial");
        let attachments = load_issue_message_attachments(
            self.issue_repository.connection(),
            issue_id,
        )?;
        if let Err(error) = handle.send_message(prompt_snapshot.to_string(), attachments) {
            agent_registry.unmark_starting(session_id);
            handle.shutdown();
            self.cleanup_owned_worktree(project_id, launch);
            let _ = self.rollback_failed_structured_issue_session(project_id, issue_id, session_id);
            return Err(agent_session_error_to_command_error(error));
        }
        agent_registry.register(session_id, handle);
        remove_session_log_file(previous_archive_path);
        Ok(())
    }


    pub(super) fn rollback_failed_structured_issue_session(
        &self,
        project_id: i64,
        issue_id: i64,
        session_id: i64,
    ) -> Result<(), CommandError> {
        let transaction = self
            .issue_repository
            .connection()
            .unchecked_transaction()
            .map_err(agent_session_database_error)?;
        AgentSessionRepository::soft_delete_in_transaction(
            &transaction,
            session_id,
            current_epoch_millis()?,
        )
        .map_err(agent_session_database_error)?;
        IssueRepository::update_status_in_transaction(
            &transaction,
            project_id,
            issue_id,
            IssueStatus::Backlog,
        )
        .map_err(agent_session_database_error)?;
        transaction.commit().map_err(agent_session_database_error)?;
        Ok(())
    }


    /// Agent 进程启动失败时清理 Redwhisk 自建 worktree。
    ///
    /// 仅在「agent 未真正产出」的启动失败路径调用：此时 worktree 无成果需保留，
    /// 清理可避免残留目录/分支卡死下次启动（分支已检出 → `git worktree add` 失败）。
    /// 外部/当前分支（External）不动；best-effort：清理失败不阻塞错误返回。
    pub(super) fn cleanup_owned_worktree(&self, project_id: i64, launch: &SessionLaunchContext) {
        if launch.worktree_owner != WorktreeOwner::Redwhisk {
            return;
        }
        let (Some(workspace_path), Some(workspace_branch)) = (
            launch.workspace_path.as_deref(),
            launch.workspace_branch.as_deref(),
        ) else {
            return;
        };
        let Ok(project) = self.project_by_id(project_id) else {
            return;
        };
        let _ = cleanup_worktree(&project.repo_path, workspace_path, workspace_branch);
    }


    pub(super) fn prepare_issue_session_launch(
        &self,
        data_dir: &Path,
        input: &StartAgentSessionInput,
    ) -> Result<SessionLaunchContext, CommandError> {
        let project = self.project_by_id(input.project_id)?;
        let profile = self
            .agent_profile_repository
            .find_profile_by_id(input.agent_profile_id)
            .map_err(agent_session_database_error)?
            .ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::AgentProfileValidationFailed,
                    "Agent Profile 不存在。",
                ).with_reason("profileNotFound")
                .with_detail(
                    ErrorDetail::new("AgentProfile")
                        .with_value("agentProfileId", input.agent_profile_id),
                )
            })?;

        validate_profile_not_deleted(&profile)?;
        validate_profile_scope(&profile, input.project_id)?;

        let started_at = current_epoch_millis()?;
        let log_path = build_log_path(
            data_dir,
            input.project_id,
            &format!("issue-{}", input.issue_id),
            input.agent_profile_id,
            started_at,
        )?;
        let command_snapshot = descriptor_for(&profile.agent_type)
            .build_launch_command_snapshot(&profile.command);
        let branch_info =
            list_local_branches(&project.repo_path).map_err(agent_session_start_error)?;
        let workspace_mode = input
            .workspace_mode
            .clone()
            .unwrap_or(WorkspaceMode::CurrentBranch);
        let worktree_setup_command = Some(
            input
                .worktree_setup_command
                .as_deref()
                .unwrap_or(&project.worktree_setup_command)
                .trim()
                .to_string(),
        );

        match workspace_mode {
            WorkspaceMode::CurrentBranch => Ok(SessionLaunchContext {
                profile,
                working_dir: validate_working_dir(&project.repo_path)?,
                log_path,
                command_snapshot,
                started_at,
                workspace_mode: WorkspaceMode::CurrentBranch,
                target_branch: Some(branch_info.current_branch.clone()),
                workspace_branch: Some(branch_info.current_branch.clone()),
                workspace_path: Some(project.repo_path.clone()),
                origin_branch: Some(branch_info.current_branch),
                worktree_owner: WorktreeOwner::External,
                worktree_root_path: None,
                worktree_setup_command: worktree_setup_command.clone(),
            }),
            WorkspaceMode::Worktree => {
                if let Some(existing) = self
                    .agent_session_repository
                    .find_latest_worktree_session_by_issue_id(input.issue_id)
                    .map_err(agent_session_database_error)?
                {
                    if let Some(workspace_path) = existing.workspace_path.as_deref() {
                        if Path::new(workspace_path).exists() {
                            return Err(CommandError::new(
                                CommandErrorCode::IssueWorktreeOccupied,
                                "同名 worktree 已被占用，请删除后再运行。",
                            )
                            .with_detail(
                                ErrorDetail::new("Issue").with_value("issueId", input.issue_id),
                            )
                            .with_detail(
                                ErrorDetail::new("Worktree")
                                    .with_value("workspacePath", workspace_path),
                            ));
                        }
                    }
                }

                let target_branch =
                    resolve_target_branch(&branch_info, input.target_branch.as_deref())?;
                let worktree_root_path = resolve_worktree_root_path(&project)?;
                let issue_number = self
                    .issue_repository
                    .find_by_id(input.issue_id)
                    .map_err(agent_session_database_error)?
                    .ok_or_else(|| {
                        CommandError::new(CommandErrorCode::IssueNotFound, "Issue 不存在。").with_reason("issueNotFound")
                            .with_detail(
                                ErrorDetail::new("Issue").with_value("issueId", input.issue_id),
                            )
                    })?
                    .number;
                // 检测磁盘上残留的同名 worktree（如上次启动失败后未清理）。
                // session 行检查（上方）覆盖有 session 记录的情况；此处补 disk 检测，
                // 覆盖回滚后无 session 但 worktree 目录仍在的情况，给出清晰「占用」错误，
                // 避免走到 create_worktree_for_issue 因分支已检出被误标成「进程启动失败」。
                let workspace_base_name =
                    issue_worktree_base_name(issue_number, Path::new(&project.repo_path));
                let primary_worktree_path =
                    Path::new(&worktree_root_path).join(&workspace_base_name);
                if primary_worktree_path.exists() {
                    return Err(CommandError::new(
                        CommandErrorCode::IssueWorktreeOccupied,
                        "同名 worktree 已被占用，请删除后再运行。",
                    )
                    .with_detail(
                        ErrorDetail::new("Issue").with_value("issueId", input.issue_id),
                    )
                    .with_detail(
                        ErrorDetail::new("Worktree")
                            .with_value("workspacePath", primary_worktree_path.to_string_lossy()),
                    ));
                }
                let created = create_worktree_for_issue(
                    &project.repo_path,
                    &worktree_root_path,
                    issue_number,
                    &target_branch,
                )
                .map_err(worktree_create_error)?;
                if let Err(error) = run_worktree_setup_command(
                    &created.workspace_path,
                    worktree_setup_command.as_deref(),
                ) {
                    let _ = cleanup_worktree(
                        &project.repo_path,
                        &created.workspace_path,
                        &created.workspace_branch,
                    );
                    return Err(error);
                }

                Ok(SessionLaunchContext {
                    profile,
                    working_dir: created.workspace_path.clone(),
                    log_path,
                    command_snapshot,
                    started_at,
                    workspace_mode: WorkspaceMode::Worktree,
                    target_branch: Some(created.target_branch),
                    workspace_branch: Some(created.workspace_branch),
                    workspace_path: Some(created.workspace_path),
                    origin_branch: Some(branch_info.current_branch),
                    worktree_owner: WorktreeOwner::Redwhisk,
                    worktree_root_path: Some(created.worktree_root_path),
                    worktree_setup_command,
                })
            }
        }
    }



}

/// 经可注入 factory 启动 provider 会话（构造侧 seam，ADR-0011）。
///
/// 将 `UnsupportedMode` 映射为校验失败，其余走 `agent_session_error_to_command_error`。
pub(super) fn start_provider_session(
    factory: &dyn AgentSessionProviderFactory,
    request: AgentSessionStartRequest,
) -> Result<StartedSession, CommandError> {
    factory.start(request).map_err(|error| match error {
        AgentSessionError::UnsupportedMode(mode) => CommandError::new(
            CommandErrorCode::AgentSessionValidationFailed,
            "不支持的 Codex 协作模式。",
        )
        .with_reason("unsupportedCodexMode")
        .with_detail(ErrorDetail::new("Field").with_value("name", "mode"))
        .with_detail(ErrorDetail::new("Value").with_value("mode", mode)),
        other => agent_session_error_to_command_error(other),
    })
}


/// 按 `StartedSession.backfill` 声明写回 thread id；service 不按 agent_type 分支。
pub(super) fn persist_started_session_thread_id(
    repository: &AgentSessionRepository<'_>,
    session_id: i64,
    started: &StartedSession,
) -> Result<(), CommandError> {
    match started.backfill {
        ThreadIdBackfill::Required => {
            let thread_id = started.thread_id.as_deref().ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::AgentSessionStreamFailed,
                    "Agent 会话启动后未拿到 threadId。",
                )
                .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session_id))
            })?;
            repository
                .update_provider_session_id(session_id, thread_id)
                .map_err(agent_session_database_error)?;
        }
        ThreadIdBackfill::WhenPresent => {
            if let Some(thread_id) = started.thread_id.as_deref() {
                repository
                    .update_provider_session_id(session_id, thread_id)
                    .map_err(agent_session_database_error)?;
            }
        }
        ThreadIdBackfill::DeferToStream => {}
    }
    Ok(())
}


/// 把 Issue 附件映射为协议中立的 agent 消息附件（仅保留磁盘上仍存在的文件）。
fn load_issue_message_attachments(
    connection: &rusqlite::Connection,
    issue_id: i64,
) -> Result<Vec<AgentMessageAttachment>, CommandError> {
    let records = IssueAttachmentRepository::new(connection)
        .list_by_issue_id(issue_id)
        .map_err(agent_session_database_error)?;
    Ok(records
        .into_iter()
        .filter(|record| Path::new(&record.absolute_path).is_file())
        .map(|record| AgentMessageAttachment {
            path: record.absolute_path,
            display_name: record.display_name,
            kind: record.kind.into(),
        })
        .collect())
}
