# 性能与并发规范

本规范约束 RedWhisk 中几类容易引入「页面卡顿 / 命令串行化」的写法，源自一次「变更 / 代码」Activity 进入与打开文件严重卡顿的排查（`getProjectWorktreeCommitHistory` 每次约 3.3s、进入「变更」页多条命令同时卡约 7.5s）。冲突时以更具体的架构文档（[Tauri 契约](../architecture-design/tauri-contract.md)、[Worktree 与 Git 生命周期](../architecture-design/worktree-git-lifecycle.md)）为准。

## 1. 阻塞型 Tauri command 必须经 `spawn_blocking`

**判据**：command 体内只要有同步阻塞操作——SQLite 开库 / 查询、`git` 子进程、文件系统遍历、`std::process::Command`——就必须把阻塞部分放进 `tauri::async_runtime::spawn_blocking`；轻量的目录解析，以及已经快路径化的幂等初始化，可留在 async 体内（若该初始化会开库、拿写事务或跑迁移，则必须先让它变成只读快路径，或一并移入 `spawn_blocking`）。

**为什么**：同步 `#[tauri::command] pub fn`，或在 async command 里直接阻塞，会占用 Tauri 的 async 运行时线程，导致并发命令被串行化。曾表现为进入「变更」页时 `getProjectWorktreeChanges` / `getProjectWorktreeCommitHistory` / `listAgentSessions` 三条命令同时卡约 7.5s 才一起返回。

**做法**（参考 `src-tauri/src/features/agent_session/commands.rs` 的 `prepare_*` + `spawn_blocking` 模式）：

- async 体内只做轻量准备：解析 `data_dir`、幂等 `local_data` 初始化、克隆 `Arc` 句柄；
- 开库、迁移、git、service 调用全部放进 `spawn_blocking(move || { ... })`；
- `State<'_, AppState>` 不可跨 `await`，所需字段在进入闭包前 `.clone()` 或提取为 owned（如 `PathBuf`）。

**反例**：`src-tauri/src/features/agent_session/workspace_commands.rs` 历史上的 6 个同步 `pub fn`（开库 + 迁移 + git 全跑在运行时线程）。已改异步 + `spawn_blocking`。

**反例**：`get_update_status` 曾为同步 command，且在缓存过期时直接 `ureq` 访问 GitHub（超时 15s）；Workbench（`AppShell`）每次挂载都会静默调用。网络慢/失败时把项目打开与 Issue 首屏拖到十多秒。已改为 `async` + `spawn_blocking`，失败时写入 `last_checked_at` 负缓存，TTL 内不再打远端。

**反例**：git 子进程会注入「login+interactive shell 解析出的 PATH」（让 git hook 找到 pnpm 等），该解析曾同步执行：`.zshrc` 带 nvm 时实测 4–5 秒（上限 15 秒）。首个 git 调用恰在 `open_project` 热路径上（`list_code_workspaces` → `git worktree list`），于是「启动后点击项目 → 工作台出现」被拖到十秒级，之后切换项目因缓存命中只要百毫秒。现改为：git 子进程只读取已解析的 PATH，未解析就继承进程 PATH；解析改由应用 setup 后台预热（`agent/command_detector::warm_interactive_shell_path`）与终端 / agent 等后台路径完成，热路径绝不等待探测。回归：`src-tauri/tests/git_command_hot_path.rs`。

**反例**：内置 agent 播种（ADR-0020）曾先探测命令、后查库，导致每次启动都为已播种的 codex/claude/opencode/grok 白跑 4 次 shell 探测（实测 9 秒后台负载，且与用户首次打开项目争抢 CPU）。现改为先查 `exists_profile_by_agent_type`，已播种直接跳过。回归：`service_seed_preview_tests.rs::seed_builtin_agents_skips_command_detection_for_already_seeded_agents`。

