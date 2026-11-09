# Tauri Command 与 Event 契约

本文档是跨 React/Rust 边界的导航和变更清单。完整字段以 `src-tauri/src/types/`、对应前端 `*-commands.ts` 及 `src-tauri/src/lib.rs` 的 `generate_handler!` 为准。重构后 command 实现位置见注册表 adapter 列；wrapper 可能位于 `features/<feature>/` 或 `shared/commands/`（全局/跨 feature 命令在后者）。

## 固定约定

- Rust command 用 `snake_case` 动词短语；前端 wrapper 用 `camelCase`，统一经 `invokeCommand` 调用。
- DTO struct 用 `#[serde(rename_all = "camelCase")]`；状态 enum 用 `snake_case`。ID 与 epoch milliseconds 时间在前端均为 `number`。
- 成功结果返回显式 DTO；列表包进对象，如 `{ issues: IssueBoardRecord[] }`。
- 失败返回 `CommandError`：`code`、`message`、可选 `reason`、可选 `details`；每个 detail 必须有 `@type`。
- 前端以 `getCommandErrorMessage(error, t)` 做本地化；Rust 不返回面向 locale 的文案逻辑。
- **Agent Session 新建**必须关联 Issue：仅 `start_agent_session`（及 Issue 完成相关注入等既有路径）；不存在、不得再注册无 Issue / structured standalone 新建 command（[ADR-0024](../adr/0024-agent-session-must-link-issue.md)）。历史独立 Session 的 list / resume / delete / title 等非新建 command 仍可保留。

## Command 注册表

| 分组         | Command                                                                                                                                                            | 前端 wrapper / 类型                                                 | Rust adapter                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ---------------------------------------- |
| 初始化       | `initialize_local_data`                                                                                                                                            | `features/project/project-commands.ts`                              | `commands/core_commands.rs`              |
| 项目         | `create_project`、`list_projects`、`remove_project_from_list`、`delete_project`、`open_project`、`open_project_window`、`update_project_settings`、`validate_project_repo_path`、`get_project_issue_source_settings`、`update_project_issue_source_settings`、`inspect_project_issue_connection`、`get_project_completion_card` | `features/project/project-commands.ts`；Issue 来源三条见 `features/settings/issue-source-commands.ts`；完成后卡片见 `features/project/project-forge-commands.ts` | `features/project/commands.rs`、`issue_source_commands.rs` |
| Issue        | `list_issues`、`create_issue`、`update_issue`、附件 draft/preview/export、`mark_issue_review`、`advance_issue_status`、完成 flow、summary、`get_issue_detail`、`apply_issue_recovery`、`retry_issue_completion_writeback`、`get_issue_timeline`、delete、`prepare_agent_commit_completion`、`send_agent_commit_prompt`、`detect_agent_commit_completion`、`get_issue_worktree_status`、`delete_issue_worktree` | `features/issues/issue-commands.ts`、`features/issues/issue-timeline-commands.ts`、`features/issues/issue-detail/issue-detail-commands.ts` | `features/issue/commands.rs`、`features/issue/unavailable_recovery.rs` |
| Issue 镜像   | `sync_project_issues`、`get_issue_sync_status` | `features/issues/issue-mirror-commands.ts` | `features/issue/commands.rs` |
| 变更请求     | `list_project_change_requests`、`get_project_change_request`、`mark_change_request_ready`、`request_change_request_review`、`close_change_request` | `features/issues/change-request-commands.ts` | `features/change_request/commands.rs` |
| 变更请求同步 | `sync_project_change_requests` | `features/issues/change-request-commands.ts` | `features/change_request/commands.rs` |
| 变更请求关联 | `link_change_request_issue` | `features/issues/change-request-commands.ts` | `features/change_request/commands.rs` |
| 变更请求创建 | `preview_change_request`、`create_change_request` | `features/project/project-forge-commands.ts` | `features/project/change_request_commands.rs` |
| 会话         | session 列表/Issue 启动/标题/attention、`get_project_git_branches`、`inject_agent_session_prompt`、Agent Session 续接（resume_agent_session）、完成回看（open_completed_review）、展示形式切换（switch_agent_session_display_mode）、`delete_agent_session`、消息、`steer_agent_turn`（把 Session 输入框消息插入正在运行的 Turn）、取消、权限、模型/思考/模式（含 `list_agent_profile_models`，按项目+Profile 启动前查模型）、附件、timeline、`read_timeline_item_at_offset`（按会话日志行起始字节回读这一行）、TUI 终端 write/resize/restore/subscribe/read（新建须关联 Issue，无 standalone 新建 command） | `features/agents/agent-session-commands.ts`                         | `features/agent_session/commands.rs`、`tui_terminal_commands.rs` |
| 工作区       | changes、`list_code_workspace_roots`、file tree、commit history（可选 `limit`/`offset`，响应 `hasMore`）、file、`write_project_worktree_file`、`stat_project_worktree_file`、`create_project_worktree_file`、`create_project_worktree_directory`、`delete_project_worktree_path`、`copy_project_worktree_path`、`move_project_worktree_path`、diff、`search_project_worktree_content`、`list_project_checkout_branches`、`fetch_project_remotes`、`checkout_project_branch`、`create_project_branch`、`list_project_merge_branches`、`merge_project_branch`、`pull_project_worktree`、`push_project_worktree`、`delete_code_workspace_worktree`、`resolve_workspace_github_remote`、`probe_github_commit` | `shared/workspace/workspace-commands.ts`                            | `features/agent_session/workspace_commands.rs` |
| 项目终端     | 创建、`create_temporary_project_terminal`、`list_project_terminals`、`ensure_project_terminals`、`subscribe_project_terminal_output`、`unsubscribe_project_terminal_output`、读写、恢复、resize、关闭、配置与快捷命令、cwd、`set_app_theme` | `features/terminals/project-terminal-commands.ts`                   | `features/project_terminal/commands.rs`  |
| Settings     | command 检测、`test_agent_command`、profile、`save_agent_display_order`、`preview_agent_command_args`、label、保存的 skill CRUD、`get_user_profile`、`update_user_profile`、`detect_tui_hook_registration`、`install_tui_hook`、`uninstall_tui_hook`、`enable_codex_hooks_feature` | `features/settings/settings-commands.ts`                            | `features/settings/commands.rs`、`tui_hook_commands.rs` |
| Skill 索引   | `list_agent_skills`、`refresh_agent_skills`（返回 `changedCount`）、`reconcile_saved_agent_skills`                                                                   | `features/settings/settings-commands.ts`                            | `features/settings/agent_skill_commands.rs` |
| 会话监控窗口 | 打开/关闭 monitor、列出与定位会话                                                                                                                                  | `features/agents/session-notifications/session-monitor-commands.ts` | `features/agent_session/session_monitor_commands.rs` |
| 代码语言智能 | `ensure_code_language_host`、`stop_code_language_host`、`notify_code_language_document`、`code_language_definition`、`code_language_references`                                                                              | `features/code/code-language-commands.ts`                           | `features/code_language/commands.rs`     |
| 应用更新     | `get_update_status`、`dismiss_update_prompt`                                                                                                                       | `shared/commands/app-update-commands.ts`                            | `features/app_update/commands.rs`        |
| 应用主题     | `set_app_theme`（入参 `themePreference` + 已解析 `theme`；当前挂在 `project_terminal` 模块，语义属应用级，未来宜迁出）                                              | `shared/commands/app-commands.ts`                                   | `features/project_terminal/commands.rs`、`types/app_theme.rs`  |

