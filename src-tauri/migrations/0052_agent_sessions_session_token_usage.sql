-- Session Token 消耗：Session 记录上的输入 / 输出 / 缓存累计值。
-- NULL 表示尚未收到用量；0 表示已收到且为 0。历史 Session 不回填。
ALTER TABLE agent_sessions ADD COLUMN token_input INTEGER;
ALTER TABLE agent_sessions ADD COLUMN token_output INTEGER;
ALTER TABLE agent_sessions ADD COLUMN token_cache INTEGER;
