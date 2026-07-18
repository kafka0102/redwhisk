# 后端 feature-first 重构方案与执行计划

> 配套决策：[ADR-0013 后端业务模块按 feature 纵切，退役 core/](../adr/0013-feature-first-module-organization.md)。
> 本文是 ADR-0013 的可执行清单：目标布局、文件迁移映射、改造规则、分步路线、验证与回滚。

## 一、目标与范围

把 `src-tauri/src/core/` 的全部业务模块 + `src-tauri/src/commands/` 的业务命令，纵切迁入 `src-tauri/src/features/<feature>/`，使后端目录与前端 `src/features/` 对称。`db/`、`agent/`、`git/`、`types/`、`logging/`、`agent_skill/` 等横切层不动。

**本文档覆盖**：模块重组（对应原重构方案 P1）。

**不在本文档范围**（另立 ADR / 计划）：SQL 从 service 收敛到 repository（P2）、`AgentProviderDescriptor` 接缝与 service 内 `match agent_type` 下沉（P3）。两者依赖本文档确立的 feature 边界，作为后续阶段推进。

## 二、目标架构

```text
src-tauri/src/
├── features/                      ← 业务纵切（原 core 业务 + 对应 commands）
│   ├── project/
│   ├── issue/
│   ├── agent_session/
│   ├── project_terminal/
│   ├── settings/
│   └── app_update/
├── agent/                         保留：provider 抽象是跨 feature 能力
├── agent_skill/                   保留：skill 扫描/索引跨 feature 复用
├── commands/                      保留 mod.rs + 残留 shell 命令（core_commands 等）
├── db/                            保留横切：migration、连接池、repository 全局
├── git/                           保留：worktree / status 跨 feature 工具
├── logging/                       保留
├── types/                         保留：跨边界 DTO 集中，便于与前端同步
├── app_state.rs                   保留：应用级状态
├── local_data_path.rs             保留：data_dir 解析
└── lib.rs                         模块挂载入口
```

依赖方向不变（见 [project-map.md](./project-map.md)「分层与依赖方向」）：

```text
React feature / shared command wrapper
        ↓ Tauri command（参数承接、状态注入、错误映射）
features/<feature>/service（业务规则、状态流转、事务编排）
        ↓
db / agent / git / PTY / 文件系统
        ↓
SQLite、Git worktree、子进程、~/.redwhisk
```

## 三、Feature 划分与文件迁移映射

feature 划分对齐前端 5 个 surface + `app_update`。`agent_skill/` 顶层模块保持独立（其 commands wrapper 归入 `features/settings/`，因 saved skill 属 settings 能力）。

### 3.1 `features/project/`

| 旧路径 | 新路径 | 行数 |
| --- | --- | --- |
| `core/project_service.rs` | `features/project/service.rs` | 418 |
| `commands/project_commands.rs` | `features/project/commands.rs` | 156 |

### 3.2 `features/issue/`

| 旧路径 | 新路径 | 行数 |
| --- | --- | --- |
| `core/issue_service.rs` | `features/issue/service.rs`（主，拆分见 §四） | 5785 |
| `core/completion_state_machine.rs` | `features/issue/completion/state_machine.rs` | 784 |
| `core/completion_effect_interpreter.rs` | `features/issue/completion/effect_interpreter.rs` | 877 |
| `commands/issue_commands.rs` | `features/issue/commands.rs` | 566 |

### 3.3 `features/agent_session/`

| 旧路径 | 新路径 | 行数 |
| --- | --- | --- |
| `core/agent_session_service.rs` | `features/agent_session/service.rs`（主，拆分见 §四） | 7283 |
| `core/session_workspace_service.rs` | `features/agent_session/workspace.rs` | 1686 |
| `commands/agent_session_commands.rs` | `features/agent_session/commands.rs` | 914 |
| `commands/session_monitor_commands.rs` | `features/agent_session/session_monitor_commands.rs` | 261 |
| `commands/session_workspace_commands.rs` | `features/agent_session/workspace_commands.rs` | 197 |

