CREATE TABLE issue_actions (
  id INTEGER PRIMARY KEY,
  issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_issue_actions_issue_id_created_at
  ON issue_actions(issue_id, created_at DESC, id DESC);
