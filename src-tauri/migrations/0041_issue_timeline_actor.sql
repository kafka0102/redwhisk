PRAGMA foreign_keys = OFF;

CREATE TABLE user_profiles_next (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  avatar_path TEXT
);

INSERT INTO user_profiles_next (id, name, avatar_path)
SELECT id, name, avatar_path FROM user_profiles;

DROP TABLE user_profiles;
ALTER TABLE user_profiles_next RENAME TO user_profiles;

INSERT OR IGNORE INTO user_profiles (id, name) VALUES (1, '');

ALTER TABLE issue_actions ADD COLUMN actor_kind TEXT NOT NULL DEFAULT 'user';
ALTER TABLE issue_actions ADD COLUMN actor_user_profile_id INTEGER REFERENCES user_profiles(id);

UPDATE issue_actions
SET actor_user_profile_id = 1
WHERE actor_kind = 'user' AND actor_user_profile_id IS NULL;

PRAGMA foreign_keys = ON;
