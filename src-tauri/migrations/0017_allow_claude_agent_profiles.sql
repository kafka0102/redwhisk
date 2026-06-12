PRAGMA foreign_keys = OFF;

CREATE TABLE agent_profiles_new (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  agent_type TEXT NOT NULL CHECK (agent_type IN ('codex', 'claude')),
  command TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('project', 'global')),
  project_id INTEGER,
  mode TEXT NOT NULL DEFAULT 'full-auto',
  dangerous INTEGER NOT NULL DEFAULT 1 CHECK (dangerous IN (0, 1)),
  default_skill TEXT NOT NULL DEFAULT '',
  prompt_template TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

INSERT INTO agent_profiles_new (
  id,
  name,
  agent_type,
  command,
  scope,
  project_id,
  mode,
  dangerous,
  default_skill,
  prompt_template
)
SELECT
  id,
  name,
  agent_type,
  command,
  scope,
  project_id,
  mode,
  dangerous,
  default_skill,
  prompt_template
FROM agent_profiles;

DROP TABLE agent_profiles;
ALTER TABLE agent_profiles_new RENAME TO agent_profiles;

PRAGMA foreign_keys = ON;
