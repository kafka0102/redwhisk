# 核心约束：必须遵守 docs/ 规范文档

## 前置要求：先读取相关规范

Agent 在执行任何任务前，**必须**先确认本次任务涉及哪些规范文档，并读取对应的 docs/ 文件：

- **所有任务默认需要读取**：
  - `docs/README.md` - docs 总索引与三类文档分类
  - `docs/architecture-design/agent-development-rules.md` - Agent 开发通用规则

- **涉及 TypeScript/代码改动时**：
  - `docs/standards/engineering-spec.md` - TypeScript 工程规范
  - `docs/standards/coding-style.md` - 编码风格

- **涉及 UI/设计/前端结构改动时**：
  - `docs/architecture-design/design-guide.md` - 设计系统指南
  - `docs/architecture-design/frontend-large-component-splitting-rules.md` - 前端大型组件拆分规则（涉及大型页面、Activity、组件拆分时）
  - `docs/architecture-design/settings-page-layout.md` - Settings 页面布局规范（如适用）

- **涉及 Git 提交时**：
  - `docs/standards/git-workflow.md` - Git 工作流规范

## 规范优先级

1. 用户明确要求 >
2. docs/\*\* 正式文档 >
3. AGENTS.md >
4. 外部 skill / workflow / 模板默认行为

当规范之间存在冲突时，以更具体的文档为准：

- `docs/architecture-design/agent-development-rules.md` 的特定规则 > 本文件的通用规则
- `docs/standards/` 下的专项规范 > 概括性说明

## Git Commit Rule

- Agent 完成当前任务并完成必要验证后，应自动创建一次 git commit。
- 自动提交顺序固定为：完成任务 -> 运行该任务所需验证 -> 暂存当前任务相关文件 -> 创建 git commit。
- 自动提交只能包含当前任务直接相关的文件，禁止混入无关改动。
- 如果工作区中存在无法安全归属到当前任务的无关改动，Agent 自动提交当前任务直接相关的文件。
- 对代码改动，`必要验证` 不能只写成笼统描述，必须落成实际命令清单；未执行的命令不能口头视为“已验证”。
- 只要改动了 TypeScript / JavaScript 源码，默认至少运行受影响包的 `lint` 与 `typecheck`。
- 只要改动了运行时行为、分支逻辑、数据流、渲染逻辑或测试用例依赖的实现，除 `lint` 与 `typecheck` 外，还必须运行受影响范围内的 `test`。
- 若因环境、耗时或外部依赖限制无法运行某项验证，必须在最终说明中明确写出“未运行什么、为什么没运行、风险在哪”。

## 开发完成自检清单（强制）

每次完成 TypeScript / TSX / JavaScript 改动后，**必须**按顺序执行并确认通过，缺一不可：

1. `pnpm format` — 格式化本次改动涉及的文件
2. `pnpm lint` — ESLint 检查
3. `pnpm typecheck` — TypeScript 类型检查
4. `pnpm test` — 改动运行时行为 / 分支逻辑 / 数据流 / 渲染逻辑或测试用例依赖实现时必跑；纯类型或纯样式改动可豁免，但需在最终说明中写明豁免理由

说明：

- 当前环境 `pnpm` 不在默认 PATH，需先加载 node：`export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"`。
- 任何一项未通过不得提交；不得用 `@ts-ignore`、`@ts-nocheck`、`eslint-disable`、跳过测试等手段掩盖问题来强行通过。
- 因环境、耗时或外部依赖限制无法运行某项时，最终说明必须明确写出「未运行什么、为什么、风险是什么」。
- 本清单是 `docs/architecture-design/agent-development-rules.md`「测试与验证规则」与 `docs/standards/coding-style.md`「格式与提交前检查」的强制执行入口；三者冲突时以本清单命令顺序为准。

## Language Rule

- 除非用户明确要求使用其他语言，所有说明性文字默认使用简体中文。
- 此规则适用于主 Agent 与所有子 Agent / delegated agents，不能因为使用 skill、workflow、subagent 或模板而切换为英文。
- 所有生成到 `docs/` 下的 Markdown 文档，正文、标题、分析、结论、步骤说明默认使用简体中文。
- 代码、命令、日志原文、API 名称、协议字段、环境变量名、文件名、路径、TypeScript/SQL/Prisma 标识符保持原样，不做翻译。
- 如果模板或工具预置了英文标题，允许保留固定文件名与少量固定英文 token，但正文内容必须使用简体中文；若无兼容性要求，优先直接使用中文标题。
- 在 spawn / Task / delegation 场景下，发给子 Agent 的 prompt 应显式重复“默认使用简体中文输出说明文字”这一要求，避免子 Agent 丢失语言上下文。

## Frontend I18n Rule

- 所有前端页面、弹窗、Drawer、Popover、空态、加载态、错误态、按钮、表单标签、`placeholder`、`title`、`aria-label`、状态文案与用户可见提示文本，默认都必须接入国际化，不得新增散落硬编码文案。
- 本规则适用于 `src/app/**`、`src/features/**`、`src/components/ui/**` 中直接面向用户展示文本的代码；演示页、设计系统页、内部原型页只要能在应用内打开，也同样适用。
- 国际化实现优先复用 `src/shared/i18n/**`：通用文案放入共享消息字典；单个 feature 的复杂文案可放入该 feature 内部的 formatter / messages helper，但仍必须由当前 locale 驱动。
- 新增页面或改动页面时，若发现相邻区域仍存在未国际化文本，应在当前任务范围内一并处理，避免继续扩大中英文混杂状态。
- 不得通过“默认英文 + 局部中文补丁”维持长期状态；所有支持的 locale 必须提供完整对应文案，缺失时应在实现阶段补齐，而不是留空或直接回退硬编码字符串。

## Karpathy 风格编码纪律

- 编码前先思考：开始实现前显式说明关键假设、歧义和取舍；如果需求存在多个合理解释，先澄清或列出默认选择，不能静默猜测。
- 简单优先：只实现当前任务需要的最小方案；禁止提前加入未被要求的抽象、配置、扩展点、缓存、通知、兼容层或“顺手功能”。
- 外科手术式修改：只修改与当前任务直接相关的代码；保持既有风格；不顺手重构、不改无关注释、不格式化无关文件；发现无关问题时只说明，不擅自处理。
- 目标驱动执行：把任务转成可验证目标；bugfix 优先先复现或补测试，功能开发要说明验收标准；多步骤任务要为每一步写明验证方式。
- 完成自检标准：每一处 diff 都必须能追溯到用户请求、项目文档或验证失败；无法解释来源的改动应撤回或单独征求确认。
- 适用范围：这些规则约束非平凡实现、重构、修复和评审；明显的一行 typo、格式修正或无歧义小改动可按常识快速处理，但仍不得混入无关改动。
