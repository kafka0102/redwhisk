-- 运行参数模型：Agent Session 启动时认定并冻结的模型快照。
ALTER TABLE agent_sessions
ADD COLUMN startup_model TEXT;
