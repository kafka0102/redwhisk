# 0032. 应用重启后 TUI Session 续接与中立 Provider 会话标识

**状态**：采纳（待执行）

## 背景

Session 展示形式快照为 `tui` 时，运行时依赖进程内 `PtySessionManager`。应用重启后 PTY 不在，`read`/`restore` 返回 `is_active=false`，Agents 主区仅展示 saved log 与统一 inactive 文案，无法继续交互。既有 `resume_structured_agent_session` 只服务 json 结构化路径；续接 id 列名 `codex_session_id` / 对外 `codexSessionId` 绑定厂商，阻碍多 provider TUI 续接语义。

## 决定

1. **统一 resume command**：对外 Tauri command 与服务入口改名为中立的 `resume_agent_session`（删除 `resume_structured_agent_session` 对外名）。按 **Session 展示形式快照** 分流：
   - `json` → 既有结构化 provider resume
   - `tui` → 以 session 的 `command_snapshot` + **Provider 会话标识** 经 descriptor 构造 TUI resume 命令，经 `PtySessionManager` 拉起交互式 PTY；输出追加同一 `log_path`；**不**注入额外 prompt
2. **统一门禁**：关联 Issue 必须为 `running` 或 `review`。无 Issue、`backlog`、`completed` 一律拒绝。Session 已 `closed` 不自动续接。
3. **自动触发面**：仅 **Agents 工作台** 打开 TUI 会话主区：PTY 不在且能力允许时自动尝试一次；不依赖是否已 reconcile 为 `stopped`。Issue 只读 session 面板不自动续接。
4. **能力声明**：`ui_capabilities` 增加 `supportsTuiResume`；Codex / Claude / OpenCode / Grok 本决策均 true，并由 descriptor 实现 TUI resume 命令构造。`supportsTuiResume=false` 时前端不发起、不显示重试。
5. **失败与重试**：缺 Provider 会话标识、workspace 缺失、spawn 失败等 → 保持原 `stopped`/`crashed`（或未改状态），主区展示详细错误；可按后端稳定 `reason` 白名单显示手动重试。其它 inactive 场景沿用统一 saved-output 文案。
6. **并发**：同 session 串行 + 幂等；已 active 或 `mark_starting` 中则 short-circuit。
7. **中立字段**：DB 列 `codex_session_id` migration 迁值为 `provider_session_id`；DTO/TS/事件对外 `providerSessionId`，删除 `codexSessionId` 对外名。存量值原样迁移。
8. **启动捕获**：各 TUI provider 启动后尽力捕获并写回 Provider 会话标识；捕获失败不阻断启动，但可观测。
9. **snapshot**：resume 不改写 `command_snapshot`；下次仍基于原 snapshot + 当前 id 现算。

## 后果

- ADR-0022「应用重启 → stopped、无活跃 PTY」仍成立；在此之上增加 **Agents 打开时的主动续接** 路径。
- ADR-0011 中 resume 命名与「仅 structured」表述由本决策 supersede 于命名与分流范围；structured 构造仍走 factory。
- 契约与 i18n 需同步；前端 json composer 路径与 TUI 主区共用 `resume_agent_session`。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 仅只读 saved log | 用户无法在重启后续上原 TUI 对话 |
| 独立 `resume_tui_*` command | 双 API、门禁与幂等易分叉 |
| 缺 id 时冷启动新 TUI | 静默丢上下文，违背「续接」 |
| 保留 `codexSessionId` 对外别名 | 与中立命名目标冲突；本仓库可同步改契约 |

## 代码事实来源

- 本决策：`docs/adr/0032-tui-session-resume-after-restart.md`
- 前置：`docs/adr/0022-display-mode-runtime-transport.md`、`docs/adr/0011-agent-session-provider-factory.md`、`docs/adr/0015-agent-provider-descriptor.md`
- 术语：`CONTEXT.md`（Provider 会话标识 / Agent Session 续接 / Agent TUI 会话视图）
