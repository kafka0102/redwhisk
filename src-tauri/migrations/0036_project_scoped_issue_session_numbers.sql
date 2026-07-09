-- 0036_project_scoped_issue_session_numbers.sql
-- 为 issues 与 agent_sessions 新增项目内不可逆递增编号 number，并回填历史数据。
-- 跨边界寻址仍用全局 id；number 仅用于展示与命名（日志路径、worktree、附件目录）。
ALTER TABLE issues ADD COLUMN number INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_sessions ADD COLUMN number INTEGER NOT NULL DEFAULT 0;

-- 回填 issues：按 project 分组、(created_at, id) 排序赋号。
-- 使用相关子查询计数，不依赖窗口函数（兼容低版本 SQLite）。该 UPDATE 幂等，可重复执行。
UPDATE issues
SET number = (
  SELECT COUNT(*) + 1
  FROM issues AS i2
  WHERE i2.project_id = issues.project_id
    AND (
      i2.created_at < issues.created_at
      OR (i2.created_at = issues.created_at AND i2.id < issues.id)
    )
);

-- 回填 agent_sessions：按 project 分组、(started_at, id) 排序赋号。
UPDATE agent_sessions
SET number = (
  SELECT COUNT(*) + 1
  FROM agent_sessions AS s2
  WHERE s2.project_id = agent_sessions.project_id
    AND (
      s2.started_at < agent_sessions.started_at
      OR (s2.started_at = agent_sessions.started_at AND s2.id < agent_sessions.id)
    )
);

-- 唯一索引 uidx_issues_project_id_number / uidx_agent_sessions_project_id_number
-- 不在本 migration 创建：在 repository 开始为新建行分配 number（MAX(number)+1）之前，
-- 加唯一索引会让未分配 number（默认 0）的多次插入直接触发 UNIQUE 冲突。
-- 这些索引随编号分配逻辑（issues / agent_sessions repository）在后续 migration 一并落库，
-- 落库前先重跑上面的幂等回填 UPDATE，以消除过渡期产生的 number=0 重复行。
