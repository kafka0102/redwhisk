-- Existing projects skip the completion-action prompt. Do not rewrite pr_draft.
ALTER TABLE projects ADD COLUMN confirm_completion_action INTEGER NOT NULL DEFAULT 0;
