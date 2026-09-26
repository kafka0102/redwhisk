# 0043. 执行时长按 App 活跃时间累计，tui 会话回退墙钟差

## 状态

采纳（已执行）。

## 背景

Agent Session 详情的「执行时长」（`formatProcessingDuration`）自 [d43d0872] 起改用墙钟差：运行中取 `now - startedAt`，结束后取 `closedAt - startedAt`。`closedAt - startedAt` 与 `now - startedAt` 都包含机器睡眠、关机与用户等待的时间，与「实际处理耗时」的展示语义不符。

实测：session 714（project 8，json / codex，仍在运行）开始于 09-25 20:24，界面显示约 12 小时 28 分；其中三段大间隔分别是 6h55m、1h13m、37m，`pmset -g log` 证实这些时段机器确实在睡眠。已结束会话同样失真：session 706 显示 25 小时 59 分，实际累计处理 4.1 分钟。

后端在 migration 0039 已引入 `turn_started_at` / `processing_ms` / `last_output_at`，由 broadcaster 在 TurnStarted 记开始、TurnCompleted 原子累加，前端当时已被改回墙钟而不再消费它。能力边界也已明确（ADR-0022）：`json` 走结构化传输，有 Turn 事件；`tui` 走 PTY，没有 Turn 事件，无法做精细统计。生产数据印证：247 个 json 会话中 246 个有累计值，10 个 tui 会话全部为 0。

## 决定

1. **口径两分法以 Session 展示形式快照为准**：`json` 会话的「执行时长」取活跃处理时长累计；`tui` 会话没有 Turn 事件，回退为开始到结束/当前的墙钟差。判定依据是 `displayMode`（运行时传输），不是 `agentType`——codex/claude 两种模式都能启动。
2. **活跃时长由 App 心跳判定，而不是事件间隔阈值**：后台按固定间隔 tick，tick 迟到超过阈值（墙钟与单调时钟差值、或墙钟迟到上限）即判定进程被系统挂起，该段整段不计入；只有「App 醒着」的时段才可能累加。这样能区分「机器睡了」与「模型长时间没有输出」，后者照常计入。
3. **进行中的 Turn 计入，且随刷新增长**：累加条件是会话处于运行态且 `is_turn_running` 为 1，因此当前 Turn 的时间持续累加，不等 TurnCompleted 才结算。Turn 之间的用户等待（`is_turn_running` 为 0）不累加。
4. **累加责任从 TurnCompleted 移到心跳**：`processing_ms` 的写入口径改为心跳增量累加；`TurnCompleted` 不再以 `turn_started_at` 的墙钟差追加 `processing_ms`，避免与心跳重复计数，其余副作用（`last_output_at`、`turn_ended_at`、完成评论）保持不变。
5. **回退而不是显示空值**：tui 会话、迁移前的 json 存量会话、以及累计值为 0 的会话都回退墙钟差，不出现 `-`。
6. **展示范围只改两处详情面板**：agent 会话右侧栏与 Issue 详情只读面板共用同一 formatter 取值，文案保留「执行时长」，会话卡片、通知与其它位置不动。

## 后果

- json 会话的执行时长不再随睡眠、关机、用户离开而膨胀；session 714 由 12h28m 变为约 2h30m–3h，且随 agent 实际工作持续增长。
- `processing_ms` 的语义由「已完成 Turn 的墙钟耗时之和」改为「会话活跃处理时长累计（含进行中的 Turn）」，`src-tauri/migrations/0039_agent_session_processing_duration.sql` 的 migration 注释与 `docs/domain/data-model.md` 的措辞需同步更新。
- 崩溃/停止的会话会保留崩溃前心跳已累加的时间（此前「crashed/stopped 不累加」的语义不再成立）；这是刻意的口径变化：跑过的时间就该计入。
- tui 会话仍会显示含睡眠的墙钟差，这是 ADR-0022 传输能力边界带来的已知限制。
- App 需新增一个轻量后台心跳，并对「运行中且 Turn 在跑」的会话做批量累加写入；开销为每个心跳至多一条 `UPDATE`。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 沿用墙钟差（含睡眠/关机） | 正是要修的问题：机器睡一夜，展示时长就多出一夜 |
| 只消费已有的 `processing_ms`，运行中不含进行中的 Turn | 数字会长时间停在已完成 Turn 的累计值上，agent 明明在跑却不增长 |
| 事件间隔上限（超过 N 秒的间隔不计入） | 阈值是魔法数，无法区分长推理静默与短睡眠；用 session 714 试算，阈值 30s 与 5min 的差异达 26 分钟 |
| 用 `now - turn_started_at` 充当运行中增量 | 正是把睡眠算进去的算法，与本次诉求相反 |
| 为 tui 会话伪造 Turn 事件或做 ANSI 启发 | ADR-0022 已判定该路径易碎，边界改为进程生命周期 |
| 回填历史会话的累计值 | 历史数据无可靠活跃信号（心跳从未记录），只能近似伪造，不回填 |

## 代码事实来源

- 现状展示：`src/features/agents/agent-session-formatters.ts`（`formatProcessingDuration` / `getSessionElapsedMs`）
- 展示入口：`src/features/agents/session-side-panel/session-issue-panel.tsx`、`src/features/issues/issue-detail/issue-readonly-session-panel.tsx`
- Turn 与累计写入口径：`src-tauri/src/agent/agent_event_broadcaster.rs`、`src-tauri/src/db/agent_session_repository.rs`、`src-tauri/migrations/0039_agent_session_processing_duration.sql`
- 传输能力边界：[0022](./0022-display-mode-runtime-transport.md)（json = structured，tui = PTY）
- 领域语言：`CONTEXT.md`（执行时长 / 活跃时长 / Turn / Agent 展示形式）
