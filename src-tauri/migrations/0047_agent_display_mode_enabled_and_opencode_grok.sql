-- 扩 agent_type CHECK 到 codex/claude/opencode/grok；加 display_mode / enabled 列。
-- 标准 ALTER ADD COLUMN 先行；agent_type CHECK 不可用 ALTER 修改，
-- 仿 0017_allow_claude_agent_profiles.sql 的 sqlite_schema 改写 + PRAGMA schema_version 手法，放在 ALTER 之后。

ALTER TABLE agent_profiles
ADD COLUMN display_mode TEXT NOT NULL DEFAULT 'json' CHECK (display_mode IN ('json', 'tui'));

ALTER TABLE agent_profiles
ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1));

UPDATE sqlite_schema
SET sql = replace(
  sql,
  'agent_type TEXT NOT NULL CHECK (agent_type IN (''codex'', ''claude''))',
  'agent_type TEXT NOT NULL CHECK (agent_type IN (''codex'', ''claude'', ''opencode'', ''grok''))'
)
WHERE type = 'table'
  AND name = 'agent_profiles'
  AND sql LIKE '%agent_type TEXT NOT NULL CHECK (agent_type IN (''codex'', ''claude''))%';

PRAGMA schema_version = 470000;
