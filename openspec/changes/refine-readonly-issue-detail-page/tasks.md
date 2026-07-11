# Tasks: refine-readonly-issue-detail-page

## 1. 精简只读详情页「更多」菜单

- [x] 1.1 在 `issue-read-only-page.tsx` 的 `IssueMoreMenu` 中删除「查看会话」「查看总结」两个 `DropdownMenuItem`。
- [x] 1.2 从 `IssueMoreMenu` 的 props 与 `IssueReadOnlyPage` 的转发中移除只为这两个菜单项存在的字段（`hasLinkedSession`、`canViewSummary`、`canOpenAgentsActivity`、`onOpenLinkedSession`、`onOpenSummary`）；注意 `IssueReadOnlyPage` 仍需为右侧会话面板保留 `hasLinkedSession`、`canOpenAgentsActivity`、`onOpenLinkedSession`。
- [x] 1.3 移除 `issue-read-only-page.tsx` 中不再使用的 `MessageSquare` 导入（`FileText` 仍被附件渲染使用，保留）。
- [x] 1.4 在 `issues-activity.tsx` 中移除对 `IssueReadOnlyPage` 传递的 `canViewSummary`、`onOpenSummary`，并删除因此变为未使用的 `handleOpenSummary`、`canViewSummary`，以及失去入口的 `summaryIssueId` 状态、相关 `setSummaryIssueId` 调用与 `IssueSummaryDialog` 接线（保留组件文件）。

## 2. 修正只读详情页标题垂直间距

- [x] 2.1 删除 `issue-read-only-page.tsx` 中 `article` 下的两处 `issue-detail__divider`。
- [x] 2.2 调整 `app.css`：将 `.issue-page__content-shell--readonly` 顶部 padding 由 22px 调整为与底部一致的 18px，并把 `.issue-dialog__editor--readonly` 的 `gap` 由 0 调为 18px，使标题距 header 与距描述间距相等。

## 3. 修复从只读详情进入编辑后的返回目的地

- [x] 3.1 在 `issues-activity.tsx` 新增 `handleCancelEditable`：当编辑态由只读详情发起（`isReadOnlyEditRequested` 为真且存在 `selectedIssue`）时，回到只读详情页（清 `isReadOnlyEditRequested`、用 `issueToForm(selectedIssue)` 还原表单），否则沿用 `closeDialog`。
- [x] 3.2 将 `IssueEditablePage` 的 `onCancel` 由 `closeDialog` 改为 `handleCancelEditable`。

## 4. 验证

- [x] 4.1 运行 `pnpm format` / `lint` / `typecheck` / `test`（全量 576 用例通过；issues-activity 99 用例通过，含新增 1 个返回只读详情的回归测试）。
- [x] 4.2 运行 `openspec validate refine-readonly-issue-detail-page --strict`（通过）。

## 5. 测试连带维护

- [x] 5.1 移除针对「查看总结」菜单项与 summary 对话框的失效测试（summary 入口已删）。
- [x] 5.2 将经由「查看会话」菜单项打开会话的缓存清理测试改为经由右侧会话面板按钮触发；移除与双栏面板测试重复的会话打开测试。
- [x] 5.3 四个完成流程测试去掉末尾「查看总结」断言，改为断言完成后仍处于只读详情。
- [x] 5.4 移除因测试删除而未使用的 `crashedRunningIssue` 夹具。
