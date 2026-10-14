# TUI Session 用 Agent Hook 补 running 状态

日期：2026-10-14。问题：Codex、Grok Build 的 TUI 会话在 Agents 左侧任务栏上不显示 running（绿色点 + 转圈），而是蓝色点。判断 agent hook 能否补上这条状态，以及值不值得做。

## 结论

**可以部分解决，且值得做，但只覆盖 Codex TUI 与 Grok Build TUI 的 turn 级 running。**

- 左侧 card 的绿色 running 不看「进程还活着」，只看 SQLite `agent_sessions.is_turn_running`。该列默认 0，只由 json 路径的 `AgentStreamEvent::TurnStarted` / `TurnCompleted` 等写入。TUI 不发这些事件，所以 `status=running` 且关联 Issue 仍是 `running` 时，圆点落在 `in-progress`（`#4d84ff`，蓝色）。
- Codex CLI 0.162.1 与 Grok 1.0.41 都有官方 lifecycle hook。用 `UserPromptSubmit` 置 running、用 Stop 族事件清 running，就能驱动现有 `getSessionStatusTone`，不必新造状态字面量，也不必解析 PTY。
- 这不是 json 模式的替代。hook 给不出消息流、权限卡、token、逐工具时间线。`docs/architecture-design/agent-provider-protocol.md` 已写明：有 Hook 时优先走显式事件，TTY 启发式只作兜底，且不得驱动完成 / 评论。
- 不覆盖：OpenCode / Claude / DeepSeek Harness 的 TUI（本次未验证其 hook 契约）；进程刚起来、首条 prompt 尚未提交的窗口；hook 未安装、未信任、被禁用或漏事件时的恢复。这些缺口留蓝色点，不回退成「进程活着就算 running」。

先前调研没有否决这条路：`docs/survey/grok-build-structured-mode-feasibility.md` 否决的是「用 headless json 冒充 TUI 交互」，并记录 ACP 才有完整 turn 耗时；`docs/survey/opencode-json-mode-feasibility.md` 只讨论 OpenCode `run --format json`。本结论不推翻它们。

## 蓝色点从哪来

### 渲染条件

`getSessionStatusTone`（`src/features/agents/agent-session-formatters.ts`）：

| 条件 | tone | 色值 |
| --- | --- | --- |
| `status !== "running"` | `done` | 灰 |
| `attention === "requested"` | `attention` | `#d97706` |
| `status === "running"` 且 `isTurnRunning === true` | `running` | `#22863a` |
| `issueStatus === "review"`（且 turn 未在跑） | `review` | `#4d84ff` |
| `issueStatus === "running"` 且 `isTurnRunning === false` | `in-progress` | `#4d84ff` |
| 其余仍 `running` 的 session | `running` | `#22863a` |

色值：`src/shared/styles/tokens.css` 的 `--color-lane-review-marker: #22863a`、`--color-lane-completed-marker: #4d84ff`；class 在 `src/shared/styles/agents-sidebar.css`。`SessionRow` 用 `getSessionStatusTone` 画圆点，用 `shouldShowRunningSpinner` 画 `LoaderCircle`（`src/features/agents/session-list/agents-session-list.tsx`）。

因此「蓝色点」是 `in-progress` 或 `review`，不是一个独立的未知态。TUI 会话关联的 Issue 在跑、turn 标志为假时，就是蓝点，文案是 `inProgress` 而不是 `running`。

`isAgentTurnActivelyRunning` 要求 `status === "running" && isTurnRunning === true`。`isTurnRunning` 缺省视为假（`agent-session-formatters.ts` 注释写明，避免旧数据误报）。

### JSON 为什么能绿

