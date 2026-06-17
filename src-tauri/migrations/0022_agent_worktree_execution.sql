ALTER TABLE agent_profiles ADD COLUMN worktree_path TEXT NOT NULL DEFAULT '';

ALTER TABLE agent_sessions ADD COLUMN workspace_mode TEXT NOT NULL DEFAULT 'current_branch';
ALTER TABLE agent_sessions ADD COLUMN target_branch TEXT;
ALTER TABLE agent_sessions ADD COLUMN workspace_branch TEXT;
ALTER TABLE agent_sessions ADD COLUMN workspace_path TEXT;
ALTER TABLE agent_sessions ADD COLUMN completion_policy TEXT;
ALTER TABLE agent_sessions ADD COLUMN worktree_root_path TEXT;
