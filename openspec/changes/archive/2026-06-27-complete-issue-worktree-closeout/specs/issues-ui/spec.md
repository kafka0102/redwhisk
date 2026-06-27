## MODIFIED Requirements

### Requirement: Issue completion git safety prompts
The Issues page SHALL gate Done / Completed actions on the persistent completion flow returned by the runtime before changing the issue to completed.

#### Scenario: Manual commit policy blocks Done with dirty related files
- **WHEN** the user marks an issue as `Done` or changes its status to `completed`
- **AND** the associated session has uncommitted changes in its workspace
- **AND** the session completion policy is `manual`
- **THEN** the app shows a dialog telling the user that the session workspace has uncommitted code
- **AND** the dialog lets the user either ignore the dirty workspace and continue or pause completion to handle it manually
- **AND** if the user pauses, the issue remains not completed and a later completion attempt resumes or restarts the persisted completion flow

#### Scenario: Auto commit policy sends localized agent prompt
- **WHEN** the user marks an issue as `Done` or changes its status to `completed`
- **AND** the associated session has uncommitted changes in its workspace
- **AND** the session completion policy is `agent_auto_commit`
- **THEN** the app sends or requests a localized prompt to the current agent session asking it to collect and commit only code related to the current issue
- **AND** the app shows that completion is waiting for a commit to be detected
- **AND** completion continues only after the runtime reports that the commit has been detected

#### Scenario: Confirming merge for a user-created worktree
- **WHEN** the user marks an issue as `Done` or changes its status to `completed`
- **AND** the associated session is in a worktree not created by RedWhisk
- **THEN** the app asks whether to merge the worktree branch and delete the worktree
- **AND** the user can choose to merge and delete, skip merge-back and complete, or cancel completion
- **AND** canceling leaves the issue not completed so the user can handle the worktree manually and retry

#### Scenario: Showing merge-back progress
- **WHEN** the user confirms or the runtime starts completion for a RedWhisk-created worktree
- **THEN** the app shows progress for checking commits, checking the worktree, rebasing the worktree branch, applying it to the target branch, and cleaning up the worktree
- **AND** progress updates are shown while the asynchronous merge-back flow is running

#### Scenario: Routing rebase or merge conflicts to the current agent session
- **WHEN** rebase or merge-back detects conflicts
- **THEN** the progress surface closes
- **AND** the issue remains not completed
- **AND** if the user is already viewing the current session, the app stays on that page
- **AND** if the user is not viewing the current session, the app navigates to that session
- **AND** the app sends or reflects an agent prompt describing the conflict and asking the agent to resolve it and land the code on the originally recorded target branch

### Requirement: Issue status change confirmation rules
The Issues page SHALL allow direct forward status changes, require confirmation for every backward status change, and route completion status changes through the completion flow.

#### Scenario: Moving an issue forward
- **WHEN** the user selects a later status in the Issue status menu
- **AND** the target status is not `completed`
- **THEN** the app applies the status change without an extra confirmation step

#### Scenario: Rolling an issue back to an earlier status
- **WHEN** the user selects an earlier status in the Issue status menu
- **THEN** the app shows a confirmation dialog before changing the status

#### Scenario: Returning a running issue to backlog
- **WHEN** the current issue is still being executed by a running session
- **AND** the user changes its status to `backlog`
- **THEN** the app asks whether it should terminate the current execution and return the issue to `backlog`
- **AND** after confirmation the runtime stops the running session and the issue becomes runnable from `backlog` again

#### Scenario: Returning an inactive issue to backlog
- **WHEN** the user changes an issue to `backlog`
- **AND** the issue does not have a running session
- **THEN** the app asks for a normal backlog return confirmation

#### Scenario: Marking any issue as completed
- **WHEN** the user changes the issue status to `completed`
- **THEN** the app routes the action through the completion flow instead of directly calling a generic status update
- **AND** if the linked session is still running, the app warns that the current issue is still executing before continuing the completion flow
- **AND** if the linked session is inactive, the app still asks the runtime whether commit checks, branch checks, or worktree handling are required before marking it completed