新增 command 必须同时更新 Rust DTO、adapter、`generate_handler!`、前端 wrapper、类型和成功/失败路径测试；并同步更新本注册表对应行 + 错误码到前端 locale 的映射（见错误码边界表）。不要只在本表新增名称。

> `get_project_issue_source_settings` 只读 SQLite，未探测时 `connection.authStatus` 为 `unknown`。返回的 `localIssueCount` 与 `remoteIssueCount` 是该项目 `issues.del = 0` 且 `source` 分别为 `local`、`remote` 的行数，不套用当前来源模式的可见性过滤，也不调用同步或连接探测。`update_project_issue_source_settings` 只写项目来源配置，缺省字段保持原值；非法模式、范围、间隔、空标签或非布尔返回 `ProjectValidationFailed`，reason 分别为 `issueSourceModeInvalid`、`issueSyncScopeInvalid`、`issueSyncIntervalInvalid`、`issueSyncLabelRequired`、`issueSourceSettingsInvalid`。`inspect_project_issue_connection` 用 git remote 与 gh/glab `auth status` 覆盖连接快照，不启动交互式登录，也不拉取远程 Issue。

> `get_project_completion_card` 只读本地 git remote 与已保存的完成后设置，不跑 `gh` / `glab auth status`。返回 `host`、`repoDefaultBranch`、`completionAction`、`prTarget`、`prDraft`、`confirmCompletionAction`。不返回 CLI 是否安装或是否登录。`host` 为 `github`、`gitlab` 或 `none`。git 失败、没有 remote、或 remote 不是 GitHub / GitLab 时成功返回 `host` `none` 且 `repoDefaultBranch` 为 null，并带上已保存动作。不写回 `projects.forge_host`。项目不存在返回 `ProjectNotFound`。阻塞的 SQLite 与 git 放在 `spawn_blocking`。

> `validate_project_repo_path` 在原有建议之外，命中已有项目时返回 `existingProject`。其中包含 `worktreeLocation`、`worktreeSetupCommand`、`issueSourceMode`、`issueSyncScope`、`issueSyncLabel`、`issueSyncEnabled`、`issueSyncIntervalSeconds`、`issueWritebackCloseOnComplete`、`issueWritebackCloseOnPrMerge`、`issueWritebackComment`、`completionAction`、`prTarget`、`prDraft`、`confirmCompletionAction`。响应还可带 `repoDefaultBranch`。入参 `probeConnection` 为真时才返回 `connection`，并且不写项目 Forge 连接。

