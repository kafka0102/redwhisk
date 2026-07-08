# issue-32 会话运行态误判 —— 调查与设计交接

> 本文是临时交接文档（非正式 spec）。供新 session 接续 brainstorming → 写 spec → writing-plans。
> 所有结论已用代码 + 真实 session log 双重确证。分支：`issue-32`，worktree：`issue-32-1`。

---

## 一、问题现象（用户实测）

使用 superpowers skill（调用 sub agent）开发时，codex agent 多 sub agent 并行，出现：

- 主 agent 等待无输出、sub agent 有输出时 → session card 显示「运行中」，session view 底部 composer 提交按钮处于运行态。✅ 正确。
- **某个 sub agent 运行结束 → session card 与底部按钮都显示「已完成」**（实际任务未结束）。
- 几秒后主 agent / 其他 agent 再输出 → 状态又变回「运行中」。

即「完成态反复横跳」。用户已确认：现象用的是 **superpowers 的 Task / Agent**（非 codex 原生 task 工具）。

---

## 二、根因（确证）

**核心：运行态是「session 级单一全局布尔」，由 codex 的 turn 事件无差别驱动；前端无法区分「主任务真完成」与「turn 间过渡 / 瞬态失败」。**

完整根因链（4 个铁证点）：

| 位置 | 事实 |
|---|---|
| `src-tauri/src/agent/agent_event_broadcaster.rs:293-301` | `turn_running_from_stream_event` 按事件类型**无差别**映射：任何 `turn_completed/failed/canceled` → `is_turn_running=false`。无 turn 归属判断。 |
| `src/features/agents/message-stream/message-stream-reducer.ts:120-142` | 前端 reducer 同样无差别：`turn_completed→idle`、`turn_failed→failed`、`turn_canceled→canceled`。 |
| `src/features/agents/agent-session-view.tsx:60-65` | `effectiveTurnStatus = turnStatus==="running" \|\| (canUseExternalTurnRunning && isTurnRunning)`，OR 合并。**两条腿同时被 turn 终结事件拉低** → session card + composer 一起闪现「完成」。 |
| `src-tauri/src/types/agent_session_stream.rs:21-28` vs `src-tauri/src/agent/codex_app_server/notification.rs:21-28` | codex 原始 `turn/completed` 通知**本带 `thread_id`**，但归一化成 `AgentStreamEvent::TurnStarted/Completed` 时**只留 `turn_id`，丢弃 `thread_id`**。 |

**session card 显示逻辑（最后一块拼图，`src/features/agents/agents-session-list.tsx:238-273`）：**
- `getSessionStatusTone`：`issueStatus==="running" && isTurnRunning===false` → tone=`"in-progress"`（:255-259）。
- `shouldShowRunningSpinner`：`isTurnRunning` 为 false 时返回 false（:262-273），spinner 停。
- 用户把「spinner 停 + in-progress」感知为「完成」。

**composer（`src/features/agents/composer/use-agent-composer.ts:125`）：**
- `isSending = turnStatus === "running"`。turnStatus 离开 running → isSending=false → 按钮从「取消」回「发送」，用户感知「可提交=完成」。

### sub agent 的实际角色（重要修正）

- superpowers 的 sub agent（`Skill`/`Agent`/`TaskOutput` 工具）**不产生独立 turn 事件**，作为主 turn 内的 `tool_call`，`detail` 被兜底为 `ToolCallDetail::Unknown`。
- 真正让状态离开 running 的是 **`turn_failed`（log 中 2 次，`error` 均为空串）+ `turn_canceled`**。
- 空串 error 的 `turn_failed` 多为 codex 长时运行 / sub agent 交互后的瞬态，而非真失败 —— 这是 `isTurnRunning` 被误拉低的高频元凶。
- log 中 `turn_failed` 前固定模式：`assistant_message → usage_updated×2 → turn_failed(error:"")`。

---

## 三、关键代码位置索引（新 session 直接定位用）

### 类型定义
- `src-tauri/src/types/agent_session_stream.rs:19-67` —— `AgentStreamEvent`（`TurnStarted{turn_id}` / `TurnCompleted{turn_id, usage}` / `TurnFailed{turn_id, error, code?}` / `TurnCanceled{turn_id, reason}`）。**turn 事件无 thread_id。**
- `src-tauri/src/types/agent_session_stream.rs:153-156` —— `ToolCallDetail::SubAgent{child_session_id}`（类型层占位，**两个后端 provider 从未填充**，grep 零命中）。
- `src/features/agents/agent-stream-types.ts:15-42` —— 前端 `AgentStreamEvent` 镜像。
- `src/features/agents/message-stream/message-stream-types.ts:14` —— `TurnStatus = "idle"|"running"|"failed"|"canceled"`。
- `src/features/agents/agent-session-commands.ts:10-40` —— `AgentType="codex"|"claude"|"claude_code"`、`AgentSessionStatus`、`AgentSessionListItem`（含 `isTurnRunning`）。

