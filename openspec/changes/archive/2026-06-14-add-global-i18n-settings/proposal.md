## Why

RedWhisk 目前只有 Project Settings，且规划文档要求 UI 文案支持 `en-US` / `zh-CN` 的国际化能力。用户需要一个全局 Settings 入口来承载应用级偏好，其中 Language 是首个实际全局偏好；同时需要为后续主题能力预留清晰位置，但 MVP 只实现默认 Light 模式。

现有规范写明 Activity Bar 的 `Settings` 是 Project Settings，Global Settings 不放入 Activity Bar。本变更更新该边界：Project 工作台 Activity Bar 仍保留项目级 Settings；另在左侧菜单最下方增加一个仅图标的全局 Settings 入口，打开应用级 Settings 视图。

## What Changes

- 在左侧全局导航最下方增加仅图标的 Settings 按钮，使用 `lucide-react` 的 Settings 图标，并提供可访问名称。
- 点击全局 Settings 图标后，显示与 Project Settings 一致的双栏 Settings 布局：左栏菜单、可调整 splitter、右侧 80% 居中内容区域。
- 全局 Settings 左栏仅包含 `Preferences`，右侧显示 Preferences 表单。
- Preferences 第一项为 `Language`，默认 `English`，支持切换为 `中文`，并立刻驱动界面国际化。
- 建立前端运行时 i18n 字典与 locale 状态，优先覆盖 App shell、Activity Bar、Settings、Issues / Agents 主要可见文案，以及当前变更触达的核心状态文案。
- Preferences 第二项为 `Theme`，视觉参考用户提供的 Light / Dark / System 卡片样式；MVP 仅支持默认 `Light`，不实现 Dark / System 切换。
- Theme 在 MVP 中可以展示 Light 为唯一可选项，也可以展示 Dark / System 为 disabled 预览，但不得让用户选择未实现模式。

## Capabilities

### Modified Capabilities

- `settings-ui`: 增加全局 Settings 入口、Preferences 页面、语言切换与 Light-only 主题偏好约束。

## Impact

- 前端 shell：`src/app/app-shell.tsx`、`src/app/activity-router.tsx` 或同层组件需要区分 Project Activity 与全局 Settings 入口。
- 前端 i18n：新增或扩展 `src/shared/i18n/**`，提供 locale store / provider、字典、格式化 helper 和测试。
- 前端 Settings：可复用 `src/features/settings/project-settings-activity.tsx` 的布局模式，但全局 Preferences 应独立于 Project Settings 业务字段。
- 样式：更新 `src/app/app.css` 和 Settings 相关样式，确保全局 Settings 图标固定在左侧菜单底部，Preferences 与现有 Settings 视觉一致。
- 测试：覆盖全局 Settings 入口、Preferences 默认英文、切换中文后的文案更新、Light 主题默认选中，以及未实现主题不可选择。
- 数据持久化：MVP 可先使用前端本地持久化保存全局偏好；不新增 SQLite migration，除非实现阶段发现已有全局设置服务可直接复用。
