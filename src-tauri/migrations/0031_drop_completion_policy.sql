-- 彻底移除提交策略 completion_policy 字段：
-- 1) projects.completion_policy（来自 0010）
-- 2) agent_sessions.completion_policy（来自 0022，原为会话级 override 快照）
-- rusqlite 0.40 携带的 SQLite >= 3.35.0 已支持 ALTER TABLE DROP COLUMN。
ALTER TABLE projects DROP COLUMN completion_policy;
ALTER TABLE agent_sessions DROP COLUMN completion_policy;
