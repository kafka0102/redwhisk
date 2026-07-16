# ADR 0008：变更视图提升为顶层 Activity 并按运行态条件轮询

## 状态

采纳（实现由后续 spec / tickets 驱动）。部分延伸 [ADR-0005](./0005-extract-shared-workspace-changes-view.md) 第 4 条关于「代码工作区侧不做轮询」的描述，但不推翻其核心决策。

## 背景

当前「变更」视图是「代码」Activity（`src/features/code/code-workspace.tsx`）左侧栏的一个 viewType，与「文件」通过左上下拉切换。变更视图的渲染件已按 ADR-0005 抽取为共享模块，数据由 `useCodeWorkspaceChanges`（以 `workspacePath` 为键）在进入视图时拉取一次、支持手动刷新，不做轮询。

业务上「查看分支变更」与「浏览代码文件」是两类独立、高频交替的操作，挤在同一个 Activity 的下拉切换里：顶层菜单进入后还要再切一次 viewType，且两侧共享同一组 tabs / 编辑器状态。同时变更数据完全靠手动刷新，Agent turn 进行中无法及时反映 worktree 的文件改动。

## 决定

1. **提升为顶层 Activity**：新增 `ActivityKey = "changes"`，菜单项置于 code 与 terminals 之间（第 4 项），文案「变更 / Changes」（新增 `messages.app.changes`），图标 `GitBranch`。新页面与 CodeWorkspace 同构：两栏布局，左栏 = 分支下拉（不设刷新按钮）+ 变更视图（复用 ADR-0005 共享渲染件与 `useCodeWorkspaceChanges`），右栏 = 只读编辑器，点击变更文件后以 Monaco 打开。
2. **复用而非复制**：不新建一套编辑器 / tabs / 面包屑逻辑，改为给 `CodeWorkspace` 增加受控 `view: "files" | "changes"` 入参，移除其内部的「文件 / 变更」下拉与 `viewType` 状态。「代码」Activity 以 `view="files"` 渲染（纯文件树 + 编辑器，保留文件树刷新按钮），「变更」Activity 以 `view="changes"` 渲染（无刷新按钮）。两个 Activity 共用 `codeWorkspaceStateCache`（按 projectId），共享选中根、tabs、侧栏宽度等状态（视为特性：跨 code / changes 切换保持一致）。缓存结构移除已无意义的 `viewType` 字段。
3. **条件轮询刷新**：仅「变更」Activity 启用自动刷新，节奏由「页面可见性 × 当前 worktree 是否有 running turn」决定：
   - 页面隐藏（Activity 非激活或 `document.hidden`）→ 暂停轮询；
   - 可见 + 当前选中 worktree 上存在 `status === "running" && isTurnRunning === true` 的 Agent session → 每 4s 刷新一次；
   - 可见 + 无 running → 每 8s 刷新一次；
   - 切换分支、或由隐藏恢复可见 → 立即补拉一次。

   running 判定经 `listAgentSessions(projectId)` 全量取回后按选中根 `workspacePath` 过滤（无按 worktree 取 session 的专用 command），并监听 `agent-session-list-changed` 事件及时重算 running 标志，避免节奏滞后。
4. **刷新范围与错误停轮询**：每次轮询同时刷新未提交变更与已提交历史。沿用 `isWorkspaceRootInaccessibleError` 模式：worktree 不可恢复（目录被删 / 移）时停止轮询；因「变更」页无手动刷新按钮，恢复时机改为「页面再次可见 / 切换分支」时自动重试，错误持续则再次停止。
5. **i18n**：新增 `app.changes`（zh / en）；变更视图内既有文案继续复用 `agentsFeature` 既有 key，不新增散落硬编码。

## 后果

- 顶层菜单由 5 项变 6 项；「代码」Activity 简化为纯文件浏览，去除 viewType 切换的认知负担与相关 cache 字段。
- `CodeWorkspace` 由「自持 viewType」变为「受控 view」，组件名对「变更」场景略勉强，但避免了几百行编辑器逻辑的重复；代价是单一组件承载两个 Activity，后续若两侧表现分化需以 props 扩展，而非各自改一份。
- 两个 Activity 共享同一缓存：在 code 页打开的文件会出现在 changes 页（反之亦然），这是预期的一致性，但意味着选中根 / tabs 不再按 Activity 隔离。
- 条件轮询带来定时请求：可见 + running 时最高每 4s 一次 `getProjectWorktreeChanges` + `getProjectWorktreeCommitHistory`，外加周期性 `listAgentSessions`；隐藏时归零，资源可控。
- 与 ADR-0005 第 4 条「代码工作区侧不做轮询」部分冲突：本决策为独立的「变更」Activity 引入条件轮询；ADR-0005 的核心（变更视图渲染件抽取为共享模块、两侧一致）仍然有效，不被推翻。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 变更页右栏改为 diff 视图（左变更列表 + 右 git diff） | 更像专业变更页且可复用 `readProjectWorktreeDiff`，但引入用户未要求的 diff 能力，超出「迁移」范围 |
| 复制一套编辑器 / tabs / 面包屑到新变更页 | 跨 Activity 重复数百行，违反 DRY，两侧一致性需人工维护 |
| 抽取共享「工作区编辑器」组件再由两侧组合 | 方向正确但重构量大、测试面广；受控 view 入参已能零重复满足需求 |
| 固定间隔轮询（不感知 running） | turn 进行中刷新偏慢、闲置时浪费请求；条件轮询更贴合「有任务在跑就勤刷」的诉求 |
| 纯事件驱动（仅听 agent-session-list-changed，不轮询） | 文件系统改动不产生该事件，turn 进行中的磁盘变更会感知滞后 |

## 代码事实来源

- 本决策记录：`docs/adr/0008-changes-promoted-to-activity-with-conditional-polling.md`
- 领域语言：`CONTEXT.md`（变更 Activity、代码工作区）
- 现有实现：`src/features/code/code-workspace.tsx`、`code-workspace-cache.ts`（外壳与共享缓存）；变更专属件 `code-workspace-changes-view.tsx`、`use-code-workspace-changes.ts`、`use-changes-auto-refresh.ts` 已迁至 `src/features/changes/`（见 [ADR-0009](./0009-changes-split-into-own-feature-dir.md)）
- Activity / 菜单：`src/app/app-shell.tsx`（`ACTIVITIES`）、`src/app/activity-router.tsx`（`ActivityKey`、`ActivityRouter`）
- 运行态信号：`src/features/agents/agent-session-commands.ts`（`AgentSessionStatus`、`isTurnRunning`、`workspacePath`）、`agent-session-list-changed` 事件
- 轮询 / 可见性先例：`src/features/agents/use-session-workspace-cache.ts`、`use-agent-session-notifications.ts`、`src/features/terminals/terminal-surface.tsx`（`document.visibilityState`）
- 相关 ADR：[ADR-0005](./0005-extract-shared-workspace-changes-view.md)（共享渲染件抽取；本 ADR 延伸其「不轮询」描述）
