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
The issue create and edit flows SHALL allow users to insert image and file attachment embeds directly from the description rich text editor toolbar.

#### Scenario: Selecting a file from the editor toolbar
- **WHEN** the user clicks the file upload control inside the description editor toolbar
- **THEN** the app opens a file picker
- **AND** after the user selects a file, the app inserts the selected file into the editor content
- **AND** the dialog footer does not show a separate attachment upload icon

#### Scenario: Rendering attachment type icons
- **WHEN** a non-image attachment embed is shown in the editor
- **THEN** PDF files show a PDF-specific icon
- **AND** Word files show a Word-specific icon
- **AND** text files show a text-specific icon
- **AND** other files show a generic file icon

#### Scenario: Rendering image attachments inline
- **WHEN** an image attachment is inserted into the editor
- **THEN** the editor displays the image inline in the description content

### Requirement: Attachment actions and preview rules
The issue editor SHALL expose preview, download, and delete actions from attachment embeds inside the rich text editor according to attachment type.

#### Scenario: Previewing an image attachment
- **WHEN** the attachment embed is an image
- **THEN** the embed exposes a `查看` action
- **AND** clicking it opens an image preview dialog

#### Scenario: Previewing a text attachment
- **WHEN** the attachment embed is a non-binary text file such as `md` or `json`
- **THEN** the embed exposes a `查看` action
- **AND** clicking it opens a text preview dialog

#### Scenario: Binary attachment without preview
- **WHEN** the attachment embed is a binary file that is not previewable
- **THEN** the embed does not show a `查看` action
- **AND** the embed still shows download and delete actions

#### Scenario: Downloading an attachment
- **WHEN** the user clicks the download action on an attachment embed
- **THEN** the app exports the attachment file to a user-selected location

#### Scenario: Deleting an attachment
- **WHEN** the user clicks the delete action on an attachment embed
- **THEN** the attachment is removed from the editor content and from the issue attachment list submitted to the backend

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

### Requirement: Rich text issue description editor
The Issues page SHALL use a reusable rich text editor component for backlog issue creation and editing descriptions.

#### Scenario: Formatting issue description text
- **WHEN** the user edits an issue description
- **THEN** the editor supports normal rich text editing
- **AND** the editor supports heading styles, bold text, ordered lists, and unordered lists

#### Scenario: Using Markdown shortcuts
- **WHEN** the user types a supported Markdown shortcut such as `# `, `## `, `- `, `1. `, or `**bold**`
- **THEN** the editor applies the corresponding rich text formatting

#### Scenario: Persisting description text
- **WHEN** the issue is created or saved
- **THEN** the app persists the description as Markdown-compatible text for existing run prompt behavior

### Requirement: Read-only issue detail actions
The read-only Issue detail page SHALL expose low-risk primary actions in the header and move secondary or destructive actions into a more menu.

#### Scenario: Opening the more menu
- **WHEN** the user views a read-only Issue detail page
- **THEN** the header shows back and status transition actions
- **AND** the header shows a horizontal three-dot more button
- **AND** the header does not show a standalone delete button

#### Scenario: Selecting a menu action
- **WHEN** the user opens the more menu
- **THEN** the menu contains edit issue, view session, view summary, and delete issue actions
- **AND** edit issue opens the existing edit flow
- **AND** view session navigates to the existing session page
- **AND** view summary opens the existing summary dialog
- **AND** delete issue opens the existing delete confirmation before deleting

### Requirement: Read-only issue detail layout
The read-only Issue detail page SHALL use a two-column detail layout: the left column shows Issue content, and the right column shows linked session context with the same default width as the Agents session side panel.

#### Scenario: Rendering two-column layout
- **WHEN** the user opens the read-only Issue detail page
- **THEN** the page renders a left content column and a right session context column
- **AND** the left and right content areas each have 10px horizontal inset from the page edges
- **AND** the right column width matches the default session side panel width (400px)

#### Scenario: Header keeps full-width divider with 10px content inset
- **WHEN** the user views the read-only Issue detail header
- **THEN** the header bottom border spans the full page width
- **AND** the Issue ID is left-aligned with 10px left inset
- **AND** the header action buttons are right-aligned with 10px right inset

