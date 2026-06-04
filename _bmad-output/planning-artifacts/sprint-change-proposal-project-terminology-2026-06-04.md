# Sprint Change Proposal：将 Workspace 概念调整为 Project

**Date:** 2026-06-04T15:54:45+0800
**Project:** redwhisk
**Mode:** Batch
**Status:** Applied

## 1. 问题摘要

用户明确要求“workspace 改成 project”。当前 RedWhisk 规划文档把本地 Git Repository 入口命名为 `Workspace`，并派生出 `Workspace Settings`、`WorkspaceAgentOverride`、`workspaces` 表、`workspace_id` 字段和 `workspace-created` 事件等命名。该命名需要统一调整为 `Project`，避免下一步 story 创建和实现继续沿用旧领域概念。

本次变更不改变 MVP 能力范围：`Project` 仍然表示绑定本地 Git Repository 的一等领域实体，是 Issue、Agent Session、Completion Policy 和日志索引的边界。

## 2. 影响分析

### 受影响范围

- PRD：术语表、FR-1 至 FR-4、FR-8、FR-9、FR-13、FR-21、成功指标和开放问题。
- PRD addendum：模块边界、command/event 表、SQLite schema、IA、里程碑。
- Epics：FR inventory、coverage map、Epic 1 标题与 stories、后续 stories 中的当前上下文引用。
- Architecture：需求概览、数据架构、命名规范、目录结构、测试映射。
- UX Experience：Project Picker、Project Settings、空态、路径异常、用户旅程。
- Sprint status：未开始的 story key 中含 `workspace` 的条目同步改为 `project`。

### 不处理范围

- 历史 brainstorming 原始记录不重写，保留当时输入语境。
- `docs/standards` 中 TypeScript / monorepo `workspace` 属于工程工具概念，不是产品领域概念，本次不改。
- 绝对路径 `/Users/yujianjia/workspace/...` 是本机目录，不改。

## 3. 推荐方案

采用 Direct Adjustment：当前还未创建任何 story 文件，`sprint-status.yaml` 中所有 story 仍为 `backlog`，可以直接同步规划文档和状态 key，成本最低且不会破坏已完成实现。

命名决策：

- 领域实体：`Workspace` -> `Project`
- 设置实体：`WorkspaceSettings` -> `ProjectSettings`
- 覆盖实体：`WorkspaceAgentOverride` -> `ProjectAgentOverride`
- 数据表：`workspaces` -> `projects`
- 数据表：`workspace_settings` -> `project_settings`
- 数据表：`workspace_agent_overrides` -> `project_agent_overrides`
- 外键字段：`workspace_id` -> `project_id`
- 事件：`workspace-created` / `workspace_created` -> `project-created` / `project_created`
- 前端 feature：`features/workspace` -> `features/project`

## 4. 详细变更

已将核心规划产物中的用户可见、数据模型、事件、目录结构和 story 标题统一为 Project 体系。

代表性变更：

- `FR-1：创建 Git Workspace` 改为 `FR-1：创建 Git Project`
- `Workspace Settings` 改为 `Project Settings`
- `WorkspaceAgentOverride` 改为 `ProjectAgentOverride`
- `workspaces` / `workspace_id` 改为 `projects` / `project_id`
- `workspace-created` 改为 `project-created`
- `1-3-create-git-workspace` 改为 `1-3-create-git-project`

## 5. 实施交接

变更范围分类：Minor / Moderate 之间，偏 Minor。它改变命名合同，但不改变功能范围、状态机语义或实现顺序。

下一步应先重新创建 story：

1. 运行 `bmad-create-story`，从更新后的 `sprint-status.yaml` 生成第一条 story。
2. 实现时使用 `Project` 命名体系，不再新建 `workspace_*` 领域表、字段、事件或模块。
3. 若未来需要表达包管理器或 monorepo workspace，应在文档中明确写作“工程 workspace”或“package workspace”，避免和产品 `Project` 混淆。
