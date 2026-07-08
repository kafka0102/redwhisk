# Design

## 现状与状态机

详情态由 `IssuesActivity` 内部状态决定，`AppShell` 不持有：

- 看板：`dialogMode === null`。
- 只读详情：`dialogMode === "edit"` 且 `isEditablePageOpen === false`（非 backlog issue、未发起只读编辑）。
- 编辑态：编辑页打开（`isEditablePageOpen === true`），来源为 backlog issue 详情、只读页发起的编辑，或 `dialogMode === "create"`。
- 创建态：`dialogMode === "create"`。

`isEditablePageOpen = Boolean(dialogMode && (isBacklogDialog || isReadOnlyEditRequested))`，`isBacklogDialog = dialogMode === "create" || selectedIssue?.status === "backlog"`。

「最左侧 Issue 菜单图标」即 `AppShell` 活动栏第一个按钮（`ACTIVITIES` 中 `key === "issues"`，Kanban 图标）。其 `onClick` 当前仅 `setActiveActivity(key)`；当已经处于 Issues Activity 时，`IssuesActivity` 不会重挂载，点击为空操作。

## 父→子通信方案

返回逻辑依赖 `IssuesActivity` 持有的 `dialogMode`、`form`、`selectedIssue`、`isSaving`，`AppShell` 不感知这些。采用「信号计数 prop」下传，与现有 `requestedIssueId` 的 prop 下传风格一致：

- `AppShell` 新增 state `const [issuesReturnSignal, setIssuesReturnSignal] = useState(0)`。
- 活动 Issue 图标 `onClick`：
  - 若 `key === "issues" && activeActivity === "issues" && !isGlobalSettingsOpen` → `setIssuesReturnSignal((n) => n + 1)`（IssuesActivity 已挂载，触发返回）。
  - 否则 → 维持现有 `setActiveActivity(key)` + `setIsGlobalSettingsOpen(false)`（切换 Activity 或关闭全局设置）。
- 经 `ActivityRouter` 把 `issuesReturnSignal` 作为可选数值 prop（默认 0）传给 `IssuesActivity`。

## IssuesActivity 消费信号

用「前值 ref」避免挂载即触发：

```ts
const previousSignalRef = useRef(issuesReturnSignal);
useEffect(() => {
  if (previousSignalRef.current === issuesReturnSignal) {
    return;
  }
  previousSignalRef.current = issuesReturnSignal;
  handleIssuesIconReturn();
}, [issuesReturnSignal]);
```

`handleIssuesIconReturn`：

```ts
function handleIssuesIconReturn() {
  if (!dialogMode || isSaving) {
    return; // 看板或保存中：不响应
  }
  if (isEditablePageOpen && isFormDirty()) {
    return; // 编辑/创建态且有改动：保护未保存编辑
  }
  closeDialog(); // 只读详情，或编辑/创建态无改动：返回看板
}
```

从其他 Activity 切回 Issues 时 `IssuesActivity` 重挂载，`previousSignalRef` 初值等于当前信号 → 不触发返回，行为正确。

## 表单脏比较

`IssueFormState = { title; description; attachments; labelIds }`。

- 创建态基线：`EMPTY_FORM`。
- 编辑态基线：`issueToForm(selectedIssue)`（与打开编辑页时填入的表单同源，round-trip 稳定）。

`isFormDirty()` 当 `dialogMode === "create"` 时对比空表单，否则对比 `issueToForm(selectedIssue)`，逐字段比对：

- `title`：直接字符串比较。
- `description`：两端 `trim` 后比较（保存时本就 `trimEnd`，trim 可吸收纯空白差异）。
- `attachments`：比较数量与每个附件的稳定标识（已保存附件比 `id`、新增草稿比 `token`，再比 `displayName` 与 `kind`）。
- `labelIds`：作为有序数组比较（选择顺序即提交顺序，顺序变化视为改动）。

任一字段不同即判定为「有变化」。

## 边界与不变量

- `closeDialog()` 内已有 `isSaving` 守卫与触发器焦点恢复，复用即可。
- 缓存（`issuePageStateCache`）由现有依赖 `dialogMode` 的 effect 清理，返回后回到看板符合既有行为。
- 不修改活动栏其他三个图标（agents / terminals / settings）行为，不修改全局设置按钮。
- 不引入后端命令、不修改数据库。