### 3.4 `features/project_terminal/`

| 旧路径 | 新路径 | 行数 |
| --- | --- | --- |
| `core/project_terminal_service.rs` | `features/project_terminal/service.rs`（主，拆分见 §四） | 3129 |
| `commands/project_terminal_commands.rs` | `features/project_terminal/commands.rs` | 272 |

### 3.5 `features/settings/`

| 旧路径 | 新路径 | 行数 |
| --- | --- | --- |
| `core/settings_service.rs` | `features/settings/service.rs` | 1018 |
| `core/user_profile_service.rs` | `features/settings/user_profile.rs` | 189 |
| `commands/settings_commands.rs` | `features/settings/commands.rs` | 175 |
| `commands/agent_skill_commands.rs` | `features/settings/agent_skill_commands.rs` | 168 |

### 3.6 `features/app_update/`

| 旧路径 | 新路径 | 行数 |
| --- | --- | --- |
| `core/app_update/`（service/github/version） | `features/app_update/`（保留内部三文件结构） | 545 + 201 + 166 |
| `commands/app_update_commands.rs` | `features/app_update/commands.rs` | 67 |

### 3.7 保留在顶层 / `commands/` 残留

| 旧路径 | 归属 | 理由 |
| --- | --- | --- |
| `core/local_data_service.rs` | `app_state.rs` 同级顶层或并入 | data_dir 基础设施，被 `lib.rs` 用于构造 `AppState`，非业务 |
| `commands/core_commands.rs` | 留 `commands/` | app shell 命令，非任一 feature |

## 四、大文件拆分（feature 内部分层）

迁移即拆分机会。三个超大 service 在迁入 feature 目录时同步按职责聚簇拆为子文件，目标单文件 ≤ 500 行，编排主文件 ≤ 800。**拆分只搬代码、不改行为**，每个子文件落地后 `cargo test --lib` 守底。

### 4.1 `features/agent_session/`（原 7283 行）

| 目标文件 | 迁入职责 | 行数估计 |
| --- | --- | --- |
| `service.rs` | `AgentSessionService` struct + 主 `impl`（裁剪后） | ~800 |
| `launch.rs` | `finish_structured_issue_provider_start`、`rollback_failed_structured_issue_session`、`cleanup_owned_worktree`、`prepare_issue_session_launch`、`start_provider_session`、`persist_started_session_thread_id` | ~900 |
| `worktree_setup.rs` | `run_setup_command*`、`run_setup_command_with_shells_and_env`、`setup_shell_candidates`、`setup_command_failure`、`should_retry_setup_command`、`mod worktree_setup_command_tests` | ~400 |
| `log_path.rs` | `build_log_path`、`session_log_root_dir`、`*_project_dir`、`build_*_structured_log_path`、`build_issue_archive_log_path`、`is_archived_issue_log_path`、`build_issue_session_archive`、`remove_session_log_file` | ~400 |
| `timeline.rs` | `read_timeline_*`、`read_last_assistant_text_for_turn`、`read_structured_timeline_log`、`structured_events_from_log_line`、`finalize_pending_reasoning_duration`、`push_compacted_timeline_item`、`merge_reasoning_timeline_item` | ~600 |
| `command_snapshot.rs` | `build_command_snapshot`、`build_structured_command_snapshot`、`agent_command_with_default_args`、`ensure_*_bypass_arg`、`append_missing_args`、`command_has_arg` | ~200 |
| `validation.rs` | `validate_profile_scope`、`validate_profile_not_deleted`、`validate_session_title`、`validate_injected_prompt`、`validate_working_dir`、`validate_prompt_snapshot` | ~250 |

### 4.2 `features/issue/`（原 5785 行）

