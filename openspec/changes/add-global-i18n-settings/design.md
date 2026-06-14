## Context

当前项目是 React + TypeScript + Tauri 桌面应用。`AppShell` 的左侧 `activity-bar` 目前包含 `Issues`、`Agents`、`Settings` 三个项目级 Activity，点击 `settings` 后由 `ProjectSettingsActivity` 渲染 Project Settings。现有 `docs/standards/agent-development-rules.md` 明确区分 Project Settings 与 Global Settings，并曾规定 Global Settings 不放入 Activity Bar；本变更在该边界上做增量调整：全局 Settings 作为左侧菜单底部的独立图标入口出现，但不成为项目 Activity 列表中的同级项。

`ProjectSettingsActivity` 已有可复用的两栏 Settings 视觉语言：左栏菜单、splitter、右侧 `80%` 居中内容容器。全局 Preferences 应复用这套交互和视觉约束，但不复用 Project Settings 的业务表单字段，避免把 Project Name、Completion Policy 或 Agent Profile 混入全局偏好。

## Confirmed Visual Direction

用户已确认 visual companion 中的方案：

- 左侧菜单底部展示全局 Settings 图标，无文字。
- 点击后主内容切换到全局 Settings。
- 全局 Settings 使用与项目级 Settings 一致的左右两栏结构。
- 左栏第一项为 `Preferences`。
- 右侧表单第一项是 `Language`，默认 `English`，支持切换 `中文`。
- 右侧表单第二项是 `Theme`，视觉参考 Light / Dark / System 卡片；当前仅实现 Light 模式。

## Navigation Model

左侧导航分为两组：

1. 上方 Project Activity：`Issues`、`Agents`、Project `Settings`。这组仍代表当前 Project 工作台内容。
2. 底部全局入口：仅图标 Global Settings。它打开应用级 Preferences，不显示文字标签，但必须有 `aria-label="Global Settings"` 或等价可访问名称。

当用户点击 Global Settings：

- 工作台内容区显示 Global Settings 页面。
- Project Switcher 和顶层 shell 可继续存在，保持应用壳稳定。
- 不修改当前 Project Activity 的数据状态；用户回到 Issues / Agents / Project Settings 时仍保持对应活动页状态。

实现阶段可在 `AppShell` 中把当前 surface 表达为联合状态，例如 `projectActivity: ActivityKey` 与 `isGlobalSettingsOpen`，或扩展为更清晰的 `ShellSurface`。选择应以最小改动和测试清晰为准。

## Global Settings Layout

全局 Settings 页面使用与 Project Settings 一致的布局约束：

- 左栏菜单默认宽度与 Project Settings 保持一致。
- splitter 行为、键盘访问、focus 样式、拖动清理逻辑与 Project Settings 一致。
- 右侧内容容器使用右侧区域 `80%` 宽度并水平居中，窄屏时不得溢出。
- 左栏菜单当前只包含 `Preferences`，使用图标 + 文案。
- 右侧标题显示 `Preferences`。

不要把 Project Settings 的 General / Agents 菜单迁移到全局 Settings；二者是不同设置域。

## Preferences Form

Preferences 表单包含两个 section。

### Language

语言选项：

- `English`，保存值建议为 `en`。
- `中文`，保存值建议为 `zh`。

默认 locale 为 `en`。切换语言后，当前界面可见文案应立即更新，不需要重启应用。MVP 只要求 English 与中文；不加入 Korean / Japanese 等截图中的额外语言。

### Theme

主题区域视觉参考截图中的卡片选择：

- Light 为默认并且唯一可用模式。
- Dark 与 System 不实现切换。
- 如果展示 Dark / System 预览，必须 disabled，并通过语义属性或文案说明不可用；也可以在 MVP 中只展示 Light 选项，避免制造可点击预期。

当前实现不得启用 CSS dark theme 切换，也不得接入系统主题监听。现有 token 中存在 `prefers-color-scheme: dark` 规则，但本变更的主题设置只承诺 Light-only 偏好，不处理系统主题覆盖。

## i18n Runtime

建议新增 `src/shared/i18n` 下的运行时能力：

- locale 类型：`"en" | "zh"`。
- 字典：按 feature 或 namespace 分组，避免一个巨大对象失控。
- Provider / hook 或轻量 store：React 组件通过统一入口读取当前 locale 和消息。
- 持久化：MVP 可使用 `localStorage` 保存 `redwhisk.locale` 与 `redwhisk.theme`，启动时读取；读取失败时回退 `en` / `light`。
- 测试辅助：提供可在组件测试中设置 locale 的 helper，避免测试互相污染。

覆盖策略以“先覆盖用户会直接看到的主路径”为准：

- App shell：Activity Bar 文案、Global Settings 可访问名称。
- Global Settings：Settings、Preferences、Language、Theme、English、中文、Light。
- Project Settings：General、Agents、表头、按钮、状态和保存相关文案。
- Issues / Agents 主路径文案：至少覆盖页面标题、空态、主要按钮和当前测试覆盖到的可见文案。

实现阶段不得把新增中文文案散落在组件中；所有新增 UI 文案都应进入字典或既有 formatter。

## Persistence Boundary

本变更不要求新增 Rust command、SQLite migration 或全局设置表。原因：

- 当前需求只需要应用级 UI 偏好，前端本地持久化足以满足 MVP。
- 后续如果需要跨设备、跨项目或 Rust Core 读取 locale，再单独引入全局设置服务和迁移。

如果实现阶段发现已有可复用全局 settings service，可用该服务替代 `localStorage`，但不得顺手扩大到新的后端数据模型。

## Validation

实现阶段至少运行：

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test -- src/app`
- `pnpm test -- src/features/settings`

如果 i18n 迁移触及 Issues 或 Agents 组件，还必须运行对应受影响测试，例如 `pnpm test -- src/features/issues` 或 `pnpm test -- src/features/agents`。