1. `is_turn_running INTEGER NOT NULL DEFAULT 0`（`src-tauri/migrations/0028_agent_session_turn_state.sql`）。
2. `turn_running_from_stream_event`（`src-tauri/src/agent/agent_event_broadcaster.rs`）：`TurnStarted` → 置 1；`TurnCompleted` / 空错误 → 只写 `turn_ended_at`，grace 后再置 0；`TurnFailed` / `TurnCanceled` → 立即置 0；reasoning / assistant_message / `status=running` 的 tool_call 可把被误清的 turn 拉回 1。
3. 列表出口再套 grace：`service.rs` 的 `list` 映射里 `is_turn_running: is_session_running && row.is_turn_running && turn_still_running_by_grace(...)`。
4. 写库后广播 `agent-session-list-changed`，前端重拉列表。

`docs/domain/state-machine.md`「Turn 与权限」：`is_turn_running` 只由 Rust 写，前端不自行置位。`docs/architecture-design/agent-provider-protocol.md` 生命周期第 2 条：json 的 `is_turn_running` 仅后端维护；**tui 不以结构化 turn 事件驱动，产品状态以进程存活为准**。进程存活只决定 `AgentSessionStatus`（`running` / `closed` / `crashed` / `stopped`），不决定圆点颜色。

### TUI 为什么停在蓝点

- TUI 走 `PtySessionManager`，不走 `AgentSessionHandle` 的 stream event（`agent-provider-protocol.md`「json / tui 分流」）。没有 `TurnStarted`，`is_turn_running` 保持默认 0。
- `AgentSessionRepository::accumulate_active_time_ms` 的注释写明：「TUI 无结构化 Turn 事件」。TUI 的 `processing_ms` 改由 Codex session log 覆盖（ADR-0046），与 turn 标志互斥。
- 进程退出走 `mark_terminated_*`，把 `is_turn_running` 清 0，并把 `status` 收到 `closed` / `crashed` / `stopped`。应用重启后没有活 PTY 的 running TUI → `stopped`。这些都不会在 turn 进行中把标志打成 1。
- `docs/architecture-design/agent-provider-protocol.md`「纯 TTY 解析方案要点」把 PTY 启发式标成「演进，非本期生产路径」，默认关闭，且禁止当完成 / 评论 / 权限的唯一依据。同节「Hook 预留切点」写明本期不实现 Hook。

Session 主状态枚举仍是 `running | closed | crashed | stopped`（`src-tauri/src/types/agent_session.rs` 的 `AgentSessionStatus`）。蓝点不是第五种 session 状态。

## Open Island 怎么用 hook 表示 running

参考仓库：`/Users/yujianjia/workspace/kafka/open-vibe-island`。数据流（`docs/hooks.md`、`CLAUDE.md`）：

```text
agent hook（stdin JSON）
  → OpenIslandHooks CLI
  → Unix socket
  → BridgeServer
  → AppModel.phase
  → UI
```

bridge 不可用时 hook 进程不写 stdout 就退出（fail-open），agent 照常跑。`OPEN_ISLAND_SKIP_HOOKS=1` 让 hook 立刻退出，供别的控制器独占权限。

它不写 RedWhisk 这种 SQLite 事实。`SessionState.phase` 是内存态：`running` / `waitingForApproval` / `waitingForAnswer` / `completed`（`Sources/OpenIslandCore/SessionState.swift`）。

### Codex

安装器 `CodexHookInstaller.eventSpecs` 默认只装四条，写入 `~/.codex/hooks.json`，并打开 feature flag（新键 `[features].hooks`，旧键 `codex_hooks`）：

| 事件 | matcher | timeout |
| --- | --- | --- |
| `SessionStart` | `startup\|resume` | 45s |
| `UserPromptSubmit` | 无 | 45s |
| `PermissionRequest` | 无 | 1h（要等人点） |
| `Stop` | 无 | 45s |

`PreToolUse` / `PostToolUse` 能解析，默认不装（终端日志吵）。装完后 Codex 仍要用户在 CLI `/hooks` 里信任，安装器绕不过这道门（`docs/hooks.md`「Default managed installation」）。

`BridgeServer` 里 Codex 的 `UserPromptSubmit` 把 phase 打成 `.running`，`Stop` 打成完成。`PermissionRequest` 进入等待审批，不把 turn 算结束。

