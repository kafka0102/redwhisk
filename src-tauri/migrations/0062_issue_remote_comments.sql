-- Remote comments stay out of issue_comments so they do not use
-- UNIQUE(linked_session_id, linked_turn_id).
CREATE TABLE issue_remote_comments (
  id INTEGER PRIMARY KEY,
  issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  remote_comment_id TEXT NOT NULL,
  author_login TEXT NOT NULL,
  author_display_name TEXT,
  author_avatar_url TEXT,
  body TEXT NOT NULL,
  remote_created_at INTEGER NOT NULL,
  remote_updated_at INTEGER NOT NULL,
  UNIQUE (issue_id, remote_comment_id)
);

-- Remote system events stay out of issue_actions and issue_comments.
CREATE TABLE issue_remote_events (
  id INTEGER PRIMARY KEY,
  issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  remote_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_login TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  remote_created_at INTEGER NOT NULL,
  UNIQUE (issue_id, remote_event_id)
);
