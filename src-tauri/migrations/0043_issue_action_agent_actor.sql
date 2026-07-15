ALTER TABLE issue_actions ADD COLUMN actor_agent_profile_id INTEGER REFERENCES agent_profiles(id);
ALTER TABLE issue_actions ADD COLUMN actor_agent_name_snapshot TEXT;
