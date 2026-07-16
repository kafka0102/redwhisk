# ADR 0003：Agent Turn 完成自动发表 Issue 评论

## 状态

已采纳（2026-07-15 落地实现，commit 10a02a5 / f304c48 / 621c902 / 24081ab / b8708aa）。落地时修正了决定 1 与决定 6 两处判断，见文末「实现落地修正」。

## 背景

ADR 0002 规划了 `issue_comments` 表与「从 Agent 最终答复提取 `<issue-comment>` 交付摘要」的方向，但把「评论表与写入逻辑」留作后续实现。commit 2d3b6ef（修复时间轴动作过滤缺陷）的遗留能力，正是「Agent 执行完任务后自动回复评论到当前 Issue」。

需要确定的开放问题：

- 何时触发：执行过程中 / 真正完成后 / 用户验收后？
- Agent 不会自发写出 `<issue-comment>` 标签——约定从何而来？
- 评论如何正确归属到 Agent 操作者？`issue_actions` 当前把所有动作硬编码为 `actor_kind='user'`、`actor_user_profile_id=1`（`event_repository.rs:24`），Agent actor 模型未落地。
- 非交互式 Agent（Claude Code headless）与交互式（Codex app-server）如何统一触发？

## 决定

1. **触发点**：以结构化事件 `AgentStreamEvent::TurnCompleted` 为唯一触发信号，仅当该 turn 的来源 ∈ `{initial, completion}` 且 session 关联了 issue 时，才尝试提取并发表评论。用户追问 turn（`follow_up`）、失败 / 取消 turn 不触发。
   - 选 turn 完成而非 session 退出：turn 完成即「这一轮任务的所有输出已产生」，是非交互式 Agent「任务执行完毕」的精确语义；等 session 退出无收益。
   - 选 turn 完成而非 issue 状态机推进：评论是独立于「待验收 / 完成」状态机的旁路，在 Agent 交付时即留痕，不等用户审核。

2. **turn 来源持久化**：`agent_sessions` 新增 `current_turn_source`（`initial`/`follow_up`/`completion`）与 `current_turn_id` 两列。`current_turn_source` 由 service 层在每个发起 turn 的入口写入；`current_turn_id` 由 broadcaster 在 `TurnStarted` 事件回流时写入（事件自带 turn_id）。两者配合消除竞态：TurnCompleted 的 spawn 任务携带 turn_id，读取时校验 `current_turn_id == 携带值`，不匹配则跳过（已被新 turn 抢占）。

3. **prompt 契约**：`<issue-comment>` 标签必须由派发 prompt 显式要求 Agent 输出。约定注入前端 `run-prompt-builder` 的 `finalPrompt`（随 `prompt_snapshot` 落库、run-dialog 只读可见）；完成流程注入的 `build_agent_commit_completion_prompt` 同步追加。评论提取的唯一来源是该标签，提取不到静默不发，不 fallback 截断最终答复。

4. **执行体**：`agent_event_broadcaster.persist_stream_event` 检测到 TurnCompleted 时 `std::thread::spawn`（与 `finalize_turn_after_grace` 同模式），任务内 `new IssueService`/Repository 完成：校验来源 → 按 turn_id 从 session log 重读该 turn 最后一条 AssistantMessage → 正则提取 `<issue-comment>` → 写 `issue_comments` + `issue_actions(IssueCommentAdded)` → 广播 list 刷新。

5. **数据模型**：
   - `issue_comments` 新表：正文 + author（agent 快照）+ source + `linked_session_id`/`linked_turn_id`，`UNIQUE(linked_session_id, linked_turn_id)` 保证幂等。
   - `issue_actions` 新增动作 `IssueCommentAdded`，`payload_json` 仅存 `{commentId, source}`，正文去 `issue_comments` 取。
   - `get_issue_timeline` 对评论动作 JOIN `issue_comments` 内联正文；`IssueTimelineEntry` 扩展可选 `commentBody`。

6. **Agent actor 模型补齐**：`issue_actions` 新增 `actor_agent_profile_id` 与 `actor_agent_name_snapshot`；`insert_issue_action` 接受 actor 参数；`get_issue_timeline` 按 `actor_kind` 分支取 user/agent 名称。补齐 CONTEXT.md「Agent 分配」规划但未落地的 Agent 操作者，使 `AgentSessionStarted` 与评论动作不再错误归属为 user/1。

