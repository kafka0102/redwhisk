CREATE TABLE IF NOT EXISTS agent_profiles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  agent_type TEXT NOT NULL CHECK (agent_type IN ('codex')),
  command TEXT NOT NULL,
  default_args TEXT NOT NULL,
  default_skill TEXT NOT NULL,
  prompt_template TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))
);

CREATE TABLE IF NOT EXISTS project_agent_overrides (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL,
  agent_profile_id INTEGER NOT NULL,
  default_args TEXT NOT NULL,
  default_skill TEXT NOT NULL,
  prompt_template TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  FOREIGN KEY (agent_profile_id) REFERENCES agent_profiles (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_project_agent_overrides_project_profile
ON project_agent_overrides (project_id, agent_profile_id);
