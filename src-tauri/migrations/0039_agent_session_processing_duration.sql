-- 记录 session 的累计处理耗时（按 App 活跃时长累加，排除系统睡眠/关机与用户交互等待）。
-- - turn_started_at：当前 turn 开始时刻，供后台活跃时长心跳做边界夹取与诊断。
-- - processing_ms：会话活跃处理时长累计毫秒数（由后台心跳独占写入，含进行中的 turn）。
-- - last_output_at：最后一次 turn 输出完成时刻，作为详情中"完成时间"展示。
ALTER TABLE agent_sessions ADD COLUMN turn_started_at INTEGER;
ALTER TABLE agent_sessions ADD COLUMN processing_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_sessions ADD COLUMN last_output_at INTEGER;