| 目标文件 | 迁入职责 |
| --- | --- |
| `service.rs` | `IssueService` struct + 主 `impl` |
| `completion/` | `completion/` 目录承接 `state_machine` + `effect_interpreter`；完成流程 phase/action/effect 聚簇（`gather_completion_world`、`derive_completion_event`、`phase_to_completion_action`、`completion_message`、`record_blocked_completion_attempt` 等） |
| `attachment.rs` | `persist_new_attachments`、`save_issue_attachment_draft_in_data_dir`、`rewrite_attachment_tokens`、`parse_attachment_ids`、`delete_attachment_files`、`read_previewable_text_file`、`is_inside_code_fence` |
| `archive.rs` | `rollback_issue_archive`、`cleanup_runtime_issue_log`、`remove_issue_log_file`、`open_issue_database`、`infer_data_dir_from_connection` |
| `validation.rs` | `validate_title`、`serialize_label_ids`、`invalid_issue_label`、`is_issue_label_accessible`、`to_issue_label_record`、`issue_not_found`、`issue_git_error` |

### 4.3 `features/project_terminal/`（原 3129 行）

| 目标文件 | 迁入职责 |
| --- | --- |
| `service.rs` | `ProjectTerminalService` struct + 主 `impl` |
| `registry.rs` | `ProjectTerminalRegistry`、`ProjectTerminalSession`、`project_terminal_summary`、`preferred_project_terminal_session` |
| `log.rs` | `terminal_log_path`、`remove_terminal_log_file`、`purge_terminal_log_dir` |
| `shortcut.rs` | `shortcut_command_record_from_row`、`validate_shortcut_command` |

> `project_terminal_service.rs` 内的 `RestoreTestHooks` 与 `run_*_hook` 是测试桩，跟随被测代码进入对应子文件，保持 `#[cfg(test)]` 守护。

## 五、改造规则

### 5.1 模块声明

每个 feature 目录建 `mod.rs`，内部子文件用 `mod` 声明 + `pub(crate)` 可见性，对外仅 `pub use <service>::<Service>`：

```rust
// src-tauri/src/features/agent_session/mod.rs
pub mod commands;
mod launch;
mod log_path;
mod service;
mod timeline;
mod validation;
mod worktree_setup;
mod command_snapshot;
mod workspace;

pub use service::AgentSessionService;
```

`src-tauri/src/features/mod.rs` 汇总：

```rust
pub mod agent_session;
pub mod app_update;
pub mod issue;
pub mod project;
pub mod project_terminal;
pub mod settings;
```

`lib.rs` 加 `pub mod features;`。迁移完成后删除 `pub mod core;` 与 `core/` 目录。

### 5.2 引用改造

全仓 `use crate::core::X` → `use crate::features::<feature>::X`。迁移前先 `rg -n "crate::core::" src-tauri/src` 取全量清单，逐 feature 批量替换。跨 feature 引用（如 `agent_session_service` 引用 `issue_service` 的 `pub(crate)` 项）改走 `crate::features::issue::...`，可见性按需从 `pub(crate)` 提为 `pub`。

### 5.3 Tauri command 注册

`lib.rs` 的 `tauri::generate_handler!` 宏内命令路径跟随 commands 迁移同步调整。command 函数 `#[tauri::command]` 不变，仅改注册项的完整路径。

### 5.4 测试跟随

- 源文件内联 `#[cfg(test)] mod tests` 跟随被测代码进入对应子文件。
- `src-tauri/tests/` 集成测试只改 `use` 路径，不动断言。

## 六、执行路线（分步，每步可独立 PR / 回滚）

| 步骤 | 内容 | 风险 | 验证 |
| --- | --- | --- | --- |
| **S0** | 建 `features/` 骨架与空 `mod.rs`、`features/mod.rs`；`lib.rs` 挂 `pub mod features;` | 🟢 | `cargo check` |
| **S1**（spike） | 迁最小 feature `project/`（service + commands），验证迁移手法与 handler 改造模板 | 🟢 | `cargo test --lib`、前端冒烟 |
| **S2** | 迁 `app_update/`、`settings/`（无大文件拆分，纯移动） | 🟢 | `cargo test --lib` |
| **S3** | 迁 `project_terminal/`（service 同步按 §四.3 拆分） | 🟡 | `cargo test --lib` + 终端冒烟 |
| **S4** | 迁 `issue/`（service 按 §四.2 拆分，含 completion 目录） | 🟡 | `cargo test --lib` + 完成流程冒烟 |
| **S5** | 迁 `agent_session/`（最大，按 §四.1 拆分） | 🟠 | `cargo test --lib` + session 启动 / resume 冒烟 |
| **S6** | 删除 `core/` 与 `pub mod core;`；清 `commands/` 残留 mod 声明 | 🟡 | `cargo test --lib` |
| **S7** | 同步契约文档（见 §八） | 🟢 | `rg -n "src-tauri/src/core" docs` 无残留 |

