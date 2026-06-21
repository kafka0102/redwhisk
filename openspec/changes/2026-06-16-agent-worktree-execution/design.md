## Context

当前实现里：

- agent profile 只保存命令、scope、workflow skills 等静态配置；worktree 根位置属于项目通用设置。
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
- 这次 issue 运行时采用了什么 worktree 初始化命令

因此需要在 session 持久化层保存一份 execution context。最小设计建议是为 `agent_sessions` 新增字段，或新增独立 session metadata 表，记录：

- `workspace_mode`: `current_branch` | `worktree`
- `target_branch`
- `workspace_branch`
- `workspace_path`
- `completion_policy_snapshot`
- `worktree_root_path`
- `worktree_setup_command`

这样 review / completion 阶段可以直接读取，不需要依赖当前 UI 状态回推。

### 3. worktree 根位置归属 Project General settings，并保存为枚举

worktree 根位置依赖项目仓库路径，不适合放在可跨项目复用的 agent profile 上。Project General settings 保存固定枚举，运行时按当前 `repo_path` 动态解析真实路径：

- `repo_sibling`: 仓库上一级目录下的 `<repoName>.worktrees`
- `repo_internal`: 当前仓库下的 `.worktrees`
- `user_home`: `~/.redwhisk/worktrees/<repoName>`

这样 repo path 变更后，UI 展示和运行时解析都会自动同步，而数据库中不需要迁移完整路径字符串。

### 4. 仓库内 worktree 目录必须被 `.gitignore` 忽略

选择 `repo_internal` 会在当前仓库下创建 `.worktrees`。为避免误提交 worktree 里的代码，保存 Project General settings 时必须校验：

- 仓库存在 `.gitignore`
- `.gitignore` 包含 `.worktrees/`，并兼容接受 `.worktree/`

`repo_sibling` 与 `user_home` 不在仓库内部，不需要这个校验。

### 5. worktree 初始化命令按“项目默认 + 本次覆盖”执行

Project General settings 提供三行 textarea 保存默认初始化命令，例如 `pnpm install`、`pip install -r requirements.txt`、`go mod download`、`cargo fetch` 或 `mvn dependency:resolve`。Issue Run Dialog 读取该默认值作为 placeholder；用户可在单次运行里覆盖，启动 session 时保存快照，避免项目设置后续变更导致运行上下文漂移。

### 6. completion policy 覆盖按“本次运行快照”执行

run dialog 中新增的 `Commit strategy` 不是在修改项目配置，而是本次 issue 运行的覆盖值。因此：

- UI 默认读取项目 `completionPolicy`
- 用户可在运行前改成本次策略
- `start_agent_session` 接口需要接收 `completion_policy_override`
- session 持久化该快照
- review / completion 阶段优先使用 session 快照，而不是再次读取项目当前设置

否则如果项目设置在 session 运行中被别人修改，完成行为会漂移。

## Data Model

### Project Settings

扩展 `projects`：

- `worktree_location TEXT NOT NULL DEFAULT 'repo_sibling'`
- `worktree_setup_command TEXT NOT NULL DEFAULT ''`

### Session Execution Context

建议为 `agent_sessions` 新增以下列，避免额外 join：

- `workspace_mode TEXT NOT NULL DEFAULT 'current_branch'`
- `target_branch TEXT`
- `workspace_branch TEXT`
- `workspace_path TEXT`
- `completion_policy TEXT`
- `worktree_root_path TEXT`
- `worktree_setup_command TEXT`

如果仓库更倾向低风险迁移，也可新建 `agent_session_execution_contexts` 表并以 `session_id` 外键关联；但对当前代码结构而言，直接扩展 `agent_sessions` 更简单，因为 session 查询已经是所有 issue/agent 视图的核心入口。

## Frontend Design

### Project General Settings

在 `Commit strategy` 下方新增：

- `Worktree path` 下拉框，显示由当前 repo path 推导出的三个真实路径，保存枚举值
- `Worktree setup after creation` 三行 textarea，保存项目默认初始化命令

Agent Profile Form 不再展示或保存 `Worktree path`。

### Issue Run Dialog

字段顺序调整为：

1. `Agent profile`
2. `Workflow skill`
3. `Commit strategy`
4. `开发模式`
   - 左：`Worktree` / `Current branch`
   - 右：本地分支下拉框
5. `Worktree setup after creation`
6. `Final prompt`

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
- `worktreeSetupCommand`

启动流程：

1. 读取项目、profile、issue
2. 解析 session execution context
3. 若 `workspaceMode = current_branch`
   - `working_dir = project.repo_path`
   - `workspace_branch = current branch`
4. 若 `workspaceMode = worktree`
   - 根据项目 `worktree_location` 和当前 `repo_path` 计算 `worktree_root_path`
   - 若 root 不存在，则创建目录
   - 基于 `targetBranch` 创建 worktree 目录，例如 `<worktree_root>/<issue-slug>`
   - 在新 worktree 中创建并 checkout 临时开发分支
   - `working_dir = workspace_path`
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
- project settings 与 agent session migration
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
