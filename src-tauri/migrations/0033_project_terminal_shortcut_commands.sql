CREATE TABLE IF NOT EXISTS project_terminal_shortcut_commands (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL,
  command TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_terminal_shortcut_commands_project_id
  ON project_terminal_shortcut_commands (project_id);