### 后端状态流转
- `src-tauri/src/agent/agent_event_broadcaster.rs:114-210` —— `emit_stream_event` → `persist_stream_event`（:155-210）：写 log + `update_latest_output` + `update_turn_running` + 回填 `codex_session_id`。
- `src-tauri/src/agent/agent_event_broadcaster.rs:293-301` —— `turn_running_from_stream_event`（**改造核心点**）。
- `src-tauri/src/db/agent_session_repository.rs:597-610` —— `update_turn_running(session_id, is_turn_running, updated_at)`，SQL `WHERE id=? AND status='running' AND del=0`。
- `src-tauri/src/db/agent_session_repository.rs:413, :440` —— `mark_terminated_*` 会 `is_turn_running=0`（终止时连 turn 标志一起清）。
- `src-tauri/src/core/agent_session_service.rs:1510` —— list 查询合成 `is_turn_running: is_session_running && row.is_turn_running`（**grace 计算改造点**）。
- `src-tauri/src/db/agent_session_repository.rs:21` —— struct 字段 `is_turn_running: bool`；`:124` 查询列；`:690` 读取。

### 前端消费
- `src/features/agents/message-stream/message-stream-reducer.ts:109-195` —— `applyEvent`，turn 事件 → turnStatus。
- `src/features/agents/agent-session-view.tsx:56-65` —— `canUseExternalTurnRunning` + `effectiveTurnStatus`。
- `src/features/agents/agent-session-view.tsx:88, :108` —— 把 `isTurnRunning` / `effectiveTurnStatus` 下传。
- `src/features/agents/composer/use-agent-composer.ts:125` —— `isSending = turnStatus === "running"`（**前端改造点**）。
- `src/features/agents/agents-session-list.tsx:238-273` —— `getSessionStatusTone` / `shouldShowRunningSpinner`。
- `src/features/agents/agents-session-pane.tsx:45, :453` —— `isTurnRunning` 从 workspace 传入 `AgentSessionView`。

### migration
- 最新编号 `0033_project_terminal_shortcut_commands.sql`。**下一个用 `0034`**。

---

## 四、真实 log 分析结论

- data dir：`~/.redwhisk`（`src-tauri/src/local_data_path.rs`，`REDWHISK_DATA_DIR_NAME=".redwhisk"`）。
- session log：`~/.redwhisk/session-logs/{runtime,archive}/project-*/`，NDJSON（每行一个 `AgentStreamEventEnvelope`）。
- 现场日志：`~/.redwhisk/session-logs/runtime/project-1/project-1-issue-32-session-139.jsonl`（62MB，14125 行，正是多 sub agent 实测现场 —— rawInput 里就是本调查发给 Explore 的 prompt，task_id `a965b013b87397616`）。

关键统计（session-139）：
```
event.type 分布: 13967 timeline, 138 usage_updated, 6 thread_started,
                 5 turn_started, 5 model_changed, 2 turn_failed, 1 turn_completed, 1 turn_canceled
tool_call name:   66 read, 54 shell, 3 tool, 2 TaskOutput, 2 Skill, 2 Agent
timeline item:    14770 reasoning, 271 assistant_message, 129 tool_call, 5 user_message
```

turn 事件序列（seq 11884-11906，含 epoch 切换）：
```
11885 turn_completed  turn-1783473550769      ← 主 turn 1 完成（持续 36 分钟，含全部 sub agent）
11887 turn_started    turn-1783475740469
11890 turn_canceled   turn-1783475740469  reason="用户中断"
11892 turn_started    turn-1783475936251
11898 turn_failed     turn-1783475936251  error=""        ← 空 error！
11900 turn_started    turn-1783476303367
11906 turn_failed     turn-1783476303367  error=""        ← 空 error！
```

sub agent 工具的 raw 字段（Q2 预留点，当前 spec 不做）：
| 工具 | rawInput | 可提取标识 |
|---|---|---|
| `Agent` | `{"description":..., "prompt":...}` | description（sub agent 名） |
| `TaskOutput` | `{"block":true, "task_id":"...", "timeout":...}` | **task_id（sub agent 唯一标识）** |
| `Skill` | `{"skill":"superpowers:..."}` | skill 名 |

> 注：rawOutput 在 log 里全为 null（tool_result 未结构化记录）。

### 复现 / 继续分析的 jq 速查
```bash
F="$HOME/.redwhisk/session-logs/runtime/project-1/project-1-issue-32-session-139.jsonl"
jq -r '.event.type' "$F" | sort | uniq -c | sort -rn                       # 事件分布
jq -r 'select(.event.type|test("^turn_")) | "\(.seq)\t\(.event.type)\tturnId=\(.event.turnId//"-")\terr=\(.event.error//.event.reason//"")"' "$F"   # turn 序列
```

---

## 五、已对齐的设计决策（用户已确认）

1. **spec 范围 = 止血**：只做 Q1.1（空 error `turn_failed` 容忍）+ Q1.2（grace period）。**不含** Q2（区分主/sub 输出）和 Q1.3（三态化），留后续 spec。
2. **grace period 触发条件 = 方案 B**：
   - **延迟 N 秒**：`turn_completed` + **空 error 的** `turn_failed`
   - **立即置非运行**：`turn_canceled`（用户中断）+ **带 error 的** `turn_failed`（真失败）
   - **恢复运行 + 取消延迟**：`turn_started`