### Grok Build

发现路径是 `~/.grok/hooks/*.json`。安装器只写自己的 `~/.grok/hooks/open-island.json`，不改用户其它文件；卸载只删该文件（`GrokHookInstaller`）。本机该文件与 `orca-status.json` 并存，说明多文件发现是事实，不是安装器一家之言。

托管事件（`requiredEventSpecs`，与 `docs/hooks.md`「Grok Build Hooks」一致）：`SessionStart`、`SessionEnd`、`UserPromptSubmit`、`Stop`、`StopFailure`、`StopCancelled`、`Notification`（matcher `*`）、`PreToolUse` / `PostToolUse` / `PostToolUseFailure`（matcher `*`）、`SubagentStart`、`SubagentStop`、`PermissionDenied`、`PreCompact`、`PostCompact`。全部 timeout 45s，`PreToolUse` 不回 deny（fail-open）。

`handleGrokHook`（`BridgeServer.swift`）的相位规则，RedWhisk 应直接借用：

| 事件 | phase |
| --- | --- |
| `SessionStart` | 建行，初始 `.completed`（还没提交 prompt，不算 running） |
| `UserPromptSubmit` | `.running` |
| `PreToolUse` | `.running` |
| `PostToolUse` / `Subagent*` / `PreCompact` / `PostCompact` / `PermissionDenied` | 保持当前；已 completed 则不变 |
| `Notification` 且 `notificationType == idle_prompt` | 仍 running 则收成 completed；已 completed 不动 |
| `Stop` 且 `reason == end_turn` 或未带 `reason` | completed |
| `Stop` 且 `reason` 不是 `end_turn` | 只观察，不改相位（session 结束时的额外 Stop） |
| `StopFailure` / `PostToolUseFailure` | completed（session 不结束） |
| `StopCancelled` | completed（用户中断 / 拒绝权限 / `--max-turns` / no-progress；它替代 `Stop`） |
| `SessionEnd` | 结束且 `isSessionEnd`；之后同 session 的非 `SessionStart` 事件丢弃 |

关联键是 payload 里的 provider `session_id` / `sessionId`，加上 TTY / CWD。Grok 进程扫描**恢复不出** session UUID；进程还活着只用于「别把行收掉」，不用于判断 turn（`docs/hooks.md` Lifecycle notes）。这和 RedWhisk「进程活着 ≠ 绿点」一致。

配置入口是 App 的 Settings → Setup，或 `swift run OpenIslandSetup installGrok|statusGrok|uninstallGrok`。状态存在用户主目录的 hook 文件和安装 manifest，不在 Open Island 自己的数据库里。

## 官方 hook 是否存在

### Codex CLI 0.162.1（本机 `/Users/yujianjia/.openagents/nodejs/bin/codex`）

- `codex features list`：`hooks` 为 `stable` 且当前 `true`；`plugin_hooks` 为 `removed`。
- `codex --help` 有 `--dangerously-bypass-hook-trust`：「Run enabled hooks without requiring persisted hook trust」。没有单独的 `codex hooks` 子命令；管理入口是 CLI 内的 `/hooks`。
- 本机 `~/.codex/config.toml` 有 `hooks = true`，以及 `[hooks.state.".../hooks.json:session_start:0:0"]` 这类信任记录。`~/.codex/hooks.json` 已是 Open Island 写的 `SessionStart` / `UserPromptSubmit` / `PermissionRequest` / `Stop`。
- 官方文档 <https://developers.openai.com/codex/hooks>（2026-10-14 读取）：hook 是生命周期脚本或 MCP tool；发现 `~/.codex/hooks.json`、`~/.codex/config.toml` 的 `[hooks]`、仓库 `.codex/hooks.json`，以及已启用插件的 `hooks/hooks.json`。多层并存会**全部执行**，不互相替换。非托管 hook 必须在 `/hooks` 里按当前定义的 hash 信任后才跑。

文档列出的事件：

