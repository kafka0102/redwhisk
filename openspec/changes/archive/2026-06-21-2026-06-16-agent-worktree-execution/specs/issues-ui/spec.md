## MODIFIED Requirements

### Requirement: Backlog run dialog compact width
The Issues page SHALL keep the compact backlog run dialog width while extending the run flow with execution context controls.

#### Scenario: Starting a backlog issue
- **WHEN** the user clicks the run icon or `Run` action for a backlog issue
- **THEN** the run dialog opens with a compact width variant
- **AND** the run dialog shows agent profile selection, workflow skill, commit strategy, development mode, target branch, and final prompt

## ADDED Requirements

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
- **AND** the available options exclude branches currently checked out by other worktrees
- **AND** the available options exclude temporary issue worktree branches
- **AND** the selected branch represents the final target branch for merge-back

#### Scenario: Showing worktree startup progress
- **WHEN** the user starts an issue in `Worktree` mode
- **THEN** the run dialog may close after submission
- **AND** the UI shows a progress surface for creating the worktree, running setup, and launching the agent session
- **AND** the app does not immediately navigate to Settings while these startup steps are still running

#### Scenario: Worktree setup command fails
- **WHEN** the worktree is created but the configured setup command fails
- **THEN** the UI shows the setup failure reason
- **AND** the agent session is not launched
- **AND** the issue remains available for the user to run again after fixing the configuration

### Requirement: Issue completion git safety prompts
The Issues page SHALL gate Done / Completed actions on commit status and merge confirmation before changing the issue to completed.

#### Scenario: Manual commit policy blocks Done with dirty related files
- **WHEN** the user marks an issue as `Done`
- **AND** the associated session has related uncommitted changes
- **AND** the session completion policy is `manual`
- **THEN** the app shows a dialog telling the user that the branch has uncommitted code and must be committed before marking the issue complete
- **AND** the issue remains in `review`

#### Scenario: Auto commit policy sends localized agent prompt
- **WHEN** the user marks an issue as `Done`
- **AND** the associated session has related uncommitted changes
- **AND** the session completion policy is `agent_auto_commit`
- **THEN** the app sends a localized prompt to the current agent session asking it to collect and commit only code related to the current issue
- **AND** the app waits asynchronously for the commit to be detected before continuing completion

#### Scenario: Confirming merge into target branch
- **WHEN** the user marks a worktree-backed issue as `Done`
- **AND** the recorded worktree still exists
- **THEN** the app shows a confirmation dialog before merging the temporary branch into the recorded target branch
- **AND** the dialog names the target branch
- **AND** target branches named `main` or `master` use a higher-risk confirmation message
- **AND** non-main target branches still require confirmation

#### Scenario: Showing merge-back progress
- **WHEN** the user confirms completion for a worktree-backed issue
- **THEN** the app shows progress for checking commits, checking the worktree, merging the temporary branch, and cleaning up the worktree
- **AND** progress updates are shown while the asynchronous merge-back flow is running

#### Scenario: Routing merge conflicts to the current agent session
- **WHEN** merge-back detects conflicts
- **THEN** the progress surface closes
- **AND** the issue remains in `review`
- **AND** if the user is already viewing the current session, the app stays on that page
- **AND** if the user is not viewing the current session, the app navigates to that session
- **AND** the app sends an agent prompt describing the conflict and asking the agent to resolve it and merge into the originally recorded target branch