> `get_issue_detail` 读取一张 Issue 的宿主投影、关联 PR URL、完成写回状态和远端不可用横幅。打开详情时若外部身份仍参与同步，会用宿主 CLI 探测这一条：404、410 和无权限把 `sync_status` 标为 `unavailable`，不删除 Issue、评论、附件、Session 或完成记录。其它探测失败保持原状态。`unavailableBanner` 仅在不可用时非 null，`showsDeleteConfirmation` 为 false，`actions` 恰好是 `keep_local`、`unlink`、`retry`。保留为本地或移除关联后投影为 null。Issue 不存在或已软删除返回 `IssueNotFound`。没有外部引用时 `projection` 为 null。`remoteState` 只返回 `open`、`closed`、`unavailable`。`linkedChangeRequests` 是关联变更请求列表，没有一等链接时为 `[]`（仅 URL 的旧记录不返回）；每条含 `provider`、`url`、`number`、`state`、`checksOk`、`checksFailed`、`checksPending`、`title`、`sourceBranch`、`targetBranch`，按链接创建时间升序、相同时按变更请求 `id` 升序，只读 SQLite，不为这张卡访问网络。`writebackPending` 为 true 时 `writebackError` 是 `writebackUnauthenticated`、`writebackForbidden`、`writebackOffline` 或 `writebackUnavailable`，对应 `errors.FORGE_UNAVAILABLE` 同名键。没有待写回时 `writebackPending` 为 false，`writebackError` 为 null。

> `apply_issue_recovery` 对不可用横幅的三个动作共用一个入口。`action` 为 `keep_local`、`unlink` 或 `retry`。Issue 不存在返回 `IssueNotFound`，reason `issueNotFound`。保留为本地把 `issues.source` 改为 `local`，外部身份改为 `kept_local` 并不再参与同步。移除关联把身份改为 `unlinked`，后续同步跳过，时间轴增加 `remote_origin`，`commentBody` 是原来的外部 URL。重试重新探测：成功后横幅消失并继续同步，失败则横幅仍在且 Issue 行仍在。命令失败的 join 错误是 `IssuePersistenceFailed`，reason `recoveryFailed`。

> `retry_issue_completion_writeback` 重试同一条已完成远程 Issue 的写回。Issue 不存在返回 `IssueNotFound`，reason `issueNotFound`。写回再次失败返回 `ForgeUnavailable`，reason 与上面的 `writebackError` 相同，不把本地完成改回未完成。成功后评论总数仍是一条。命令任务本身失败返回 `IssuePersistenceFailed`，reason `writebackRetryFailed`。待写回状态落库失败返回 `IssuePersistenceFailed`，reason `writebackSaveFailed`。这两个 reason 对应 `errors.ISSUE_PERSISTENCE_FAILED` 同名键。

> `get_issue_timeline` 仍是唯一时间轴命令，不另开第二条。返回按 `createdAt` 升序合并的本地动作、本地评论、远程评论和远程系统事件。`IssueTimelineEntry.source` 为 `local` 或 `remote`。远程评论的 `actionType` 是 `remote_comment`，不是 `issue_comment_added`；系统事件是 `remote_event`。移除关联留下的远程来历是 `remote_origin`，`commentBody` 为外部 URL。本地评论正文只出现在 `commentBody`，不写入动作负载。该命令不访问网络。

> `sync_project_issues` 同步当前项目的 GitHub 或 GitLab Issue 镜像，不新增 command。`list_issues` 返回 `IssueBoardRecord`，在 Issue 字段上附加 `source`、`provider`、`externalNumber`、`remoteState`、`remoteLabels`、`syncStatus`、`remoteClosedWhileRunning`、`remoteReopened`、`pullRequestUrl`。这些字段由 DTO parity 核对。成功、跳过、凭据过期和缓存失败都返回 `outcome`，并广播 `issue-sync-changed`。outcome 集合是 `synced`、`skipped`、`credential_expired`、`cache_failed`、`coalesced`。同一项目的同步锁被占用时返回 `coalesced`，不改已有镜像。项目不存在返回 `ProjectNotFound`，消息为 `Project not found.`。标签范围为空时返回既有 `ProjectValidationFailed`（`reason=issueSyncLabelRequired`）。`get_issue_sync_status` 返回 `lastSyncedAt` 与 `syncError`。`syncError` 代码为 `credential_expired`、`cli_missing`、`offline`、`rate_limited`、`cache_failed`。`credential_expired` 的 outcome 是 `credential_expired`，另外四个的 outcome 是 `cache_failed`。一次同步只拉一次列表，阻塞的 CLI 与 SQLite 放在 `spawn_blocking`。`list_issues` 的 `sourceFilter` 可取 `all`、`local`、`remote`；缺省和空字符串都是 `all`，空字符串不报错。`local` 只留 `source=local`，`remote` 只留 `source=remote`。仅本地和仅远程模式忽略该参数。`statusTotals` 是过滤后的各状态总数，不是当前页张数。

> `list_project_change_requests` 一次返回当前筛选行、`tabCount` 和四个筛选计数。关联 Issue 带 `linkKind`。`filter` 缺省或空字符串是 `review_requested`；还可取 `created_by_me`、`all_open`、`recently_merged`。其它字符串返回 `ProjectValidationFailed`，reason `changeRequestFilterInvalid`。项目不存在返回 `ProjectNotFound`，消息 `Project not found.`。`tabCount` 是已入库行数，不是当前筛选条数。观察者缺省时读取 `project_forge_connections.login`；登录名为空时「需要我审阅」和「我创建的」计数为 0。阻塞的 SQLite 放在 `spawn_blocking`。任务本身失败返回 `IssuePersistenceFailed`，reason `queryFailed`。命令顺带把已有 `issue_pull_requests.url` 解析到 `change_request_id`，解析失败或没有对应行时不改 URL、不插入 change request。

