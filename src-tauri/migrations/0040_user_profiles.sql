CREATE TABLE user_profiles (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT '',
  avatar_path TEXT
);
