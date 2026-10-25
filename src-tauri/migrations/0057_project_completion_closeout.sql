-- 项目完成后的默认动作，以及 Issue 上记下的 PR/MR 链接。
ALTER TABLE projects ADD COLUMN completion_action TEXT NOT NULL DEFAULT 'merge_to_base';
ALTER TABLE projects ADD COLUMN pr_target TEXT NOT NULL DEFAULT 'issue_base';
ALTER TABLE projects ADD COLUMN pr_draft INTEGER NOT NULL DEFAULT 1;

CREATE TABLE issue_pull_requests (
  issue_id INTEGER PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 完成选择是新的可持久化 phase。SQLite 不能改 CHECK，重建表并保留进行中的 flow。
PRAGMA foreign_keys = OFF;

CREATE TABLE issue_completion_flows_v2 (
  id INTEGER PRIMARY KEY,
  issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  session_id INTEGER REFERENCES agent_sessions(id) ON DELETE SET NULL,
  phase TEXT NOT NULL CHECK (phase IN (
    'detecting_workspace',
    'prompting_dirty_decision',
    'auto_committing',
    'confirming_continue_after_commit',
    'prompting_closeout_action',
    'reconciling_worktree',
    'confirming_worktree_cleanup',
    'completed',
    'cancelled',
    'blocked'
  )),
  ignore_dirty INTEGER NOT NULL DEFAULT 0 CHECK (ignore_dirty IN (0, 1)),
  dirty_decision TEXT CHECK (
    dirty_decision IS NULL
    OR dirty_decision IN ('auto_commit', 'skip', 'cancel')
  ),
  continue_after_commit INTEGER CHECK (
    continue_after_commit IS NULL OR continue_after_commit IN (0, 1)
  ),
  worktree_cleanup_decision INTEGER CHECK (
    worktree_cleanup_decision IS NULL OR worktree_cleanup_decision IN (0, 1)
  ),
  base_branch TEXT,
  workspace_branch TEXT,
  workspace_path TEXT,
  actual_path TEXT,
  failure_reason TEXT,
  updated_at INTEGER NOT NULL
);

INSERT INTO issue_completion_flows_v2 (
  id, issue_id, session_id, phase, ignore_dirty, dirty_decision,
  continue_after_commit, worktree_cleanup_decision, base_branch,
  workspace_branch, workspace_path, actual_path, failure_reason, updated_at
)
SELECT
  id, issue_id, session_id, phase, ignore_dirty, dirty_decision,
  continue_after_commit, worktree_cleanup_decision, base_branch,
  workspace_branch, workspace_path, actual_path, failure_reason, updated_at
FROM issue_completion_flows;

DROP TABLE issue_completion_flows;
ALTER TABLE issue_completion_flows_v2 RENAME TO issue_completion_flows;

CREATE UNIQUE INDEX IF NOT EXISTS idx_issue_completion_flows_issue_id
ON issue_completion_flows(issue_id);

PRAGMA foreign_keys = ON;
