# Git Commit Detection Spike

日期：2026-06-07

## 目标

验证 RedWhisk 是否能在本地 Git 仓库中可靠读取 completion 前后的 Git 事实，避免把 Agent 输出文本误当作真实提交结果。

本次 Spike 只建立 Git 检测能力和结论，不实现 Epic 5 的 Completion Confirmation UI、`completion_attempts` 完整持久化链路或 Issue 完成状态机。

## 本次实现

- 新增 `src-tauri/src/git/status.rs`，提供最小 Git 快照能力：
  - `head`
  - `statusPorcelain`
  - `changedFiles`
  - `operationState`
  - `isClean`
- 新增 `src-tauri/src/git/operation_state.rs`，识别：
  - `merge_in_progress`
  - `rebase_in_progress`
  - `cherry_pick_in_progress`
  - `revert_in_progress`
  - `sequencer_in_progress`
  - `unmerged`
  - `none`
- 新增 `detect_commit_result`，用 completion 前后的 `HEAD` 对比输出：
  - `NewCommit { commit_hash }`
  - `NoCommitDetected`
  - `HeadMovedWithoutNewCommit { head }`
- Git 状态读取通过 Rust Core 执行本机 `git` 命令，不暴露给 React，不执行 `git add`、`git commit`、`merge`、`rebase` 或修复操作。

## 自动化证据

已按 TDD 执行：

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test git_detection
```

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

RED 阶段结果：

- 首次运行失败，原因是 `redwhisk_lib::git::operation_state` 与 `redwhisk_lib::git::status` 尚不存在。
- 该失败证明测试先于实现建立，且失败点对应 Story 2.9 所需的新 Git 检测能力。

GREEN 阶段结果：

- 新增最小实现后复跑通过。
- review follow-up 收口后复跑通过。
- `git_detection` 集成测试共 8 个用例全部通过。

覆盖行为：

- dirty worktree：记录 `HEAD`、`git status --porcelain`、changed files 摘要和 `isClean=false`。
- 特殊路径与 rename/copy：基于 `git status --porcelain=v1 -z` 结构化解析，覆盖空格、引号、tab、rename/copy 和异常行。
- new commit：`HEAD` 改变时返回新 commit hash。
- no commit detected：`HEAD` 未改变时返回 `NoCommitDetected`。
- non-fast-forward head move：`checkout` / `reset` / 类似路径导致的 HEAD 改动不会被误报为新提交，而是返回 `HeadMovedWithoutNewCommit`。
- operation in progress：可识别 merge、rebase、cherry-pick、revert、sequencer 和 unmerged 等阻塞状态。

## 手工命令事实

当前实现依赖 Git 的脚本化接口：

```bash
git rev-parse HEAD
git rev-parse --git-dir
git status --porcelain=v1
git status --porcelain=v1 -z
git merge-base --is-ancestor <before> <after>
```

取舍：

- 使用 `git status --porcelain=v1` 和 `git status --porcelain=v1 -z`，不解析普通人类可读 `git status` 输出。
- 使用 `git rev-parse --git-dir` 定位真实 Git metadata 目录，避免只看 `.git` 目录形态。
- 使用 `git merge-base --is-ancestor` 区分“新提交导致的 HEAD 前进”和“checkout/reset/rebase 等导致的非前进式 HEAD 移动”。
- changed files 摘要保留 porcelain 状态码、路径和 rename/copy 源路径，不实现完整 diff。

## 结论

### 已验证成立

- RedWhisk 可以在 Rust Core 中读取当前仓库 `HEAD` 和 porcelain status。
- RedWhisk 可以基于 `HEAD` 前后对比判断 completion 后是否产生新 commit。
- 当 `HEAD` 没有变化时，可以稳定归档为 `no_commit_detected`，后续 Epic 5 必须保持 Issue 为 `review`。
- RedWhisk 可以把 `checkout` / `reset` 等非前进式 HEAD 移动与真实新提交区分开，避免把仓库导航误报成 Agent commit。
- RedWhisk 可以在 completion 前识别 merge、rebase、cherry-pick、revert、sequencer 和 unmerged 等阻塞状态，并将其作为阻塞完成的事实。

### 未进入本 story

- 未实现 Completion Confirmation UI。
- 未实现 `completion_attempts` 表、repository 或完整审计事务。
- 未实现 Issue `completed` 状态流转。
- 未实现 Agent Session `closed` 收口。
- 未实现完整 Diff、Git 历史、GitHub/GitLab、PR/MR 或 worktree 自动化。

## 推荐降级策略

- 如果 `operationState != none`，Epic 5 的完成动作必须阻塞自动完成，提示用户手动处理当前 Git 操作。
- 如果 completion prompt 发送后 `HEAD` 未改变，结果必须为 `no_commit_detected`，Issue 保持 `review`。
- 如果 completion 前后 `HEAD` 改变但不是祖先前进关系，结果必须视为 `HeadMovedWithoutNewCommit`，不能直接当作 Agent 新提交完成。
- 如果 Git 命令不可用、repo path 不可访问或不是有效 Git 仓库，不能把结果当作 no commit；应展示明确失败并保持原业务状态。
- 如果 `HEAD` 改变，后续 Epic 5 可以记录新 commit hash，但仍应在同一事务中收口 CompletionAttempt、Issue 和 AgentSession 状态。

## 对后续故事的约束

- Story 5.3 可以复用 `GitSnapshot.changedFiles` 作为确认面板摘要，但不应展示完整 diff。
- Story 5.5 可以复用 `detect_commit_result` 判断 commit hash，但必须把结果写入 `completion_attempts` 并由 Rust Core 更新 Issue / AgentSession。
- Story 5.6 必须把 `NoCommitDetected` 映射为 Issue 保持 `review`。
- Story 5.7 必须把 merge / rebase / cherry-pick / revert / sequencer / unmerged 等进行中状态作为阻塞自动完成的条件。
