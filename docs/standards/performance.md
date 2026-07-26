# 性能与并发规范

本规范约束 RedWhisk 中几类容易引入「页面卡顿 / 命令串行化」的写法，源自一次「变更 / 代码」Activity 进入与打开文件严重卡顿的排查（`getProjectWorktreeCommitHistory` 每次约 3.3s、进入「变更」页多条命令同时卡约 7.5s）。冲突时以更具体的架构文档（[Tauri 契约](../architecture-design/tauri-contract.md)、[Worktree 与 Git 生命周期](../architecture-design/worktree-git-lifecycle.md)）为准。

## 1. 阻塞型 Tauri command 必须经 `spawn_blocking`

**判据**：command 体内只要有同步阻塞操作——SQLite 开库 / 查询、`git` 子进程、文件系统遍历、`std::process::Command`——就必须把阻塞部分放进 `tauri::async_runtime::spawn_blocking`；轻量的目录解析 / 幂等初始化可留在 async 体内。

**为什么**：同步 `#[tauri::command] pub fn`，或在 async command 里直接阻塞，会占用 Tauri 的 async 运行时线程，导致并发命令被串行化。曾表现为进入「变更」页时 `getProjectWorktreeChanges` / `getProjectWorktreeCommitHistory` / `listAgentSessions` 三条命令同时卡约 7.5s 才一起返回。

**做法**（参考 `src-tauri/src/features/agent_session/commands.rs` 的 `prepare_*` + `spawn_blocking` 模式）：

- async 体内只做轻量准备：解析 `data_dir`、幂等 `local_data` 初始化、克隆 `Arc` 句柄；
- 开库、迁移、git、service 调用全部放进 `spawn_blocking(move || { ... })`；
- `State<'_, AppState>` 不可跨 `await`，所需字段在进入闭包前 `.clone()` 或提取为 owned（如 `PathBuf`）。

**反例**：`src-tauri/src/features/agent_session/workspace_commands.rs` 历史上的 6 个同步 `pub fn`（开库 + 迁移 + git 全跑在运行时线程）。已改异步 + `spawn_blocking`。

## 2. 批量取数，禁止 N+1 子进程 / 命令调用

**判据**：对一组条目（提交、文件、行）逐条发起 `git` 子进程、SQL 查询或 Tauri command，就是 N+1。

**为什么**：每次 `git` 子进程在 macOS 上 fork/exec + 仓库初始化约 10–30ms。逐条循环会把这个成本放大 N 倍。曾表现为 `read_workspace_commit_history` 对最近 50 条提交逐条各起 `git merge-base --is-ancestor` 与 `git diff-tree`，约 116 次子进程，每次调用约 3.3s，且变更视图每 4–8s 轮询一次。

**做法**：用单次调用取回全部所需数据。

- 提交表头 + 每提交变更文件：单次 `git log --name-status`，提交头用 NUL 分隔、其后跟该提交的 name-status 行；
- 批量祖先判定：单次 `git rev-list <ref>` 取可达集合，成员判定代替逐条 `git merge-base --is-ancestor`。

**反例**：`src-tauri/src/features/agent_session/workspace.rs::read_workspace_commit_history` 历史上的逐提交 `diff-tree` / `merge-base`。已批量化。

## 3. 按需过滤，禁止拉全量再前端过滤

**判据**：后端命令能按参数过滤时，不要在前端拉全量再 `.filter`。

**为什么**：轮询场景下每数秒把全量（含大量已结束 / 无关）数据序列化、跨 IPC、再前端过滤，是纯浪费。

**做法**：给命令加可选过滤参数；调用方按需传。

- `list_agent_sessions(project_id, status?)`：变更页 running 检测传 `status=running` 只取运行中会话，其余 8 处调用方不传、仍取全量。

**反例**：`src/features/changes/use-changes-auto-refresh.ts` 的 `useWorktreeRunningSession` 历史上每 5s 拉全量 session 再前端过滤 running turn。

## 4. 新增命令 / 轮询前的自检

- 命令体内有 `Command::new("git")` / `Connection::open` / `fs::read_dir` 吗？→ `spawn_blocking`。
- 有「对每条结果再调一次命令 / git」的循环吗？→ 改单次批量。
- 前端在轮询吗？轮询的数据能否后端过滤、或改为事件驱动（`agent-session-list-changed` 等）？

## 5. 新窗口 / 默认 Issues 首屏禁止同步拉起重依赖

**判据**：项目窗口冷启动（`open_project_window` → `index.html?projectId=`）默认进入 Issues，主入口与 Issues 渲染路径不得同步 `import` Monaco、xterm、Agents/Code/Changes/Terminals 等非默认 Activity 的重模块。

**为什么**：生产构建中曾出现主 chunk ≈5.8MB（含 `monaco-editor`），新窗口需在首屏可交互前解析整包，表现为「正在打开项目…」或白屏卡住十多秒；后端 `open_project` 本身通常在百毫秒级。

**做法**：

- `src/main.tsx` 不调用 / 不静态 import Monaco 配置；首次真正渲染 Editor/DiffEditor 前再 `import("./monaco-editor-setup")`。
- `ActivityRouter` 对非 `issues` Activity 使用 `React.lazy` + `Suspense`；Issues 保持同步 import。
- URL 带 `projectId` 时，`openProject` 与 `listProjects` 并行，避免列表 IPC 串行拖长打开空态。
- 回归：`src/app/main-entry-budget.test.ts`；本地可用 `pnpm exec vite build` 核对 `dist/assets/index-*.js` 体积与是否含 `monaco`。

