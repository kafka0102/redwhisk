ALTER TABLE projects
ADD COLUMN completion_policy TEXT NOT NULL DEFAULT 'manual'
CHECK (completion_policy IN ('manual', 'agent_auto_commit'));
