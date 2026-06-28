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
- **AND** the right-split icon button is shown to the right of the transition control

#### Scenario: Opening the side panel

- **WHEN** the user clicks the right-split icon button
- **THEN** the right Session side panel opens
- **AND** the right-split icon button indicates the selected state with a subtle light background or inset treatment

#### Scenario: Session stream handles high-frequency assistant output

- **WHEN** a running Agent Session emits many assistant or reasoning deltas within a short time window
- **THEN** the app batches those deltas before rendering the message stream
- **AND** the final assistant or reasoning text is still rendered when the item or turn completes
- **AND** stream persistence avoids per-delta database session lookups and per-delta latest-output writes

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

### Requirement: Session 主窗口提供工具 Tab 入口

Agents Activity 的 Session 主窗口 SHALL 将 Session 内容作为首个 Tab，并 SHALL 在该 Tab 后提供一个 `+` 菜单入口用于新增工具 Tab。

#### Scenario: 展示工具新增菜单

- **GIVEN** 用户正在查看一个 Agent Session
- **WHEN** 用户点击 Session 主窗口 Tab 栏中的 `+`
- **THEN** 系统展示包含“终端”和“浏览器”的菜单
- **AND** 每个菜单项都带有默认图标

### Requirement: 终端作为 Session 工具 Tab 管理

系统 SHALL 允许用户从 `+` 菜单新增终端 Tab，并 SHALL 在 Session Tab 内容区内渲染终端，而不是在页面底部渲染终端面板。

#### Scenario: 新增终端 Tab

- **GIVEN** 用户正在查看一个 Agent Session
- **WHEN** 用户从 `+` 菜单选择“终端”
- **THEN** 系统新增一个可切换的终端 Tab
- **AND** 终端内容显示在当前 Session 主窗口的 Tab 内容区内

#### Scenario: 关闭终端 Tab

- **GIVEN** 用户已打开一个或多个终端 Tab
- **WHEN** 用户点击某个终端 Tab 的关闭按钮
- **THEN** 系统关闭该终端 Tab
- **AND** 其他 Session 内容或工具 Tab 保持可用

#### Scenario: 限制终端 Tab 数量

- **GIVEN** 用户已经打开 10 个终端 Tab
- **WHEN** 用户再次从 `+` 菜单选择“终端”
- **THEN** 系统不新增终端 Tab
- **AND** 系统显示不支持继续添加终端的提示

### Requirement: 浏览器作为 Session 工具 Tab 管理

系统 SHALL 允许用户从 `+` 菜单新增浏览器 Tab，并 SHALL 在浏览器 Tab 内显示地址输入框和嵌入式浏览区域。

#### Scenario: 新增浏览器 Tab

- **GIVEN** 用户正在查看一个 Agent Session
- **WHEN** 用户从 `+` 菜单选择“浏览器”
- **THEN** 系统新增一个浏览器 Tab
- **AND** 浏览器 Tab 显示地址输入框和嵌入式浏览区域

#### Scenario: 地址栏访问或刷新页面

- **GIVEN** 用户已打开浏览器 Tab
- **WHEN** 用户在地址栏输入地址并按 Enter
- **THEN** 嵌入式浏览区域访问该地址
- **AND** 如果地址与当前地址相同，系统重新加载当前页面