> `get_project_change_request` 按 `projectId`、`provider`、`number` 读取一条已入库变更请求的详情，并把文件、检查、评审、评论写入已有 `change_request_details` JSON。不新建 PR 模型，也不发详情事件。`detailStatus` 只取 `fresh`、`cached`、`unavailable`。拉取成功是 `fresh`。拉取失败但已有快照是 `cached`，JSON 保持失败前的内容。拉取失败且没有快照是 `unavailable`，四个数组为空，头部仍来自列表行并带 `detailError`。`detailError` 只在非 fresh 时出现，取值 `credential_expired`、`cli_missing`、`offline`、`rate_limited`、`cache_failed`。该项目没有这条变更请求返回 `IssueNotFound`，reason `changeRequestNotFound`。provider 为空串、空白、不是 `github`/`gitlab`，或 number 小于 1，返回 `ProjectValidationFailed`，reason `changeRequestDetailInvalid`。项目不存在返回 `ProjectNotFound`，消息 `Project not found.`。命令任务本身失败返回 `IssuePersistenceFailed`，reason `changeRequestDetailFailed`。阻塞的 CLI 与 SQLite 放在 `spawn_blocking`。前端不拼 `gh` / `glab`。详情里的 `authorLogin`、`sourceBranch`、`targetBranch`、`commitCount`、`reviewDecision`、`mergeStateStatus`、`blockingReasons`、`mergeMethod`、`mergeCommitSha`、`linkedIssues` 缺了就不造假值。文件项用 `patchStatus`。检查项用 `durationMs` 和 `logUrl`。讨论项用 `createdAt`。`readySupported` 与 `reviewSupported` 表示当前宿主能不能标记就绪、请求审阅。详情刷新成功时会先把 `change_requests.state` 写成宿主状态。合并写回不能只靠「同步时看到状态从非 merged 变成 merged」：详情先写 state 后，下一次列表同步看不到边沿。写回测试要同时覆盖详情刷新触发一次，以及失败后再次同步不再打宿主。

> `mark_change_request_ready`、`request_change_request_review`、`close_change_request` 成功时返回刷新后的详情，包含 `readySupported` 与 `reviewSupported`。前端等这份响应回来再替换详情，不提前把 `state` 改成 `open` 或 `closed`。不发新事件。阻塞的 CLI 与 SQLite 放在 `spawn_blocking`。标记就绪只接受 `draft`，否则 `IssueValidationFailed`，reason `changeRequestNotDraft`，不调用宿主。宿主不支持标记就绪时 `ForgeUnavailable`，reason `changeRequestReadyUnsupported`，状态保持 `draft`。请求审阅的 `reviewer` 去掉空白后为空时 `IssueValidationFailed`，reason `changeRequestReviewerMissing`，不调用宿主。宿主不支持请求审阅时 `ForgeUnavailable`，reason `changeRequestReviewUnsupported`，不写入伪造审阅者。关闭只接受 `open`，否则 `IssueValidationFailed`，reason `changeRequestNotOpen`，不调用宿主；成功后的 `state` 是 `closed`，不是 `merged`。三个命令遇到宿主失败都保持原状态：认证过期 `credentialExpired`，无写权限 `writeForbidden`，限流 `rateLimited`，对象不存在 `changeRequestNotFound`（`IssueNotFound`），CLI 缺失 `forgeCliMissing`，离线 `forgeOffline`。其余宿主失败是 `ForgeUnavailable`，reason `changeRequestActionFailed`。`credentialExpired`、`writeForbidden`、`rateLimited`、`forgeCliMissing`、`forgeOffline`、`changeRequestReadyUnsupported`、`changeRequestReviewUnsupported`、`changeRequestActionFailed` 都是 `ForgeUnavailable`。命令任务本身失败返回 `IssuePersistenceFailed`，reason `changeRequestActionFailed`。失败不自动重试。

> `merge_change_request` 入参是 `projectId`、`provider`、`number`、`method`、`deleteSourceBranch`。没有 admin、auto、force。`method` 只接受宿主支持的非绕过方式 `squash`、`merge`、`rebase`；不支持时 `ForgeUnavailable`，reason `changeRequestMergeMethodUnsupported`，不调用宿主合并。GitHub 只有 `mergeable` 为 `MERGEABLE`、GitLab 只有 `mergeable` 为 `mergeable`，且 `blockingReasons` 为空，才调用宿主。`null`、空串、`UNKNOWN` 以及其它非空值或非空阻塞原因都返回 `IssueValidationFailed`，reason `changeRequestNotMergeable`，宿主合并调用次数为 0。成功返回刷新后的详情，含 `supportedMergeMethods` 与 `sourceBranchDeleted`。`sourceBranchDeleted` 只有宿主明确为 true 才表示源分支已删除。前端等这份响应回来再替换详情，不提前把 `state` 改成 `merged`。不发新事件。阻塞的 CLI 与 SQLite 放在 `spawn_blocking`。宿主合并失败保持原状态，reason `changeRequestActionFailed`。失败不自动重试。

> `sync_project_change_requests` 同步当前项目的 GitHub 或 GitLab PR/MR。open 与 draft 都入库；merged 与 closed 只保留最近 30 天。返回 `ChangeRequestSyncResult.outcome`：`synced`、`skipped`、`credential_expired`、`cache_failed`、`coalesced`。`errorCode` 只用 `credential_expired`、`cli_missing`、`offline`、`rate_limited`、`cache_failed`。仅本地模式不调用 forge，outcome 为 `skipped`。项目不存在返回 `ProjectNotFound`，消息 `Project not found.`。同一项目的 Issue 同步与 PR 同步共用一把进程内锁，拿不到锁时 outcome 为 `coalesced`，不清列表。成功后由 `emit_change_request_sync_changed` 广播 `change-request-sync-changed`。阻塞的 SQLite 与 CLI 放在 `spawn_blocking`。

