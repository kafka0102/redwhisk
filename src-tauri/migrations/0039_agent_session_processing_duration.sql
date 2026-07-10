-- 记录 session 的实际处理耗时（累加各 turn，排除用户交互等待）。
-- - turn_started_at：当前 turn 开始时刻，turn 结束后用于累加 processing_ms。
-- - processing_ms：已正常完成 turn 的累计处理毫秒数（crashed/stopped 不累加）。
-- - last_output_at：最后一次 turn 输出完成时刻，作为详情中"完成时间"展示。
ALTER TABLE agent_sessions ADD COLUMN turn_started_at INTEGER;
ALTER TABLE agent_sessions ADD COLUMN processing_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_sessions ADD COLUMN last_output_at INTEGER;
