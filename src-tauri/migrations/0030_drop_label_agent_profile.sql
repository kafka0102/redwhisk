-- Label 不再关联 Agent：删除 agent_profile_id 列。
-- workflow_skill 语义从 "agent default_skill 中的名" 改为 "saved_agent_skills.name"，
-- 旧值不可直接映射，置 NULL 由用户在 Label 表单重新选择。
UPDATE project_labels SET workflow_skill = NULL WHERE workflow_skill IS NOT NULL;

-- SQLite 不允许 DROP COLUMN 被 FOREIGN KEY 引用的列，走表重建。
CREATE TABLE project_labels_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('global', 'project')),
  project_id INTEGER,
  color TEXT NOT NULL,
  workflow_skill TEXT,
  del INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

INSERT INTO project_labels_new (id, name, scope, project_id, color, workflow_skill, del, created_at, updated_at)
SELECT id, name, scope, project_id, color, workflow_skill, del, created_at, updated_at FROM project_labels;

DROP TABLE project_labels;
ALTER TABLE project_labels_new RENAME TO project_labels;
