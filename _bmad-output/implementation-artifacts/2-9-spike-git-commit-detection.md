---
baseline_commit: 426fd6d
---

# Story 2.9: Spike - 验证 Git Commit Detection

Status: done

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为 RedWhisk 实现者,
我希望在真实 Git 仓库中验证 completion 前后 HEAD/status/changed files 检测,
以便 Agent Commit 完成不会只相信 Agent 输出文本。

## Acceptance Criteria

1. 给定一个本地 Git Repository 有未提交改动，当系统在 completion 前记录 Git 状态时，记录 `HEAD`、`git status --porcelain` 和 changed files 摘要。
2. 给定 completion prompt 发送后仓库产生新 commit，当系统重新读取 Git 状态时，检测到 `HEAD` 改变，并记录新 commit hash。
3. 给定 completion prompt 发送后未产生新 commit，当系统重新读取 Git 状态时，结果记录为 `no_commit_detected`，并要求 Issue 保持 `review`。
4. 给定仓库处于 merge、rebase、cherry-pick 等进行中状态，当用户尝试完成 Issue 时，系统能识别该状态，并记录降级行为：提示用户手动处理，不自动 completed。
5. 给定 Spike 完成，当结果归档时，在 `spikes/git-commit-detection.md` 记录结论，并要求 Epic 5 story 引用该结论或采用记录的降级路径。

## Tasks / Subtasks

- [x] 收口 Git 检测的事实边界和当前代码状态，避免提前实现完整完成流 (AC: 1, 2, 3, 4)
  - [x] 复查 `src-tauri/src/git/repository.rs`、`src-tauri/src/core/agent_session_service.rs`、Story 2.8 的 prompt 注入结论和 architecture 的 `git/*` 边界，确认本 story 只验证 Git 快照与状态判断，不实现 Completion Confirmation UI。
  - [x] 明确 `completion prompt 已发送` 与 `commit 已产生` 是两件事；本 story 只建立检测证据，不能因为 Agent 输出声称完成就更新 Issue 为 `completed`。
  - [x] 确认当前仓库尚未落地 `completion_attempts` repository / migration；除非 Spike 最小验证确实需要，不在本 story 中抢跑完整 Epic 5 审计表。
- [x] 在 Rust Core 建立最小 Git 快照检测能力 (AC: 1, 4)
  - [x] 在 `src-tauri/src/git/` 下按架构边界补齐最小模块，例如 `status.rs` 和 `operation_state.rs`；复用现有 `repository.rs` 的仓库校验，不把 Git 命令暴露给 React。
  - [x] 使用稳定、可脚本解析的 Git 输出记录快照：`git rev-parse HEAD` 或等价 HEAD 读取、`git status --porcelain`、changed files 摘要；不要解析本地化的普通 `git status` 文本。
  - [x] 通过 `git rev-parse --git-dir` 或等价方式定位真实 Git metadata 目录，并识别 merge / rebase / cherry-pick 进行中状态；`.git` 是文件的 worktree 场景不能被简单当作非仓库。
  - [x] 输出结构保持事实性：`head`、`statusPorcelain`、`changedFiles`、`operationState`、`isClean` 等字段用显式缺失或枚举表达，不用模糊字符串。
- [x] 验证 HEAD 改变与 no commit detected 两条路径 (AC: 2, 3)
  - [x] 在临时真实 Git 仓库里创建初始 commit，记录 `head_before` 和 changed files，再创建新 commit 后记录 `head_after`，证明 `HEAD` 改变时可以得到新 commit hash。
  - [x] 在同一类临时仓库里模拟 completion 后没有 commit 的路径，证明 `head_before == head_after` 时结果必须归档为 `no_commit_detected`，且后续 Epic 5 必须让 Issue 保持 `review`。
  - [x] 记录 changed files 摘要时保留文件路径和 porcelain 状态码即可；本 story 不实现完整 diff 查看或 Git 历史浏览。
- [x] 验证 Git operation in-progress 降级路径 (AC: 4)
  - [x] 用可重复的临时仓库样本或最小 fixture 覆盖 merge / rebase / cherry-pick 至少三类进行中状态；如果某类状态无法稳定自动化，必须把未验证项和风险写入 Spike 文档。
  - [x] 操作进行中时只返回可消费事实和降级建议，不自动提交、不自动完成 Issue、不尝试 merge/rebase/cherry-pick recovery。
  - [x] 对 Git command 不可用、非 Git 仓库、路径不可访问等失败路径返回统一 `CommandError` 或 Spike 记录，不吞掉为普通 `no_commit_detected`。
