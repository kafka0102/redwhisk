# Agent Turn 完成自动发表 Issue 评论设计

## 背景

CONTEXT.md 把「Issue 交付摘要」定义为 Agent 最终答复中由 `<issue-comment>` 包围的精简交付内容，是「唯一可自动创建 Issue 评论的 Agent 输出」。ADR 0002（已采纳）规划了 `issue_comments` 表与「从 Agent 最终答复提取 `<issue-comment>` 交付摘要」的方向，但明确把「评论表与写入逻辑」留作后续实现。ADR 0003（拟议）给出了详细的实现蓝图。

诊断结论：**该功能从未实现**。全 git 历史中 `issue_comments` 表、`IssueCommentAdded` 动作、`<issue-comment>` 提取逻辑均零命中；当前时间轴只有 `AgentSessionStarted` 等状态动作，没有任何评论正文。本设计在 ADR 0003 蓝图基础上落地实现，并修正其两处判断错误。

## 目标

1. Agent 走完 issue 完成流程（注入 commit 指令）那个 turn 完成时，自动从该 turn 最终答复提取 `<issue-comment>` 交付摘要，作为评论发表到当前 Issue 时间轴。
2. 评论正确归属为 Agent 操作者（`actor_kind='agent'`），时间轴展示 Agent 名称快照与类型图标。
3. 保留向「用户手动评论」无损扩展的能力。

## 非目标

- 不在 `initial` turn（派发首条消息）或 `follow_up` turn（用户追问）触发评论发表。
- 不引入用户手动发表/编辑/删除评论的 UI（留作后续独立需求，但本设计保证其零 schema 改动即可扩展）。
- 不覆盖 PTY/TUI 路径（issue 派发均走结构化路径：Claude streaming / Codex app-server）。
- 不回填历史 `issue_actions` 的 actor（历史动作维持 `user/1`）。
- 不把评论发表耦合到 commit 检测（`detect_agent_commit_completion`）或 issue 状态机推进。

## 对 ADR 0003 的修正

落地前更正 ADR 0003 两处判断错误，实现时以本设计为准：

- **决定 1（触发范围）**：ADR 0003 原定 turn 来源 ∈ `{initial, completion}` 均触发。本设计收窄为**仅 `completion` turn 触发**。`initial` turn 时 Agent 通常无可交付内容，强制发表易产生噪音。
- **决定 6（actor 归属）**：ADR 0003 称「`AgentSessionStarted` 不再错误归属为 `user/1`」的前提是错的。`AgentSessionStarted` 是**用户**启动 Agent 会话时把 issue 从 `backlog` 切到 `running` 的状态切换动作，操作主体是人，归属 `user` 正确。**所有现有状态类动作维持 `user`，仅评论动作归 `agent`。**

## 事实模型

### completion turn

用户在 issue 上点「完成」、工作区有改动且选「自动提交」时，`complete_issue_flow` 向活跃 session 注入 `build_agent_commit_completion_prompt`（commit 指令）那条 message 所触发的 turn（`issue_service.rs:1093`）。service 层在发送前显式知晓「这是 completion 消息」，标记可靠。

### turn 来源与配对

- `current_turn_source`：`initial` / `follow_up` / `completion`，由 service 在每个发起 turn 的入口写入。
- `current_turn_id`：由 broadcaster 在 `TurnStarted` 回流时写入（事件自带 turn_id）。
- `TurnCompleted` 的提取任务携带 turn_id，读取时校验 `current_turn_id == 携带值`，不匹配则跳过（已被新 turn 抢占）。

### 发起 turn 的三类入口

| 入口 | source | 位置 |
| --- | --- | --- |
| 启动 session 首条消息 | `initial` | `agent_session_service.rs:820/1032` |
| 完成流程注入 commit 指令 | `completion` | `issue_service.rs:1093` |
| 用户在 session 追问 | `follow_up` | `agent_session_commands.rs:466` |

## 数据模型（migration 0043）

```sql
CREATE TABLE issue_comments (
  id INTEGER PRIMARY KEY,
  issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  linked_session_id INTEGER,   -- 可空：用户评论为 NULL
  linked_turn_id TEXT,         -- 可空：用户评论为 NULL
  created_at INTEGER NOT NULL,
  UNIQUE(linked_session_id, linked_turn_id)   -- 仅约束 Agent 评论幂等；SQLite 中 NULL 不冲突
);

ALTER TABLE issue_actions
  ADD COLUMN actor_agent_profile_id INTEGER,
  ADD COLUMN actor_agent_name_snapshot TEXT;

ALTER TABLE agent_sessions
  ADD COLUMN current_turn_source TEXT,   -- initial/follow_up/completion
  ADD COLUMN current_turn_id TEXT;
```

