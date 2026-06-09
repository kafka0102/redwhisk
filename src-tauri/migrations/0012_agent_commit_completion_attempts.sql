PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS completion_attempts_new (
  id INTEGER PRIMARY KEY,
  issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  session_id INTEGER NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  option TEXT NOT NULL CHECK (option IN ('complete_manual', 'complete_clean', 'agent_auto_commit')),
  head_before TEXT NOT NULL,
  head_after TEXT NOT NULL,
  changed_files_json TEXT NOT NULL DEFAULT '[]',
  result TEXT NOT NULL CHECK (result IN ('completed', 'prompt_sent')),
  created_at INTEGER NOT NULL
);

INSERT INTO completion_attempts_new (
  id,
  issue_id,
  session_id,
  option,
  head_before,
  head_after,
  changed_files_json,
  result,
  created_at
)
SELECT
  id,
  issue_id,
  session_id,
  option,
  head_before,
  head_after,
  '[]',
  result,
  created_at
FROM completion_attempts;

DROP TABLE completion_attempts;
ALTER TABLE completion_attempts_new RENAME TO completion_attempts;

CREATE INDEX IF NOT EXISTS idx_completion_attempts_issue_id_created_at
ON completion_attempts(issue_id, created_at DESC, id DESC);

PRAGMA foreign_keys = ON;
