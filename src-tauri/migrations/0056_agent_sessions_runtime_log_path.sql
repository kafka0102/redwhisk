-- 完成后保留运行日志路径，只读 TUI 回放用它，不跟归档文件混用。
ALTER TABLE agent_sessions ADD COLUMN runtime_log_path TEXT;
