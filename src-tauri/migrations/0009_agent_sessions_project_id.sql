ALTER TABLE agent_sessions ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE;

UPDATE agent_sessions
SET project_id = (
  SELECT issues.project_id
  FROM issues
  WHERE issues.id = agent_sessions.issue_id
)
WHERE project_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_agent_sessions_project_id_status_last_active_at
ON agent_sessions (project_id, status, last_active_at DESC, started_at DESC, id DESC);
