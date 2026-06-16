## MODIFIED Requirements

### Requirement: Backlog run dialog compact width
The Issues page SHALL keep the compact backlog run dialog width while extending the run flow with execution context controls.

#### Scenario: Starting a backlog issue
- **WHEN** the user clicks the run icon or `Run` action for a backlog issue
- **THEN** the run dialog opens with a compact width variant
- **AND** the run dialog shows agent profile selection, workflow skill, commit strategy, development mode, target branch, and final prompt

### Requirement: Issue run dialog execution context
The backlog issue run dialog SHALL let the user override commit strategy and choose where code runs before starting the agent session.

#### Scenario: Defaulting commit strategy from the project
- **WHEN** the user opens the run dialog
- **THEN** the `Commit strategy` field defaults to the current project's configured completion policy
- **AND** the user may change it for this run without editing project settings

#### Scenario: Remembering the last development mode for a project
- **WHEN** the user previously started an issue in the same project with `Worktree` or `Current branch`
- **THEN** reopening the run dialog for that project restores the last selected development mode

#### Scenario: Locking branch selection in current branch mode
- **WHEN** the user selects `Current branch`
- **THEN** the branch selector is disabled
- **AND** its value is fixed to the repository's current local branch

#### Scenario: Allowing branch selection in worktree mode
- **WHEN** the user selects `Worktree`
- **THEN** the branch selector remains enabled
- **AND** the available options come from local repository branches
- **AND** the selected branch represents the final target branch for merge-back
