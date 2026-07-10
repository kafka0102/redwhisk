# issues-ui Specification Delta

## ADDED Requirements

### Requirement: Delete issue action relies on backend resource cleanup

Issue 详情中的删除 Issue 动作 SHALL 继续调用既有 `delete_issue` command；资源清理（session runtime、session log、RedWhisk worktree）由后端完成，前端不额外编排清理步骤。

#### Scenario: User confirms delete on issue detail

- **WHEN** 用户在 Issue 详情确认删除 Issue
- **THEN** 前端调用 `delete_issue`
- **AND** 删除成功后从列表移除该 Issue 并关闭详情
- **AND** 前端不单独调用 `delete_issue_worktree` 或 session 删除 API 作为删除 Issue 的前置条件