- [x] 归档 Spike 结论并写清 Epic 5 gate (AC: 5)
  - [x] 新增 `spikes/git-commit-detection.md`，记录实际命令、自动化证据、手工验证、限制、降级策略和 Epic 5 可以依赖的 gate 条件。
  - [x] 在本 story 的 Dev Agent Record 中同步记录实际执行命令、观察结果、文件清单和未验证风险。
  - [x] 不修改 PRD、architecture 或 Epic 5 story；若发现规划缺口，只在 Spike 文档和 Dev Agent Record 记录后续约束。
- [x] 测试与验证 (AC: 1, 2, 3, 4, 5)
  - [x] 若修改 Rust Git 检测模块、service、command、repository 或类型，运行 `cargo fmt --manifest-path src-tauri/Cargo.toml` 和 `cargo test --manifest-path src-tauri/Cargo.toml`。
  - [x] 若新增 TypeScript command bridge 或 UI 消费面，先运行 `pnpm format`，再运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`。
  - [x] 若某项 Git 场景只能手工验证，把实际命令、输出摘要、未覆盖风险逐条写入 Dev Agent Record；不能只写“已验证”。

### Review Findings

- [x] [Review][Patch] 将 changed files 解析改为基于 `git status --porcelain=v1 -z` 的结构化解析，覆盖路径含空格、引号、tab、rename/copy 和异常行；已改为 `--porcelain=v1 -z` 解析，并补充特殊路径与 rename/copy 解析单测。
- [x] [Review][Patch] 将未解决冲突、revert/sequencer 等 Git operation blocker 显式建模，或让调用方类型上必须先处理 `operationState`；已显式覆盖 `unmerged`、`revert_in_progress`、`sequencer_in_progress`，并保证 operation in-progress 优先阻断 commit/no-commit 判定。
- [x] [Review][Patch] 避免把 `checkout` / `reset` / `rebase` 导致的 HEAD 移动误判为 Agent 新提交；已通过 `git merge-base --is-ancestor` 区分前进式新提交与非前进式 HEAD 移动，并补充 `reset` / `checkout` 夹具测试。

## Dev Notes

### 关键假设与取舍

- Story 2.9 是 Epic 2 的最后一个 Spike。它的目标是证明 RedWhisk 能否可靠判断“Agent Commit 后是否真的产生 commit”，不是提前交付 Epic 5 的完整完成按钮、确认面板、Summary 页面或完成状态机。
- Story 2.8 已经证明 completion prompt 可以注入当前活 PTY Session，但注入成功不代表 Codex 一定提交了代码；2.9 必须把检测闭环建立在 Git 事实之上。
- 默认最小方案是通过 Rust Core 调用本机 Git 读取状态和 HEAD，不引入 Git GUI、不实现完整 diff、不替用户执行 `git add` / `commit` / `merge` / `rebase`。
- `changed files 摘要` 只需要服务 Completion Confirmation 和后续审计判断，当前 story 不要求展示完整 diff 内容。

### 范围边界

- 交付：Git 快照检测、HEAD 前后对比、changed files 摘要、merge / rebase / cherry-pick 进行中识别、`no_commit_detected` 结论、Spike 归档文档。
- 不交付：Completion Confirmation UI、`completion_attempts` 完整持久化链路、Issue `completed` 状态流转、Agent Session `closed` 收口、Summary / Open Log 页面。
- 不交付：GitHub/GitLab、PR/MR、完整 Git 历史、完整 Diff、Worktree 自动化、merge/rebase 修复工具。

### 架构约束

- Git status / HEAD 检测必须由 Rust Core 负责；React 不能直接执行 shell 或 Git 命令。[Source: `_bmad-output/planning-artifacts/architecture.md` §Authentication & Security, §Service Boundaries]
- Completion Policy 只能通过 completion prompt 与 Git 检测闭环，不允许应用层静默提交或直接提交全部改动。[Source: `_bmad-output/planning-artifacts/architecture.md` §Core Architectural Decisions; `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR-21, NFR5]
- `git/*` 只负责 Git 检测，不执行自动提交策略；状态变化仍由 `core/*_service.rs` 统一处理。[Source: `_bmad-output/planning-artifacts/architecture.md` §Service Boundaries]
- 失败路径必须显式可见：Git 操作异常、未检测到 commit、merge/rebase/cherry-pick 进行中不能被吞成成功完成。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §NFR6; `_bmad-output/planning-artifacts/epics.md` Story 2.9 AC]

### 当前代码状态与修改指引

