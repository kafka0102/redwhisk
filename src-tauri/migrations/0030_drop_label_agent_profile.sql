-- Label 不再关联 Agent：删除 agent_profile_id 列。
-- workflow_skill 语义从 "agent default_skill 中的名" 改为 "saved_agent_skills.name"，
-- 旧值不可直接映射，置 NULL 由用户在 Label 表单重新选择。
UPDATE project_labels SET workflow_skill = NULL WHERE workflow_skill IS NOT NULL;
ALTER TABLE project_labels DROP COLUMN agent_profile_id;
