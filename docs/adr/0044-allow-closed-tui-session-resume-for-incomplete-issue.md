# 0044. 未完成 Issue 的 closed TUI Session 可续接

## 状态

采纳（已执行）。

## 背景

ADR-0033 第 2 条统一门禁规定「关联 Issue 必须为 `running` / `review`，且 Session 已 `closed` 不自动续接」。但应用退出或 TUI 会话正常退出后，session 常落成 `closed`：此时关联 Issue 仍为 `running` / `review`，用户需要继续同一对话，却被 `closed` 短路挡在只读回看态，无法自动或手动续接。

「关联 Issue 未完成」已经是「仍需继续」的充分判据；再叠加 session 终态 `closed` 会误伤正常退出的未完成会话。

## 决定

1. **放宽门禁**：`resume_agent_session` 去掉「`session.status == Closed` 一律拒绝」的短路。`closed` 的 TUI session 在关联 Issue 为 `running` / `review` 时允许续接并恢复 live PTY。
2. **保留门禁**：关联 Issue 门禁（仅 `running` / `review`）、`providerSessionId` 必需、幂等 short-circuit、并发串行均保持不变。`backlog` / `completed` / 无 Issue / 缺 id / provider 不支持 TUI resume / PTY 已活跃时行为与原因不回归。
3. **前端同步**：`shouldAutoResumeTuiSession` 去掉 `sessionStatus === "closed"` 短路，触发条件与后端一致。
4. 本决策 **supersede ADR-0033 第 2 条**中「Session 已 `closed` 不自动续接」的表述；ADR-0033 其余决定（统一 resume command、按展示形式快照分流、自动触发面、能力声明、失败与重试、并发、中立字段等）继续有效。

## 后果

- 用户手动结束的 TUI 会话，只要关联 Issue 未完成，再次打开 Agents 主区会被重新拉起；以 Issue 未完成作为「仍需继续」的判据，符合需求意图。
- `closedSessionCannotResume` reason 与对应 i18n 文案不再由门禁触发，保留不报错，不做顺手清理。
- 不改 schema、不改 resume command 契约与分流逻辑。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 保持 `closed` 一律拒绝，仅按 Issue 未完成提示手动重试 | 与「未完成即续接」的用户预期不符，仍停在只读回看 |
| 新增「关闭原因」事实区分正常/异常关闭 | 引入额外状态维度，与「以 Issue 未完成判据统一」的目标冲突 |

## 代码事实来源

- 本决策：`docs/adr/0044-allow-closed-tui-session-resume-for-incomplete-issue.md`
- 被取代：`docs/adr/0033-tui-session-resume-after-restart.md` 第 2 条
- 相关：`docs/adr/0022-display-mode-runtime-transport.md`、`docs/adr/0024-agent-session-must-link-issue.md`
- 代码：`src-tauri/src/features/agent_session/service.rs`（`resume_agent_session`）、`src-tauri/src/features/agent_session/tui_start_tests/resume.rs`、`src/features/agents/session-pane/agent-tui-session-resume.ts`
- 术语：`CONTEXT.md`（Agent Session 续接）
