## Context

当前实现里：

- agent profile 只保存命令、scope、workflow skills 等静态配置，没有 worktree 根目录。
- `IssueRunDialog` 只把 `projectId`、`issueId`、`agentProfileId` 与最终 prompt 发给 `start_agent_session`。
- `AgentSessionService::prepare_session_launch` 永远把 `project.repo_path` 作为 `working_dir`。
- issue 的完成链路默认观察 `project.repo_path` 的 git 状态，并假设运行中的 agent session 直接作用在该仓库工作区。

因此，这次需求不是简单的 UI 加字段，而是要让“本次运行的执行上下文”成为一等数据：它必须从前端 run dialog 传到 session 启动，再贯穿 issue review/completion，直到 worktree 被合并并删除。

## Key Decisions

### 1. 分支下拉框表示“目标合并分支”

已和用户确认：run dialog 里的本地分支下拉框表示最终目标分支，而不是 agent 直接开发的分支。

因此 `Worktree` 模式采用两层分支模型：

- 目标分支：用户在右侧下拉框中选择，例如 `devlop`
- 临时开发分支：系统在新 worktree 中自动创建，例如 `issue-123-dev` 或同等唯一命名

agent 始终在临时开发分支中工作；完成后系统负责把它合并回目标分支，再删除临时分支和 worktree。

### 2. 把运行期选择显式持久化到 session 上

仅靠 localStorage 记忆 UI 选择不足以支撑完成阶段的自动合并与清理，因为完成时必须知道：

- 本次是否用了 worktree
- worktree 路径是什么
- 目标分支是什么
- 临时开发分支是什么
- 这次 issue 运行时采用了什么 completion policy

因此需要在 session 持久化层保存一份 execution context。最小设计建议是为 `agent_sessions` 新增字段，或新增独立 session metadata 表，记录：

- `workspace_mode`: `current_branch` | `worktree`
- `target_branch`
- `workspace_branch`
- `workspace_path`
- `completion_policy_snapshot`
- `worktree_root_path`

这样 review / completion 阶段可以直接读取，不需要依赖当前 UI 状态回推。

### 3. agent profile 的 `worktree_path` 只在项目级 profile 下提供稳定默认值

默认值定义为 `<repoPath>.worktrees`。例如：

- repo path: `/home/xx/itsm-risk`
- default worktree path: `/home/xx/itsm-risk.worktrees`

这里有一个边界：全局 agent profile 可能跨项目复用，而默认值依赖当前项目仓库路径。因此设计取舍为：

- 所有 profile 都允许持久化 `worktree_path`
- 但只有在当前表单上下文能拿到项目 `repoPath` 时，才自动填入 `<repoPath>.worktrees`
- 若当前是 global profile 且没有项目 repo path，上层表单传入空字符串时不自动补默认值；若是从项目 Settings 打开 global profile，则可按当前项目 repo path 预填，用户可手工改

这能兼容现有 UI 结构，而不用先重构 profile 的作用域模型。

### 4. 路径校验分为“默认值容忍不存在”和“自定义值必须存在”

用户要求默认值可能指向一个尚未存在的目录，因此不能要求默认值在保存前必须存在。否则会和默认行为冲突。

建议规则：

- 如果当前值等于该项目 repo path 计算出的默认值 `<repoPath>.worktrees`，允许目录不存在；运行时创建 worktree 前再自动 `mkdir -p`
- 如果用户把值改成非默认路径，则前端立即校验该路径是否存在；不存在则提示并阻止保存
- 后端 `save_agent_profile` 也执行同样的兜底校验，防止前端绕过

这样既满足“默认目录可不存在”，也满足“自定义目录必须存在”。

### 5. completion policy 覆盖按“本次运行快照”执行

run dialog 中新增的 `Commit strategy` 不是在修改项目配置，而是本次 issue 运行的覆盖值。因此：

- UI 默认读取项目 `completionPolicy`
- 用户可在运行前改成本次策略
- `start_agent_session` 接口需要接收 `completion_policy_override`
- session 持久化该快照
- review / completion 阶段优先使用 session 快照，而不是再次读取项目当前设置

否则如果项目设置在 session 运行中被别人修改，完成行为会漂移。

## Data Model

### Agent Profile

扩展 `agent_profiles`：

- `worktree_path TEXT NOT NULL DEFAULT ''`

前后端类型同步增加：

- `AgentProfileRecord.worktreePath`
- `SaveAgentProfileInput.worktreePath`

### Session Execution Context

建议为 `agent_sessions` 新增以下列，避免额外 join：

- `workspace_mode TEXT NOT NULL DEFAULT 'current_branch'`
- `target_branch TEXT`
- `workspace_branch TEXT`
- `workspace_path TEXT`
- `completion_policy TEXT`
- `worktree_root_path TEXT`

如果仓库更倾向低风险迁移，也可新建 `agent_session_execution_contexts` 表并以 `session_id` 外键关联；但对当前代码结构而言，直接扩展 `agent_sessions` 更简单，因为 session 查询已经是所有 issue/agent 视图的核心入口。

