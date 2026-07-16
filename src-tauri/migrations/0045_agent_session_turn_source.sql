-- 记录 agent_sessions 当前 turn 的来源与标识，供 completion turn 自动发表 Issue 评论
-- 的提取任务做配对校验（见 docs/superpowers/specs/2026-07-15-agent-turn-comment-auto-post-design.md）。
-- current_turn_source：initial / follow_up / completion，由 Issue/Session 服务层在发起
--   turn 的入口写入；写 source 时同时清空 current_turn_id（新 turn 上下文开始）。
-- current_turn_id：由事件广播层在 TurnStarted 回流时写入（事件自带 turn_id）。
--   TurnCompleted 的提取任务携带 turn_id，读取时校验 current_turn_id == 携带值，
--   不匹配则跳过（已被新 turn 抢占）。
ALTER TABLE agent_sessions ADD COLUMN current_turn_source TEXT;
ALTER TABLE agent_sessions ADD COLUMN current_turn_id TEXT;
