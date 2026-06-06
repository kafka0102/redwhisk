CREATE TABLE IF NOT EXISTS agent_sessions (
  id INTEGER PRIMARY KEY,
  issue_id INTEGER REFERENCES issues(id) ON DELETE CASCADE,
  title TEXT,
  agent_profile_id INTEGER NOT NULL REFERENCES agent_profiles(id) ON DELETE RESTRICT,
  codex_session_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'closed', 'crashed', 'stopped')),
  attention TEXT NOT NULL CHECK (attention IN ('none', 'requested')),
  working_dir TEXT NOT NULL,
  command_snapshot TEXT NOT NULL,
  prompt_snapshot TEXT NOT NULL,
  log_path TEXT NOT NULL,
  last_active_at INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  closed_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_agent_sessions_issue_id
ON agent_sessions (issue_id)
WHERE issue_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_sessions_status_last_active_at
ON agent_sessions (status, last_active_at DESC, started_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS session_events (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_events_session_id_created_at
ON session_events (session_id, created_at DESC, id DESC);
