-- 重构 agent_profiles：取消 override 继承逻辑，改为 scope + project_id 同级管理
-- 新增 mode 和 dangerous 字段替代 default_args

DROP TABLE IF EXISTS project_agent_overrides;
DROP TABLE IF EXISTS agent_profiles;

CREATE TABLE agent_profiles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  agent_type TEXT NOT NULL CHECK (agent_type IN ('codex')),
  command TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('project', 'global')),
  project_id INTEGER,
  mode TEXT NOT NULL DEFAULT 'full-auto',
  dangerous INTEGER NOT NULL DEFAULT 1 CHECK (dangerous IN (0, 1)),
  default_skill TEXT NOT NULL DEFAULT '',
  prompt_template TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
