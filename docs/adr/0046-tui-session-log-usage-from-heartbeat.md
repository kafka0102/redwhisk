# 0046. TUI Codex 用量与执行时长由心跳同步 session log

**状态**：采纳（已执行）。

## 背景

ADR-0039 §4 规定 TUI 无结构化用量时「Session Token 消耗」留空、界面横线；ADR-0043 §1 规定 TUI 无 Turn 事件，「执行时长」回退开始到结束/当前的墙钟差（含机器睡眠与用户等待）。ADR-0045 已确定 Codex TUI 以本机 provider session log 为事实源，并声明「用量与执行时长同样以该 session log 为事实源，由后续票与心跳同步落地」。

本 ADR 落地该同步：对运行中的 Codex TUI 会话，由既有后台活跃时长心跳按同一 tick 增量读取 session log，把线程累计 Token 用量与各 turn 处理耗时之和写回 Session 记录。

## 决定

1. **分派条件**：仅对 `display_mode=tui`、`agent_type=codex`、已捕获 `provider_session_id` 的运行中会话同步；其余（含所有 `json`、其它 Agent 的 TUI）严格保持既有行为。
2. **事实源与解析复用**：复用 `codex_session_log` 的定位规则（`sessions/**` 与 `profiles/*/sessions/**`）与规范化口径，不重写解析、不引入第二个数据源、不新增 DB 列 / Tauri command / event / 错误码。
3. **写入口径**：`token_input` / `token_output` / `token_cache` 取自线程累计 `total_token_usage`，按「有则覆盖」写入（不累加）；`processing_ms` 取各 turn `duration_ms` 之和，覆盖写、单调不减。三项均复用 ADR-0039 的统一口径。
4. **增量与幂等**：心跳在内存按会话维护字节偏移，只解析新增的完整行（末尾不完整行留待下个 tick）；进程重启后从零重读一次即可，累计值可幂等重建，避免整文件重读。
5. **按 `display_mode` 互斥**：`processing_ms` 的写入责任两分——既有活跃时长心跳只累加 `json`（且 `is_turn_running=1`），session log 同步只覆盖 `tui`（SQL 层 `display_mode='tui'` 守卫）；TUI 无结构化 Turn 事件，两条路径不互相覆盖。
6. **失败静默降级**：定位失败 / 文件缺失 / 解析失败 / IO 或编码错误一律静默跳过，不中断后台心跳线程、不产生用户可见报错。
7. **前端放宽门禁**：`formatProcessingDuration` 的 `displayMode === "json"` 门禁放宽为「`processingMs > 0` 即取累计值」，否则回退墙钟差；Token 展示逻辑不改（已在三值非空时展示）。
8. **supersede TUI 结论**：本 ADR 取代 ADR-0039 §4（tui 用量留空）与 ADR-0043 §1（tui 回退墙钟差）中**针对 TUI 的结论**。ADR-0039 的统一口径、ADR-0043 对 `json` 的活跃时长结论，以及其它 Agent 的 TUI 行为继续有效。

## 后果

- Codex TUI 会话在运行期即可看到与 `json` 同口径的 Token 消耗与执行时长，并随 session log 增长；应用重启后保持同一数值。
- 依赖 Codex 本机 session log 这一非官方稳定接口（官方明确 transcript 格式可能变化）。缓解：解析器幂等、可整体降级、失败静默，且 `json` 与其它 Agent 不受影响。
- 其它 Agent（Claude / OpenCode / Grok）的 TUI 会话仍留空用量、回退墙钟差，属本期已知边界。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 每 tick 整文件重读 session log | 长会话文件持续增长，整读是 O(文件大小) 的重复开销（见 `docs/standards/performance.md`） |
| 代码侧把 `total_token_usage` 再累加一遍 | `total` 已是线程累计快照，再加会重复计数；按「有则覆盖」写入才正确 |
| 为 TUI 伪造 Turn 事件或做 ANSI 用量启发 | ADR-0022 已判定该路径易碎，传输能力边界改为进程级 |
| 为 TUI 新增专用 DB 列 / 命令 | 复用既有 `processing_ms` 与 token 三列即可，无需扩表或扩契约 |

## 代码事实来源

- 本决策：`docs/adr/0046-tui-session-log-usage-from-heartbeat.md`
- 被取代：`docs/adr/0039-session-token-usage-snapshot.md` §4、`docs/adr/0043-session-duration-active-time.md` §1（仅限 TUI）
- 相关：`docs/adr/0022-display-mode-runtime-transport.md`、`docs/adr/0045-tui-codex-archive-and-usage-from-session-log.md`
- 纯函数事实源：`src-tauri/src/features/agent_session/codex_session_log.rs`
- 心跳接线与写库：`src-tauri/src/features/agent_session/active_time_heartbeat.rs`、`src-tauri/src/features/agent_session/tui_session_metrics_sync.rs`、`src-tauri/src/db/agent_session_repository.rs`
- 前端展示：`src/features/agents/agent-session-formatters.ts`
- 术语：`CONTEXT.md`（执行时长 / Session Token 消耗）
