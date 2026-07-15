# ADR 0007：Agent Turn 异常终止的可观测性与会话内提示

## 状态

采纳。可观测性（C）与会话内提示（B）已实现，见 commit `e31e7cd`、`2027c4b`。

## 背景

- **现象**：某 Claude session（后端 `glm-5.2[1m]`，经代理挂在 claude CLI 上、套 Anthropic streaming 协议）的日志「看着还在中途」，但 Session Card 状态点已变蓝（非 Running）。
- **排查结论**：session 没有卡死，是 turn 异常终止。该会话是用户消息驱动的交互式会话（累计 14 个 turn），第 14 个 turn 末尾 reasoning 计划「写 migration / 测试」，最后一句 assistant 文本「在写测试之前先确认编译」，跑了一个 108s 的 `cargo check`（status=completed）后，**没有任何收尾 assistant 消息**就直接 `turn_completed`，且（与前 13 个正常 turn 不同）之后没有续接。Claude 子进程已退出、日志静止，故 card 转蓝（`getSessionStatusTone` 中 `session.status !== "running"` → `done`）是**对真实状态的正确反映**，不是显示 bug。
- **根因方向**：glm-5.2 经代理桥接到 Anthropic streaming 协议，长工具（108s）执行后的那次模型调用疑似返回空终态响应，CLI 当作 success `Result` 收尾。但因 success 分支**丢弃了 SDK `result.stop_reason` / `subtype`**，无法从日志确认是否空 `end_turn`——这是本次难断的根因。
- **两个独立遗留问题**（本次未处理）：日志文件名 `...-session-145.jsonl` 与内容 `sessionId=211` 不一致（文件名用 log slot，非 DB sessionId）；`result_text` 在 success 分支被丢弃（潜在隐患，非本次触发）。

## 决定

1. **C：TurnCompleted 携带终止原因**。`AgentStreamEvent::TurnCompleted` 新增 `stop_reason` / `subtype`（`Option<String>`，`skip_serializing_if = "Option::is_none"`），`claude_streaming` 的 `Result` 分支透传；codex 路径传 `None`。两字段随 TurnCompleted 自动写入 JSONL 回放日志——正常 turn 带 `stopReason:"end_turn"`，异常值一目了然。前端 TS 类型镜像同步。

2. **B：前端检测异常终止并给会话内提示**。`message-stream-reducer` 的 `turn_completed` 用两条信号取或判定异常：
   - `stopReason` 非空且 ∉ {`end_turn`, `stop_sequence`}（如 `max_tokens` / `tool_use`）；
   - 末条 timeline 是「已完成的 tool_call」（无收尾 assistant 消息）——本次被掐断的精确形态，与 stopReason 无关，可兜底代理把空响应当 `end_turn` 上报、或后端未上报的场景。

   命中时 state 置 `turnInterrupted` / `interruptedStopReason`（仅在 stopReason 本身异常时才存，避免启发式命中却展示误导性的 `end_turn`），消息流末尾渲染本地化提示条；`turn_started` 与用户重发时清空。

3. **暂缓：列表点变色**。列表点是显眼位置，可靠判据需等 C 收集到真实 `stopReason` 值后再定，避免误判正常会话。当前仅在会话内提示，不动 list 行的状态点。

## 后果

- 异常提示是**实时态**：异常 turn 发生时在线才显示；重新打开 session（HYDRATE）不重新推导（timeline 不带 stopReason）。持久可见需把信号落到 timeline / DB（后续工作）。
- 检测判据可调：拿到真实 `stopReason` 后，若为 `max_tokens` / `tool_use` 等则信号 ① 稳定，可放心接列表点；若为 `end_turn` / 空则只能靠信号 ②，需把异常态持久化到 DB 才能让列表点表达「异常中断」。
- codex 路径 TurnCompleted 暂传 `None`（codex 无等价 stop_reason 概念），不影响 claude 路径诊断。
- 启发式（末条 tool_call）有低概率误报：agent 罕见地以「工具即终态、无收尾消息」正常结束 turn 时会触发；后果仅多一条「可重发」提示，非致命。

## 代码事实来源

- 终止原因字段：`src-tauri/src/types/agent_session_stream.rs:25` `AgentStreamEvent::TurnCompleted { stop_reason, subtype }`；前端镜像 `src/features/agents/agent-stream-types.ts` 的 `turn_completed`。
- claude 透传：`src-tauri/src/agent/claude_streaming/session.rs:703`（解构 `stop_reason`）、`:734`（success 分支发 TurnCompleted）；codex 传 None：`src-tauri/src/agent/codex_app_server/session.rs:722`。
- 前端检测：`src/features/agents/message-stream/message-stream-reducer.ts` 的 `CLEAN_STOP_REASONS` / `isCleanStopReason` / `lastEntryIsCompletedToolCall`（`:50` 起）与 `turn_completed` 分支（`:176` 起）。
- 提示渲染：`src/features/agents/message-stream/agent-message-stream.tsx:221`。
- i18n：`src/shared/i18n/messages.ts:438`、`src/shared/i18n/locales/{en,zh}.json` 的 `turnInterrupted` / `turnInterruptedWithReason`。
- 关联：TurnCompleted 经 `src-tauri/src/agent/agent_event_broadcaster.rs` 的 `turn_running_from_stream_event` 映射为 `EndedWithGrace`；列表点 tone 由 `src/features/agents/agents-session-list.tsx` 的 `getSessionStatusTone` 决定（`status !== "running"` → `done`，即用户看到的蓝点）。

## 替代方案

- **后端把异常 stop_reason 提升为 TurnFailed**：否决——会触发 `turn_failed` 的通知与 failed 态语义，对「静默中断」过吵且语义不准。
- **异常完成时置 `attention=requested` 让列表点变色**：否决（暂缓）——attention 是 DB 驱动的显眼态，判据可靠性依赖真实 stopReason（未知），误判打扰强；文案也只有通用「需要关注」。等数据再评估。
- **新增专用「异常中断」tone + 文案 + DB 字段**：否决（暂缓）——需 migration + 列表查询 + CSS + i18n，改动最大；判据稳定前不划算。
- **只靠 stopReason 单一信号**：否决——代理可能把空响应当 `end_turn` 上报或不上报，会漏掉本次场景；故加「末条已完成 tool_call」兜底信号。
