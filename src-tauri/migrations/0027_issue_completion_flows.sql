ALTER TABLE agent_sessions ADD COLUMN origin_branch TEXT;
ALTER TABLE agent_sessions ADD COLUMN worktree_owner TEXT NOT NULL DEFAULT 'external'
CHECK (worktree_owner IN ('redwhisk', 'external'));

UPDATE agent_sessions
SET origin_branch = COALESCE(target_branch, workspace_branch, ''),
    worktree_owner = CASE
      WHEN workspace_mode = 'worktree'
       AND workspace_path IS NOT NULL
       AND workspace_branch IS NOT NULL
      THEN 'redwhisk'
      ELSE 'external'
    END;

CREATE TABLE IF NOT EXISTS issue_completion_flows (
  id INTEGER PRIMARY KEY,
  issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  session_id INTEGER REFERENCES agent_sessions(id) ON DELETE SET NULL,
  phase TEXT NOT NULL CHECK (phase IN (
    'checking_dirty',
    'waiting_agent_commit',
    'manual_dirty_blocked',
    'checking_branch',
    'confirming_external_worktree',
    'rebasing',
    'agent_merge_blocked',
    'completed'
  )),
  ignore_dirty INTEGER NOT NULL DEFAULT 0 CHECK (ignore_dirty IN (0, 1)),
  external_worktree_decision TEXT CHECK (
    external_worktree_decision IS NULL
    OR external_worktree_decision IN ('merge_and_delete', 'skip', 'cancel')
  ),
  base_branch TEXT,
  workspace_branch TEXT,
  workspace_path TEXT,
  failure_reason TEXT,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_issue_completion_flows_issue_id
ON issue_completion_flows(issue_id);
