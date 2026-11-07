CREATE TABLE change_requests (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'gitlab')),
  host TEXT NOT NULL,
  repo TEXT NOT NULL,
  external_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK (state IN ('open', 'draft', 'merged', 'closed')),
  author_login TEXT,
  author_avatar_url TEXT,
  source_branch TEXT NOT NULL,
  target_branch TEXT NOT NULL,
  mergeable TEXT,
  merge_state_status TEXT,
  review_decision TEXT,
  requested_reviewers_json TEXT NOT NULL DEFAULT '[]',
  checks_ok INTEGER,
  checks_failed INTEGER,
  checks_pending INTEGER,
  remote_created_at INTEGER,
  remote_updated_at INTEGER NOT NULL,
  synced_at INTEGER NOT NULL,
  detail_synced_at INTEGER,
  etag TEXT,
  UNIQUE (project_id, provider, host, repo, number),
  UNIQUE (provider, host, external_id)
);

CREATE TABLE change_request_issue_links (
  change_request_id INTEGER NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
  issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  link_kind TEXT NOT NULL CHECK (link_kind IN ('closing', 'mentioned', 'branch', 'manual')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (change_request_id, issue_id)
);

CREATE TABLE change_request_details (
  change_request_id INTEGER PRIMARY KEY REFERENCES change_requests(id) ON DELETE CASCADE,
  files_json TEXT NOT NULL DEFAULT '[]',
  checks_json TEXT NOT NULL DEFAULT '[]',
  reviews_json TEXT NOT NULL DEFAULT '[]',
  comments_json TEXT NOT NULL DEFAULT '[]',
  fetched_at INTEGER NOT NULL
);

ALTER TABLE issue_pull_requests ADD COLUMN change_request_id INTEGER REFERENCES change_requests(id) ON DELETE SET NULL;
