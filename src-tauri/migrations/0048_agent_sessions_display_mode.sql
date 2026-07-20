-- Session 展示形式快照：启动时从 profile 拷贝，会话存续期只认快照。
ALTER TABLE agent_sessions
ADD COLUMN display_mode TEXT NOT NULL DEFAULT 'json'
  CHECK (display_mode IN ('json', 'tui'));
