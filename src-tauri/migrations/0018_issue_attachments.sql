CREATE TABLE IF NOT EXISTS issue_attachments (
  id INTEGER PRIMARY KEY,
  issue_id INTEGER NOT NULL,
  display_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  absolute_path TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER NOT NULL,
  kind TEXT NOT NULL,
  is_previewable INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (issue_id) REFERENCES issues (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_issue_attachments_issue_id_created_at
ON issue_attachments (issue_id, created_at DESC, id DESC);