> `link_change_request_issue` 写入 `link_kind=manual`。同一对重复调用不产生第二行，也不修改 Issue 完成状态。项目不存在返回 `ProjectNotFound`，消息 `Project not found.`。

> `create_change_request` 沿用变更页发布入口，成功返回 `url`。同分支已有打开请求时复用该 URL，不再创建第二条，并记下这条变更请求。`linkMode` 缺省或 `none` 不新增 manual 关联。`remote` 把正文追加为包含 `Closes #<remoteNumber>`，关联种类是 `closing`，需要 `linkIssueId` 与 `remoteNumber`。`local` 正文不追加 `Closes #<项目内编号>`，关联种类是 `manual`，需要 `linkIssueId`。缺少关联对象时 `ProjectValidationFailed`，reason `changeRequestLinkMissing`。其它 `linkMode` reason `changeRequestLinkInvalid`。未知宿主 reason `forgeUnknown`。完成流读不到请求编号时 reason `changeRequestNumberMissing`。CLI 缺失 reason `forgeCliMissing`。完成流提交 PR/MR 也使用 `forgeUnknown`：创建失败时本地 Issue 保持 `review`，不合并到 base；成功后当前 Issue 一定有一条关联，完成弹窗没有「不关联」。

> `create_issue`、`update_issue`、`advance_issue_status`、`mark_issue_review` 和完成流程返回 `IssueRecord`，不含上面的镜像字段。写回看板行时保留上一行缺失的字段，入口是 `retainIssueMirrorFields`（`issue-mirror-fields.ts`，由 `issue-description-serializer.ts` 的 `mergeIssue` 调用）。来源缺失、空串或 null 不是 local。

> `create_issue` 仍是既有命令，不另开远程创建 command。选择远程且连接就绪时，用当前 Forge CLI 创建远端 Issue，再在一个本地事务里写一条 `issues` 和一条 `issue_external_refs`。成功后发已有 `issue-sync-changed`。刷新失败不回滚远端，命令仍返回成功。连接未就绪，以及 `forge_create_error` 里的 `CliMissing`、`RateLimited`、`CommandFailed`，都返回 `ForgeUnavailable`，reason `remoteCreateUnavailable`（`errors.FORGE_UNAVAILABLE.remoteCreateUnavailable`），不写本地行。认证失败 reason `remoteCreateUnauthenticated`，无权限 `remoteCreateForbidden`，网络失败 `remoteCreateOffline`，空 URL、空编号或无法解析 `remoteCreateInvalid`；这些都是 `ForgeUnavailable`，locale 同名键在 `errors.FORGE_UNAVAILABLE`，不写本地行。远端已创建但本地事务失败返回 `IssuePersistenceFailed`，reason `remoteCreateMirrorFailed`。detail `@type=RemoteIssue` 的 `url` 是远端地址；前端 `errors.ISSUE_PERSISTENCE_FAILED.remoteCreateMirrorFailed` 用 `{{url}}` 展示。下一次同步按外部身份只导入一条。之后改标题、正文、标签、指派不写回远端。

> `save_agent_display_order`：入参 `SaveAgentDisplayOrderInput.profileIds`，为当前全部未删除 profile 的 id 顺序。缺少未删除 profile、重复、未知或已软删 id 时返回既有 `AgentProfileValidationFailed`（`reason=agentDisplayOrderMismatch`），原顺序不变。成功后项目级与全局级列表都按这份全应用顺序返回。

> `get_project_worktree_commit_history`：`ProjectWorkspaceInput` 可选 `limit` / `offset`（缺省 50 / 0）；`ProjectWorktreeCommitHistoryResponse.hasMore` 为本页条数 `>= limit`。允许 `limit > 50` 支撑整窗刷新；`signature` 仍对**本次响应** commits 计算。
>
> `get_project_worktree_file_tree`：`ProjectWorkspaceInput` 可选 `directoryPath`（缺省 / 空 / `.` 表示工作区根）。每次只返回该目录的**一层**子节点；子目录在前端展开时再请求。`signature` 对本次 listing 计算。

> `switch_agent_session_display_mode`：入参 `SwitchAgentSessionDisplayModeInput`（`projectId` + `sessionId`）。只改这一条 Session 的 `displayMode` 快照，不改 Agent profile 默认展示形式。Issue 未完成且 Agent 同时支持 json 与 tui 时，终止当前进程，用同一个 `providerSessionId` 按对调后的形式拉起，不发送 prompt。切到 json 时把本机会话记录里已完成的用户输入与助手最终正文写成结构化 JSONL。DeepSeek、已完成或 Backlog Issue 返回 `AgentSessionValidationFailed`，快照不变。成功后发既有 `agent-session-list-changed`（`reason=display_mode_switched`）。

