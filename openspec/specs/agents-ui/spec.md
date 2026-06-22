# agents-ui Specification

## Purpose
Defines the Agents Activity session header, left workspace tabs, and right session side panel behavior.
## Requirements
### Requirement: Agents Session header compact issue bar

Agents Activity SHALL render the selected Session header as a compact, full-width issue bar without Card styling.

#### Scenario: Session has a linked Issue

- **WHEN** the user selects an Agent Session with a linked Issue
- **THEN** the Session header shows only `#<Issue ID> <Issue title>` as the primary text
- **AND** the header does not show `当前会话`, `当前绘画`, or a `Status` field
- **AND** the header has no outer margin or Card background
- **AND** a horizontal divider separates the header from the content below

#### Scenario: Header actions are rendered

- **WHEN** the selected Session header renders actions
- **THEN** the previous `Open Issue` button is not shown
- **AND** the status transition dropdown remains available when the Session can transition
- **AND** the transition dropdown button uses a white background
- **AND** terminal and right-split icon buttons are shown to the right of the transition control

#### Scenario: Opening the side panel

- **WHEN** the user clicks the right-split icon button
- **THEN** the right Session side panel opens
- **AND** the right-split icon button indicates the selected state with a subtle light background or inset treatment

#### Scenario: Opening the inline terminal panel

- **WHEN** the user clicks the terminal icon button in the Session header
- **THEN** the Session workspace opens an inline terminal panel below the Session main content
- **AND** the terminal icon button indicates the selected state with a subtle light background or inset treatment

### Requirement: Session workspace tabs

Agents Activity SHALL provide a tabbed left workspace where `Session` is fixed and file-oriented tabs are replaceable by type.

#### Scenario: Session tab is always present

- **WHEN** the Session workspace renders
- **THEN** a `Session` tab is present
- **AND** the `Session` tab cannot be closed

#### Scenario: Opening a file from the file tree

- **WHEN** the user clicks a file in the right panel `文件` tree
- **THEN** the left workspace opens a file tab
- **AND** the tab title is the file name without a `Diff` prefix
- **AND** the tab content displays the file contents in a read-only code viewer
- **AND** clicking another file tree item replaces the existing file tab content instead of adding another file tab

#### Scenario: Opening a changed file

- **WHEN** the user clicks a file in the right panel `变更` list
- **THEN** the left workspace opens a change tab with a Git branch style icon
- **AND** the tab title is the file name without a `Diff` prefix
- **AND** the content displays the selected file diff rather than a placeholder or “diff which file” prompt
- **AND** clicking another changed file replaces the existing change tab content instead of adding another change tab

### Requirement: Session side panel changes view

Agents Activity SHALL provide a right Session side panel changes view backed by real uncommitted repository changes.

#### Scenario: Changes view is opened

- **WHEN** the right Session side panel opens
- **THEN** the panel width defaults to `300px`
- **AND** the top panel tabs include `变更` and `文件`
- **AND** the top panel tab row height matches the left Agents issue row height

#### Scenario: Selecting change status

- **WHEN** the `变更` tab is active
- **THEN** a compact menu trigger allows switching between `未提交` and `已提交`
- **AND** the trigger is not rendered as a native `select`
- **AND** the trigger keeps a status icon and dropdown icon
- **AND** the right side of that row shows only a refresh button

#### Scenario: Showing uncommitted changed files

- **WHEN** the `未提交` filter is selected
- **THEN** the panel shows one real uncommitted changed file per full-width row
- **AND** each row shows the file name
- **AND** hovering the row exposes a tooltip containing the file path in the project
- **AND** the right side of the row shows a text status label such as `新增`, `修改`, `删除`, or `重命名`
- **AND** the right side of the row shows added and deleted line counts when applicable
- **AND** spacing between the status label and the added line count is `4px`

#### Scenario: Uncommitted changes refresh while panel is open

- **WHEN** the `变更` tab is visible in an open Session side panel
- **THEN** Agents Activity polls the repository changes about every `2s`
- **AND** the changed file list refreshes when file count, status, metadata signature, or line statistics change
- **AND** unchanged polling results do not reset the selected workspace tab or visible list unnecessarily

#### Scenario: Committed changes are not implemented yet

- **WHEN** the user selects `已提交`
- **THEN** the panel may show an explicit placeholder instead of committed file data

### Requirement: Session side panel file tree view

Agents Activity SHALL provide a right Session side panel file tree view backed by the current project repository.

