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
The Issues page SHALL use a narrower run dialog width for backlog issue execution without changing the existing run flow.

#### Scenario: Starting a backlog issue
- **WHEN** the user clicks the run icon or `Run` action for a backlog issue
- **THEN** the run dialog opens with a compact width variant
- **AND** the run dialog still shows agent profile selection, final prompt editing, and run summary content

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

