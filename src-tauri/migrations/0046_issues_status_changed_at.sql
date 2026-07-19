-- 0046_issues_status_changed_at.sql
-- 看板四个甬道（backlog / running / review / completed）改按「进入当前状态的时间」
-- 降序排列；新增 issues.status_changed_at 列承载该语义，与任意字段更新都刷新的
-- updated_at 职责分离。详见 docs/adr/0017-issue-status-since-sort.md。
ALTER TABLE issues ADD COLUMN status_changed_at INTEGER NOT NULL DEFAULT 0;

-- 回填存量行：取该 Issue 在 issue_actions 中状态相关动作
-- （agent_session_started / issue_review_marked / issue_completed / issue_status_changed）
-- 的最大 created_at；无任何记录则退回 updated_at（语义最接近的存量字段）。
UPDATE issues
SET status_changed_at = COALESCE((
  SELECT MAX(ia.created_at)
  FROM issue_actions AS ia
  WHERE ia.issue_id = issues.id
    AND ia.action_type IN (
      'agent_session_started', 'issue_review_marked',
      'issue_completed', 'issue_status_changed'
    )
), issues.updated_at);
