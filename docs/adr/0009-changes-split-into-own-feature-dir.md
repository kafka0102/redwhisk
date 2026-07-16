# ADR 0009：变更专属件从 code 拆分到独立 features/changes

## 状态

采纳。延伸 [ADR-0008](./0008-changes-promoted-to-activity-with-conditional-polling.md) 的文件归属，不改变其「两侧复用同一 CodeWorkspace 外壳」的核心决策。

## 背景

ADR-0008 把「变更」提升为顶层 Activity 时，为避免重复数百行编辑器逻辑，刻意让 code / changes 两个 Activity 复用同一 `CodeWorkspace`（受控 `view`），变更相关的渲染件与数据 hook 一并放在 `src/features/code/`。此后变更侧新增了 `useWorktreeRunningSession`（running 检测）与条件轮询，变更专属代码量与职责已独立成面，继续塞在 `code/` 下让「代码」feature 承载了不属于它的变更轮询 / running 检测逻辑，目录与职责边界模糊。

## 决定

1. 新建 `src/features/changes/`，把变更专属件迁入：`code-workspace-changes-view.tsx`（变更视图）、`use-code-workspace-changes.ts`（变更数据 hook）、`use-changes-auto-refresh.ts`（running 检测 + 条件轮询），及其单测。
2. `CodeWorkspace` 外壳与 `code-workspace-cache.ts`（按 projectId 供 code / changes 两侧共享的缓存）仍留在 `src/features/code/`——ADR-0008「两侧复用同一外壳与编辑器」的核心不变，只把变更侧「视图 + 数据 + 轮询」从外壳所在目录剥离。
3. 不重命名迁移的文件与导出符号（`CodeWorkspaceChangesView`、`useCodeWorkspaceChanges` 等），仅改目录与 import 路径，作为轻量拆分；后续若两侧表现分化再评估更名。

## 后果

- `src/features/code/` 只剩 CodeWorkspace 外壳、共享缓存与外壳测试，职责清晰；变更的轮询 / running 检测归 `features/changes/`。
- 跨 feature 引用增加一层：`code/code-workspace.tsx` 从 `../changes/...` 引入变更视图与 hooks（方向 feature→feature，与 ADR-0005 的 feature→shared 同向，可接受）。
- 文件名仍带 `code-workspace-` 前缀、落在 `changes/` 略有历史包袱；轻量拆分刻意不更名以控制影响面。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 维持 `features/code/` 共置（ADR-0008 现状） | 变更侧职责已独立成面，共置让 code feature 承载无关的轮询逻辑，边界模糊 |
| 彻底独立（变更自带 Activity 外壳 + 编辑器） | 重复 ADR-0008 明确要避免的编辑器逻辑，违背其核心决策 |
| 拆分同时重命名为 `changes-view` / `use-changes` | 影响面更大（符号 + 全部引用 + 测试 mock），与「轻量」目标不符 |

## 代码事实来源

- 本决策记录：`docs/adr/0009-changes-split-into-own-feature-dir.md`
- 领域语言：`CONTEXT.md`（变更 Activity、代码工作区）
- 变更专属件：`src/features/changes/code-workspace-changes-view.tsx`、`use-code-workspace-changes.ts`、`use-changes-auto-refresh.ts`
- 共享外壳（留 code/）：`src/features/code/code-workspace.tsx`、`code-workspace-cache.ts`
- 相关 ADR：[ADR-0008](./0008-changes-promoted-to-activity-with-conditional-polling.md)（复用 CodeWorkspace；本 ADR 延伸其文件归属）
