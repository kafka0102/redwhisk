-- 中立化 Provider 会话标识：列名从 codex_session_id 迁为 provider_session_id，存量值原样保留。
ALTER TABLE agent_sessions RENAME COLUMN codex_session_id TO provider_session_id;
