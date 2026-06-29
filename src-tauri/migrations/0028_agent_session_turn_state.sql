ALTER TABLE agent_sessions
ADD COLUMN is_turn_running INTEGER NOT NULL DEFAULT 0;
