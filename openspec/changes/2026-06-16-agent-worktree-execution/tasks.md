## 1. Agent Profile Worktree 配置

- [x] 1.1 为 agent profile 增加 `worktree_path` 持久化字段、前后端类型与 migration。
- [x] 1.2 在 Agent Profile 表单中新增 `Worktree path` 字段，并按当前项目 `repoPath` 计算默认值 `<repoPath>.worktrees`。
- [x] 1.3 实现路径校验：默认路径允许不存在，自定义路径不存在时提示并阻止保存。
- [x] 1.4 补充 Settings 前端测试与 Rust settings service / repository 测试。

## 2. Issue Run Dialog 执行上下文

- [x] 2.1 在 run dialog 中新增 `Commit strategy` 字段，默认继承项目 `completionPolicy`，允许本次覆盖。
- [x] 2.2 在 run dialog 中新增 `开发模式` 和目标分支选择，并记忆项目上次的选择。
- [x] 2.3 新增读取本地分支与当前分支的命令，并在 `Current branch` 模式下禁用分支修改。
- [x] 2.4 补充 run dialog 前端测试，覆盖默认值、禁用态、最近选择记忆和提交流程。

## 3. Session Execution Context 与 Worktree 启动

- [x] 3.1 扩展 `start_agent_session` 输入与 session 持久化模型，保存 workspace mode、目标分支、临时分支、workspace path 与 completion policy 快照。
- [x] 3.2 新增最小 git/worktree runtime 模块，实现本地分支查询、worktree 创建、临时分支派生和清理辅助。
- [x] 3.3 在 `Worktree` 模式启动 issue 时，于配置的 `worktree_path` 下创建 worktree，并在其中创建以 issue ID 为核心的临时开发分支。
- [x] 3.4 补充 `agent_session` Rust 测试，覆盖 current branch / worktree 两种启动路径与异常场景。

## 4. 完成阶段自动合并与清理

- [x] 4.1 让 issue review/completion 逻辑读取 session execution context，而不是只看项目 `repo_path`。
- [x] 4.2 对 worktree 模式实现“检测是否已合并目标分支，未合并则自动 merge”的完成流程。
- [x] 4.3 在成功完成后删除临时开发分支与对应 worktree；失败时保持 issue 在 `review` 并记录错误。
- [x] 4.4 补充 `issue` Rust 测试，覆盖自动 merge、merge 冲突、未提交改动与清理失败等场景。

## 5. 验证

- [x] 5.1 运行 `pnpm lint`。
- [x] 5.2 运行 `pnpm typecheck`。
- [x] 5.3 运行 `pnpm test -- src/features/settings/project-settings-activity.test.tsx src/features/issues/issues-activity.test.tsx`。
- [x] 5.4 运行 `cargo test --manifest-path src-tauri/Cargo.toml agent_session`。
- [x] 5.5 运行 `cargo test --manifest-path src-tauri/Cargo.toml issue`。
- [x] 5.6 运行 `cargo test --manifest-path src-tauri/Cargo.toml settings`。

## 6. Review 反馈：Project 级 worktree 设置与初始化

- [x] 6.1 从 Agent Profile 表单、前后端类型、repository 与 settings service 中移除 `worktree_path`。
- [x] 6.2 将 worktree 位置迁移到 Project General settings，保存为 `repo_sibling`、`repo_internal`、`user_home` 三个枚举值。
- [x] 6.3 按当前 repo path 动态展示三种 worktree 真实路径，并在 repo path 变化后同步刷新显示。
- [x] 6.4 对 `repo_internal` 保存增加 `.gitignore` 安全校验，要求忽略 `.worktrees/` 或兼容的 `.worktree/`。
- [x] 6.5 在 Project General settings 增加三行 `Worktree setup after creation` textarea，并在 Issue Run Dialog 中支持单次运行覆盖。
- [x] 6.6 运行更新后的前端相关测试与 Rust 相关测试。

## 7. Review 反馈：Done 提交检查与 Worktree 合并流程

- [ ] 7.1 标记 issue 为 Done / 完成前，按 session execution context 检查本次 issue 相关未提交代码；手动提交策略时弹窗阻止完成，自动提交策略时向当前 agent session 注入本地化提交提示词。
- [ ] 7.2 自动提交提示词改为“获取本次修改相关的代码”，并按全局语言设置选择中文或英文模板；提交检测需异步等待新 commit 出现后再继续完成流程。
- [ ] 7.3 本地分支下拉框只展示可作为 merge-back base 的仓库本地有效分支，排除附加 worktree 正在占用的分支与临时 issue 分支。
- [ ] 7.4 Worktree 模式启动时，先创建 `issue-{id}-xxx` worktree，再执行配置的初始化命令并等待完成；初始化期间展示进度窗口，失败时关闭 run dialog 但不跳转 Settings，并阻止启动 agent session。
- [ ] 7.5 Worktree-backed issue 标记完成时，先检查记录的 worktree 是否仍存在；不存在则跳过 worktree 合并清理，存在则先做提交检查再执行 merge-back。
- [ ] 7.6 点击完成时必须展示确认框，明确将临时分支合入记录的目标分支；目标分支为 `main` / `master` 时使用高风险文案，其他分支也必须确认。
- [ ] 7.7 自动 merge-back 期间展示异步进度窗口，逐步展示检查提交、检查 worktree、合并分支与清理 worktree 等步骤。
- [ ] 7.8 若 merge-back 发生冲突，关闭进度窗口，保持 issue 在 review，跳转或停留在当前 session，并自动发送提示词要求 agent 解决冲突并合并到最初记录的目标分支。
- [ ] 7.9 补充前端与 Rust 测试，覆盖自动提交提示词、手动提交阻止、分支过滤、初始化等待、完成确认、合并进度和冲突接管。
