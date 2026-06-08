CREATE TABLE IF NOT EXISTS completion_attempts (
  id INTEGER PRIMARY KEY,
  issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  session_id INTEGER NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  option TEXT NOT NULL CHECK (option IN ('complete_manual', 'complete_clean')),
  head_before TEXT NOT NULL,
  head_after TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('completed')),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_completion_attempts_issue_id_created_at
ON completion_attempts(issue_id, created_at DESC, id DESC);
