ALTER TABLE projects ADD COLUMN last_issue_synced_at INTEGER;
ALTER TABLE projects ADD COLUMN last_issue_sync_error TEXT;

CREATE TABLE issue_external_refs (
  issue_id INTEGER PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'gitlab')),
  host TEXT NOT NULL,
  repo TEXT NOT NULL,
  external_id TEXT NOT NULL,
  external_number INTEGER NOT NULL,
  external_url TEXT NOT NULL,
  remote_state TEXT NOT NULL CHECK (remote_state IN ('open', 'closed')),
  remote_author_login TEXT,
  remote_assignees_json TEXT NOT NULL DEFAULT '[]',
  remote_labels_json TEXT NOT NULL DEFAULT '[]',
  remote_updated_at INTEGER NOT NULL,
  synced_at INTEGER NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'synced' CHECK (sync_status IN ('synced', 'error')),
  remote_closed_while_running INTEGER NOT NULL DEFAULT 0
    CHECK (remote_closed_while_running IN (0, 1)),
  remote_reopened INTEGER NOT NULL DEFAULT 0 CHECK (remote_reopened IN (0, 1)),
  UNIQUE (project_id, provider, host, repo, external_number),
  UNIQUE (provider, host, external_id)
);

CREATE INDEX idx_issue_external_refs_project_id
  ON issue_external_refs(project_id, provider, remote_updated_at DESC);
