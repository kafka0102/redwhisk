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
