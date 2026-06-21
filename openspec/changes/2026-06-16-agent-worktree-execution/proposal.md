## Why

当前项目通用设置只能配置提交策略，无法声明当前仓库执行 `worktree` 模式时的工作目录根位置，也无法配置 worktree 创建后的初始化动作。`Issue Run` 对话框只有 profile 与 workflow skill 选择，不能覆盖项目默认的提交策略，更不能决定这次执行是跑在当前分支还是独立 worktree 中。

这会带来三类问题：

- 用户无法为项目显式配置 worktree 根目录策略，导致运行时只能退回当前仓库目录，无法隔离多条 issue 的开发环境。
- 创建 worktree 后缺少项目初始化命令，常见 TypeScript、Python、Go、Rust、Java 项目需要用户手工安装依赖。
- backlog issue 的运行入口缺少“开发模式 + 目标分支 + 提交策略”的执行上下文，无法把一次运行稳定映射到具体的 git 生命周期。
- 当前 issue 完成链路默认只观察主仓库 `repo_path` 的提交状态，尚未覆盖“在临时 worktree 分支开发、完成后自动合并并清理”的场景。

## What Changes

- 从创建与编辑 agent 的表单中移除 `Worktree path` 字段。
- 在 Project General settings 中新增 `Worktree path` 下拉字段，持久化为固定枚举值，运行时按当前仓库路径动态解析真实路径：
  - 仓库同级目录下的 `<repoName>.worktrees`
  - 当前仓库内的 `.worktrees`
  - `~/.redwhisk/worktrees/<repoName>`
- 当选择当前仓库内 `.worktrees` 时，保存项目设置必须校验仓库存在 `.gitignore`，且包含 `.worktrees/` 或兼容的 `.worktree/` 忽略项。
- 在 Project General settings 中新增三行 `Worktree setup after creation` textarea，用于配置 worktree 创建后的初始化命令；空值时 Issue Run 对话框显示按项目路径/常见语言推断的占位符，用户可在单次运行中覆盖。
- 在 issue 运行对话框中，于 `Workflow skill` 下方新增 `Commit strategy` 字段，默认继承当前项目的 `completionPolicy`，但允许本次运行覆盖。
- 在 issue 运行对话框中新增 `开发模式` 区块：
  - 左侧为 `Worktree` / `Current branch` 下拉框，并记忆该项目上次执行时的选择。
  - 右侧为仓库本地有效分支下拉框，默认选中当前分支；仅在 `Worktree` 模式下允许修改，并排除附加 worktree 正在占用的分支与临时 issue 分支。
- 当用户以 `Worktree` 模式启动 issue 时，运行时需要：
  - 记录这次选择的开发模式、目标分支与提交策略。
  - 按项目级 worktree 位置枚举解析真实路径，并在该路径下创建基于目标分支的独立 worktree。
  - 记录 worktree 创建后的初始化命令快照。
  - 创建 worktree 后按配置执行初始化命令，并等待其完成后再启动 agent session；初始化期间展示进度提示，失败时阻止启动并展示错误。
  - 在该 worktree 中创建一个以 issue ID 为核心的临时开发分支，并让 agent 在此分支中运行。
- 当用户将 issue 标记为 `Done` / `完成` 时，完成链路需要先检查本次 issue 相关代码是否已提交：
  - 若存在未提交代码且本次策略为自动提交，向当前 agent session 注入本地化提示词，请 agent 只获取并提交本次修改相关的代码，随后异步检测提交是否完成。
  - 若存在未提交代码且本次策略为手动提交，弹出提示框要求用户先提交后再标记完成。
- 当 issue 任务完成且本次运行创建了 worktree 时，系统需要：
  - 检查记录的 worktree 是否仍存在；若已删除则跳过 worktree 合并与清理。
  - 若仍存在，先完成提交检查，再弹出确认框，提示即将把临时分支合入记录的目标分支；目标分支为 `main` / `master` 时使用更醒目的确认文案，其他分支也必须确认。
  - 检查临时开发分支是否已合并回用户选择的目标分支；若尚未合并，则自动执行合并并展示异步进度。
  - 若合并发生冲突，保持 issue 在 review，跳转或停留在当前 agent session，并自动发送提示词要求 agent 解决冲突并合并到最初记录的目标分支。
  - 随后删除临时开发分支与对应 worktree。

## Capabilities

### Modified Capabilities

- `settings-ui`: 扩展 Project General settings，支持 worktree 位置枚举、仓库内 `.gitignore` 安全校验与初始化命令配置。
- `issues-ui`: 扩展 issue run dialog，支持提交策略覆盖、开发模式选择、目标分支选择与最近一次选择记忆。

### Added Capabilities

- `issue-execution-worktree`: 定义 issue 运行时的 worktree 创建、分支派生、提交完成检测、自动合并与清理生命周期。

## Non-goals

- 不在本次 change 内支持远程分支列表、自动 fetch/pull、跨仓库 worktree 管理或多个目标分支的批量合并。
- 不引入通用的 git 流程编排框架；仅实现当前 issue run / issue completion 所需的最小 worktree 生命周期。
- 不处理用户手工在 worktree 里做出的额外分支切换、rebase 或 cherry-pick 流程，超出约束的场景按错误提示处理。
- 不自动提交与当前 issue / 当前 session 无关的文件，即使这些文件也出现在同一仓库的 git status 中。

## Impact

- 前端：`src/features/settings/agent-profile-form.tsx`、`src/features/issues/issue-run-dialog.tsx`、对应 command types、本地存储记忆逻辑与测试。
- Tauri / Rust：agent profile 类型、repository、migration、settings service、issue session 启动参数、git/worktree 生命周期辅助模块、issue completion 检测逻辑与测试。
- 数据：需要新增 migration，为 agent profile、agent session 或 completion attempt 补充 worktree/执行策略相关字段，确保运行时状态可追踪。