- `src-tauri/src/git/repository.rs` 当前只提供 `is_git_repository`，且通过 `.git` 是目录或文件判断 Git 仓库；2.9 可在此基础上补快照与 operation-state 模块，不应把逻辑散落到 command adapter。
- `src-tauri/src/core/agent_session_service.rs` 已有 prompt 注入和 `session_prompt_injected` 事件；本 story 不需要再改 prompt 注入链路，除非 Spike 需要复用其结果模型。
- `src-tauri/src/types/errors.rs` 已有统一 `CommandError` / `CommandErrorCode`；Git 检测失败应沿用统一错误结构，必要时最小新增 Git 相关错误码，避免返回散装字符串。
- `src-tauri/migrations/0008_agent_sessions_and_session_events.sql` 尚未包含 `completion_attempts`；architecture 预期该表归 Epic 5 完整 completion flow 使用，2.9 默认只写 Spike 结论文档和 Git 检测代码。
- `spikes/codex-resume-completion-prompt.md` 已明确：completion prompt 注入可以作为运行时能力依赖，但 commit 是否产生必须等待 Story 2.9 结论。

### 前置故事信息

- Story 2.6 已建立 PTY / xterm / session log 基础，使 Agent 可以在当前活 Session 中运行。
- Story 2.7 已补齐 `session_exited` 和日志路径事实，为失败复盘保留结构化事件。
- Story 2.8 已新增 `inject_agent_session_prompt`，并确认 completion prompt 可以进入当前活 Session；但 resume 和精确 `codex_session_id` 仍是最佳努力能力。
- Epic 5 的 `agent_auto_commit` stories 必须等待本 story 的 Git commit detection gate；否则会把 Agent 输出文本误当成真实提交证据。

### Git Intelligence

- 当前 workflow preflight 记录的基线 `HEAD` 是 `426fd6d`。
- 当前工作区在 story creation 阶段只有 workflow handoff 变更；后续开发若出现无关改动，最终提交只能包含 Story 2.9 直接相关文件。
- 官方 Git 文档说明 `git status --porcelain` 面向脚本解析，`git rev-parse` 可用于解析仓库与 Git metadata 路径；实现时优先使用这些稳定接口，而不是解析普通人类可读输出。

### 测试要求

- Rust Git 检测变更：必须运行 `cargo fmt --manifest-path src-tauri/Cargo.toml` 和 `cargo test --manifest-path src-tauri/Cargo.toml`。
- TypeScript / React 运行时变更：必须运行 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`。
- 真实 Git 场景验证需要覆盖至少：dirty worktree、new commit、no commit detected、merge in-progress、rebase in-progress、cherry-pick in-progress。未覆盖项必须写明原因和风险。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 2 / Story 2.9 的验收标准，以及 FR21、FR22、NFR5、NFR6 的原始来源。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — Completion Policy、Agent Commit、Git 检测、完成安全和失败可见性要求。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` — Spike 3：Git Commit Detection、`completion_attempts` 目标表和 M4 Complete Loop 边界。
- `_bmad-output/planning-artifacts/architecture.md` — Rust Core / Git 检测层职责、`src-tauri/src/git/` 目标结构、CompletionAttempt / Git 检测依赖。
- `_bmad-output/implementation-artifacts/2-8-spike-codex-resume-and-completion-prompt-injection.md` — completion prompt 注入能力、`codex_session_id` 降级路径和 Story 2.9 的直接前置约束。
- `spikes/codex-resume-completion-prompt.md` — Story 2.8 Spike 结论，明确 commit 检测仍依赖本 story。
- Git 官方文档：`git status --porcelain` 与 `git rev-parse` 的脚本化接口说明。
- `src-tauri/src/git/repository.rs`、`src-tauri/src/core/agent_session_service.rs`、`src-tauri/src/types/errors.rs`、`src-tauri/migrations/0008_agent_sessions_and_session_events.sql` — 本 story 的主要实现入口和边界参考。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Implementation Plan

- 采用 TDD：先新增 `src-tauri/tests/git_detection.rs`，用真实临时 Git 仓库覆盖 dirty worktree、new commit、no commit detected、merge/rebase/cherry-pick 进行中。
- 最小实现落在 `src-tauri/src/git/status.rs` 与 `src-tauri/src/git/operation_state.rs`，只读取 Git 事实，不执行任何写入性 Git 操作。
- Spike 结论写入 `spikes/git-commit-detection.md`，作为 Epic 5 completion flow 的 gate 输入。

### Debug Log References

