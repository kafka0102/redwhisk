## Why

当前 `Agent Profile` 只能配置命令、作用域与 workflow skills，无法声明该 agent 在当前仓库里执行 `worktree` 模式时的工作目录根路径。`Issue Run` 对话框也只有 profile 与 workflow skill 选择，不能覆盖项目默认的提交策略，更不能决定这次执行是跑在当前分支还是独立 worktree 中。

这会带来三类问题：

- 用户无法为不同 agent 显式配置 worktree 根目录，导致运行时只能退回当前仓库目录，无法隔离多条 issue 的开发环境。
- backlog issue 的运行入口缺少“开发模式 + 目标分支 + 提交策略”的执行上下文，无法把一次运行稳定映射到具体的 git 生命周期。
- 当前 issue 完成链路默认只观察主仓库 `repo_path` 的提交状态，尚未覆盖“在临时 worktree 分支开发、完成后自动合并并清理”的场景。

## What Changes

- 在创建与编辑 agent 的表单中新增 `Worktree path` 文本字段，默认值为 `<repoPath>.worktrees`，允许用户覆盖；若用户输入自定义路径且路径不存在，前端需要提示，后端也要拒绝保存无效路径。
- 扩展 agent profile 数据模型，持久化 `worktree_path`，并让项目级 profile 的默认值始终基于当前项目仓库路径计算。
- 在 issue 运行对话框中，于 `Workflow skill` 下方新增 `Commit strategy` 字段，默认继承当前项目的 `completionPolicy`，但允许本次运行覆盖。
- 在 issue 运行对话框中新增 `开发模式` 区块：
  - 左侧为 `Worktree` / `Current branch` 下拉框，并记忆该项目上次执行时的选择。
  - 右侧为仓库本地分支下拉框，默认选中当前分支；仅在 `Worktree` 模式下允许修改。
- 当用户以 `Worktree` 模式启动 issue 时，运行时需要：
  - 记录这次选择的开发模式、目标分支与提交策略。
  - 在 agent profile 指定的 `worktree_path` 下创建基于目标分支的独立 worktree。
  - 在该 worktree 中创建一个以 issue ID 为核心的临时开发分支，并让 agent 在此分支中运行。
- 当 issue 任务完成且本次运行创建了 worktree 时，系统需要：
  - 检查临时开发分支是否已合并回用户选择的目标分支。
  - 若尚未合并，则自动执行合并。
  - 随后删除临时开发分支与对应 worktree。

## Capabilities

### Modified Capabilities

- `settings-ui`: 扩展 agent profile 表单，支持 worktree 根路径配置与校验提示。
- `issues-ui`: 扩展 issue run dialog，支持提交策略覆盖、开发模式选择、目标分支选择与最近一次选择记忆。

### Added Capabilities

- `issue-execution-worktree`: 定义 issue 运行时的 worktree 创建、分支派生、提交完成检测、自动合并与清理生命周期。

## Non-goals

- 不在本次 change 内支持远程分支列表、自动 fetch/pull、跨仓库 worktree 管理或多个目标分支的批量合并。
- 不引入通用的 git 流程编排框架；仅实现当前 issue run / issue completion 所需的最小 worktree 生命周期。
- 不处理用户手工在 worktree 里做出的额外分支切换、rebase 或 cherry-pick 流程，超出约束的场景按错误提示处理。

## Impact

- 前端：`src/features/settings/agent-profile-form.tsx`、`src/features/issues/issue-run-dialog.tsx`、对应 command types、本地存储记忆逻辑与测试。
- Tauri / Rust：agent profile 类型、repository、migration、settings service、issue session 启动参数、git/worktree 生命周期辅助模块、issue completion 检测逻辑与测试。
- 数据：需要新增 migration，为 agent profile、agent session 或 completion attempt 补充 worktree/执行策略相关字段，确保运行时状态可追踪。