### 设计要点：作者归属单一来源

`issue_comments` **不存任何作者信息**。作者（user/agent + 名称快照）完全由关联的 `issue_actions` 记录的 actor 列表达。这避免在两张表重复存 Agent 名称快照，且天然支持未来用户评论（其 issue_action actor 为 `User`）。符合 ADR 0002「操作者列化、正文与操作者分离」。

`linked_session_id` / `linked_turn_id` 可空：Agent 评论填充（用于幂等），用户评论为 NULL。`UNIQUE(linked_session_id, linked_turn_id)` 仅约束 Agent 评论幂等；SQLite 中多个 NULL 不冲突，用户评论可多条。

### 类型变更

- `IssueActionType` 新增 `IssueCommentAdded`（`as_str` → `"issue_comment_added"`）。
- 新增 `IssueActionActor` 枚举：`User { profile_id: i64 }` / `Agent { profile_id: i64, name_snapshot: String }`。

## 触发流程（端到端）

1. 用户点「完成」+ 自动提交 → `complete_issue_flow` 向活跃 session `send_message(completion_prompt)`。
2. service 发送前写 `agent_sessions.current_turn_source='completion'`，清空 `current_turn_id`。
3. `TurnStarted` 回流 → broadcaster 写 `current_turn_id = event.turn_id`。
4. `TurnCompleted` 回流 → broadcaster `thread::spawn` 提取任务（模式参照 `finalize_turn_after_grace`），携带 turn_id。
5. 任务内：校验 `current_turn_id == 携带值` 且 `current_turn_source == 'completion'` → 按 turn_id 从 session log 找最后一条 `AssistantMessage` → 正则提取 `<issue-comment>` → 写库 → 广播列表刷新。
6. `initial` / `follow_up` turn 不触发；提取不到标签静默不发。

## 提取执行体

- 触发点：`agent_event_broadcaster.persist_stream_event` 检测 `AgentStreamEvent::TurnCompleted` 时 `thread::spawn`（同 `finalize_turn_after_grace` 模式，`agent_event_broadcaster.rs:149/255`）。
- 任务体（`new IssueService` / Repository，避免让 agent 层依赖 core 写入）：
  1. 读取 session，校验 `current_turn_id == 携带 turn_id` 且 `current_turn_source == 'completion'`；不匹配则跳过。
  2. `read_timeline_from_log_path`（`agent_session_service.rs:3612`）按 turn_id 过滤，取该 turn 最后一条 `AssistantMessage`。
  3. 正则 `(?s)<issue-comment>\s*(.*?)\s*</issue-comment>` 提取首个匹配；无匹配则静默返回。
  4. 单事务内：`issue_comments` 插入正文（`linked_session_id` + `linked_turn_id`）→ `issue_actions` 插入 `IssueCommentAdded`（actor=`Agent{profile_id, name_snapshot}`，`payload_json={commentId, linkedSessionId, linkedTurnId}`）→ 提交。
  5. 广播 issue 列表刷新事件。
- 正则不做容错：标签出现在代码块或被转义时不识别，靠 prompt 约束 Agent 把标签写在正文顶层。

## prompt 契约

`build_agent_commit_completion_prompt`（`issue_service.rs:3203`）追加一条要求：完成提交后，在答复正文**顶层**用 `<issue-comment>精简中文交付摘要</issue-comment>` 输出给 Issue 的交付内容（做了什么、结果、验证命令；不含代码块/转义）。

该契约是机制的必要组成：prompt 模板被改坏则评论静默失效（不报错，靠时间轴无评论发现）。因本设计**仅 completion turn 触发**，只需在后端 `build_agent_commit_completion_prompt`（`issue_service.rs:3203`）追加该契约；**不改 `run-prompt-builder`**——initial turn 不触发评论，无需要求 Agent 在首 turn 输出该标签。（ADR 0003 决定 3 原要求两处同步注入，是基于 initial+completion 均触发的旧决策，随决定 1 收窄后失效。）

## actor 归属

