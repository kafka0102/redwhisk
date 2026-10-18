# Agent 会话诊断入口

排查「某个 Agent Session 为什么这样跑」——异常权限卡、模型或权限与预期不符、会话被重建后续不上——时，按本文定位信号，不要从 `features/agent_session/service.rs` 全文读起。

## 四个事实来源

| 来源 | 路径 | 有什么信号 | 没有什么 |
| --- | --- | --- | --- |
| runtime log | `~/.redwhisk/session-logs/runtime/project-<项目>/…-session-<编号>.jsonl`（归档在 `~/.redwhisk/session-logs/archive/`） | 映射后的会话事件流：`turn_started/completed/failed/canceled`、`thread_started`、`permission_requested`、timeline 的 user/assistant/reasoning/tool_call | provider 的原始协议细节与进程 argv；被映射丢弃的事件 |
| 业务库 | `~/.redwhisk/redwhisk.sqlite3`：`agent_sessions`、`agent_profiles`、`session_events`、`issue_actions` | 会话状态与启动参数（`agent_profiles.mode/dangerous`、`agent_sessions.startup_model/display_mode/provider_session_id`）、每次 `session_started` 的 payload | provider 侧的实际行为 |
| provider 本机会话存储 | Grok：`~/.grok/sessions/<urlencoded-cwd>/<sessionId>/`（`events.jsonl` / `summary.json` / `updates.jsonl`） | provider 自己的事实：审批判定（见下文「关键判据」）、模型切换、会话加载方式 | RedWhisk 的映射口径 |
| provider 进程日志 | Grok：`~/.grok/logs/unified.jsonl`（用 `sid` = `provider_session_id` 过滤） | 进程级事件：`session created` / `session loaded`、`model changed`、推理耗时 | 进程 argv |

runtime log 是映射产物：它只保留映射器认识的事件。同一个会话的 provider 原始事件在 provider 本机存储里，两者对不上时以原始记录为准。

## 关键判据

- runtime log 里 `permission_requested` 之后**整轮再无任何事件** → provider 在等客户端写回（Grok 的 `session/request_permission` 是阻塞式反向请求，见 `src-tauri/src/agent/grok_streaming/permission.rs`）。
- provider 原始 `events.jsonl` 里 `permission_requested` **没有**配对的 `permission_resolved` → 该命令被升级到客户端审批；有 `permission_resolved`（`decision=allow`、`wait_ms=0`）则是 provider 内部自动放行。
- 会话被重建过（应用重启后续接、切换展示形式）时，先看 `session_events` 最后几条 `session_started` / `session_exited`：payload 里的 `resumed` / `displayModeSwitched` 标出了走的是哪条路径。
- 权限与模型的生效点：`dangerous` 或 `mode=full-access` → provider 启动时注入 `--always-approve`（`src-tauri/src/agent/grok_streaming/argv.rs` 的 `should_always_approve`）；结构化（json）会话的 argv **每次 spawn 现算**，TUI 会话则把 `--always-approve` / `-m` 冻结在 `agent_sessions.command_snapshot` 里按快照重放。

## 三条重建路径

结构化（json）会话有三个拉起进程的入口，都必须恢复同一批启动参数（profile 的 `mode` / `dangerous` 与 `startup_model`），并在 `session_started` 事件里留下同一口径的审计字段（`agentType` / `modeId` / `dangerous` / `model`）：

| 路径 | 入口 | `session_started` 标记 |
| --- | --- | --- |
| 首启 | `src-tauri/src/features/agent_session/service.rs` 的 `start_structured_issue_agent_session` | `structuredStream: true` |
| 续接 | `src-tauri/src/features/agent_session/service.rs` 的 `resume_structured_agent_session` | `resumed: true` |
| 切形态重拉 | `src-tauri/src/features/agent_session/display_mode_switch_relaunch.rs` 的 `relaunch_structured` | `displayModeSwitched: true` |

比对三者的 `modeId` / `dangerous` / `model` 与 profile、`agent_sessions.startup_model`，即可判断重建路径有没有漏传启动参数。TUI 路径的对应信息在 `command_snapshot` 里，不重复记 payload。

## 常用取数

```bash
# 某 Session 的审计事件（启动参数、重建路径、退出原因）
sqlite3 -readonly ~/.redwhisk/redwhisk.sqlite3 \
  "SELECT id, event_type, payload_json FROM session_events WHERE session_id = <id> ORDER BY id;"

# 该 Session 在 Grok 侧有没有被自动放行 / 升级到客户端审批
jq -c 'select(.type|startswith("permission"))' \
  ~/.grok/sessions/*/<provider_session_id>/events.jsonl

# 该 Session 的 runtime log 事件类型分布
jq -r '.event.type' ~/.redwhisk/session-logs/runtime/project-<N>/*session-<编号>.jsonl | sort | uniq -c
```