#### Scenario: File tree is opened

- **WHEN** the user selects the `文件` tab in the right Session side panel
- **THEN** the panel shows the real project repository file tree
- **AND** file rows include file-type icons
- **AND** clicking a directory expands or collapses the directory without changing the left workspace content
- **AND** clicking a file opens or replaces the single file tab in the left workspace

#### Scenario: File tree refreshes in memory

- **WHEN** the file tree tab remains active
- **THEN** Agents Activity checks the repository tree for changes about every `5s`
- **AND** the tree refreshes when files or directories are added, removed, renamed, or have relevant metadata changes
- **AND** unchanged polling results preserve current expanded and selected tree state

### Requirement: Session workspace diff rendering

Agents Activity SHALL render selected changed files with a VS Code-like read-only diff viewer.

#### Scenario: Added file diff is opened

- **WHEN** the selected changed file is newly added or untracked
- **THEN** the diff tab displays the file contents as added content
- **AND** the UI exposes an `新增` text status
- **AND** the diff is read-only

#### Scenario: Modified file diff is opened

- **WHEN** the selected changed file modifies an existing file
- **THEN** the diff tab displays old content on the left and new content on the right
- **AND** the diff is read-only

#### Scenario: Deleted file diff is opened

- **WHEN** the selected changed file is deleted
- **THEN** the changes list exposes a `删除` text label or equivalent text tag
- **AND** the diff tab displays the old content with an empty new side or an equivalent deleted-file view
- **AND** the deleted state is not communicated only by color or strikethrough

### Requirement: Session workspace cache per session

Agents Activity SHALL retain workspace side panel and opened file data in memory per Session during the current app runtime.

#### Scenario: Switching away from a Session

- **WHEN** the user switches from Session A to Session B
- **THEN** Session A's loaded changes, file tree, opened file tab, opened change tab, and active workspace tab remain in memory

#### Scenario: Switching back to a Session

- **WHEN** the user switches back to Session A during the same runtime
- **THEN** Agents Activity immediately displays Session A's cached workspace state
- **AND** subsequent polling may refresh stale data without first clearing the visible cached state

### Requirement: Project workspace file access safety

Workspace file and diff commands SHALL only read files inside the selected project's repository workspace.

#### Scenario: Relative file path is valid

- **WHEN** the frontend requests a file or diff for a relative path inside the project repository
- **THEN** the command returns the requested content or a typed binary/too-large placeholder

#### Scenario: File path escapes the repository

- **WHEN** the frontend requests an absolute path or a path containing traversal outside the repository
- **THEN** the command fails with a structured command error
- **AND** no file content outside the project repository is returned

### Requirement: Session inline terminal panel

Agents Activity SHALL provide a Session-scoped inline terminal panel below the Session main content.

#### Scenario: Opening the first terminal

- **WHEN** the user clicks the Session header terminal icon and no inline terminal is open
- **THEN** Agents Activity starts one temporary terminal for the selected Agent Session
- **AND** the panel appears below the Session main content with default height `200px`
- **AND** the terminal tab name is the final path segment of the terminal working directory
- **AND** the terminal process working directory is the selected Agent Session's actual working directory

#### Scenario: Managing terminal tabs

- **WHEN** at least one inline terminal is open
- **THEN** the terminal tab row shows one tab per terminal
- **AND** a plus icon button is available next to the tabs
- **AND** clicking the plus icon starts another temporary terminal for the same selected Agent Session
- **AND** each tab can be closed
- **AND** closing the active tab selects another remaining tab when one exists
- **AND** closing the last tab hides the inline terminal panel

#### Scenario: Resizing terminal panel

- **WHEN** the inline terminal panel is visible and not maximized
- **THEN** a horizontal splitter separates Session main content from the terminal panel
- **AND** dragging the splitter up or down changes the terminal panel height
- **AND** the panel remains within usable minimum and maximum heights

#### Scenario: Maximizing Session main content

- **WHEN** the user clicks the maximize button at the far right of the terminal tab row
- **THEN** Agents Activity hides the inline terminal panel and lets the Session main content use the available height
- **AND** clicking the button again restores the previous inline terminal panel

#### Scenario: Switching Session

- **WHEN** the user opens inline terminals for Session A and then switches to Session B
- **THEN** the inline terminal panel state is scoped to the selected Session
- **AND** new terminals for Session B start in Session B's actual working directory

