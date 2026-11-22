ALTER TABLE projects ADD COLUMN issue_display_mode TEXT NOT NULL DEFAULT 'board'
  CHECK (issue_display_mode IN ('board', 'list'));