## Frontend Design

### Agent Profile Form

在 `Workflow Skills` 下方新增：

- `Worktree path` 文本框

表单行为：

- 初始值优先级：
  1. 编辑已有 profile 时使用已保存值
  2. 新建时若能拿到当前项目 `repoPath`，使用 `<repoPath>.worktrees`
  3. 否则为空
- 如果用户输入值与默认值不同，则触发存在性校验
- 不存在时显示行内错误并阻止保存

需要从父组件把 `projectPath` 传入 `AgentProfileForm`，否则无法计算默认值。

### Issue Run Dialog

字段顺序调整为：

1. `Agent profile`
2. `Workflow skill`
3. `Commit strategy`
4. `开发模式`
   - 左：`Worktree` / `Current branch`
   - 右：本地分支下拉框
5. `Final prompt`

交互规则：

- `Commit strategy` 默认取项目 `completionPolicy`
- `开发模式` 默认取该项目上次运行选择，存于 localStorage
- 分支列表默认选择当前分支
- 当开发模式为 `Current branch` 时，右侧分支选择禁用并固定显示当前分支
- 当开发模式为 `Worktree` 时，右侧分支可修改

需要新增一个后端命令用于读取本地分支和当前分支，避免前端直接 shell：

- `get_project_git_branches(projectId) -> { currentBranch, localBranches[] }`

## Backend Flow

### Start

`start_agent_session` 扩展输入：

- `selectedWorkflowSkill` 如果后续想做精确记录可一起带上；本次不是必需
- `completionPolicyOverride`
- `workspaceMode`
- `targetBranch`

启动流程：

1. 读取项目、profile、issue
2. 解析 session execution context
3. 若 `workspaceMode = current_branch`
   - `working_dir = project.repo_path`
   - `workspace_branch = current branch`
4. 若 `workspaceMode = worktree`
   - 计算 `worktree_root_path`
   - 若 root 不存在且是默认路径，则创建目录
   - 基于 `targetBranch` 创建 worktree 目录，例如 `<worktree_root>/<issue-slug>`
   - 在新 worktree 中创建并 checkout 临时开发分支
   - `working_dir = worktree_path`
5. 启动 agent process / PTY
6. 持久化 session 与 execution context
7. 记下最近一次 run dialog 选择

worktree 目录命名建议：

- `<issueId>-<sanitized-title>`
- 失败时回退为 `<issueId>`

临时开发分支命名建议：

- `issue/<issueId>`
- 若冲突则追加时间戳或随机后缀

### Completion

只要 session execution context 里 `workspace_mode = worktree`，完成阶段就必须走专门清理逻辑。

以 `agent_auto_commit` 为例：

1. 在 worktree 中检测临时开发分支是否产生了新的 commit
2. 切回主仓库 `repo_path`
3. 判断 `target_branch` 是否已包含 `workspace_branch`
4. 若未包含：
   - checkout `target_branch`
   - merge `workspace_branch`
   - 若冲突，则把 issue 保持在 `review` 并记录失败原因
5. merge 成功后：
   - `git branch -d <workspace_branch>`，必要时在确认已合并后用强制删除兜底
   - `git worktree remove <workspace_path>`
   - `git worktree prune`

`complete_issue_clean` 也需要识别 worktree session：

- 如果用户选择 clean completion，且 worktree 分支没有改动，可直接清理 worktree 并完成 issue
- 如果 worktree 仍有未提交改动，则阻止 clean completion

### Failure Handling

以下情况要明确保留 issue 在 `review` 并展示错误：

- worktree 创建失败
- 临时分支创建失败
- target branch 不存在或不是本地分支
- merge 冲突
- worktree remove 失败
- branch delete 失败

其中 merge / 清理失败时，不应提前把 issue 标记为 completed。

## Suggested Modules

为避免把 git 命令散落在 `issue_service.rs` 和 `agent_session_service.rs` 中，建议新增一个最小的 worktree runtime 模块，例如：

- `src-tauri/src/git/worktree.rs`

职责仅包含：

- 获取当前分支与本地分支列表
- 创建 worktree
- 在 worktree 中创建临时分支
- 检查分支是否已合并
- merge 目标分支
- 删除 worktree 与临时分支

这是当前任务需要的最小抽象，不延伸成通用 git orchestration framework。

## Complexity

该 change 涉及：

- 前端两处关键表单
- agent profile 与 agent session migration
- 新 git/worktree 生命周期
- issue completion 行为变化

这属于 `高复杂度` 变更。推荐实现路径为：

- `Superpowers + subagent + new worktree`

原因：

- 任务跨前端、Rust service、migration、git runtime 和测试
- worktree 生命周期需要严格分步验证
- session / issue 状态流和 git 副作用耦合较强，适合拆小步执行与 review gate

## Validation

实现阶段至少运行：

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test -- src/features/settings/project-settings-activity.test.tsx src/features/issues/issues-activity.test.tsx`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_session`
- `cargo test --manifest-path src-tauri/Cargo.toml issue`
- `cargo test --manifest-path src-tauri/Cargo.toml settings`