> `open_completed_review`：入参 `OpenCompletedReviewInput`（`projectId` + `sessionId`），成功返回 `OpenCompletedReviewResult`（`sessionId`、`command`、`workingDir`）。仅已完成 Issue 可用。沿用该 Agent 已有的交互式 resume 命令，在工作区目录拉起查看进程，`discard_log` 不创建查看日志，不改 Issue 状态、Agent Session 状态、`log_path`、归档和原运行日志，也不发 `agent-session-list-changed`。工作区目录不存在返回 `AgentSessionValidationFailed`（`reason=workspaceMissingForCompletedReview`）。缺少 Provider 会话标识为 `missingResumeSessionId`，Agent 不支持交互式 resume 为 `tuiResumeNotSupported`，Issue 未完成为 `completedReviewRequiresCompletedIssue`。进程启动或注册失败为 `AgentSessionStartFailed`（`reason=completedReviewSpawnFailed`）。与正式 `resume_agent_session` 分开。

> `steer_agent_turn`：入参与 `send_agent_message` 相同（`SendAgentMessageInput`）。只给 Session 输入框在当前 Turn 仍运行时使用。成功时把消息插入当前 Turn，不改 turn 来源，也不清空当前 Turn。没有可插入的 Turn 时返回 `AgentSessionValidationFailed`（`reason=noSteerableTurn`），调用方应立刻改走 `send_agent_message`。方法不存在或其它协议错误返回 `AgentSessionStreamFailed`（`reason=turnSteerRejected`），调用方退回排队追问。完成提示与注入 prompt 不调用本命令。

> `start_agent_session`：入参 `StartAgentSessionInput` 可选 `model`（启动期模型选择，ADR-0036 第 8 条）。json 与 tui 启动都按「启动期模型选择 → 该 Agent 启动时刻的当前模型（与模型目录默认项同一套解析）→ 空」认定运行参数模型，写入 Session 记录，并由 `list_agent_sessions` 的 `startupModel` 下发（ADR-0038）。不写回 Agent 全局配置、不记入 Profile；会话内切换模型不改写该快照。
>
> `read_agent_session_terminal`：入参可选 `source`。缺省 `log` 读当前 `logPath`（完成后是归档）。`runtimeReplay` 读完成后复制的运行日志 `runtimeLogPath`；副本缺失时快照为空。
>
> `list_agent_sessions`：出参 `AgentSessionListItem` 含 `runtimeLogPath`（完成后保留的运行日志副本，未完成为 `null`）以及 `tokenInput` / `tokenOutput` / `tokenCache`（Session Token 消耗三项累计；尚未收到用量为 `null`，已收到 0 为 `0`）。总计与命中率由展示层派生。Codex 结构化用量事件按线程累计 `total` 覆盖写入，不把 `last` 再加一遍；Claude 按 turn 增量累加（同一 turn 的 assistant 分片与 result 总额不双计，cache 写入计入输入、读取计入缓存），能解析同口径字段的其它 Agent 同样累计，否则三项保持 `null`（ADR-0039）。Issue 详情须订阅既有 `agent-session-list-changed` 才能在运行中刷新这五行。

> `detect_tui_hook_registration` / `install_tui_hook` / `uninstall_tui_hook` / `enable_codex_hooks_feature`：设置页 Agents 模块的 TUI hook 注册。检测「已注册」只读本机 `hooks.json` / `redwhisk.json`，不启动 Codex / Grok agent。`codexHooksFeatureEnabled` 另读 `codex features list` 的 `hooks` 行：有效值为 false 时为 false；命令缺失或没有该行时为 true（不据此改 `config.toml`）。返回 `TuiHookRegistrationStatus`（`codexRegistered`、`grokRegistered`、`codexHooksOutdated`、`grokHooksOutdated`、`codexHooksFeatureEnabled`、`channelAvailable`、`registrationAllowed`）。「已注册」表示 RedWhisk command 覆盖当前事件表，不表示 CLI 已信任或已生效。`codexHooksOutdated` / `grokHooksOutdated` 表示文件里已有 RedWhisk command，但缺当前事件。应用启动且本机通道可用时会补写这些事件，不改 `config.toml`，也不代用户在 Codex `/hooks` 里信任；文件里没有 RedWhisk command 时不自动安装。`registrationAllowed` 只记录「允许为这个机器注册」，不拦截安装或卸载。安装与卸载入参 `{ agent: "codex" | "grok" }`，只改 RedWhisk 自己的条目。`channelAvailable` 为 false 时安装返回 `SettingsPersistenceFailed`（`reason=channelUnavailable`），不写 hook 文件。`enable_codex_hooks_feature` 只在 `config.toml` 的 `[features] hooks` 当前为 false 时写成 true，不与安装合成一次调用；`hooks` 已是 stable 且默认开启时不改文件。前端不直接写 `~/.codex` / `~/.grok`。

> `list_agent_profile_models`：入参 `ListAgentProfileModelsInput`（`projectId` + `agentProfileId`），返回与会话内 `list_agent_models` 相同的 `ListAgentModelsResult`（候选 + 只读标记 + 能力投影）；内部经同一 descriptor 解析（ADR-0036 第 7 条），Profile 不存在/不属于该项目/home 不可解析时返回既有风格命令错误（`profileNotFound` / `profileDeleted` / `profileNotInProject` / `<provider>ConfigReadFailed`）。`AgentModel.wireModel` 是发给 LLM 的模型参数（Grok 别名表的 `model`、Codex 目录条目的 `model`）；缺省时展示层回退 `modelId`。`startupModel` 按同一口径落库。