- 2026-06-07T10:20+0800：`bmad-dev-workflow` preflight 读取 `sprint-status.yaml`，确认当前无 `ready-for-dev` story，按顺序锁定 `2-9-spike-git-commit-detection`，基线 `HEAD` 为 `426fd6d`。
- 2026-06-07T10:24+0800：交叉核对 Epic 2.9、PRD、addendum、architecture、Story 2.8 和当前 `src-tauri/src/git/` 代码，确认本 story 是 Git detection Spike，不提前实现 Epic 5 completion flow。
- 2026-06-07T10:24+0800：复查当前源码，确认 `src-tauri/src/git/repository.rs` 只有 Git 仓库识别能力，尚无 status / HEAD / operation-state 模块；`completion_attempts` 尚未落地。
- 2026-06-07T10:44+0800：新增 `src-tauri/tests/git_detection.rs`，先写真实临时 Git 仓库集成测试；首次运行 `cargo test --manifest-path src-tauri/Cargo.toml --test git_detection` 失败，原因是 `git::status` 与 `git::operation_state` 模块尚不存在，符合 RED 预期。
- 2026-06-07T10:49+0800：新增 `GitSnapshot`、`GitChangedFile`、`GitOperationState`、`read_git_snapshot` 和 `detect_commit_result`，复用 `git rev-parse HEAD`、`git rev-parse --git-dir`、`git status --porcelain` 建立最小检测能力。
- 2026-06-07T10:50+0800：复跑 `cargo test --manifest-path src-tauri/Cargo.toml --test git_detection`，4 个测试通过，覆盖 dirty worktree、new commit、no commit detected 与 merge/rebase/cherry-pick 进行中。
- 2026-06-07T10:53+0800：新增 `spikes/git-commit-detection.md`，记录自动化证据、命令事实、结论、降级策略和 Epic 5 gate。
- 2026-06-07T10:55+0800：运行 `cargo fmt --manifest-path src-tauri/Cargo.toml`、目标测试和全量 Rust 测试；发现 `cargo fmt` 触碰了无关 settings 旧格式化，已撤回无关 diff，仅保留 Story 2.9 相关文件。
- 2026-06-07T10:58+0800：撤回无关格式化后复跑 `cargo test --manifest-path src-tauri/Cargo.toml --test git_detection` 与 `cargo test --manifest-path src-tauri/Cargo.toml`，均通过。
- 2026-06-07T10:59+0800：运行 `rustfmt --edition 2021 --check src-tauri/src/git/mod.rs src-tauri/src/git/operation_state.rs src-tauri/src/git/status.rs src-tauri/tests/git_detection.rs`，确认本 story 相关 Rust 文件格式通过。
- 2026-06-07T11:38+0800：继续 review follow-up，先用真实临时仓库与 `xxd` 核对 `git status --porcelain=v1 -z` 的 rename 记录格式，确认路径顺序是“新路径在前、旧路径在后”，并据此修正解析与测试夹具。
- 2026-06-07T11:40+0800：补齐 `unmerged`、`revert`、`sequencer` 和非前进式 HEAD 变化的稳定测试夹具，修正原先会误把测试假设当成实现缺陷的场景。
- 2026-06-07T11:47+0800：调整 `detect_operation_state` 的优先级，让多提交 `cherry-pick` 冲突在存在 `.git/sequencer` 时返回 `SequencerInProgress`，单次冲突仍返回 `CherryPickInProgress`。
- 2026-06-07T11:49+0800：最终复跑 `cargo fmt --manifest-path src-tauri/Cargo.toml`、`cargo test --manifest-path src-tauri/Cargo.toml --test git_detection`、`cargo test --manifest-path src-tauri/Cargo.toml` 和 `rustfmt --edition 2021 --check ...`，全部通过；Story 2.9 review clean。

### Completion Notes List

- 2026-06-07：create-story 已为 Story 2.9 生成开发上下文，并将实现焦点限定为 Git commit detection Spike。
- 2026-06-07：已明确 2.9 与 2.8 / Epic 5 的边界：completion prompt 注入成功不等于 commit 成功，必须由 Git HEAD/status 检测提供事实依据。
- 新增 Rust Git 快照检测能力，记录 `HEAD`、`git status --porcelain`、changed files、operation state 和 clean 状态。
- 新增 HEAD 前后对比结果模型，`HEAD` 改变时返回新 commit hash，未改变时返回 `NoCommitDetected`。
- 新增 operation-state 检测，覆盖 merge、rebase、cherry-pick 进行中状态，后续 Epic 5 可据此阻塞自动完成。
- 新增 `spikes/git-commit-detection.md`，明确 Epic 5 可以依赖的 gate：commit 必须由 Git HEAD/status 检测确认，不能只相信 Agent 输出文本。
- 已按 review patch follow-up 补齐 `git status --porcelain=v1 -z` 结构化 changed files 解析，避免特殊路径与 rename/copy 被误读。
- 已显式建模 `unmerged`、`revert_in_progress`、`sequencer_in_progress`，并让 operation in-progress 先于 commit/no-commit 判定生效。
- 已把 `checkout` / `reset` 等非前进式 HEAD 移动与真实新提交区分开，新增 `HeadMovedWithoutNewCommit` 路径和对应集成测试。

