## Why

当前全局设置页只有「主题偏好」「内容字号」，**没有语言偏好入口**；而 `settings-ui` spec 仍保留 "Global Preferences language"（默认 English）需求，代码与 spec 已漂移。同时默认 locale 仍是 `en`，与「以简体中文为第一公民」的预期不符。

i18n 基础设施虽已存在（`src/shared/i18n/messages.ts` 1628 行 en/zh 字典、闭包式参数化模板、`I18nProvider`），但存在三类问题：

1. 自研闭包模板 `(p) => \`…${p}…\`` 非声明式，难以统一校验占位符与翻译完整性；团队缺乏标准 i18n 能力（复数、select、嵌套命名空间）。
2. 约 60 个非测试文件通过 `useI18n().messages.*` 消费文案，迁移到声明式 `{{name}}` 模板需一次性架构切换。
3. 前端散落硬编码中文（83 个文件含中文，剔除测试夹具后仍有多处用户可见泄露），导致「英文 locale 下仍出现中文」的不可接受现象。

后端 Rust 源码 0 中文、0 面向用户展示文本，错误以英文/code 经 `CommandError` 回传前端，本次**不动后端**。

## What Changes

- 引入 `i18next` + `react-i18next` 作为前端 i18n 运行时：JSON 命名空间字典（`en.json` / `zh.json`）、`{{name}}` 插值、`useTranslation() / t()` 入口。
- 将现有 `messages.ts` + `settings-messages.ts` 的 en/zh 字典迁移为 i18next JSON 资源；闭包式参数化文案改写为 `{{name}}` 模板。
- locale 状态迁移至 i18next（沿用 `redwhisk.locale` 持久化键），`I18nProvider` 收敛为 theme / 内容字号 偏好 provider；默认 locale 改为 `zh`（首次启动无偏好时）。
- 在全局设置页「主题偏好」**正下方**新增「语言偏好」行：下拉菜单，选项「简体中文」「English」，默认选中「简体中文」，切换即时生效并持久化。
- 修复 `setLocale` 未真正接参 / 未持久化的潜在 bug。
- 中文用户可见文案术语统一：`agent → 智能体`、`session → 会话`、`Issues → 任务`（仅 zh locale 文案，不改标识符 / 文件名 / 路由）。
- 后端错误本地化策略：Rust 不变；前端对关键错误按 code / 类型映射到本地化模板，自由文本错误暂保留英文。
- 审计并修复「英文 locale 下仍含中文」的用户可见泄露（典型面：toast、confirm/loading dialog、issue 命令提示、agents 关键可见文案）。
- 全量系统性 i18n 审计（剩余 83 文件中的非测试用户可见面）**拆为后续独立 change**，在本次确立的 i18next 基础上进行。

## Capabilities

### Modified Capabilities

- `settings-ui`: 恢复并改写 Global Preferences language 需求（默认简体中文、标签「简体中文/English」、置于主题偏好下方、即时切换与持久化）。

### Added Capabilities

- `app-i18n`: 前端 i18n 运行时（i18next）、声明式 `{{name}}` 模板、locale 持久化与默认值、本地化术语规范、后端错误的本地化渲染边界。

## Impact

- 前端 i18n：`src/shared/i18n/**` 重构（引入 i18next、JSON 资源、迁移 1628 行字典、改写约 60 个消费点的 `t()` 调用）。
- 前端设置：`src/features/settings/global-settings-activity.tsx` 新增语言偏好行；`I18nProvider` 职责收敛。
- 前端文案：术语统一触达 agents / issues / app shell 等多 surface 的 zh 文案。
- 后端：无改动。
- 数据：无 SQLite migration；locale 沿用 `localStorage` `redwhisk.locale`。
- 测试：i18n 测试辅助需适配 i18next（`i18next` 测试实例 / `I18nextProvider`），现有断言英文文案的组件测试需复核；新增语言选择器、默认 zh、术语、错误映射测试。
- 风险：i18next 迁移面广，须分阶段迁移与回归；JSON 字典与现有闭包字典须 1:1 对齐，避免漏译 / 占位符错配。

## Non-goals

- 不引入后端 locale 上下文或 Rust 消息目录。
- 不做剩余 83 文件的系统性全量 i18n 审计（后续 change 承接）。
- 不改 agent 注入的任务 prompt 文案（`run-prompt-builder` 的中文属业务内容，非 UI 文案）。
- 不改主题 / 内容字号行为。
- 不改任何标识符、文件名、路由键。
