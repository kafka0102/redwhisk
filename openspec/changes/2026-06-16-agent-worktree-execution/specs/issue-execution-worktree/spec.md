## ADDED Requirements

### Requirement: Worktree-backed issue execution
The runtime SHALL support launching an issue agent session inside a dedicated git worktree derived from a selected local target branch.

#### Scenario: Starting an issue in worktree mode
- **WHEN** the user starts a backlog issue with development mode `Worktree`
- **THEN** the runtime records the selected target branch, completion policy snapshot, and workspace mode for that session
- **AND** creates a worktree under the agent profile's configured `Worktree path`
- **AND** creates a temporary development branch inside that worktree using the issue ID as the naming base
- **AND** launches the agent session inside that worktree directory

#### Scenario: Starting an issue in current branch mode
- **WHEN** the user starts a backlog issue with development mode `Current branch`
- **THEN** the runtime records the selected completion policy snapshot and workspace mode for that session
- **AND** launches the agent session in the project's primary repository path without creating a worktree

### Requirement: Worktree completion merge-back and cleanup
When an issue session used a temporary worktree, completion SHALL merge the worktree branch back to the selected target branch before cleanup.

#### Scenario: Completing a worktree-backed issue whose branch is not yet merged
- **WHEN** a review or auto-commit completion flow runs for a session created in `Worktree` mode
- **AND** the temporary development branch is not yet merged into the recorded target branch
- **THEN** the runtime attempts to merge the temporary branch into the target branch
- **AND** only after a successful merge does it delete the temporary branch and remove the worktree

#### Scenario: Completing a worktree-backed issue whose branch is already merged
- **WHEN** the temporary development branch is already contained in the recorded target branch
- **THEN** the runtime skips the merge step
- **AND** still deletes the temporary branch and removes the worktree

#### Scenario: Blocking completion when merge-back fails
- **WHEN** the merge-back step encounters conflicts or another git failure
- **THEN** the issue remains in `review`
- **AND** the runtime records a failure reason describing the blocked merge or cleanup step
- **AND** it does not delete the temporary branch or worktree as if completion had succeeded
