ALTER TABLE projects ADD COLUMN issue_source_mode TEXT NOT NULL DEFAULT 'local'
  CHECK (issue_source_mode IN ('local', 'remote', 'mixed'));
ALTER TABLE projects ADD COLUMN issue_sync_scope TEXT NOT NULL DEFAULT 'assigned_to_me'
  CHECK (issue_sync_scope IN ('assigned_to_me', 'all_open', 'label', 'all'));
ALTER TABLE projects ADD COLUMN issue_sync_label TEXT;
ALTER TABLE projects ADD COLUMN issue_sync_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (issue_sync_enabled IN (0, 1));
ALTER TABLE projects ADD COLUMN issue_sync_interval_seconds INTEGER NOT NULL DEFAULT 90
  CHECK (issue_sync_interval_seconds >= 60);
ALTER TABLE projects ADD COLUMN issue_writeback_close_on_complete INTEGER NOT NULL DEFAULT 1
  CHECK (issue_writeback_close_on_complete IN (0, 1));
ALTER TABLE projects ADD COLUMN issue_writeback_close_on_pr_merge INTEGER NOT NULL DEFAULT 1
  CHECK (issue_writeback_close_on_pr_merge IN (0, 1));
ALTER TABLE projects ADD COLUMN issue_writeback_comment INTEGER NOT NULL DEFAULT 1
  CHECK (issue_writeback_comment IN (0, 1));
ALTER TABLE projects ADD COLUMN issue_create_source TEXT NOT NULL DEFAULT 'local'
  CHECK (issue_create_source IN ('local', 'remote'));

ALTER TABLE issues ADD COLUMN source TEXT NOT NULL DEFAULT 'local'
  CHECK (source IN ('local', 'remote'));

CREATE TABLE project_forge_connections (
  project_id INTEGER PRIMARY KEY,
  provider TEXT CHECK (provider IN ('github', 'gitlab')),
  host_url TEXT,
  repo_path TEXT,
  login TEXT,
  auth_kind TEXT NOT NULL DEFAULT 'cli' CHECK (auth_kind IN ('cli')),
  auth_status TEXT NOT NULL CHECK (auth_status IN (
    'unknown',
    'ready',
    'expired',
    'unauthenticated',
    'cli_missing',
    'not_forge'
  )),
  scopes_json TEXT NOT NULL DEFAULT '[]',
  cli_installed INTEGER NOT NULL DEFAULT 0 CHECK (cli_installed IN (0, 1)),
  cli_authenticated INTEGER NOT NULL DEFAULT 0 CHECK (cli_authenticated IN (0, 1)),
  checked_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
