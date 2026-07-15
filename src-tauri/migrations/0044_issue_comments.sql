-- Issue 评论正文实体。作者归属不在本表表达，完全由关联的 issue_actions 记录的
-- actor 列承载（user / agent + 名称快照），避免重复存储。
-- linked_session_id / linked_turn_id 可空：Agent 评论填充（用于幂等），用户评论为 NULL。
-- UNIQUE(linked_session_id, linked_turn_id) 仅约束 Agent 评论幂等；
-- SQLite 中多个 NULL 不冲突，故用户评论可多条。
CREATE TABLE issue_comments (
  id INTEGER PRIMARY KEY,
  issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  linked_session_id INTEGER,
  linked_turn_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(linked_session_id, linked_turn_id)
);
