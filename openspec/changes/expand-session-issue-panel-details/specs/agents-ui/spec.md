# agents-ui Specification Delta

## MODIFIED Requirements

### Requirement: Session side panel issue view

Agents Activity SHALL provide a right Session side panel issue view for linked Issues without replacing the existing workspace tabs.

#### Scenario: Side panel opens with a linked Issue

- **WHEN** the selected Session has a linked Issue
- **AND** the user opens the right Session side panel
- **THEN** the top panel tabs include `Issue`, `变更`, and `文件`
- **AND** the `Issue` tab is rendered in the first position
- **AND** the `Issue` tab is active immediately after opening the panel

#### Scenario: Issue tab is grouped into three cards

- **WHEN** the `Issue` tab is active
- **THEN** the panel renders exactly three cards named `Issue信息`, `运行参数`, and `Session信息`
- **AND** the cards use compact bordered panel styling consistent with the existing side panel

#### Scenario: Issue information card preserves existing issue content

- **WHEN** the `Issue信息` card renders
- **THEN** its header keeps the existing Issue title heading
- **AND** the right side renders a compact non-link button labeled `查看 issue`
- **AND** the card still renders the Issue description
- **AND** if the Issue has labels, the card still renders the labels inline using the existing label chip style

#### Scenario: Run parameters card shows three persisted values

- **WHEN** the `运行参数` card renders
- **THEN** it shows exactly three parameter rows: `Agent`, `工作流技能`, and `开发模式`
- **AND** `Agent` shows the resolved Agent profile name
- **AND** `工作流技能` shows the workflow skill name saved with the Session
- **AND** if no workflow skill name is available, the UI shows `无`
- **AND** `开发模式` shows `当前分支 (<branch>)` for current-branch sessions
- **AND** `开发模式` shows `工作树 (<branch>) <worktree-name>` for worktree sessions

#### Scenario: Session information card shows timestamps, status, and log path

- **WHEN** the `Session信息` card renders
- **THEN** it shows `开始时间`, `结束时间`, and `当前状态`
- **AND** an unfinished Session shows `-` for `结束时间`
- **AND** the card also shows `日志路径` in a dedicated section separated by a divider
- **AND** a running Session shows the runtime log path
- **AND** a closed, crashed, stopped, or archived Session shows the archived or final saved log path

#### Scenario: Open linked Issue from the side panel

- **WHEN** the user clicks `查看 issue` in the side panel `Issue` tab
- **THEN** the app switches to the Issues Activity
- **AND** the linked Issue is selected
- **AND** the Issue detail view is opened for that Issue
- **AND** the navigation request preserves the source Session context for the return action

#### Scenario: Side panel opens for a standalone Session

- **WHEN** the selected Session has no linked Issue
- **AND** the user opens the right Session side panel
- **THEN** the top panel keeps the existing `变更` and `文件` tabs
- **AND** the panel does not add a standalone-only empty `Issue` primary flow
