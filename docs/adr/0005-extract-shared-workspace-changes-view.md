# ADR 0005：工作区变更视图渲染件抽取为共享模块

## 状态

已采纳。

## 背景

代码工作区左侧栏需要新增「变更」视图，展示当前分支工作区的「未提交变更」与「已提交变更时间轴」，且内容须与 Agent 会话页右侧侧栏的变更面板（`SessionChangesPanel`）**一致**：相同的未提交文件行、相同的时间轴、相同的「已推送云端 = 紫、本地 = 蓝」着色，以及「第一条云端记录右侧显示分支名 Tag」。

这些渲染逻辑目前内聚在 `src/features/agents/session-changes-panel.tsx` 中，仅被 Agent 会话页一处消费。代码工作区属于另一个 feature（`src/features/code/`）。若直接在代码工作区内复制一套渲染，会形成跨 feature 的重复，且两处「一致」只能靠人工同步维护。

## 决定

1. **抽取共享渲染件**：将 `session-changes-panel.tsx` 中的提交时间轴、未提交文件行、云端 / 本地着色修饰、第一条云端记录 Tag、单条提交展开等渲染逻辑，移动到共享工作区模块（`src/shared/workspace/`），由 Agent 会话面板与代码工作区两侧共同引用。
2. **先预构、行为不变**：抽取作为独立的前置步骤完成，迁移会话面板到引用共享件后，会话面板的现有行为与测试保持完全一致；随后代码工作区再消费共享件。
3. **共享件沿用既有 i18n**：渲染所需文案继续使用 `agentsFeature` 既有 key（`pushedToRemote`、`noUncommittedChanges`、`noCommittedChanges` 等），访问方式与现状一致，不新增散落硬编码文案。
4. **数据获取不共享**：仅渲染件共享。Agent 会话页继续用绑定 `sessionId` 的既有缓存 hook；代码工作区新建以 `workspacePath` 为键的轻量 hook（`useCodeWorkspaceChanges`），两侧按各自生命周期拉取，互不耦合。

## 后果

- 两处「变更」视图保持一致的成本降低：渲染逻辑只有一份事实源。
- `src/shared/workspace/` 多承担一个与 Git 变更展示相关的渲染模块；该目录本就承载工作区相关共享 UI（文件树面板等）与命令客户端，归属合理。
- 会话面板由「自包含」变为「引用共享件」，出现一层跨层依赖（feature → shared），但方向正确（feature 依赖 shared，非反向）。
- 未来若变更视图渲染需要分化（两侧表现不一致），需以 props 或变体扩展，而非直接改共享件单点。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 在代码工作区内复制一套渲染 | 跨 feature 重复，「一致」需人工同步，维护成本高 |
| 让代码工作区直接 import 会话面板内部件 | 跨 feature 引用未导出的内部实现，违反特性边界、脆弱 |
| 把渲染件留在会话 feature 内、向代码工作区导出 | 共享方向应为 feature → shared，而非 feature → feature |
| 抽取时一并抽公共数据 hook | 两侧数据生命周期不同（sessionId vs workspacePath、轮询策略不同），强行合并增加耦合 |

## 事实来源

- 本决策记录：`docs/adr/0005-extract-shared-workspace-changes-view.md`
- 规格锚点：`.scratch/code-workspace-changes-view/spec.md`
- 待抽取来源：`src/features/agents/session-changes-panel.tsx`
- 共享目录约定：`src/shared/workspace/`（文件树面板、工作区命令客户端）
- 领域语言：`CONTEXT.md`（代码工作区、代码工作区变更视图）
