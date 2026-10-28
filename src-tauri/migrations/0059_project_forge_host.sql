-- Existing projects have no saved host class. Leave them as other; do not probe git.
ALTER TABLE projects ADD COLUMN forge_host TEXT NOT NULL DEFAULT 'other'
  CHECK (forge_host IN ('github', 'gitlab', 'other'));
