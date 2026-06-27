## MODIFIED Requirements

### Requirement: Worktree-backed issue execution
The runtime SHALL support launching an issue agent session inside either the current checkout or a dedicated git worktree, and SHALL persist enough launch metadata to safely complete the issue later.

#### Scenario: Starting an issue in worktree mode
- **WHEN** the user starts a backlog issue with development mode `Worktree`
- **THEN** the runtime records the selected target branch, completion policy snapshot, workspace mode, origin branch, worktree owner, workspace branch, and workspace path for that session
- **AND** resolves the worktree root from the project's configured worktree location enum and current repository path
- **AND** creates a worktree under that resolved root path
- **AND** creates a temporary development branch inside that worktree using the issue ID as the naming base
- **AND** names the worktree path using the `issue-{id}-...` pattern
- **AND** marks the worktree owner as `redwhisk`
- **AND** runs the captured setup command in the new worktree when one is configured
- **AND** waits for the setup command to finish before launching the agent session
- **AND** launches the agent session inside that worktree directory
- **AND** records the project default or run-level overridden worktree setup command as a session snapshot

#### Scenario: Starting an issue in current branch mode
- **WHEN** the user starts a backlog issue with development mode `Current branch`
- **THEN** the runtime records the selected completion policy snapshot, workspace mode, origin branch, workspace branch, and workspace path for that session
- **AND** launches the agent session in the project's primary repository path without creating a worktree

### Requirement: Persistent completion orchestration
The runtime SHALL route every Issue completion action through a persistent completion flow before writing the Issue status as `completed`.

#### Scenario: Completing through any user entry point
- **WHEN** the user marks an issue as `Done` or changes its status to `completed`
- **THEN** the runtime starts or resumes the issue completion flow
- **AND** it checks the linked session workspace for in-progress Git operations and uncommitted changes before completing the issue
- **AND** it records the current completion phase so the flow can continue after an application restart
- **AND** it does not update the Issue to `completed` until required commit checks, branch checks, worktree handling, session close, and audit writes have succeeded or have been explicitly skipped by a user choice allowed by this specification

#### Scenario: Manual completion policy with dirty workspace
- **WHEN** the completion flow detects uncommitted changes in the linked session workspace
- **AND** the session completion policy snapshot is `manual`
- **THEN** the runtime returns a manual dirty-workspace action to the UI
- **AND** records that completion is paused for manual handling
- **AND** if the user later chooses to ignore the dirty workspace, the flow records that choice and continues to branch/worktree handling
- **AND** if the user chooses manual handling, the Issue remains not completed until the user retries completion

#### Scenario: Auto-commit completion policy with dirty workspace
- **WHEN** the completion flow detects uncommitted changes in the linked session workspace
- **AND** the session completion policy snapshot is `agent_auto_commit`
- **THEN** the runtime injects a localized completion prompt into the linked agent session
- **AND** records that it is waiting for an agent commit
- **AND** after a new commit is detected in the linked session workspace, the runtime resumes the same completion flow
- **AND** if no new commit is detected, the Issue remains not completed and the flow remains resumable

#### Scenario: Completing on the original branch
- **WHEN** the linked session workspace is on the same branch recorded at session start
- **AND** required dirty-workspace checks have passed or were explicitly ignored
- **THEN** the runtime closes the linked session, records completion audit data, and marks the Issue `completed` without worktree merge-back or worktree cleanup

### Requirement: Worktree completion merge-back and cleanup
When an issue completion flow runs from a worktree branch, completion SHALL handle merge-back and cleanup according to whether RedWhisk created the worktree.

#### Scenario: Completing after the recorded worktree was already removed and closed out
- **WHEN** a completion flow runs for a session created in `Worktree` mode
- **AND** the recorded worktree path no longer exists
- **AND** the recorded workspace branch no longer exists or is already contained in the recorded target branch
- **THEN** the runtime treats the worktree closeout as already handled and skips worktree merge-back and cleanup
- **AND** continues the non-worktree completion checks that still apply to the issue

#### Scenario: Completing after the recorded RedWhisk worktree was removed before merge-back
- **WHEN** a completion flow runs for a session created in `Worktree` mode
- **AND** the worktree is marked as RedWhisk-created
- **AND** the recorded worktree path no longer exists
- **AND** the workspace branch still exists and is not contained in the recorded target branch
- **THEN** the Issue remains not completed
- **AND** the runtime records the blocked completion phase and failure reason
- **AND** it does not silently skip merge-back

#### Scenario: RedWhisk-created worktree completes cleanly
- **WHEN** the completion flow runs in a worktree marked as RedWhisk-created
- **AND** required dirty-workspace checks have passed or were explicitly ignored
- **THEN** the runtime rebases the workspace branch onto the recorded target branch
- **AND** fast-forwards or otherwise rebase-applies the target branch to include the workspace branch without creating a normal merge commit
- **AND** only after successful merge-back does it delete the temporary branch and remove the worktree
- **AND** then marks the Issue `completed`

#### Scenario: RedWhisk-created worktree rebase or merge-back fails
- **WHEN** rebase or merge-back fails for a RedWhisk-created worktree
- **THEN** the Issue remains not completed
- **AND** the runtime records the blocked completion phase and failure reason
- **AND** it does not delete the temporary branch or worktree
- **AND** it injects a prompt into the linked agent session asking it to resolve the rebase or merge-back and land the code on the originally recorded target branch

#### Scenario: User-created worktree requires confirmation
- **WHEN** the completion flow detects that the linked session is in a worktree not created by RedWhisk
- **THEN** the runtime returns a UI action asking whether to merge the worktree branch and delete the worktree
- **AND** if the user confirms, the runtime uses the same rebase and merge-back behavior as a RedWhisk-created worktree
- **AND** if the user declines, the runtime skips merge-back and cleanup and may mark the Issue `completed`
- **AND** if the user cancels, the runtime records the paused phase and leaves the Issue not completed

#### Scenario: Completing a worktree-backed issue whose branch is already merged
- **WHEN** the temporary development branch is already contained in the recorded target branch
- **THEN** the runtime skips the merge-back step
- **AND** still deletes the RedWhisk-created temporary branch and removes the RedWhisk-created worktree

### Requirement: Agent auto-commit prompt localization
Agent auto-commit completion SHALL send a language-appropriate prompt that limits the agent to files related to the current issue and the linked session workspace.

#### Scenario: Chinese auto-commit prompt
- **WHEN** global language is Chinese
- **AND** auto-commit completion needs the agent to commit related dirty files
- **THEN** the prompt asks the agent to "获取本次修改相关的代码"
- **AND** instructs the agent to stage and commit only files directly related to the current issue
- **AND** names the linked session workspace that should be inspected

#### Scenario: English auto-commit prompt
- **WHEN** global language is English
- **AND** auto-commit completion needs the agent to commit related dirty files
- **THEN** the prompt asks the agent to collect the code changes related to this issue
- **AND** instructs the agent not to include unrelated changes
- **AND** names the linked session workspace that should be inspected