> `ensure_code_language_host`：进程拉起后即返回 `CodeLanguageHostStatus`，不在命令路径上等待 LSP initialize 或语义项目加载。`status = "unavailable"` 时 `reason` 取值 `nodeNotFound`（本机缺 Node）、`bundledRuntimeUnavailable`（安装包内置语言运行时缺失或不完整）、`spawnFailed`（进程无法启动）。三类原因须在 `src-tauri/src/types/code_language.rs`、`features/code/code-language-commands.ts` 与 `codeLanguage.unavailable.*` locale（zh/en）之间一一对应，并由 `src/shared/commands/__parity__` 快照守住跨边界同步。握手在后台完成；失败时宿主随后退出，下次 ensure 再拉起。

> `code_language_definition` / `code_language_references`：语义项目加载中（语言服务项目加载进度 begin 之后、end 之前，含 didOpen 后的短宽限窗）到达的请求会等到加载完成再取结果；等待超限时按未就绪返回空结果（不返回加载期的本文件 import 子句），不挂死。未处于加载中的请求不被额外等待拖慢。等待期间不持有宿主注册表锁，不阻塞其他代码根。等待上限与宽限窗取值见 `src-tauri/src/features/code_language/readiness.rs`（最坏同步阻塞约等于等待上限 + 请求自身超时）。


> 注册表路径以 `src-tauri/src/lib.rs` 的 `generate_handler!` 与各 feature 的 `commands.rs` 为准；ADR-0013 feature-first 重构后命令已下沉到 `features/<feature>/`，本表随之回写。

## Parity gate

`src-tauri/tests/dto_parity_export.rs`（`cargo test`）解析 `src/types/*.rs` 生成 `src/shared/commands/__parity__/rust-dto-signatures.json`（提交进仓）；`src/shared/commands/__parity__/dto-parity.test.ts`（`pnpm test:parity`）解析全部 `*-commands.ts` 并对比。改 Rust DTO 后须重生成快照并 commit；改前端 `*-commands.ts` 后 `pnpm test` 自动校验。drift 表现为测试失败。类型名差异登记在 `name-mapping.ts`，前端不需 mirror 的 Rust 类型登记在 `rustOnlyAllowlist`（每条带注释说明）。

## Event 注册表

| 事件                            | 载荷                                                                            | 生产者                        | 消费者与语义                                                 |
| ------------------------------- | ------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------ |
| `agent-session-stream-event`    | `AgentStreamEventEnvelope`（`projectId`、`sessionId`、`seq`、`epoch`、`event`） | `agent_event_broadcaster.rs`  | 结构化 Codex/Claude 会话事实；前端只渲染，不借事件写业务状态 |
| `agent-session-terminal-output` | PTY 输出事件                                                                    | `lib.rs` 的 PTY output sink   | 项目终端与 **tui** Agent Session 的实时字节输出；json 结构化会话不使用 |
| `agent-skills-updated`          | `AgentSkillsUpdatedEvent`                                                       | `agent_skill_commands.rs`     | 全局或项目 skill 索引刷新完成                                |
| `open-agent-session`            | `OpenAgentSessionEventPayload`                                                  | `session_monitor_commands.rs` | 通知目标窗口定位指定项目与会话                               |
| `agent-session-list-changed`    | 会话列表变更（`projectId`、`sessionId`、`reason`）                              | `agent_event_broadcaster.rs`、`features/agent_session/commands.rs`（`emit_agent_session_list_changed`） | 会话增删/标题/attention 变更与用量落库后刷新；前端 `agents/agent-session-events.ts`（常量 + 命中判定）、`agents/agent-session-list-change-subscription.ts`（去抖订阅）、`agents/use-agent-session-list.ts`（`agents-activity.tsx` 间接消费）、`issues/issue-detail/issue-readonly-session-panel.tsx`、`changes/use-changes-auto-refresh.ts`（变更 Activity：running 重算 + 未提交变更 / 已提交历史失效刷新）、`agents/session-workspace/use-session-workspace-changes-invalidation.ts`（会话右侧栏变更 Tab：未提交变更 / 已提交历史失效刷新）据此刷新 |
| `code-workspace-roots-updated`  | Code workspace 根目录变更                                                       | `features/agent_session/workspace_commands.rs`（`emit_code_workspace_roots_updated`） | worktree/code 根目录刷新；前端 `code/use-code-workspace-roots.ts` 重新拉取 |
| `update-prompt-changed`         | `UpdateStatus`                                                                  | `features/app_update/commands.rs` | 应用更新提示状态变更；前端 `app-update/use-update-status.ts` 刷新徽章 |
| `app-theme-preference-changed`  | `AppThemePreferenceChangedEvent`（`themePreference`）                           | `features/project_terminal/commands.rs`（`emit_app_theme_preference_changed`） | 全局主题偏好跨窗同步；前端 `shared/i18n/i18n-provider.tsx` 更新偏好/localStorage 并本地解析 light/dark |
| `issue-timeline-changed`        | Issue 时间轴变更                                                                | `features/issue/completion_comment.rs`  | 评论自动发表后广播；前端 `issues/issue-detail/issue-timeline.tsx` 刷新当前 Issue 时间轴 |
| `issue-session-start-progress`  | `IssueSessionStartProgressEvent`（`projectId`、`issueId`、`phase`：`creating_worktree` \| `running_setup_command` \| `starting_session`） | `features/agent_session/commands.rs`（`emit_issue_session_start_progress`） | Issue 启动准备进度；前端 `issues/use-issue-session-start-progress.ts` 仅在匹配当前启动对象时更新 LoadingDialog 文案 |
| `issue-sync-changed`            | `IssueSyncChangedEvent`（`projectId`、`outcome`：`synced` \| `skipped` \| `credential_expired` \| `cache_failed` \| `coalesced`） | `features/issue/commands.rs` | 当前项目同步结束后刷新看板；前端 `issues/issue-sync-toolbar.tsx` 卸载时解除监听。`coalesced` 表示同一项目的同步锁被占用 |
| `change-request-sync-changed`   | `ChangeRequestSyncChangedEvent`（`projectId`、`outcome`：`synced` \| `skipped` \| `credential_expired` \| `cache_failed` \| `coalesced`） | `emit_change_request_sync_changed` | Pull requests 面板刷新列表；前端卸载时解除监听 |
| `code-language-diagnostics`     | `CodeLanguageDiagnosticsEvent`（`projectId`、`workspacePath`、`uri`、`diagnostics`） | `features/code_language/commands.rs`（`emit_code_language_diagnostics`） | 代码页 TS/JS 诊断推送；前端 `code/use-code-language-diagnostics.ts` 应用到当前根 Monaco markers |

