# ADR 0029：Eligible Turn 自动 Issue 评论（标签优先 + Multica 式兜底）

## 状态

采纳（已执行）。

本 ADR 取代 [0003 Agent Turn 完成自动发表 Issue 评论](./0003-agent-turn-comment-auto-post.md) 中「仅 `completion` 触发」与「仅标签可评论、无兜底」的落地修正表述；0003 的表结构、`issue_actions` actor、幂等键与广播路径仍有效。

## 背景

ADR-0003 落地后，实现曾收窄为仅 `completion` turn，且正文唯一来源是 `<issue-comment>`（提取不到则静默不发）。实践中：

1. 用户从看板派发后的首轮 `initial` turn 往往已有可交付结果，时间轴却无评论。
2. Agent 未必稳定遵守标签契约；「无标签 = 无评论」导致成功 turn 在 Issue 侧「跑完无痕迹」。
3. Multica 对照路径是：优先 Agent 主动评论，缺失时用本轮输出兜底整理，保证 eligible 成功 turn 至少一条交付说明。

CONTEXT「Issue 交付摘要」已改为：标签优先，缺失时采用本轮最终答复的整理版。

## 决定

1. **触发范围（eligible source）**：`initial` | `completion` 的成功 `TurnCompleted`。`follow_up`、失败/取消 turn 不自动发成功交付评论。TUI / 无结构化助手消息路径仍不纳入启发式提取（无助手正文时可用固定句，无关联 issue 则跳过）。
2. **快照判定**：broadcaster 处理 `TurnCompleted` 时快照 `turn_source` + `turn_id` 注入 handler；不以事后可能被 follow_up 改写的库字段判定 eligible。幂等键仍为 `(issue_id, agent_session_id, turn_id)` UNIQUE。
3. **正文解析顺序（Multica 式）**：
   1. 扫描该 turn 全部助手消息，从后往前取首个可提取的 `<issue-comment>`（跳过 fence 内与转义标签；空内容无效）。
   2. 否则取最后一条非空助手正文 → 去掉 fenced code → trim → 上限 800 字（超出加 `…`）。
   3. 结果为空或 trivial（完成/done/好的等，大小写/标点不敏感）→ 固定句：`Agent 已完成本轮任务。`
   4. 不写「系统整理」前缀；actor 仍为 Agent 名称快照。
4. **Prompt 契约（同构注入）**：
   - 派发首轮：`run-prompt-builder` 的 `finalPrompt` 必须追加阶段性交付摘要指令（sources 同步可见）；随 `prompt_snapshot` 落库。
   - 完成流程：`build_agent_commit_completion_prompt` 使用同构句式（顶层 `<issue-comment>精简中文交付摘要</issue-comment>`、做了什么/结果/验证命令、系统**优先**提取、禁止 fence/转义）。
   - 标签为高质量可选，不是评论成功的唯一条件。
5. **数据与 UI**：不改 schema；继续写 `issue_comments` + `IssueCommentAdded`，广播 `issue-timeline-changed`；前端既有时间轴订阅即可。

## 后果

- 首轮与完成两类 eligible turn 结束后，时间轴应出现交付评论（幂等、不刷屏）。
- prompt 模板被改坏时，兜底仍可发表整理版/固定句；标签质量下降但不致「零评论」。
- 开发者不得再按 0003 落地修正假设「只改 completion / 无标签必静默」。
- TUI 与 Agent CLI 主动评论 API 仍不在本决策范围。

## 代码事实来源

- 反应入口：`src-tauri/src/features/issue/completion_comment.rs`（`handle_turn_completed` / `try_publish_*`）
- 快照注入：`src-tauri/src/agent/agent_event_broadcaster.rs`（`TurnCompleted`）
- 首轮 prompt：`src/features/issues/issue-run/run-prompt-builder.ts`（`ISSUE_DELIVERY_SUMMARY_INSTRUCTION`）
- 完成 prompt：`src-tauri/src/features/issue/completion/formatting.rs`（`build_agent_commit_completion_prompt`）
- 术语：`CONTEXT.md`「Issue 交付摘要」

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 维持 0003 落地：仅 completion + 仅标签 | 首轮无痕迹；标签失约即静默 |
| 全部 turn（含 follow_up）自动评论 | 调试对话污染时间轴 |
| 独立「系统评论」实体类型 | 过重；现有 `issue_comments` + Agent actor 已足够 |
| 后端隐式注入 prompt、不改 finalPrompt | 快照与实际发送不一致，不可审计 |

## 与 0003 的关系

- **保留**：表与 UNIQUE 幂等、`IssueCommentAdded` actor=agent、spawn 不阻塞 stream、timeline 事件模型、结构化路径范围。
- **取代**：触发范围仅 completion；正文唯一来源=标签且无兜底；「不必改 run-prompt-builder」的落地修正。
