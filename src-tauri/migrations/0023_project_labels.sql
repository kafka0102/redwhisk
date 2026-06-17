CREATE TABLE IF NOT EXISTS project_labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('global', 'project')),
  project_id INTEGER,
  color TEXT NOT NULL,
  agent_profile_id INTEGER,
  workflow_skill TEXT,
  del INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (agent_profile_id) REFERENCES agent_profiles(id)
);
