CREATE TABLE tui_hook_registration_preference (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  registration_allowed INTEGER NOT NULL DEFAULT 0 CHECK (registration_allowed IN (0, 1))
);
