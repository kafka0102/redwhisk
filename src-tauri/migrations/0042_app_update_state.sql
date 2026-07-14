CREATE TABLE app_update_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  snooze_until TEXT,
  ignored_version TEXT,
  last_checked_at TEXT,
  cached_latest_version TEXT,
  cached_release_url TEXT
);
