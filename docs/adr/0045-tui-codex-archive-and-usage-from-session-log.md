# 0045. TUI Codex 归档与用量取自 provider session log

## 状态

采纳（已执行）。

## 背景

ADR-0023 / ADR-0025 规定 `display_mode=tui` 的 Issue 完成归档在同一份纯文本路径上，对 PTY 原始终端字节流做写侧启发式提取，只保留真实用户输入与每轮结论。该启发式在实档中经常退化：Codex 交互式 CLI 的全屏重绘、spinner 与状态条粘连会把多轮正文压成「只剩最后一次输出」，与 `json` 会话的结构化归档信息量差距明显。

与此同时，Codex 交互式 TUI 会把整段会话完整写入本机 session log（`CODEX_HOME` 下 `sessions/**/rollout-*.jsonl` 及兼容根 `profiles/*/sessions/**`）。其中 `item_completed` 事件带结构化的 `UserMessage` / `AgentMessage` 条目，可按 turn 还原真实用户输入与该轮最终结论；`task_complete` 带每 turn `duration_ms`，`token_count` 带线程累计用量。RedWhisk 启动会话时已捕获并持久化该会话的 `provider_session_id`，据此可唯一定位本会话的 rollout 文件。

## 决定

1. **分派条件**：仅在 `display_mode=tui` 且会话 `agent_type=codex` 时尝试读取 session log；其余情况（含所有 `json`）严格保持既有行为。
2. **事实源**：复用 `src-tauri/src/features/agent_session/codex_session_log.rs` 读取并规范化 session log（定位规则与既有会话标识捕获共用同一套 `sessions/` 与 `profiles/*/sessions/` 根集合），不重写解析逻辑，不引入第二个数据源。
3. **归档形态不变**：仍写在既有 `session-logs/archive/**` 纯文本路径、仍为 `.log`；`latest_output` 仍取归档文本最后一条非空行。
4. **逐 turn 排版**：解析成功时逐 turn 输出「用户输入块 + 结论块」，块间与 turn 间各空一行，块内连续空行压到一行，去交付用 `<issue-comment>` 标签，保留 Markdown 源文；不展开 reasoning 思考与工具执行过程。
5. **降级**：定位或解析失败（文件缺失、被清空、格式不认识、IO / 编码错误、`provider_session_id` 缺失、profile 缺失）时静默回退到既有 `terminal_archive_clean` PTY 提取路径，行为与今天一致，不影响完成事务。
6. **supersede ADR-0025 的降级结论**：对 Codex TUI，ADR-0025 第 5 / 6 条「无用户 turn 时只留全会话最后结论」不再是主路径——session log 可用时以逐 turn 提取为准。ADR-0025 的其余决定（纯文本形态、按 `display_mode` 分流、多标记族启发式、不迁历史）继续作为回退路径有效。
7. **不迁移存量归档**：沿用 ADR-0023 §4，历史归档不读侧兼容、不回填。
8. **用量同源（后续票）**：TUI Codex 的「Session Token 消耗」与「执行时长」同样以该 session log 为事实源（线程累计用量按「有则覆盖」写入、各 turn `duration_ms` 求和写入 `processing_ms`），由后续票与心跳同步落地；本 ADR 只落地 Issue 归档接线。其落地后将取代 ADR-0039 §4（tui 用量留空）与 ADR-0043 §1（tui 回退墙钟差）中对 TUI 的结论。

## 后果

- 新完成的 Codex TUI 归档能逐条回放每一次用户输入与该轮结论，不再退化成只剩最后一次输出；观感与 `json` 归档接近。
- Codex 本地 session log 是非官方稳定接口（官方明确 transcript 格式可能变化）。缓解：解析器幂等、失败静默、可整体降级回 PTY 提取，`json` 与其它 provider 不受影响。
- 其它 Agent（Claude / OpenCode / Grok）TUI 归档继续走既有 PTY 提取；本次不为其新增 session log 解析。
- 完成后用户仍可能在同一 Issue 详情看到原始 prompt 与归档正文并存，属预期。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 继续只靠 PTY 启发式提取 | 正是要修的退化：全屏重绘下多轮正文被压成最后一段 |
| 采用 Codex hooks 取数 | 官方 hook 载荷不含逐 turn 结构化正文，且要求向用户配置写入 hook，侵入性更高 |
| 解析 `~/.codex/thread_history_1.sqlite` | 为归档再耦合第二个内部存储，收益不足 |
| 读侧兼容 / 迁移存量坏归档 | 用户明确只需修新归档，历史形态按 ADR-0023 不迁移 |

## 代码事实来源

- 本决策：`docs/adr/0045-tui-codex-archive-and-usage-from-session-log.md`
- 被取代：`docs/adr/0025-tui-issue-archive-conclusion-only.md` 第 5 / 6 条（降级结论，仅限 Codex TUI）
- 相关：`docs/adr/0022-display-mode-runtime-transport.md`、`docs/adr/0023-tui-issue-archive-plain-text.md`
- 纯函数事实源：`src-tauri/src/features/agent_session/codex_session_log.rs`、`src-tauri/src/features/agent_session/codex_session_id_capture.rs`
- 归档接线：`src-tauri/src/features/agent_session/log_path.rs`、`src-tauri/src/features/agent_session/codex_tui_archive.rs`、`src-tauri/src/features/issue/service.rs`
- 术语：`CONTEXT.md`（Issue Session 归档、Provider 会话标识）
