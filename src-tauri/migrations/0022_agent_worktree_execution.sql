ALTER TABLE projects ADD COLUMN worktree_location TEXT NOT NULL DEFAULT 'repo_sibling';
ALTER TABLE projects ADD COLUMN worktree_setup_command TEXT NOT NULL DEFAULT '';

ALTER TABLE agent_sessions ADD COLUMN workspace_mode TEXT NOT NULL DEFAULT 'current_branch';
ALTER TABLE agent_sessions ADD COLUMN target_branch TEXT;
ALTER TABLE agent_sessions ADD COLUMN workspace_branch TEXT;
ALTER TABLE agent_sessions ADD COLUMN workspace_path TEXT;
ALTER TABLE agent_sessions ADD COLUMN completion_policy TEXT;
ALTER TABLE agent_sessions ADD COLUMN worktree_root_path TEXT;
ALTER TABLE agent_sessions ADD COLUMN worktree_setup_command TEXT;
