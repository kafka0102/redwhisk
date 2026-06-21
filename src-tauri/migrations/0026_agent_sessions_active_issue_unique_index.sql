DROP INDEX IF EXISTS uidx_agent_sessions_issue_id;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_agent_sessions_issue_id
ON agent_sessions (issue_id)
WHERE issue_id IS NOT NULL AND del = 0;