3. **整体方案 = 方案 1（后端时间戳 grace，单一数据源）**。
4. **grace 时长 = 3 秒**（可调常量）。

---

## 六、方案 1 设计要点（待逐节细化成 spec）

**思路：把「turn 是否在 grace 期内」做成 DB 层查询时计算，无定时器、单一数据源。**

1. **DB migration `0034`**：`agent_sessions` 加 `turn_ended_at INTEGER NULL`（Unix epoch ms）。
2. **broadcaster 改造**（`agent_event_broadcaster.rs`）：
   - `turn_started` → 清 `turn_ended_at` + `is_turn_running=1`
   - `turn_completed` / **空 error** `turn_failed` → 写 `turn_ended_at=now`，**不置** `is_turn_running=0`
   - **带 error** `turn_failed` / `turn_canceled` → `is_turn_running=0` + 清 `turn_ended_at`
   - 空判断：`turn_failed.error.trim().is_empty()`
   - 需把 `turn_running_from_stream_event` 的返回从 `Option<bool>` 扩成三态决策（或新增 `turn_ended_at` 写入分支）。
3. **repository**（`agent_session_repository.rs`）：
   - 新增 `update_turn_ended_at(session_id, now)` 与 `clear_turn_ended_at`（或在 `update_turn_running` 内联处理）。
   - `mark_terminated_*`（:413/:440）顺带清 `turn_ended_at`。
4. **list 查询 grace 计算**（`agent_session_service.rs:1510`）：
   ```
   is_turn_running = is_session_running
     && row.is_turn_running
     && (row.turn_ended_at IS NULL || now - row.turn_ended_at < GRACE_MS)
   ```
   - `GRACE_MS = 3000`，后端常量（service 或 repository）。
5. **前端 composer 改造**（`use-agent-composer.ts:125`）：
   - `isSending` 改从 `isTurnRunning`（props，已带 grace）派生，不再用 reducer `turnStatus`。
   - `isSubmitting` 本地锁保留（点击发送→running 回流间隙）。
   - reducer `turnStatus` 保留给消息流内部状态（错误条目等），不再驱动发送按钮。
   - `effectiveTurnStatus`（`agent-session-view.tsx:60-65`）相应调整：以 `isTurnRunning` 为主。
6. **覆盖**：session card（DB）+ composer + 非活跃 session 全部；无定时器竞态。

### 待逐节确认的设计点（新 session 继续 brainstorming 时问用户）
- migration 列名 / 默认值语义
- `turn_ended_at` 在 session resume / 应用重启恢复时的语义（重启后 status 转 stopped/crashed，`turn_ended_at` 应随之失效 —— 由 `mark_terminated` 清理）
- composer 改用 `isTurnRunning` 后，cancel 按钮、`isCancelling` 态的联动
- 常量 `GRACE_MS` 放 service 还是 repository
- 是否需要前端保留 `turnStatus=failed/canceled` 的 UI 提示（如「已取消」文案）

---

## 七、待办（新 session 接续）

1. **继续 brainstorming**：分节呈现方案 1 完整设计（架构 / 数据层 / broadcaster / 前端 / 错误处理 / 测试），每节获用户确认。
2. **写 spec**：`docs/superpowers/specs/2026-07-08-session-running-state-grace-design.md`（中文正文，遵循项目 CLAUDE.md）。
3. **spec 自审**：占位符 / 内部一致性 / 范围 / 歧义，inline 修复。
4. **用户审查 spec** → 批准。
5. **writing-plans**：生成分阶段实现计划。建议顺序：
   - a. migration `0034` + repository `turn_ended_at` 读写
   - b. broadcaster 三态改造（含空 error 判断）
   - c. service list grace 计算
   - d. 前端 composer `isSending` 改 `isTurnRunning`
   - e. 测试（repository grace 边界 / broadcaster 决策 / service 计算 / 前端 / 端到端模拟横跳）

### 验证要求（项目 `docs/architecture-design/agent-development-rules.md`）
- TS/TSX 改动：`pnpm lint` + `pnpm typecheck`，行为改动加 `pnpm test`。
- Rust / migration 改动：`cd src-tauri && cargo test`。
- 自动提交由 hook 处理（`.claude/auto-commit.json`），只需完成验证。

---

## 八、被排除 / 后续的内容（YAGNI，本 spec 不做）

- **Q2 区分主/sub 输出**：后端识别 `Agent`/`TaskOutput`/`Skill`，从 rawInput 解析 task_id/description，归一化为结构化 sub_agent detail；timeline item 挂 `origin: main|sub`。raw 字段已确认含标识，可行性高，留独立 spec。
- **Q1.3 三态化**：`is_turn_running` 单布尔 → `running/transitioning/idle` 三态 + session card `in-progress` tone 语义澄清。
- **codex 原生 task 工具**的 sub agent 事件模型（可能发独立 turn）—— 用户确认用的是 superpowers Task/Agent，本 spec 不覆盖原生 task。
