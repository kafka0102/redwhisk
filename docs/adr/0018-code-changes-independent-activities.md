# ADR 0018：代码与变更拆分为完全独立的 Activity

## 状态

采纳。修订 [ADR-0008](./0008-changes-promoted-to-activity-with-conditional-polling.md)
「单一 CodeWorkspace + 受控 view + 跨 code/changes 共享选中根与缓存」的核心实现方案，
与 [ADR-0009](./0009-changes-split-into-own-feature-dir.md)「外壳留 code/」的文件归属。
不推翻两条 ADR 的「不复制编辑器逻辑」「条件轮询」等仍有效决策。

## 背景

ADR-0008 为控制重构量，让 code / changes 两个 Activity 复用同一 `CodeWorkspace`（受控
`view`），`code-workspace.tsx` 内用 `view === "changes" ? ... : ...` 三元分支区分两侧
渲染，并以单份 `codeWorkspaceStateCache` 共享选中根 / 侧栏宽度 / tabs。此后两侧职责
持续分化，单一外壳的 if-else 与共享状态成为各自独立演进的阻碍：业务上「在 code 选 A
分支、在 changes 选 B 分支、互不影响」成为明确诉求，而共享选中根无法满足。

## 决定

1. 拆为两个完全独立的 Activity 容器：`features/code/code-activity.tsx`、
   `features/changes/changes-activity.tsx`，各自持有独立的分支选择与缓存
   （`codeWorkspaceCache` / `changesWorkspaceCache`，按 projectId 物理隔离）。
2. 抽出无状态共享层供两者复用、零逻辑重复：`shared/workspace/use-workspace-shell.ts`
   （hook：roots 轮询 / selectRoot / 侧栏宽度拖拽 / root 失效切换）、
   `shared/workspace/workspace-shell.tsx`（布局组件：分支下拉 + splitter + sidebar/main
   双 slot）。`useCodeWorkspaceRoots` 一并迁入 `shared/workspace/`（依赖方向 shared→feature）。
3. 消除 `view` prop 与三元分支；`activity-router` 直接渲染两个 Activity。
4. 行为变化：`useCodeWorkspaceDiff` 改在 `ChangesActivity` 实例化——切到 code 时 changes
   卸载，diff 面板随之重置（不再跨 code↔changes 保留 diff）。该跨 Activity 保留此前无测试
   覆盖，且 changes 页右栏本就是 diff 而非 tabs，独立状态更贴合直觉。

## 后果

- code / changes 的分支选择、侧栏宽度、各自专属状态彻底隔离，满足「互不影响」诉求。
- `features/code/` 不再承载变更视图渲染与外壳；`code-workspace.tsx` 删除。
- 共享层位于 `shared/workspace/`，两个 Activity 各自调用，编辑器 / diff / 文件树逻辑零复制。
- diff 不再跨 code↔changes 保留：用户在 changes 打开 diff 后切到 code 再切回，diff 重置。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 维持 ADR-0008 受控 view 单外壳 | if-else 与共享选中根阻碍两侧独立演进，无法满足「分支互不影响」 |
| 各自复制一套编辑器 / splitter 逻辑 | 违反 ADR-0008「不复制编辑器逻辑」核心，DRY 退化 |
| 共享层留 `features/code/`（ADR-0009 既有归属） | changes 跨目录引用 code 违反独立性诉求；shared 更符合依赖方向 |

## 代码事实来源

- 本决策记录：`docs/adr/0018-code-changes-independent-activities.md`
- 独立 Activity：`src/features/code/code-activity.tsx`、`src/features/changes/changes-activity.tsx`
- 共享层：`src/shared/workspace/use-workspace-shell.ts`、`workspace-shell.tsx`、`use-code-workspace-roots.ts`
- 独立缓存：`src/features/code/code-workspace-cache.ts`、`src/features/changes/changes-workspace-cache.ts`
- 相关 ADR：[ADR-0008](./0008-changes-promoted-to-activity-with-conditional-polling.md)、[ADR-0009](./0009-changes-split-into-own-feature-dir.md)（被本 ADR 修订）