| 时机 | 事件 |
| --- | --- |
| turn 进行中 | `PreToolUse`、`PermissionRequest`、`PostToolUse`、`PreCompact`、`PostCompact`、`UserPromptSubmit`、`SubagentStop`、`Stop` |
| 用户打断当前 turn | `Interrupt`（子代理不跑） |
| 会话或子代理开始 | `SessionStart`、`SubagentStart` |
| 主线程结束 | `SessionEnd`（子代理不跑） |

stdin 公共字段：`session_id`、`transcript_path`、`cwd`、`hook_event_name`、`model`。turn 级事件另有 `turn_id`。`SessionStart` 的 matcher 取值是 `startup`、`resume`、`clear`、`compact`、`fork`。`UserPromptSubmit` 与 `Stop` 的 matcher 会被忽略。默认 timeout 600 秒；`SessionEnd` 与 `Interrupt` 默认 1 秒、上限 3 秒。关闭方式是 `[features] hooks = false`；`codex_hooks` 仍是弃用别名。

同页还说明：匹配的 command hook **并发**启动，一个 hook 不能挡住另一个；`PreToolUse` 回调错误、超时、畸形输出默认不阻断工具。文件编辑可能走 `apply_patch`，matcher 可用 `apply_patch` / `Edit` / `Write`，不能假设所有编辑都叫 `Bash`。

### Grok 1.0.41（本机 `/Users/yujianjia/.local/bin/grok`，`grok 1.0.41 (4220f3b224a6)`）

- `grok --help`、`grok agent --help` **没有** hook 子命令。`grok inspect` 的说明是展示本目录发现的配置（文档写明包含 hooks）。`grok agent --help` 里唯一的 hook 字样是插件 flag：「always trusted: hooks and MCP servers activate without a prompt」。
- 本机 `~/.grok/hooks/` 已有 `open-island.json` 与 `orca-status.json`，事件名与 Open Island 文档一致，包括官方摘要页未单列的 `StopCancelled`。
- 对 `grok` 二进制做字节扫描，能找到 `SessionStart`、`UserPromptSubmit`、`StopCancelled`、`hookEventName`、`GROK_HOOK`、`.grok/hooks`。这只证明 1.0.41 的二进制携带这些字符串，不能代替协议文档。
- 官方文档 <https://docs.x.ai/build/features/hooks>（页面标注 Last updated 2026-07-02；`docs.x.ai/build/settings` 指向该页）：

| 事件 | 何时 |
| --- | --- |
| `SessionStart`、`SessionEnd` | 会话开始或结束 |
| `UserPromptSubmit` | 用户提交 prompt |
| `PreToolUse` | 工具即将运行；**唯一可阻断事件** |
| `PostToolUse`、`PostToolUseFailure` | 工具完成或失败 |
| `PermissionDenied` | 权限系统拒绝 |
| `Stop`、`StopFailure` | turn 结束，或因 API 错误结束 |
| `Notification` | agent 发出通知 |
| `SubagentStart`、`SubagentStop` | 子代理开始或结束 |
| `PreCompact`、`PostCompact` | 压缩上下文 |

配置：`~/.grok/hooks/*.json` 与 `<project>/.grok/hooks/*.json`。同时会读 Claude Code 的 `.claude/settings.json` 和 Cursor 的 `.cursor/hooks.json`。`type` 为 `command` 或 `http`。command 的 timeout 默认 **5 秒**（短于 Open Island 写的 45）。stdin 含 `hookEventName`、`sessionId`、`cwd`、`workspaceRoot`；工具事件另有 `toolName`、`toolInput`。环境变量有 `GROK_HOOK_EVENT`、`GROK_HOOK_NAME`、`GROK_SESSION_ID`、`GROK_WORKSPACE_ROOT`。被动事件忽略 stdout；退出码 0 即成功。`PreToolUse` 只有明确 `{"decision":"deny"}` 或退出码 2 才阻断，超时 / 崩溃 / 畸形输出都是 fail-open。项目级 hook 要 `/hooks-trust` 或 `--trust`，决定写入 `~/.grok/trusted_folders.toml`。