#### Scenario: Left column keeps Issue content presentation
- **WHEN** the user opens the read-only Issue detail page
- **THEN** the left column renders the title, description, and labels using the existing presentation
- **AND** when the issue has labels, a divider still appears below the description before the labels

#### Scenario: Right column shows session info above run parameters
- **WHEN** the read-only Issue detail page has a linked session
- **THEN** the right column shows a session information card titled with the session-info label above a run-parameters card
- **AND** the session information card header includes a “查看会话” action button styled like the session issue panel “查看 issue” button
- **AND** clicking “查看会话” navigates to the existing session page for the linked session
- **AND** the run-parameters card shows agent, workflow skill, and development mode from the linked session

#### Scenario: Right column empty without linked session
- **WHEN** the read-only Issue detail page has no linked session
- **THEN** the right column still occupies the reserved width
- **AND** the page shows an empty state instead of session info and run parameters

### Requirement: Read-only issue description attachments
The read-only Issue detail page SHALL render Markdown attachment tokens as visible attachments inside the description.

#### Scenario: Rendering an image attachment token
- **WHEN** the description contains an image attachment token with a local file path
- **THEN** the page resolves the token to an absolute renderable path
- **AND** the image is displayed inline instead of only showing the file name

#### Scenario: Rendering a non-image attachment token
- **WHEN** the description contains a non-image attachment token
- **THEN** the page displays an attachment item in the description
- **AND** the item supports downloading the file
- **AND** the item supports preview when the file type is previewable

#### Scenario: Handling missing attachment files
- **WHEN** an attachment token cannot be resolved to an existing file
- **THEN** the page keeps a readable attachment name
- **AND** the page does not render a broken image

### Requirement: Activity bar Issue icon quick return

The leftmost activity bar Issue icon SHALL act as a quick return to the Issues kanban when the user is already on the Issues Activity, instead of being a no-op.

#### Scenario: Returning from a read-only Issue detail

- **WHEN** the user is viewing a read-only Issue detail page on the Issues Activity
- **AND** the user clicks the leftmost activity bar Issue icon
- **THEN** the app closes the detail page and returns to the Issues kanban

#### Scenario: Returning from an unchanged edit or create form

- **WHEN** the user is editing an existing Issue or creating a new Issue on the Issues Activity
- **AND** the form content has not changed from its baseline (the saved Issue for edit, the empty form for create)
- **AND** the user clicks the leftmost activity bar Issue icon
- **THEN** the app closes the edit or create page and returns to the Issues kanban

#### Scenario: Preserving a changed edit or create form

- **WHEN** the user is editing an existing Issue or creating a new Issue on the Issues Activity
- **AND** the form content has changed from its baseline
- **AND** the user clicks the leftmost activity bar Issue icon
- **THEN** the app takes no action and keeps the user on the edit or create page

#### Scenario: No effect on the kanban or while saving

- **WHEN** the Issues kanban is already shown
- **AND** the user clicks the leftmost activity bar Issue icon
- **THEN** the app takes no action
- **WHEN** an Issue save or status change is in progress
- **AND** the user clicks the leftmost activity bar Issue icon
- **THEN** the app takes no action and does not interrupt the in-progress operation

#### Scenario: Switching to Issues from another Activity is unchanged

- **WHEN** the user is on the Agents, Terminals, or Settings Activity, or has the global settings panel open
- **AND** the user clicks the leftmost activity bar Issue icon
- **THEN** the app switches to the Issues Activity as before
- **AND** the app does not trigger the quick return behavior

### Requirement: Delete issue action relies on backend resource cleanup

Issue 详情中的删除 Issue 动作 SHALL 继续调用既有 `delete_issue` command；资源清理（session runtime、session log、RedWhisk worktree）由后端完成，前端不额外编排清理步骤。

#### Scenario: User confirms delete on issue detail

- **WHEN** 用户在 Issue 详情确认删除 Issue
- **THEN** 前端调用 `delete_issue`
- **AND** 删除成功后从列表移除该 Issue 并关闭详情
- **AND** 前端不单独调用 `delete_issue_worktree` 或 session 删除 API 作为删除 Issue 的前置条件