- `insert_issue_action_in_transaction`（`event_repository.rs:15`）改签名，接受 `IssueActionActor` 参数，移除硬编码 `'user', 1`（`event_repository.rs:23`）。
- **现有 13 处调用点全部传 `User{1}`**（含 3 个 `AgentSessionStarted`——维持 user 正确）。调用点：`agent_session_service.rs:515/745/980`、`issue_service.rs:361/576/751/1477/2282/2357/2454/2546/2615/2717`。
- 仅评论动作传 `Agent{profile_id, name_snapshot}`。
- `get_issue_timeline`（`issue_service.rs:255`）按 `actor_kind` 分支取值：
  - `user` → `LEFT JOIN user_profiles` 取 name / avatar_path。
  - `agent` → `actor_agent_name_snapshot` + `agent_type`（前端按类型出图标）。
- `IssueTimelineActor` 扩展：新增 `actor_kind`（`user`/`agent`）与 `agent_type`（可空）。

## 前端渲染

- `issue-timeline.tsx` 新增 `issue_comment_added` 动作分支：
  - 渲染评论正文，复用 `agent-markdown`（`src/features/agents/message-stream/agent-markdown.tsx`）。
  - actor 头像按 `actorKind` 切换：`user` → 照片；`agent` → `agent-visuals` 按 `agentType` 的类型图标 + 名快照。
- 时间轴动作文案注册表（`issue-timeline.tsx:66`）补 `issue_comment_added: messages.issues.timelineCommentAdded`。
- i18n：新增 `timelineCommentAdded` 文案，所有 locale 补齐。

## 边界与错误处理

- 提取不到 `<issue-comment>` → 静默不发，不 fallback 截断最终答复（与 CONTEXT.md「评论唯一来源 = `<issue-comment>`、完整答复仍属 Session」一致）。
- 幂等：`UNIQUE(linked_session_id, linked_turn_id)`；重复触发同 turn 时 INSERT 冲突直接忽略。
- 竞态：被新 turn 抢占（`current_turn_id` 不匹配）则跳过。
- 提取任务独立 catch：失败不影响 session 正常运行与 commit 检测。
- 只覆盖结构化路径；PTY/TUI 不纳入。

## 测试策略

### Rust 单测

- `<issue-comment>` 正则提取：标签在顶层提取成功；在代码块内/被转义不提取；多个标签取首个；缺闭合标签不提取。
- 幂等：同一 `(session_id, turn_id)` 重复触发只产生一条评论。
- 竞态跳过：`current_turn_id` 已被新 turn 覆盖时，旧 turn 的提取任务不写库。
- actor 归属：评论动作 actor=`Agent`；`AgentSessionStarted` 等状态动作 actor=`User`。
- `get_issue_timeline` 分支：`actor_kind='user'` 取 user_profiles；`actor_kind='agent'` 取快照名 + agent_type。
- `current_turn_source` 写入：三类入口分别写 initial/completion/follow_up。

### 前端单测

- `issue_comment_added` 动作渲染评论正文 + agent actor。
- `actorKind` 切换头像来源。

### 端到端（手动 / 集成）

- completion turn 产生评论并出现在时间轴，归属 Agent。
- follow_up turn 不产生评论。
- 提取不到标签时时间轴无评论且无报错。

## 未来扩展：用户手动评论

本设计保证零 schema 改动即可扩展用户评论：

- 写一条 `issue_actions(IssueCommentAdded, actor=User{profile_id})` + 一条 `issue_comments(body, linked_session_id=NULL, linked_turn_id=NULL)`。
- `get_issue_timeline` 对评论动作的 JOIN 与 actor 分支无需改动。
- 前端新增评论输入框即可。

## 代码事实来源

- TurnCompleted 事件：`src-tauri/src/types/agent_session_stream.rs:25`。
- broadcaster spawn 模式：`src-tauri/src/agent/agent_event_broadcaster.rs:149/255`（`finalize_turn_after_grace`）、`persist_stream_event` `:193`、`turn_running_from_stream_event` `:375`。
- session log 读取：`agent_session_service.rs:3612 read_timeline_from_log_path`。
- completion 消息注入：`issue_service.rs:1093`；prompt 构造 `:3203 build_agent_commit_completion_prompt`。
- `insert_issue_action` 硬编码 actor：`src-tauri/src/db/event_repository.rs:23`。
- timeline 查询：`issue_service.rs:255 get_issue_timeline`。
- 前端时间轴：`src/features/issues/issue-timeline.tsx:66`；actor 渲染 `:80`。
