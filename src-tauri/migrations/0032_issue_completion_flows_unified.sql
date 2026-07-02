-- 重写 issue 完成流程状态机：
-- 移除 manual / agent_auto_commit policy 二分 phase，改为「完成时统一检测实际路径 +
-- 未提交改动 → 弹框决策（自动提交 / 不提交 / 取消）」的统一 phase 流。
-- 旧 phase 值不再合法；进行中的 flow 直接清空，用户重新触发完成即可恢复。
DROP INDEX IF EXISTS idx_issue_completion_flows_issue_id;
DROP TABLE issue_completion_flows;

CREATE TABLE issue_completion_flows (
  id INTEGER PRIMARY KEY,
  issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  session_id INTEGER REFERENCES agent_sessions(id) ON DELETE SET NULL,
  phase TEXT NOT NULL CHECK (phase IN (
    'detecting_workspace',
    'prompting_dirty_decision',
    'auto_committing',
    'confirming_continue_after_commit',
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_issue_completion_flows_issue_id
ON issue_completion_flows(issue_id);
