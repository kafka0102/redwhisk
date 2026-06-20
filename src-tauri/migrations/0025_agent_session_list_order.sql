ALTER TABLE agent_sessions
ADD COLUMN list_inserted_at INTEGER;

UPDATE agent_sessions
SET list_inserted_at = started_at
WHERE list_inserted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_agent_sessions_project_id_list_inserted_at
ON agent_sessions (project_id, list_inserted_at DESC, id DESC)
WHERE del = 0;
