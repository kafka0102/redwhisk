# issues-ui Specification

## Purpose
TBD - created by archiving change 2026-06-13-refine-backlog-issue-dialog. Update Purpose after archive.
## Requirements
### Requirement: Backlog issue dialog layout
The Issues page SHALL render backlog issue creation and backlog issue detail in a dedicated compact single-column dialog layout that does not show any right-side content.

#### Scenario: Creating a backlog issue
- **WHEN** the user clicks `New Issue` in the backlog lane
- **THEN** the dialog shows editable title and description fields in a single main column
- **AND** the dialog does not render any right-side preview, `Session`, or `Actions` panels

#### Scenario: Editing a backlog issue
- **WHEN** the user opens an issue whose status is `backlog`
- **THEN** the dialog uses the same backlog-specific layout as the create flow
- **AND** the dialog remains a single-column editor without any right-side content

### Requirement: Non-backlog issue dialogs remain unchanged
The Issues page SHALL preserve the existing sidebar-based dialog structure for `running`, `review`, and `completed` issues.

#### Scenario: Opening an in-progress issue
- **WHEN** the user opens an issue whose status is `running`
- **THEN** the dialog still shows session information and action controls in the right sidebar

#### Scenario: Opening a review or completed issue
- **WHEN** the user opens an issue whose status is `review` or `completed`
- **THEN** the dialog still shows the existing session/actions or summary actions in the right sidebar

### Requirement: Backlog run dialog compact width
The Issues page SHALL keep the compact backlog run dialog width while extending the run flow with execution context controls.

#### Scenario: Starting a backlog issue
- **WHEN** the user clicks the run icon or `Run` action for a backlog issue
- **THEN** the run dialog opens with a compact width variant
- **AND** the run dialog shows agent profile selection, workflow skill, commit strategy, development mode, target branch, and final prompt

### Requirement: Attachment insertion in issue editor
The issue create and edit flows SHALL allow users to insert attachment cards into the description editor from the dialog footer.

#### Scenario: Selecting a file from the footer action
- **WHEN** the user clicks the file icon on the left side of the create / edit issue footer
- **THEN** the app opens a file picker
- **AND** after the user selects a file, the app inserts an attachment card block into the description editor

#### Scenario: Rendering attachment type icons
- **WHEN** an attachment card is shown
- **THEN** PDF files show a PDF-specific icon
- **AND** Word files show a Word-specific icon
- **AND** image files show an image-specific icon
- **AND** other files show a generic file icon

### Requirement: Attachment actions and preview rules
The issue editor SHALL expose preview, download, and delete actions according to attachment type.

#### Scenario: Previewing an image attachment
- **WHEN** the attachment is an image
- **THEN** the card shows a `查看` eye icon button
- **AND** clicking it opens an image preview dialog

#### Scenario: Previewing a text attachment
- **WHEN** the attachment is a non-binary text file such as `md` or `json`
- **THEN** the card shows a `查看` eye icon button
- **AND** clicking it opens a text preview dialog

#### Scenario: Binary attachment without preview
- **WHEN** the attachment is a binary file that is not previewable
- **THEN** the card does not show a `查看` button
- **AND** the card still shows download and delete actions

#### Scenario: Downloading an attachment
- **WHEN** the user clicks the download button on an attachment card
- **THEN** the app exports the attachment file to a user-selected location

#### Scenario: Deleting an attachment
- **WHEN** the user clicks the delete button on an attachment card
- **THEN** the attachment card is removed from the editor content

### Requirement: Issue attachments are readable by execution prompts
The issue run flow SHALL store attachments at an agent-readable path and include those paths in the final run prompt.

#### Scenario: Building a run prompt for an issue with attachments
- **WHEN** the user opens the run dialog for an issue with saved attachments
- **THEN** the prompt preview includes a dedicated attachment source
- **AND** the final prompt lists repo-relative attachment paths for the agent to read

### Requirement: Issue dialog label picker
The Issues page SHALL allow users to assign configured labels while creating or editing a backlog issue.

#### Scenario: Selecting labels from configured project and global labels
- **WHEN** the user opens a create or edit dialog for a backlog issue
- **THEN** the dialog shows a `labels` row below the description field
- **AND** the picker options include both project-scoped and global labels for the current project
- **AND** the picker trigger renders selected labels as colored chips inside the control

#### Scenario: Managing labels from the picker
- **WHEN** the picker has at least one available label
- **THEN** the dropdown lists label options first
- **AND** separates non-label actions with a divider
- **AND** shows a `管理 labels` action at the bottom
- **AND** clicking that action opens Project Settings with the `labels` tab active

#### Scenario: Empty labels state
- **WHEN** the current project has no project-scoped labels and there are no global labels
- **THEN** the dropdown does not show label options
- **AND** instead shows an `添加标签` action
- **AND** clicking that action opens Project Settings with the `labels` tab active

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

### Requirement: Issue status change confirmation rules
The Issues page SHALL allow direct forward status changes, require confirmation for every backward status change, and gate completion confirmation on whether the linked session is still running.

#### Scenario: Moving an issue forward
- **WHEN** the user selects a later status in the Issue status menu
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

#### Scenario: Marking a running issue as completed
- **WHEN** the user changes the issue status to `completed`
- **AND** the linked session is still running
- **THEN** the app warns that the current issue is still executing and asks whether to mark it as completed
- **AND** after confirmation the app continues the existing completion flow

#### Scenario: Marking an inactive issue as completed
- **WHEN** the user changes the issue status to `completed`
- **AND** the issue does not have a running session
- **THEN** the app changes the status without the extra running-session confirmation

