-- Widen issue_external_refs.sync_status. Published 0061 only allows
-- synced and error, and SQLite cannot alter a CHECK in place.
CREATE TABLE issue_external_refs_next (
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
  sync_status TEXT NOT NULL DEFAULT 'synced' CHECK (
    sync_status IN ('synced', 'error', 'unavailable', 'kept_local', 'unlinked')
  ),
  remote_closed_while_running INTEGER NOT NULL DEFAULT 0
    CHECK (remote_closed_while_running IN (0, 1)),
  remote_reopened INTEGER NOT NULL DEFAULT 0 CHECK (remote_reopened IN (0, 1)),
  UNIQUE (project_id, provider, host, repo, external_number),
  UNIQUE (provider, host, external_id)
);

INSERT INTO issue_external_refs_next (
  issue_id, project_id, provider, host, repo, external_id, external_number,
  external_url, remote_state, remote_author_login, remote_assignees_json,
  remote_labels_json, remote_updated_at, synced_at, sync_status,
  remote_closed_while_running, remote_reopened
)
SELECT
  issue_id, project_id, provider, host, repo, external_id, external_number,
  external_url, remote_state, remote_author_login, remote_assignees_json,
  remote_labels_json, remote_updated_at, synced_at, sync_status,
  remote_closed_while_running, remote_reopened
FROM issue_external_refs;

DROP TABLE issue_external_refs;
ALTER TABLE issue_external_refs_next RENAME TO issue_external_refs;

CREATE INDEX idx_issue_external_refs_project_id
  ON issue_external_refs(project_id, provider, remote_updated_at DESC);