### File List

- _bmad-output/implementation-artifacts/2-9-spike-git-commit-detection.md
- _bmad-output/implementation-artifacts/bmad-dev-workflow-handoff.yaml
- _bmad-output/implementation-artifacts/sprint-status.yaml
- spikes/git-commit-detection.md
- src-tauri/src/git/mod.rs
- src-tauri/src/git/operation_state.rs
- src-tauri/src/git/status.rs
- src-tauri/tests/git_detection.rs

### Validation Commands

- `cargo test --manifest-path src-tauri/Cargo.toml --test git_detection`
- `cargo test --manifest-path src-tauri/Cargo.toml --test git_detection`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml --test git_detection`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml --test git_detection`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `rustfmt --edition 2021 --check src-tauri/src/git/mod.rs src-tauri/src/git/operation_state.rs src-tauri/src/git/status.rs src-tauri/tests/git_detection.rs`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml --test git_detection`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `rustfmt --edition 2021 --check src-tauri/src/git/mod.rs src-tauri/src/git/operation_state.rs src-tauri/src/git/status.rs src-tauri/tests/git_detection.rs`

### Validation Results

- `cargo test --manifest-path src-tauri/Cargo.toml --test git_detection`：RED 阶段失败，编译错误指出 `redwhisk_lib::git::operation_state` 与 `redwhisk_lib::git::status` 不存在，符合测试先行预期。
- `cargo test --manifest-path src-tauri/Cargo.toml --test git_detection`：GREEN 阶段通过，4 个 Git detection 测试全部通过。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：通过；该命令同时格式化了无关 settings 旧文件，相关无关 diff 已撤回，Story 2.9 相关 Rust 文件保持格式化结果。
- `cargo test --manifest-path src-tauri/Cargo.toml --test git_detection`：通过，4 个测试全部通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：通过，Rust 单元测试、集成测试和 doc-tests 全部通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --test git_detection`：撤回无关 settings 格式化后复跑通过，4 个测试全部通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：撤回无关 settings 格式化后复跑通过，Rust 全量测试通过。
- `rustfmt --edition 2021 --check src-tauri/src/git/mod.rs src-tauri/src/git/operation_state.rs src-tauri/src/git/status.rs src-tauri/tests/git_detection.rs`：通过，确认本 story 相关 Rust 文件格式正确。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：通过；本轮 review follow-up 仅格式化 Story 2.9 相关 Rust 文件，未纳入工作区已有无关 settings 改动。
- `cargo test --manifest-path src-tauri/Cargo.toml --test git_detection`：通过，8 个 Git detection 集成测试全部通过，覆盖 dirty worktree、特殊路径、new commit、no commit detected、merge/rebase/cherry-pick/revert/unmerged/sequencer 与非前进式 HEAD 移动。
- `cargo test --manifest-path src-tauri/Cargo.toml`：通过，Rust 全量测试通过。
- `rustfmt --edition 2021 --check src-tauri/src/git/mod.rs src-tauri/src/git/operation_state.rs src-tauri/src/git/status.rs src-tauri/tests/git_detection.rs`：通过，确认本轮 review follow-up 后的 Story 2.9 相关 Rust 文件格式正确。
- `pnpm format` / `pnpm lint` / `pnpm typecheck` / `pnpm test`：未运行；本 story 未修改 TypeScript / JavaScript 源码或前端运行时行为，风险限定在 Rust Git 检测层且已由 Rust 集成测试覆盖。
### Change Log

- 2026-06-07：创建 Story 2.9 开发上下文并将状态推进到 `ready-for-dev`。
- 2026-06-07：完成 Git commit detection Spike，实现 Rust Core Git 快照、HEAD 对比、operation-state 检测、Spike 文档与集成测试，状态推进到 `review`。
- 2026-06-07：代码评审留下 3 个 patch action items，状态回退到 `in-progress` 等待后续修复。
- 2026-06-07：完成 review follow-up，补齐 `porcelain=v1 -z` 解析、`revert/sequencer/unmerged` blocker 建模、非前进式 HEAD 移动判定与稳定测试夹具，复审通过并将状态推进到 `done`。