新增 event 必须有 kebab-case 名、定位实体 ID、Rust payload 类型、前端 listener 的释放逻辑和至少一条序列/重连行为测试。事件名以 `pub const`（或文件内 `const`）定义；生产者封装为 `emit_*` 函数；跨窗口广播用 `emit_to`；前端 listener 必须在卸载时释放并覆盖序列/重连测试。

## 注册约定（feature-first 重构后）

- **A. feature-first command 落点**：`commands/` 仅保留 `core_commands.rs`（承载不属于任何 feature 的全局命令，如 `initialize_local_data`）；新命令一律落在 `features/<feature>/commands.rs` 或同 feature 下 `*_commands.rs`，并在 `src-tauri/src/lib.rs` 的 `generate_handler!` 注册。
- **D. DTO 跨边界同步**：event/命令 DTO 定义以 `src-tauri/src/types/` 为准；`lib.rs` 或 feature 内联的私有 payload struct（如 `TerminalOutputEventPayload`）不视为稳定契约，跨模块复用前须迁入 `types/`。
- **E. 前端 wrapper 路径判据**：被多 feature 复用或属全局应用级命令（主题、应用更新）的 wrapper 放 `shared/commands/`；领域专属命令放 `features/<feature>/`。
- **F. 错误码领域归属**：错误码按前缀归入领域，见「错误码边界」章节的「错误码前缀 -> 领域 -> adapter 模块」精简表，避免分类描述再次失同步；新增错误码同时更新该表与 `src-tauri/src/types/errors.rs`。

## 结构化消息流的稳定部分

`AgentStreamEvent` 的顶层事件包含 thread/turn 生命周期、timeline、usage、permission、mode/model/effort 更新。`timeline` 是可判别 union，含用户/助手消息、reasoning、tool call、todo、error、compaction，以及只用于重建花名册的 `subagent_roster`。完整枚举在 `src-tauri/src/types/agent_session_stream.rs`；前端 reducer 与卡片渲染必须为未知 provider 细节保留安全降级，而非假设只会出现 Codex 私有字段。

## 错误码边界

错误码定义在 `src-tauri/src/types/errors.rs`。现有分类是 Local Data、Project、Issue（含 IssueWorktree 子类）、Agent Profile/Command/Session（含 `AgentSessionStartNotReady`、`AgentSessionUsesStructuredStream`、`AgentSessionModelUnavailable` 等细化码）、Project Terminal、Settings、UserProfile（`UserProfilePersistenceFailed`、`UserProfileValidationFailed`）、AppUpdate（`AppUpdatePersistenceFailed`、`AppUpdateValidationFailed`）的验证、持久化或启动错误。新增可预期失败优先归入现有领域；新增错误码时同步添加前端 locale 映射和 command client 测试。

错误码与领域归属精简表（详见 `src-tauri/src/types/errors.rs`）：

| 错误码前缀           | 领域               | adapter 模块                          |
| -------------------- | ------------------ | ------------------------------------- |
| `LocalData*`         | 本地数据初始化     | `commands/core_commands.rs`           |
| `Project*`           | 项目               | `features/project/commands.rs`        |
| `ForgeUnavailable`   | 项目 Issue 来源    | `features/project/issue_source_commands.rs` |
| `Issue*`             | Issue              | `features/issue/commands.rs`          |
| `IssueWorktree*`     | Issue Worktree     | `features/issue/commands.rs`          |
| `AgentSession*`      | Agent 会话         | `features/agent_session/commands.rs`  |
| `AgentProfile*`      | Agent Profile      | `features/settings/commands.rs`       |
| `AgentCommand*`      | Agent 命令检测     | `features/settings/commands.rs`       |
| `ProjectTerminal*`   | 项目终端           | `features/project_terminal/commands.rs` |
| `Settings*`          | 设置（label/skill）| `features/settings/commands.rs`       |
| `UserProfile*`       | 用户档案           | `features/settings/commands.rs`       |
| `AppUpdate*`         | 应用更新           | `features/app_update/commands.rs`     |
| `CodeLanguage*`     | 代码页 TS/JS 语言智能 | `features/code_language/commands.rs`  |
