CREATE TABLE IF NOT EXISTS project_terminal_configs (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  working_dir TEXT NOT NULL,
  launch_command TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_terminal_configs_project_id
  ON project_terminal_configs (project_id);
