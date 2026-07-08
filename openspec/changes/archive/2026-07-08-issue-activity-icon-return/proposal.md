## Why

在 Issue 页面，打开某个 Issue 后进入只读详情或编辑/创建页，目前只能通过页面右上角的「返回」按钮回到看板。最左侧活动栏的「看板 / Issue」图标在已经处于 Issues Activity 时点击是空操作，没有提供「再点一次回到看板」的快捷返回能力，用户要回到看板必须移动到右上角点返回。

希望复用最外侧 Issue 图标作为快捷返回入口：

- 处于只读 Issue 详情时，点击该图标直接返回看板。
- 处于编辑或创建状态时，点击该图标先检查内容是否有变化：有变化则不响应（保护未保存编辑），无变化则返回看板。
- 已经在看板时，点击维持现有空操作行为。

## What Changes

- 活动栏最左侧「Issue / 看板」图标在已经处于 Issues Activity 且非全局设置面板打开时，点击不再是无操作，而是触发 Issues 详情页的返回逻辑。
- 返回逻辑按当前详情状态分流：
  - 只读详情（`dialogMode === "edit"` 且未进入编辑页）→ 直接返回看板。
  - 编辑 / 创建态（编辑页打开）→ 比较当前表单与基线（创建态对比空表单，编辑态对比已保存 issue），有差异不响应，无差异返回看板。
- 保存进行中（`isSaving`）或已处于看板时不响应，避免破坏既有流程。
- 从其他 Activity（agents / terminals / settings）或全局设置面板点击 Issue 图标时，维持现有「切换到 Issues Activity」行为，不触发返回逻辑。

## Impact

- 受影响代码：
  - `src/app/app-shell.tsx`：活动栏 Issue 图标的 `onClick`，区分「已在 Issues 时触发返回信号」与「切换 Activity」。
  - `src/app/activity-router.tsx`：把返回信号 prop 下传给 `IssuesActivity`。
  - `src/features/issues/issues-activity.tsx`：消费返回信号，按详情状态与脏检查执行返回；新增表单脏比较辅助函数。
- 受影响能力：`issues-ui`（详情返回交互）。新增一条 Requirement，描述活动栏图标快捷返回行为。
- 不涉及数据库、迁移、后端命令或跨端联动，纯前端交互调整。
