## MODIFIED Requirements

### Requirement: New agent dialog fields
The create-agent and edit-agent dialogs SHALL expose a worktree root path field alongside the primary agent configuration fields.

#### Scenario: Creating an agent with a default worktree path
- **WHEN** the user clicks `+ New agent` from a project settings context
- **THEN** the dialog shows fields ordered as Name, Type, Command, Scope, Workflow Skill, and Worktree path
- **AND** `Worktree path` defaults to `<current project repo path>.worktrees`
- **AND** the default path may be saved even when that directory does not yet exist

#### Scenario: Editing an existing agent
- **WHEN** the user opens an existing agent profile for editing
- **THEN** the dialog preloads the saved `Worktree path` value
- **AND** saving preserves that value unless the user changes it

#### Scenario: Rejecting a missing custom worktree path
- **WHEN** the user changes `Worktree path` away from the default derived value
- **AND** the entered directory does not exist
- **THEN** the dialog shows an inline validation error
- **AND** the `Save` action is blocked until the path is corrected

#### Scenario: Allowing the default derived path to be absent
- **WHEN** the current `Worktree path` exactly matches `<current project repo path>.worktrees`
- **AND** that directory does not exist yet
- **THEN** the dialog does not show a blocking validation error
- **AND** saving remains allowed
