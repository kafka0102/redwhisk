# agents-ui Specification Delta

## ADDED Requirements

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
- **AND** clicking another file tree item replaces the existing file tab content instead of adding another file tab

#### Scenario: Opening a changed file

- **WHEN** the user clicks a file in the right panel `变更` list
- **THEN** the left workspace opens a change tab with a Git branch style icon
- **AND** the tab title is the file name without a `Diff` prefix
- **AND** the content shows a Diff placeholder for the selected file
- **AND** clicking another changed file replaces the existing change tab content instead of adding another change tab

### Requirement: Session side panel changes view

Agents Activity SHALL provide a right Session side panel changes view matching the approved compact prototype.

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
- **THEN** the panel shows one mock changed file per full-width row
- **AND** each row shows the file name
- **AND** hovering the row exposes a tooltip containing the file path in the project
- **AND** the right side of the row shows the `新增` label when the file is new
- **AND** the right side of the row shows added and deleted line counts
- **AND** spacing between the `新增` label and the added line count is `4px`

#### Scenario: Committed changes are not implemented yet

- **WHEN** the user selects `已提交`
- **THEN** the panel may show an explicit placeholder instead of committed file data

### Requirement: Session side panel file tree view

Agents Activity SHALL provide a right Session side panel file tree view with typed file icons.

#### Scenario: File tree is opened

- **WHEN** the user selects the `文件` tab in the right Session side panel
- **THEN** the panel shows a project file tree placeholder
- **AND** file rows include file-type icons
- **AND** TypeScript, Vue, CSS, Rust, and generic files use visually distinct icon colors
- **AND** clicking a file opens or replaces the single file tab in the left workspace
