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

## 架构与项目规范类

- [Agent 开发通用规则](./architecture-design/agent-development-rules.md)
- [RedWhisk 设计系统指南](./architecture-design/design-guide.md)
- [Settings 页面布局规范](./architecture-design/settings-page-layout.md)
- [前端大型组件拆分规则](./architecture-design/frontend-large-component-splitting-rules.md)

## 业务知识类

业务知识文档用于记录具体功能、能力、调研、方案和历史设计事实。读取时应按任务相关性选择，不要求所有任务默认读取。

- `docs/survey/`：调研、竞品分析和能力差距分析。
- `docs/superpowers/specs/`：具体功能设计规格。
- `docs/superpowers/plans/`：具体功能实施计划。

## 读取顺序建议

- 所有任务：先读本索引，再读任务涉及类型的子索引。
- 代码改动：读标准通用类中的工程规范与编码风格，再读对应架构与项目规范。
- UI / 前端结构改动：读设计系统指南、对应页面布局规范，以及前端大型组件拆分规则。
- Git 提交：读 Git 工作流规范。