官方事件表**没有** `StopCancelled`。Open Island 与本机 1.0.41 二进制、`open-island.json` 都有它。设计里把它当 1.0.41 已观察行为，并在文档升级时再核对；不能假装 2026-07-02 的文档页写过这个名字。

`docs/survey/grok-build-cli-probe-notes.md` 已记录 ACP `initialize` 的 `x.ai/hooks.blockingEvents = pre_tool_use|stop|subagent_stop`。那是 json/ACP 通道里的 hook 执行回执，不是 TUI 子进程回调。TUI 进程没有 ACP stdout，不能靠订阅 `hook_execution` 通知来点亮 card。

### 未验证

Claude、OpenCode、DeepSeek Harness 的 TUI hook 本次没有对照各自官方文档逐项核对。不把 Claude Code 的 hook 事件表挪到它们的 TUI 上。

## 能否盖住左侧 card 的 running

| 问题 | 答案 |
| --- | --- |
| 绿点 / 转圈 | 能。hook 只负责把已有 `is_turn_running` 写成 1 或 0。前端 `getSessionStatusTone` / `shouldShowRunningSpinner` 不用改语义。 |
| 哪些 provider | Codex TUI、Grok Build TUI。二者官方都有 `UserPromptSubmit` 与 `Stop`。 |
| json 会话 | 不接。json 已有 stream event；再接 hook 会双写。 |
| 权限卡、消息、token | 不能。Codex `PermissionRequest` 可以另作 attention，但那不是本次绿点。Grok 文档没有与 Codex 同形的 `PermissionRequest`；`PermissionDenied` 表示已经拒绝。 |
| 刚启动、尚未提交 | 不能标绿。`SessionStart` 在 Open Island 里也是 idle。首条 prompt 若由 RedWhisk 注入且 CLI 仍发 `UserPromptSubmit`，则提交后变绿。 |
| 漏事件 | 会卡住。Grok 用 `Notification(idle_prompt)` 兜「没有 Stop」；Codex 文档的对应事件是 `Stop` 与 `Interrupt`，没有同名 backstop。需要超时兜底，但不能用「PTY 还活着」冒充 running。 |
| 重启 | hook 是边沿，不是水位。进程已经在跑、hook 之后才装上时，看不到当前 turn。恢复只保证「进程没了就清标志」。 |
| 多 session | 可以，只要 hook 能解析到 RedWhisk `session_id`。provider 的 `session_id` 与 RedWhisk 行 id 不是同一个数。 |
| 配置 UI | 需要。hook 落在用户目录，还有信任门，不能静默改 `~/.codex/hooks.json`。 |

关联是最大缺口：`PtySpawnRequest`（`src-tauri/src/agent/pty_session_manager.rs`）今天只注入 `TERM`、`COLORTERM`、`COLORFGBG`、`PATH`，没有 RedWhisk session 环境变量。TUI 的 `provider_session_id` 对 Codex 是 session log 事后回填（`tui_session_metrics_sync.rs`），启动瞬间 hook 不能靠它找行。

## 缺口（做的时候必须承认）

