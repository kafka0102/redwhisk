CREATE TABLE saved_agent_skills (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    scope TEXT NOT NULL,
    project_id INTEGER,
    skill_paths_json TEXT NOT NULL,
    del INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_saved_agent_skills_unique_name
    ON saved_agent_skills (name, scope, COALESCE(project_id, 0), del)
WHERE del = 0;
