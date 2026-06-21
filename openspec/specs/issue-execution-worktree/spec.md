# issue-execution-worktree Specification

## Purpose
TBD - created by archiving change 2026-06-16-agent-worktree-execution. Update Purpose after archive.
## Requirements
### Requirement: Worktree-backed issue execution
The runtime SHALL support launching an issue agent session inside a dedicated git worktree derived from a selected local target branch.

#### Scenario: Starting an issue in worktree mode
- **WHEN** the user starts a backlog issue with development mode `Worktree`
- **THEN** the runtime records the selected target branch, completion policy snapshot, and workspace mode for that session
- **AND** resolves the worktree root from the project's configured worktree location enum and current repository path
- **AND** creates a worktree under that resolved root path
- **AND** creates a temporary development branch inside that worktree using the issue ID as the naming base
- **AND** names the worktree path using the `issue-{id}-...` pattern
- **AND** runs the captured setup command in the new worktree when one is configured
- **AND** waits for the setup command to finish before launching the agent session
- **AND** launches the agent session inside that worktree directory
- **AND** records the project default or run-level overridden worktree setup command as a session snapshot

#### Scenario: Starting an issue in current branch mode
- **WHEN** the user starts a backlog issue with development mode `Current branch`
- **THEN** the runtime records the selected completion policy snapshot and workspace mode for that session
- **AND** launches the agent session in the project's primary repository path without creating a worktree

### Requirement: Worktree completion merge-back and cleanup
When an issue session used a temporary worktree, completion SHALL merge the worktree branch back to the selected target branch before cleanup.

#### Scenario: Completing after the recorded worktree was already removed
- **WHEN** a review or auto-commit completion flow runs for a session created in `Worktree` mode
- **AND** the recorded worktree path no longer exists
- **THEN** the runtime skips worktree merge-back and cleanup
- **AND** continues the non-worktree completion checks that still apply to the issue

#### Scenario: Checking related commits before worktree merge-back
- **WHEN** a review or auto-commit completion flow runs for a session created in `Worktree` mode
- **AND** the recorded worktree path still exists
- **THEN** the runtime checks for uncommitted changes related to the current issue before merge-back
- **AND** manual completion policy blocks completion when related dirty files exist
- **AND** agent auto-commit policy injects a prompt into the current agent session and waits for a new commit before continuing

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

#### Scenario: Handing merge conflicts to the active agent session
- **WHEN** the merge-back step detects conflicts
- **THEN** the runtime emits enough failure detail for the frontend to route the user to the original agent session
- **AND** the current agent session receives a prompt asking it to resolve the conflicts and merge the temporary branch into the originally recorded target branch

### Requirement: Agent auto-commit prompt localization
Agent auto-commit completion SHALL send a language-appropriate prompt that limits the agent to files related to the current issue.

#### Scenario: Chinese auto-commit prompt
- **WHEN** global language is Chinese
- **AND** auto-commit completion needs the agent to commit related dirty files
- **THEN** the prompt asks the agent to "获取本次修改相关的代码"
- **AND** instructs the agent to stage and commit only files directly related to the current issue

#### Scenario: English auto-commit prompt
- **WHEN** global language is English
- **AND** auto-commit completion needs the agent to commit related dirty files
- **THEN** the prompt asks the agent to collect the code changes related to this issue
- **AND** instructs the agent not to include unrelated changes
