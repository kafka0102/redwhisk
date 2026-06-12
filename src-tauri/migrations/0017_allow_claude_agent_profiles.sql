UPDATE sqlite_schema
SET sql = replace(
  sql,
  'agent_type TEXT NOT NULL CHECK (agent_type IN (''codex''))',
  'agent_type TEXT NOT NULL CHECK (agent_type IN (''codex'', ''claude''))'
)
WHERE type = 'table'
  AND name = 'agent_profiles'
  AND sql LIKE '%agent_type TEXT NOT NULL CHECK (agent_type IN (''codex''))%';

PRAGMA schema_version = 170000;
