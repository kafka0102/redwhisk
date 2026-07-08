# Tasks

## 1. 活动栏 Issue 图标触发返回信号

- [x] 1.1 在 `src/app/app-shell.tsx` 新增 `issuesReturnSignal` state（初始 0）。
- [x] 1.2 修改活动栏按钮 `onClick`：`key === "issues" && activeActivity === "issues" && !isGlobalSettingsOpen` 时递增信号；否则维持现有切换 Activity / 关闭全局设置逻辑。
- [x] 1.3 经 `ActivityRouter` 把 `issuesReturnSignal` 作为可选数值 prop（默认 0）下传。

## 2. IssuesActivity 消费信号并执行返回

- [x] 2.1 `IssuesActivity` 新增可选 prop `issuesReturnSignal?: number`（默认 0），在 `src/app/activity-router.tsx` 透传。
- [x] 2.2 新增「前值 ref」`useEffect`：信号变化时调用返回逻辑，挂载首帧不触发。
- [x] 2.3 实现返回分流：`!dialogMode || isSaving` 不响应；`isEditablePageOpen && isFormDirty()` 不响应；否则 `closeDialog()`。

## 3. 表单脏比较

- [x] 3.1 新增 `isFormDirty()`：创建态对比 `EMPTY_FORM`，编辑态对比 `issueToForm(selectedIssue)`。
- [x] 3.2 逐字段比较：`title` 直接比；`description` trim 后比；`attachments` 比数量与稳定标识（`id`/`token` + `displayName` + `kind`）；`labelIds` 有序比较。

## 4. 测试

- [x] 4.1 `issues-activity.test.tsx`：只读详情下递增信号 → 返回看板。
- [x] 4.2 `issues-activity.test.tsx`：编辑态无改动 → 返回看板；有改动 → 维持编辑页。
- [x] 4.3 `issues-activity.test.tsx`：创建态无改动 → 返回看板；有改动 → 维持创建页。
- [x] 4.4 `issues-activity.test.tsx`：看板态 / `isSaving` 时递增信号 → 无副作用。
- [x] 4.5 `issues-activity.test.tsx`：挂载首帧信号非 0 → 不触发返回。
- [x] 4.6 `app-shell` 相关测试：活动 Issue 图标在已处于 Issues 时递增信号，其他情况维持切换 Activity。

## 5. 验证

- [x] 5.1 `pnpm typecheck` 通过。
- [x] 5.2 `pnpm lint` 通过。
- [x] 5.3 `pnpm test` 相关用例通过（issue-form-dirty 11/11、issues-activity 102/102、app-shell 6/6）。注：全量 `pnpm test` 有 2 个预存在的无关失败位于 `src/features/agents/agents-activity.test.tsx`（"loads committed branch history…" / "opens a single replaceable changed-file tab…"），该文件直接渲染 `AgentsActivity`、不引入本次改动的任何模块，且失败在 base 提交 9b55d30 即已存在，与本次 change 无关。
- [x] 5.4 spec delta 文件已就位。
