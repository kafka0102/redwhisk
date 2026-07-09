-- 0037_issues_project_scoped_number_unique.sql
-- 为 issues 建立项目内 (project_id, number) 唯一索引，保证编号不可逆且不重复。
--
-- 背景：0036 已为历史行回填了项目内连续 number；但 0036 之后、本 migration 之前
-- 新建的 issue 仍走旧路径，number 默认为 0（过渡期行）。直接加唯一索引会让同一项目
-- 内多个 number=0 行触发 UNIQUE 冲突。因此必须先把 number=0 的过渡期行回填为
-- 项目内新序号，且不得改变任何已分配(>0)的 number（保证编号稳定），再加唯一索引。
--
-- 实现要点（顺序无关）：
--   先把每个 number=0 行的新 number 物化到临时表，再一次性 UPDATE。
--   新 number = 项目内已有最大正编号 + 1 + 该行在 number=0 集合中按 (created_at, id) 的位次。
--   物化阶段所有 number=0 行尚未被改动，子查询看到的是一致快照，结果与 UPDATE 扫描顺序无关。
--   幂等：number>0 的行不在物化集合内，永不被改写；无 number=0 行时临时表为空，UPDATE 空操作。

CREATE TABLE IF NOT EXISTS _issues_number_remap (
  row_id INTEGER PRIMARY KEY,
  new_number INTEGER NOT NULL
);

INSERT INTO _issues_number_remap (row_id, new_number)
SELECT t.id,
       COALESCE(
         (SELECT MAX(number) FROM issues WHERE project_id = t.project_id AND number > 0),
         0
       ) + 1
       + (
         SELECT COUNT(*) FROM issues AS z
         WHERE z.project_id = t.project_id
           AND z.number = 0
           AND (
             z.created_at < t.created_at
             OR (z.created_at = t.created_at AND z.id < t.id)
           )
       )
FROM issues AS t
WHERE t.number = 0;

UPDATE issues
SET number = (
  SELECT new_number FROM _issues_number_remap WHERE row_id = issues.id
)
WHERE EXISTS (SELECT 1 FROM _issues_number_remap WHERE row_id = issues.id);

DROP TABLE _issues_number_remap;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_issues_project_id_number
  ON issues (project_id, number);
