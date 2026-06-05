PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS projects_integer_migration (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  repo_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_opened_at INTEGER NOT NULL
);

INSERT INTO projects_integer_migration (id, name, repo_path, created_at, last_opened_at)
SELECT
  CASE
    WHEN typeof(id) = 'integer' THEN id
    ELSE NULL
  END,
  name,
  repo_path,
  CASE
    WHEN typeof(created_at) = 'integer' THEN created_at
    ELSE CAST(unixepoch(created_at) AS INTEGER) * 1000
  END,
  CASE
    WHEN typeof(last_opened_at) = 'integer' THEN last_opened_at
    ELSE CAST(unixepoch(last_opened_at) AS INTEGER) * 1000
  END
FROM projects
;

DROP TABLE projects;

ALTER TABLE projects_integer_migration RENAME TO projects;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_projects_repo_path ON projects (repo_path);

PRAGMA foreign_keys = ON;