### Requirement: Read-only Issue detail more-menu composition

只读 Issue 详情页的「更多」菜单 SHALL 仅保留编辑、删除等通用动作，不再包含「查看会话」「查看总结」入口；会话入口由右侧只读会话面板承担。

#### Scenario: More menu on read-only detail

- **WHEN** 用户打开非 backlog Issue 的只读详情页
- **AND** 用户展开头部「更多」菜单
- **THEN** 菜单不展示「查看会话」项
- **AND** 菜单不展示「查看总结」项
- **AND** 右侧只读会话面板仍提供「打开会话」入口

### Requirement: Read-only detail title vertical spacing

只读 Issue 详情页的标题 SHALL 与上方 header、下方描述保持相等的垂直间距，且标题与描述、标签之间不再依赖分隔线维持间距。

#### Scenario: Title centered between header and description

- **WHEN** 用户打开非 backlog Issue 的只读详情页
- **THEN** 标题文本距上方 header 的间距等于距下方描述的间距
- **AND** 标题与描述之间不渲染 `issue-detail__divider` 分隔线
- **AND** 描述与标签之间不渲染 `issue-detail__divider` 分隔线

### Requirement: Edit page back returns to read-only detail when entered from it

当编辑页是由只读详情页的「编辑 Issue」入口打开时，编辑页的「返回」SHALL 回到该只读详情页，而非关闭返回看板。

#### Scenario: Back from edit opened via read-only detail

- **WHEN** 用户在只读详情页点击「编辑 Issue」进入编辑页
- **AND** 用户点击编辑页的「返回」
- **THEN** 应用返回该 Issue 的只读详情页
- **AND** 表单被还原为该 Issue 的已保存内容，丢弃未保存编辑

#### Scenario: Back from edit opened for a backlog issue

- **WHEN** 用户打开 backlog Issue（直接以编辑态呈现）
- **AND** 用户点击编辑页的「返回」
- **THEN** 应用关闭详情并返回看板

### Requirement: Issue running state exit hook
The Issues page SHALL encapsulate side effects of transitioning an issue out of the `running` state into an asynchronous exit-hook mechanism, invoked after the status change has succeeded, so that additional running-exit behaviors can be added without modifying the status-change call site.

#### Scenario: Hook fires on every running exit
- **WHEN** the user advances an issue whose current status is `running` to any other status (`review`, `completed`, or `backlog`)
- **AND** the status change succeeds
- **THEN** the app invokes the running-exit hook with the issue id, project id, `fromStatus` = `running`, and the `targetStatus`
- **AND** the hook is invoked asynchronously without blocking the UI or the post-transition flow

#### Scenario: Hook does not block on failures
- **WHEN** an individual hook side effect throws
- **THEN** the failure is swallowed
- **AND** other side effects in the hook still execute
- **AND** the already-succeeded status change is not rolled back

#### Scenario: Hook is skipped for non-running sources
- **WHEN** the user advances an issue whose current status is not `running`
- **THEN** the running-exit hook is not invoked

### Requirement: Issue review transition notification sound
When the running-exit hook runs for a `running` -> `review` transition, the app SHALL play a notification sound if and only if the global Notification reminder preference is enabled. The sound SHALL be synthesized via the Web Audio API at a moderate, clearly audible volume, and playback failures SHALL be silent.

#### Scenario: Sound plays when reminder enabled on running to review
- **WHEN** an issue transitions from `running` to `review`
- **AND** the Notification reminder preference is enabled (`Yes`)
- **THEN** the app plays a synthesized notification sound via the Web Audio API
- **AND** the sound plays at a moderate volume that is clearly audible

#### Scenario: No sound when reminder disabled
- **WHEN** an issue transitions from `running` to `review`
- **AND** the Notification reminder preference is disabled (`No`)
- **THEN** no notification sound is played

#### Scenario: No sound for other running exits
- **WHEN** an issue transitions from `running` to `completed` or `backlog`
- **THEN** no notification sound is played regardless of the preference value

#### Scenario: Silent on audio failure
- **WHEN** the Web Audio API is unavailable or playback throws
- **THEN** the failure is silent
- **AND** the status change and the rest of the hook are unaffected

