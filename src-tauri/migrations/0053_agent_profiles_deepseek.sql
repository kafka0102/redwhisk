-- 扩 agent_profiles.agent_type CHECK，允许 deepseek。
-- CHECK 不能 ALTER，沿用 sqlite_schema 改写。

UPDATE sqlite_schema
SET sql = replace(
  sql,
  'agent_type TEXT NOT NULL CHECK (agent_type IN (''codex'', ''claude'', ''opencode'', ''grok''))',
  'agent_type TEXT NOT NULL CHECK (agent_type IN (''codex'', ''claude'', ''opencode'', ''grok'', ''deepseek''))'
)
WHERE type = 'table'
  AND name = 'agent_profiles'
  AND sql LIKE '%agent_type TEXT NOT NULL CHECK (agent_type IN (''codex'', ''claude'', ''opencode'', ''grok''))%';

PRAGMA schema_version = 530000;