**反例**：`prepare_*_data_dir` 里的「幂等 `local_data` 初始化」曾对每条命令都开新连接并完整跑一遍 `MigrationRunner`，即每条命令都执行 `BEGIN IMMEDIATE` 写事务。多窗口同时轮询时该写锁被反复抢占：实测并发写探测 p99.9 达 0.5–1s、最大 4s，并让并存的读命令以 `SQLITE_BUSY` 失败（表现为文件树展开后子节点一直为空）。现改为 `MigrationRunner::run` 先做只读探测，全部内置迁移已记录时直接返回、不开写事务。回归：`db/migrations.rs::tests::run_skips_write_transaction_when_all_migrations_applied`。

## 2. 批量取数，禁止 N+1 子进程 / 命令调用

**判据**：对一组条目（提交、文件、行）逐条发起 `git` 子进程、SQL 查询或 Tauri command，就是 N+1。

**为什么**：每次 `git` 子进程在 macOS 上 fork/exec + 仓库初始化约 10–30ms。逐条循环会把这个成本放大 N 倍。曾表现为 `read_workspace_commit_history` 对最近 50 条提交逐条各起 `git merge-base --is-ancestor` 与 `git diff-tree`，约 116 次子进程，每次调用约 3.3s，且变更视图每 4–8s 轮询一次。

**做法**：用单次调用取回全部所需数据。

- 提交表头 + 每提交变更文件：单次 `git log --name-status`，提交头用 NUL 分隔、其后跟该提交的 name-status 行；
- 批量祖先判定：单次 `git rev-list <ref>` 取可达集合，成员判定代替逐条 `git merge-base --is-ancestor`。
- 改动文件增删行数：单次 `git diff --numstat -z --no-renames HEAD` 取全部文件，用 NUL 分隔路径避免引号转义；`--no-renames` 保持「重命名按新路径整体计为新增」的既有语义。

**反例**：`src-tauri/src/features/agent_session/workspace.rs::read_workspace_commit_history` 历史上的逐提交 `diff-tree` / `merge-base`。已批量化。

**反例**：`workspace.rs::read_workspace_changes` 曾对每个改动文件各起一次 `git diff --numstat HEAD -- <path>`（macOS 实测每次约 100–160ms）。30 个改动文件时该命令单次调用约 4.7s，而它在「代码 / 变更」页按秒轮询。改为单次批量调用后约 0.098s（约 48 倍）。

## 3. 按需过滤，禁止拉全量再前端过滤

**判据**：后端命令能按参数过滤时，不要在前端拉全量再 `.filter`。

**为什么**：轮询场景下每数秒把全量（含大量已结束 / 无关）数据序列化、跨 IPC、再前端过滤，是纯浪费。

**做法**：给命令加可选过滤参数；调用方按需传。

- `list_agent_sessions(project_id, status?)`：变更页 running 检测传 `status=running` 只取运行中会话，其余 8 处调用方不传、仍取全量。

**反例**：`src/features/changes/use-changes-auto-refresh.ts` 的 `useWorktreeRunningSession` 历史上每 5s 拉全量 session 再前端过滤 running turn。

## 4. 新增命令 / 轮询前的自检

- 命令体内有 `Command::new("git")` / `Connection::open` / `fs::read_dir` 吗？→ `spawn_blocking`。
- 命令体内会开库并跑迁移吗？→ 迁移检查必须走只读快路径（见 §1 反例），禁止每条命令 `BEGIN IMMEDIATE`。
- 有「对每条结果再调一次命令 / git」的循环吗？→ 改单次批量。
- 前端在轮询吗？轮询的数据能否后端过滤、或改为事件驱动（`agent-session-list-changed` 等）？是否已按 §7 做「可见 + 聚焦」门控？
- 会不会在已有的高频本地轮询（如变更页 4s/8s）里再嵌网络型 `git fetch`？→ 禁止；远端跟踪更新应低频独立（见 ADR-0032 的 60s 后台 fetch），失败不得阻塞本地 refresh。
- 启动期任务 / 热路径会不会同步拉起 shell 探测（login+interactive）？→ 改成启动后台预热 + 命中缓存才用，禁止让用户动作等它。

## 5. 新窗口 / 默认 Issues 首屏禁止同步拉起重依赖

