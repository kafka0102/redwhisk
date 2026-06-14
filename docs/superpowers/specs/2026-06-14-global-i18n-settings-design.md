# 全局 Settings 与 i18n 设计

## 背景

RedWhisk 当前只有项目级 Settings。用户确认需要在左侧菜单最下方增加一个仅图标的全局 Settings 入口，用来承载应用级 Preferences。该入口不同于 Project Settings：Project Settings 仍是工作台 Activity 之一；全局 Settings 是应用壳底部入口。

本设计已通过 visual companion 确认：全局 Settings 打开后采用与项目级 Settings 一致的左右两栏布局，左栏为 `Preferences`，右侧表单第一项为 `Language`，第二项为 `Theme`。

## 范围

本次变更包含：

- 左侧导航底部的全局 Settings 图标。
- 全局 Settings 的两栏 Preferences 页面。
- `English` / `中文` 的运行时语言切换。
- 默认 Light 主题偏好。
- i18n 运行时字典和主路径文案迁移。

本次不包含：

- Dark 或 System 主题切换。
- 新增 SQLite migration 或 Rust 全局设置服务。
- 将 Project Name、Completion Policy、Agent Profile 移入全局 Settings。
- 支持截图中的韩语、日语等额外语言。

## 导航设计

左侧导航拆为两组：

- 上方 Project Activity：`Issues`、`Agents`、Project `Settings`。
- 底部 Global Settings：仅显示 Settings 图标，无可见文字，但必须提供可访问名称。

点击底部图标后，主内容区域显示 Global Settings。用户再点击任一 Project Activity 时回到对应项目页面，项目活动页状态不因为打开全局 Settings 而被清空。

## 页面设计

Global Settings 复用 Project Settings 的视觉语言：

- 左栏菜单。
- 可拖动 splitter。
- 右侧 80% 居中内容容器。
- 窄屏溢出保护。

全局左栏当前只有 `Preferences`。右侧 Preferences 表单包含两个 section。

### Language

默认选中 `English`，可切换 `中文`。切换后，当前页面中由 i18n 运行时管理的文案立即更新，并持久化到本地偏好。

MVP locale 值使用 `"en"` 与 `"zh"`。如果后续要支持区域差异，可在后续变更中扩展到 `en-US` / `zh-CN`。

### Theme

默认选中 `Light`。Dark / System 当前不实现。

实现可以只展示 Light，也可以展示 Dark / System 的 disabled 预览；如果展示未实现选项，必须清楚表达不可选择，且点击不能改变当前主题。

## i18n 设计

新增或扩展 `src/shared/i18n/**`：

- 定义 locale 类型。
- 提供按 namespace 分组的字典。
- 提供 React 读取入口或轻量 store。
- 使用本地持久化保存 locale。
- 测试中提供可控的 locale 初始化方式。

迁移范围优先覆盖当前主路径可见文案：App shell、Global Settings、Project Settings、Issues / Agents 的页面标题、按钮、空态和测试触达文案。新增文案不得继续散落硬编码。

## 验证

实现阶段至少运行：

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test -- src/app`
- `pnpm test -- src/features/settings`

如果迁移 Issues 或 Agents 文案，还需运行对应 feature 测试。
