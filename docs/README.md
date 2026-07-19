# RedWhisk 文档索引

本文档是 `docs/` 的总入口。Agent 或开发者进入项目后，应先从这里判断本次任务需要读取哪些规范与知识文档。

## 文档分类

`docs/` 下文档按三类组织：

1. **标准通用类**：与 RedWhisk 具体业务无关，可复用于其他 TypeScript / Git / 协作项目的工程规范。
2. **架构与项目规范类**：与 RedWhisk 项目有关，约束目录边界、运行时架构、UI 布局、组件拆分和项目特定实现方式，但不记录具体业务能力细节。
3. **业务知识类**：描述某个功能、组件、Agent session、业务流程或调研结论的具体能力和行为。

## 标准通用类

- [TypeScript 工程规范](./standards/engineering-spec.md)
- [编码风格](./standards/coding-style.md)
- [Git 工作流规范](./standards/git-workflow.md)
- [发布与打包规范](./standards/release-workflow.md)
- [性能与并发规范](./standards/performance.md)

## 架构与项目规范类

- [Agent 开发通用规则](./architecture-design/agent-development-rules.md)
- [项目代码地图](./architecture-design/project-map.md)
- [Tauri Command 与 Event 契约](./architecture-design/tauri-contract.md)
- [Agent Provider 协议](./architecture-design/agent-provider-protocol.md)
- [Worktree 与 Git 生命周期](./architecture-design/worktree-git-lifecycle.md)
- [RedWhisk 设计系统指南](./architecture-design/design-guide.md)
- [Settings 页面布局规范](./architecture-design/settings-page-layout.md)
- [前端大型组件拆分规则](./architecture-design/frontend-large-component-splitting-rules.md)
- [后端 Rust 大文件拆分规则](./architecture-design/backend-large-file-splitting-rules.md)
- [后端 feature-first 重构方案（已完成，历史执行计划）](./architecture-design/backend-feature-first-refactor.md)

## 领域、数据与质量

- [领域状态机](./domain/state-machine.md)
- [数据模型与 Migration](./domain/data-model.md)
- [测试与验证策略](./testing/strategy.md)
- [架构决策记录](./adr/README.md)

## Agent 技能与开发流程

- [领域上下文布局](./agents/domain.md)
- [Issue tracker 技能](./agents/issue-tracker.md)
- [Triage 标签](./agents/triage-labels.md)

## 业务知识类

业务知识文档用于记录具体功能、能力、调研、方案和历史设计事实。读取时应按任务相关性选择，不要求所有任务默认读取。

- `docs/survey/`：调研、竞品分析和能力差距分析。
- `docs/superpowers/specs/`：具体功能设计规格。
- `docs/superpowers/plans/`：具体功能实施计划。

## 读取顺序建议

- 所有任务：先读本索引，再按下表选择最小必要文档；代码事实以链接的源码为最终依据。

| 改动类型                      | 必读文档                                                                                       | 追加阅读                           |
| ----------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------- |
| TypeScript / TSX              | 工程规范、编码风格、[前端大型组件拆分规则](./architecture-design/frontend-large-component-splitting-rules.md) | [项目代码地图](./architecture-design/project-map.md)、[测试策略](./testing/strategy.md) |
| Rust（`src-tauri/**/*.rs`）   | [后端 Rust 大文件拆分规则](./architecture-design/backend-large-file-splitting-rules.md)、Agent 开发规则 | [项目代码地图](./architecture-design/project-map.md) |
| UI、页面或组件                | 上述 TypeScript 文档、设计系统指南、大型组件拆分规则                        | Settings 页面布局规范、i18n 章节   |
| Tauri command、DTO、event     | [Tauri 契约](./architecture-design/tauri-contract.md)                       | Agent 开发规则、测试策略           |
| Issue、Session 或完成流程     | [领域状态机](./domain/state-machine.md)                                     | 数据模型、Worktree 与 Git 生命周期 |
| SQLite、repository、migration | [数据模型与 Migration](./domain/data-model.md)                              | Agent 开发规则、测试策略           |
| Codex 或 Claude provider      | [Agent Provider 协议](./architecture-design/agent-provider-protocol.md)     | Tauri 契约、状态机                 |
| Worktree、Git 完成或清理      | [Worktree 与 Git 生命周期](./architecture-design/worktree-git-lifecycle.md) | 状态机、数据模型                   |
| Git 提交                      | Git 工作流规范                                                              | 测试策略                           |
| 发布或打包                    | 发布与打包规范                                                              | Git 工作流规范                     |
| 后端命令、git 操作、轮询性能   | [性能与并发规范](./standards/performance.md)                                | Tauri 契约、Worktree 与 Git 生命周期 |