**判据**：项目窗口冷启动（`open_project_window` → `index.html?projectId=`）默认进入 Issues，主入口与 Issues 渲染路径不得同步 `import` Monaco、xterm、Agents/Code/Changes/Terminals 等非默认 Activity 的重模块。

**为什么**：生产构建中曾出现主 chunk ≈5.8MB（含 `monaco-editor`），新窗口需在首屏可交互前解析整包，表现为「正在打开项目…」或白屏卡住十多秒；后端 `open_project` 本身通常在百毫秒级。

**做法**：

- `src/main.tsx` 不调用 / 不静态 import Monaco 配置；首次真正渲染 Editor/DiffEditor 前再 `import("./monaco-editor-setup")`。
- `ActivityRouter` 对非 `issues` Activity 使用 `React.lazy` + `Suspense`；Issues 保持同步 import。
- URL 带 `projectId` 时，`openProject` 与 `listProjects` 并行，避免列表 IPC 串行拖长打开空态。
- `IssuesActivity` 对详情编辑 / 只读页使用 `React.lazy` + `Suspense`；看板首屏保持同步，避免同步解析 Quill 与 `react-markdown`。
- 回归：`src/app/main-entry-budget.test.ts`；本地可用 `pnpm exec vite build` 核对 `dist/assets/index-*.js` 体积与是否含 `monaco` / `quill`。

## 6. SQLite 连接与并发

**判据**：高频 command（秒级轮询、会话状态）不得每条都开新连接并隐式拿写锁；数据库连接必须启用 WAL 与 `busy_timeout`。

**为什么**：应用是单进程多窗口，多窗口各自轮询会让同一个库同时存在大量连接。SQLite 默认 rollback journal 下写事务与读者互斥：一个连接写时，其他连接的读会直接 `SQLITE_BUSY`（默认 `busy_timeout` 为 0），表现为文件树 / 变更页偶发读失败；写-写竞争实测还会出现秒级停顿。

**做法**：

- `DatabaseConfig::open` 统一设置 `PRAGMA journal_mode = WAL`、`busy_timeout = 5000`、`synchronous = NORMAL`，读写不再互相阻塞。
- 迁移检查先只读探测（`sqlite_master` + `schema_migrations`），全部迁移已记录时直接返回，不带写事务（见 §1 反例）。
- 新增高频 command 前先问：它是否每次都要开库？能否复用只读连接 / 把过滤下推到 SQL（配合 §3）。

## 7. 后台窗口不轮询（聚焦门控）

**判据**：新增定时轮询（文件树 / 变更徽标 / 工作区 roots / 终端快照 / 侧栏数据）时，必须把「窗口可见且聚焦」作为门控条件之一。

**为什么**：应用是单进程多窗口。`document.visibilityState` 对未最小化的后台窗口仍是 `visible`，只看可见性会让每个窗口都全速轮询：git 子进程、SQLite 连接与 IPC 会按窗口数线性叠加，正是「窗口开多了整体卡顿」的主因。

**做法**：

- `src/shared/window/use-window-focus.ts` 取 Tauri 窗口焦点（`getCurrentWindow().isFocused()` + `onFocusChanged()`）；非 Tauri 环境 / API 不可用时返回 `true`，即退回按可见性轮询，不会因为拿不到焦点信息而误停轮询。
- 组合成 `isActive = isVisible && isWindowFocused` 后再决定是否起定时器；重新聚焦时立即补拉一次（`useConditionalPolling` 的 `refreshOnActivate`，或各 hook 自己的 recovery effect）。
- 例外：**通知类**轮询不能因失焦而停——后台窗口正是系统通知的触发场景。`useAgentSessionNotifications` 的会话状态检查改为「事件驱动为主（`agent-session-list-changed`，去抖 300ms）+ 5s 低频兜底 + 在途去重」。
- 不要用 `document.hasFocus()`：它反映 webview 内容是否持有 DOM 焦点，点窗口标题栏 / 原生菜单就会变 `false`，会把「正在看的窗口」误判成后台而停掉轮询。