## 后果

- 评论自动发表的成败取决于 prompt 是否要求 Agent 写 `<issue-comment>`：prompt 模板（`run-prompt-builder`、`build_agent_commit_completion_prompt`）是机制的必要组成，不是可选配套；模板被改坏则评论静默失效（不报错，靠时间轴无评论发现）。
- 只覆盖结构化路径（Claude streaming / Codex app-server）；PTY/TUI 路径无法可靠从裸 stdout 提取标签，不纳入。issue 派发均走结构化路径，覆盖范围足够。
- `issue_actions` 的 actor 模型变更是对 0005/0041 schema 的扩展，需 migration；历史 `AgentSessionStarted` 动作的 actor 仍为 user/1，不回填（可接受）。
- 提取规则为正则、不做容错：Agent 把标签写进代码块或转义将不被识别，靠 prompt 约束 Agent 把标签写在正文顶层。

## 代码事实来源

- 触发信号：`AgentStreamEvent::TurnCompleted` 产生点 `src-tauri/src/agent/claude_streaming/session.rs:734`；统一判定 `agent_event_broadcaster.rs:375 turn_running_from_stream_event`。
- broadcaster spawn 模式参照：`agent_event_broadcaster.rs:255 finalize_turn_after_grace`。
- timeline 文本来源：`agent_session_service.rs:3548 read_timeline_from_session_log` / `:3558 read_timeline_from_log_path`（log 由 `agent_event_broadcaster.rs:217` 逐行写入，Timeline 事件带 turn_id）。
- issue ↔ session 关联：`StartAgentSessionInput.issue_id` → `issue.linked_session_id`。
- issue_actions 硬编码 actor：`src-tauri/src/db/event_repository.rs:24`。
- timeline 查询：`issue_service.rs:250 get_issue_timeline`。
- prompt 构造：`src/features/issues/run-prompt-builder.ts`（`APP_INSTRUCTIONS` 当前只进 `sources`、未进 `finalPrompt`）；completion 模板 `issue_service.rs:3203 build_agent_commit_completion_prompt`。
- markdown 渲染：`src/features/agents/message-stream/agent-markdown.tsx`。

## 替代方案

- **触发时机**：session 退出时触发（否决：延迟无收益，且进程退出回调里重捞 turn 文本更复杂）；issue 状态推进到 Review/Completed 时触发（否决：违背「不等用户审核」诉求）。
- **prompt 注入层**：后端隐式注入、`prompt_snapshot` 保持纯净（否决：不透明、快照与实际发送不一致；且 finalPrompt 只读、无被编辑风险，前端注入更可审计）。
- **提取策略**：提取不到时 fallback 截断最终答复（否决：与 CONTEXT.md「评论唯一来源 = `<issue-comment>`、完整答复仍属 Session」冲突）。
- **actor 模型**：把 agent 名称快照塞 `payload_json`（否决：违反 ADR 0002「操作者列化、payload 仅存展示参数」）。
- **执行体**：独立 worker + channel（否决：对单机桌面应用过重）；session.rs 就地提取（否决：让 agent 层依赖 core 写入，分层更乱，且 codex 路径要重复实现）。

## 实现落地修正（2026-07-15）

实现时发现原决定的两处判断前提有误，按实际取舍落地（原文保留以追溯）：

- **决定 1（触发范围）**：收窄为**仅 `completion` turn 触发**，去掉 `initial`。`initial` turn（派发首条消息）时 Agent 通常无可交付内容，强制发表易产生噪音；自动评论收敛到「完成时发交付摘要」最干净。故 `<issue-comment>` prompt 契约只需注入完成流程的 `build_agent_commit_completion_prompt`，不改 `run-prompt-builder`（原决定 3 要求两处同步注入的前提随之失效）。
- **决定 6（操作者归属）**：`AgentSessionStarted` 是**用户**启动 Agent 会话时把 Issue 从 backlog 切到 running 的状态切换动作，操作主体是人，维持 `actor_kind='user'` 正确，**不归 agent**。仅评论动作（`IssueCommentAdded`）归 `agent`（交付摘要是 Agent 产出）。历史动作不回填。

完整设计见 `docs/superpowers/specs/2026-07-15-agent-turn-comment-auto-post-design.md`。
