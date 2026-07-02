## REMOVED Requirements

### Requirement: Agent auto-commit prompt localization
Agent auto-commit completion SHALL send a language-appropriate prompt that limits the agent to files related to the current issue and the linked session workspace.

**Reason:** Completion no longer selects an upfront policy; the auto-commit path becomes one of three dirty-workspace dialog choices and is re-specified under the new completion orchestration requirement.

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

## MODIFIED Requirements

### Requirement: Worktree-backed issue execution
The runtime SHALL support launching an issue agent session inside either the current checkout or a dedicated git worktree, and SHALL persist enough launch metadata to safely complete the issue later. The runtime SHALL NOT persist a per-issue or per-project completion policy; completion decisions are made at completion time from the actual workspace state.

#### Scenario: Starting an issue in worktree mode
- **WHEN** the user starts a backlog issue with development mode `Worktree`
- **THEN** the runtime records the selected target branch, workspace mode, origin branch, worktree owner, workspace branch, and workspace path for that session
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
- **THEN** the runtime records the workspace mode, origin branch, workspace branch, and workspace path for that session
- **AND** launches the agent session in the project's primary repository path without creating a worktree

#### Scenario: Capturing a worktree created mid-run by a workflow skill
- **WHEN** an issue session was started in `Current branch` mode
- **AND** a workflow skill creates an additional git worktree during the run that causes the session's effective working directory to move into that worktree
- **THEN** the runtime does not treat the startup workspace snapshot as the final execution path
- **AND** at completion time the runtime resolves the session's actual current working directory to detect the drift
- **AND** the runtime treats any such mid-run worktree as `External` ownership regardless of how it was created

### Requirement: Persistent completion orchestration
The runtime SHALL route every Issue completion action through a persistent completion flow before writing the Issue status as `completed`. The flow SHALL be driven by the actual workspace state at completion time, not by any pre-selected completion policy.

#### Scenario: Completing through any user entry point
- **WHEN** the user marks an issue as `Done` or changes its status to `completed`
- **THEN** the runtime starts or resumes the issue completion flow
- **AND** it resolves the actual execution path: the session's current working directory when the session is still active, otherwise the workspace path recorded at session start
- **AND** it checks that resolved path for uncommitted Git changes before completing the issue
- **AND** it records the current completion phase so the flow can continue after an application restart
- **AND** it does not update the Issue to `completed` until required commit checks, branch checks, worktree handling, session close, and audit writes have succeeded or have been explicitly skipped by a user choice allowed by this specification

#### Scenario: Dirty workspace prompts a three-option decision
- **WHEN** the completion flow detects uncommitted changes on the resolved execution path
- **THEN** the runtime returns a dirty-workspace decision action to the UI
- **AND** the UI presents three options: auto-commit, skip (do not commit), and cancel
- **AND** the UI pre-fills the known branch name: the origin/current branch for current-branch sessions, the recorded workspace branch for program-created worktrees, and an editable field only when the session is closed or the actual path could not be resolved
- **AND** if the user chooses cancel, the flow records a cancelled phase and the Issue remains not completed

#### Scenario: Auto-commit choice jumps to the session and waits for a commit
- **WHEN** the user chooses the auto-commit option for a dirty workspace
- **THEN** the UI navigates to the linked session page
- **AND** the runtime injects a commit instruction that includes commit-message context for the current change into the linked session
- **AND** the runtime records that it is waiting for an agent commit
- **AND** after a new commit is detected on the resolved execution path, the runtime asks the user to confirm continuing with "代码已提交成功。确定继续标记完成吗？"
- **AND** if the user confirms, the flow continues to worktree reconciliation
- **AND** if the user declines, the flow records a cancelled phase and the Issue remains not completed
- **AND** if no new commit is detected, the Issue remains not completed and the flow remains resumable

#### Scenario: Skip choice continues without committing
- **WHEN** the user chooses the skip (do not commit) option for a dirty workspace
- **THEN** the runtime records the user's choice to ignore the dirty workspace
- **AND** the flow continues to worktree reconciliation without requiring a commit

#### Scenario: Completing on the original branch
- **WHEN** the resolved execution path is on the same branch recorded at session start
- **AND** required dirty-workspace checks have passed or were explicitly ignored
- **THEN** the runtime closes the linked session, records completion audit data, and marks the Issue `completed` without worktree merge-back or worktree cleanup

### Requirement: Worktree completion merge-back and cleanup
When an issue completion flow runs from a worktree branch, completion SHALL handle merge-back and cleanup according to whether RedWhisk created the worktree and whether the actual execution path differs from the startup snapshot.

#### Scenario: Completing after the recorded worktree was already removed and closed out
- **WHEN** a completion flow runs for a session created in `Worktree` mode
- **AND** the recorded worktree path no longer exists
- **AND** the recorded workspace branch no longer exists or is already contained in the recorded target branch
- **THEN** the runtime treats the worktree closeout as already handled and skips worktree merge-back and cleanup
- **AND** continues the non-worktree completion checks that still apply to the issue

#### Scenario: RedWhisk-created worktree completes cleanly
- **WHEN** the completion flow runs in a worktree marked as RedWhisk-created
- **AND** the actual execution path matches the recorded workspace path
- **AND** required dirty-workspace checks have passed or were explicitly ignored
- **THEN** the runtime rebases the workspace branch onto the recorded target branch
- **AND** fast-forwards or otherwise rebase-applies the target branch to include the workspace branch without creating a normal merge commit
- **AND** only after successful merge-back does it delete the temporary branch and remove the worktree
- **AND** then marks the Issue `completed`

#### Scenario: Mid-run drifted worktree is treated as user-created
- **WHEN** the actual execution path at completion differs from the recorded workspace path
- **AND** the actual execution path is inside a worktree that was created during the run
- **THEN** the runtime treats the worktree as `External` ownership
- **AND** follows the user-created worktree confirmation behavior before any merge-back or cleanup

#### Scenario: Rebase or merge-back failure does not prompt the user inline
- **WHEN** rebase or merge-back fails during worktree reconciliation
- **THEN** the runtime does not show a failure dialog
- **AND** it records the blocked completion phase and failure reason
- **AND** it does not delete the temporary branch or worktree
- **AND** when the linked session is active, it sends "代码合并冲突，请根据本次修改合并代码。" to the session
- **AND** when the linked session is closed, it creates a new session in the worktree path carrying the prior change context and the same instruction
- **AND** the Issue remains not completed until the user resolves the conflict, commits, and retries completion

#### Scenario: User-created worktree requires confirmation before cleanup
- **WHEN** the completion flow detects that the linked session is in a worktree not created by RedWhisk
- **AND** required commit and merge-back steps have succeeded
- **THEN** the runtime returns a UI action asking "代码已提交至 [base branch name]，是否删除当前 work tree？"
- **AND** if the user confirms, the runtime removes the worktree
- **AND** if the user declines, the runtime skips cleanup and continues to mark the Issue `completed`
- **AND** the [base branch name] is filled from the user-provided or resolved branch name

#### Scenario: Completing a worktree-backed issue whose branch is already merged
- **WHEN** the temporary development branch is already contained in the recorded target branch
- **THEN** the runtime skips the merge-back step
- **AND** still deletes the RedWhisk-created temporary branch and removes the RedWhisk-created worktree
