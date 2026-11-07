CREATE TABLE issue_completion_writebacks (
  issue_id INTEGER PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE,
  completion_method TEXT NOT NULL CHECK (
    completion_method IN ('merge_to_base', 'open_pull_request')
  ),
  close_done INTEGER NOT NULL DEFAULT 0 CHECK (close_done IN (0, 1)),
  comment_done INTEGER NOT NULL DEFAULT 0 CHECK (comment_done IN (0, 1)),
  error_code TEXT,
  updated_at INTEGER NOT NULL
);