1. **信任门**。Codex 改 hook 定义后要用户在 `/hooks` 重新信任，否则跳过。Grok 用户级 `~/.grok/hooks/*.json` 由用户自己放；项目级才要 trust。RedWhisk 写到用户级文件，仍可能与已有 Open Island / orca 条目并存，不能覆盖别人的 command。
2. **配置归属**。hook 文件是 CLI 的配置，不是 RedWhisk SQLite。SQLite 只存「用户是否允许 RedWhisk 注册」和最近一次注册结果。卸载必须只删自己的 command 或自己的那一个 json 文件。
3. **漏 Stop**。Grok 有 `idle_prompt` 与 `StopCancelled`；Codex 有 `Interrupt`。两者都可能在异常退出时什么都不发。进程退出路径已经会 `mark_terminated` 清标志；活着但再也不发 hook 时，要用「自最后一次 running 边沿起的空闲超时」收口，超时只许清、不许置。
4. **重启与晚安装**。已在 turn 中的 TUI 不会补发 `UserPromptSubmit`。晚安装后保持蓝点，直到下一次提交。
5. **多 session / 多产品**。本机 Codex、Grok 的 hook 文件已经指向 Open Island。RedWhisk 追加自己的 command，不替换。`OPEN_ISLAND_SKIP_HOOKS` 这类开关是 Open Island 的，RedWhisk 不读它。
6. **阻塞**。状态 hook 必须快进快出，不回 deny。Codex 同事件的多个 command 并发，一个慢 hook 不会挡住 RedWhisk 这条，但会拖住 turn（默认最长 600 秒）。Grok 默认 timeout 只有 5 秒，写文件时应显式给出短 timeout。
7. **活跃时长**。把 TUI `is_turn_running` 打成 1 后，现有 `accumulate_active_time_ms` 的 SQL 没有 `display_mode='json'` 守卫，会给这些 TUI 行累加墙钟。ADR-0046 要求 TUI 的 `processing_ms` 只由 session log 覆盖。实现时必须把心跳 WHERE 收紧到 json，否则 Codex TUI 时长被双计。这是接 hook 的必改项，不是可选优化。
8. **Claude 兼容入口**。Grok 还会执行 `~/.claude/settings.json` 里的 hook。RedWhisk 不往 Claude 配置里写 Grok 状态 hook，避免 Claude 会话误收。

## 来源

| 主张 | 来源 |
| --- | --- |
| 绿点条件、蓝点 class | `src/features/agents/agent-session-formatters.ts` `getSessionStatusTone`；`src/shared/styles/agents-sidebar.css`；`src/shared/styles/tokens.css` |
| `is_turn_running` 只由 stream event 写，默认 0 | `src-tauri/migrations/0028_agent_session_turn_state.sql`；`src-tauri/src/agent/agent_event_broadcaster.rs` `turn_running_from_stream_event`；`src-tauri/src/features/agent_session/service.rs` list 映射 |
| TUI 无结构化 turn；进程态 ≠ turn 态 | `docs/architecture-design/agent-provider-protocol.md` 生命周期第 2–3 条、Hook 预留切点；`src-tauri/src/db/agent_session_repository.rs` `accumulate_active_time_ms` 注释 |
| Session 四态 | `src-tauri/src/types/agent_session.rs` `AgentSessionStatus`；`docs/domain/state-machine.md` |
| PTY 环境今天不含 session id | `src-tauri/src/agent/pty_session_manager.rs` `PtySpawnRequest`、`spawn_pending` |
| 列表刷新事件名 | `src-tauri/src/agent/agent_event_broadcaster.rs` `AGENT_SESSION_LIST_CHANGED_EVENT` |
| Open Island 事件、相位、安装路径 | `open-vibe-island/docs/hooks.md`；`Sources/OpenIslandCore/CodexHookInstaller.swift`；`GrokHookInstaller.swift`；`BridgeServer.swift` `handleGrokHook`；`GrokHooks.swift` `isGenuineTurnStop` |
| Codex hook 官方 | 本机 `codex-cli 0.162.1` 的 `codex features list`、`codex --help`；`~/.codex/hooks.json`；<https://developers.openai.com/codex/hooks> |
| Grok hook 官方 | 本机 `grok 1.0.41` 的 `grok --help`（无 hook 子命令）；`~/.grok/hooks/open-island.json`；<https://docs.x.ai/build/features/hooks> |
| ACP hook 回执不能替代 TUI hook | `docs/survey/grok-build-cli-probe-notes.md` 的 `x.ai/hooks`；`docs/survey/grok-build-acp-protocol-notes.md` |
| 先前结论未被本调研推翻 | `docs/survey/grok-build-structured-mode-feasibility.md`；`docs/survey/opencode-json-mode-feasibility.md` |