**起步建议**：S1 的 `project/` 作为 spike，跑通"迁移 + 拆分 + handler 改造 + 文档更新"全流程模板，再批量推其余 feature。

## 七、验证策略

- **回归底**：`cd src-tauri && cargo test --lib`。已知 `tests/agent_session.rs` 有 3 个 PTY 提示文本断言在 clean main 也红（见项目记忆），回归判定以 `--lib` 为准，不用全量 `cargo test`。
- **编译**：每步 `cargo check`；S5/S6 后跑一次 `cargo build`。
- **前端契约**：Tauri command 名称与 DTO 不变，前端 wrapper 零改动；S1 后做一次前端冒烟确认 command 调用通路。
- **lint**：`cargo fmt --check` 与 `cargo clippy`（注意：项目 Rust 非 fmt-clean，勿跑全量 `cargo fmt`，见项目记忆）。

## 八、需同步更新的文档清单（S7）

执行迁移时，同 PR 内更新以下"现状文档"对 `core/` 的引用：

| 文档 | 位置 | 改动 |
| --- | --- | --- |
| `docs/architecture-design/project-map.md` | 「从界面到代码」表、「分层与依赖方向」图 | `core/*_service.rs` → `features/<feature>/service.rs`；分层图 `Rust core service` → `features/<feature>/service` |
| `docs/architecture-design/agent-development-rules.md` | 第 34–39 行分层定义 | 重写 `core/` 条目为 `features/` 条目 |
| `docs/adr/0001-core-architecture-boundaries.md` | 第 22 行事实来源 | `src-tauri/src/core/` → `src-tauri/src/features/` |
| `docs/architecture-design/worktree-git-lifecycle.md` | 第 3 行实现入口 | `core/agent_session_service.rs`、`core/issue_service.rs` 路径更新 |

**不回写**：历史 ADR（0010-0015，即全部已归档 ADR）、`docs/superpowers/plans/*`、`docs/superpowers/specs/*` 里的 `core/` 路径——它们记录当时事实，按 ADR 规则保持不变。

## 九、风险与回滚

| 风险 | 应对 |
| --- | --- |
| 全仓 `use` 路径漏改导致编译失败 | 每步以 `cargo check` 收口；迁移前 `rg` 取全量清单逐项销账 |
| `generate_handler!` 注册路径漏改致 command 丢失 | S1 后前端冒烟；每步迁移的 commands 在同 PR 内改注册 |
| 跨 feature `pub(crate)` 可见性不足 | 按编译器报错逐项提升可见性，不预先全提 `pub` |
| 拆分引入行为回归 | 拆分步只搬代码不改逻辑；以 `cargo test --lib` 与现有集成测试为安全网；大文件拆分（S3–S5）单独成 PR，不与纯移动混在一起 |
| 回滚 | 每步独立 PR / commit，任何一步可单独 revert；feature 目录与 `core/` 并存期内双向可达 |

## 十、验收标准

- [ ] `src-tauri/src/core/` 目录与 `pub mod core;` 已删除。
- [ ] `rg -n "crate::core::" src-tauri` 无结果。
- [ ] `rg -n "src-tauri/src/core" docs` 仅命中历史 ADR / plans（§八白名单）。
- [ ] `cd src-tauri && cargo test --lib` 通过（相对迁移前基线无新增失败）。
- [ ] 前端冒烟：项目创建、issue 完成流程、agent session 启动与 resume、终端、settings 均通路。
- [ ] §八四个文档已同步，链接可达。
