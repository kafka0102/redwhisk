## MODIFIED Requirements

### Requirement: Project general worktree settings
Project General settings SHALL own the worktree root location and worktree setup command for issue execution.

#### Scenario: Agent profile form does not expose worktree path
- **WHEN** the user opens the create-agent or edit-agent dialog
- **THEN** the dialog does not show a `Worktree path` field
- **AND** saving an agent profile does not submit a worktree path value

#### Scenario: Selecting a project worktree location
- **WHEN** the user opens Project General settings for a repository at `/workspace/kafka/redwhisk`
- **THEN** the `Worktree path` field is a select control
- **AND** it offers `/workspace/kafka/redwhisk.worktrees`
- **AND** it offers `/workspace/kafka/redwhisk/.worktrees`
- **AND** it offers `~/.redwhisk/worktrees/redwhisk`
- **AND** the saved value is one of `repo_sibling`, `repo_internal`, or `user_home`

#### Scenario: Worktree location options follow repository path changes
- **WHEN** the user changes the project repository path
- **THEN** the displayed worktree path options are recalculated from the new repository path
- **AND** the persisted value remains the selected enum rather than a full path

#### Scenario: Rejecting unsafe repository-internal worktree location
- **WHEN** the user saves Project General settings with `repo_internal`
- **AND** the repository has no `.gitignore` entry for `.worktrees/`
- **THEN** the save is rejected
- **AND** the project settings are not persisted

#### Scenario: Configuring worktree setup command
- **WHEN** the user opens Project General settings
- **THEN** the form shows a three-line `Worktree setup after creation` textarea below `Worktree path`
- **AND** the textarea stores the project default setup command
- **AND** an empty value is allowed
