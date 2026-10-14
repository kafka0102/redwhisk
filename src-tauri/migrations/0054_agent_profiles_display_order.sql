-- 智能体显示顺序（ADR-0051）。全应用一份，项目级与全局级共用。
-- 存量行先留 NULL，由列表读取时按「启用在前、同组 id 升序」回填。
-- 软删行不参与显示顺序，保持 NULL。

ALTER TABLE agent_profiles
ADD COLUMN display_order INTEGER;

CREATE INDEX IF NOT EXISTS idx_agent_profiles_active_display_order
ON agent_profiles (display_order ASC, id ASC)
WHERE del = 0;
