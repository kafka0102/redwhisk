## Context

当前 Settings 已有左右两栏、可拖动 splitter 和 `SettingsContentFrame`。General 使用 `settings-card settings-general-card` 表单；Agents 当前拆成 Project Agents 与 Global Agents 两个 section，并在 section header 中各自提供新增按钮。`AgentProfileForm` 已具备 `detectCodexCommand`、`testAgentCommand`、`listAgentSkills` 和 `agent-skills-updated` 订阅，但表单字段顺序、scope 来源和展示方式需要调整。

现有 agent 类型在 TypeScript 中是 `codex | claude`。用户文案中的 `cloud code` 按现有系统语义理解为 Claude Code，在 UI 上显示为 `Claude Code`，保存值继续使用 `claude`，避免本次改版引入数据迁移。

## Layout Direction

Settings 右侧内容由统一的内容容器控制宽度：

- 容器宽度为右侧区域的 `80%`。
- 容器水平居中。
- 窄屏或右侧区域较小时仍需通过 `max-width` / `min()` / `width: min(80%, ...)` 等 CSS 约束避免溢出。
- General card 不设置固定高度，让内容自然撑开。
- 后续 Settings 菜单页默认复用该容器，不在单页重复定义不同宽度规则。

Agents 页面内容顺序：

1. Settings 右侧 frame 标题显示 `Agents`。
2. 标题下方渲染一个 action card，右上角有 `+ New agent`。
3. card 下方渲染 profiles table。

## Agents Table

table 数据源合并当前项目 profiles 与全局 profiles。列顺序固定为：

1. Type：显示 Codex / Claude logo 图片，并提供可访问文本。
2. Name：显示 profile name。
3. Command：显示 profile command；如果保存的是路径，展示时可按 basename 收敛为命令名，但不改变存量数据。
4. Scope：显示 `Global` 或 `Project`。
5. Workflow Skill：显示 default skill；为空时显示空态占位。

点击已有 row 可继续进入编辑弹窗；编辑行为不扩大到删除、批量操作或新数据模型。

## New Agent Dialog

新增入口统一打开 `New agent` dialog，不再由入口决定 Project / Global。表单字段顺序：

1. Name：用户输入。
2. Type：默认 `codex`；另一个选项显示为 `Claude Code`，保存为 `claude`。
3. Command：创建时自动检测当前类型命令，并将检测结果转换为命令名（例如 `/usr/local/bin/claude` 显示为 `claude`）；用户可编辑。输入右侧提供 `测试` 小按钮，调用 `testAgentCommand`。
4. Scope：默认 `Global`；可切换 `Project`。
5. Workflow Skill：按当前 Type + Scope 查询并展示可选项。Global 只展示全局项；Project 只展示当前项目项。每个选项展示 skill 名称和浅灰路径。

隐藏字段保存策略：

- `mode` 保存为当前系统默认模式对应值，并启用 `dangerous: true`。
- `promptTemplate` 保存为空字符串。
- 编辑已有 profile 时不展示 Prompt Template；如现有 profile 有旧值，本次改版不提供编辑入口。为避免静默丢失，编辑保存应保留旧值，新增保存使用空字符串。

## Validation

实现阶段至少运行：

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test -- src/features/settings/project-settings-activity.test.tsx`

如修改共享 command wrapper 或 Rust command 行为，再运行受影响的共享前端测试或 Rust 测试。
