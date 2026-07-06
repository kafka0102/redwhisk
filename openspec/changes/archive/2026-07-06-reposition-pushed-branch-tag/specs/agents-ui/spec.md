# agents-ui Specification Delta

## MODIFIED Requirements

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

#### Scenario: Uncommitted changes refresh while the panel is open

- **WHEN** the `变更` tab is visible in an open Session side panel
- **THEN** Agents Activity polls the repository changes about every `2s`
- **AND** the changed file list refreshes when file count, status, metadata signature, or line statistics change
- **AND** unchanged polling results do not reset the selected workspace tab or visible list unnecessarily

#### Scenario: Committed changes timeline

- **WHEN** the user selects `已提交`
- **THEN** the panel shows a vertical timeline of recent commits
- **AND** each commit row shows the commit message and author name
- **AND** each commit row expands to reveal its changed files
- **AND** a pushed commit is marked with a purple timeline dot

#### Scenario: Pushed branch tag appears only on the first pushed commit

- **WHEN** the committed timeline contains one or more pushed commits
- **THEN** only the topmost pushed commit renders a branch name tag with a cloud icon
- **AND** every other pushed commit keeps the purple timeline dot without the branch name tag
- **AND** the branch name tag is anchored to the right edge of its row with a 4px right gap
- **AND** the branch name tag stacks above the author name so a long author name is covered by the tag instead of overflowing the row
