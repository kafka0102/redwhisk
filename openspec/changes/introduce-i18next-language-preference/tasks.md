## 1. i18next 基础设施

- [ ] 1.1 安装 `i18next` + `react-i18next` 依赖。
- [ ] 1.2 新增 `src/shared/i18n/locales/en.json`、`zh.json` 占位结构（按现有 `messages` 顶层分组）。
- [ ] 1.3 新增 `src/shared/i18n/i18n.ts`：初始化 i18next（resources 注入 JSON、`fallbackLng: 'zh'`、插值配置、从 `redwhisk.locale` 读取初始 lng、无值默认 `zh`）。
- [ ] 1.4 新增 `src/shared/i18n/i18n-provider.tsx`：包 `I18nextProvider`，收敛 theme / 内容字号偏好（沿用既有 localStorage 键与默认值逻辑）。
- [ ] 1.5 新增 `src/shared/i18n/use-i18n.ts`：导出 `useTranslation()` 便捷封装与 theme / 内容字号 hook，替代旧 `useI18n` 的非文案职责。
- [ ] 1.6 提供测试 i18next 实例 / 测试 helper，支持测试内显式指定 locale（默认 `en` 稳住既有断言）。

## 2. 字典迁移与术语统一

- [ ] 2.1 将 `messages.ts` 的 `en` 字典 1:1 转写入 `en.json`（嵌套结构保留）。
- [ ] 2.2 将 `messages.ts` 的 `zh` 字典 1:1 转写入 `zh.json`，并完成术语统一：`agent→智能体`、`session→会话`、`Issues→任务` 及其派生词。
- [ ] 2.3 将 `settings-messages.ts` 的 en/zh 合并入 `settings` 命名空间 JSON。
- [ ] 2.4 将所有闭包式参数化文案改写为 `{{name}}` 模板字符串，记录 key 清单。
- [ ] 2.5 补术语对照检查单测（断言 zh 中关键术语为智能体 / 会话 / 任务，无残留 代理 / Agent / 会话 与 任务 混用）。

## 3. 调用点迁移（按命名空间分批，TDD 守护）

- [ ] 3.1 建立临时桥接：旧 `useI18n().messages` 返回值由 `t()` 派生，保证未迁移调用点不崩。
- [ ] 3.2 迁移 `globalSettings` 命名空间调用点。
- [ ] 3.3 迁移 `settings` 命名空间调用点。
- [ ] 3.4 迁移 `app`（shell / activity bar）命名空间调用点。
- [ ] 3.5 迁移 `issues` 命名空间调用点。
- [ ] 3.6 迁移 `agents` 命名空间调用点。
- [ ] 3.7 迁移其余命名空间（`common` / terminal / 其他）调用点。
- [ ] 3.8 删除桥接与旧 `messages.ts` / `settings-messages.ts` 字典，仅保留 i18next JSON；保留必要的类型与导出常量（存储键、`Locale`、`ThemePreference`）。
- [ ] 3.9 每个命名空间迁完跑对应 surface 组件测试确认无回归。

## 4. 语言偏好 UI 与默认 locale

- [ ] 4.1 在 `global-settings-activity.tsx`「主题偏好」与「内容字号」之间新增「语言偏好」section（标题、`Select`、`aria-label`）。
- [ ] 4.2 选项：`简体中文`（`zh`，默认选中）、`English`（`en`）；回显当前 locale。
- [ ] 4.3 `onValueChange` → `setLocale(lng)`：调用 i18next `changeLanguage` + 写 `redwhisk.locale`，即时生效。
- [ ] 4.4 实现 / 修复 `setLocale(lng)`（接参 + 持久化），删除旧 bug 实现。
- [ ] 4.5 默认 locale 改为 `zh`（首次启动无偏好时）。
- [ ] 4.6 组件测试：语言行位置、默认简体中文、切换即时生效、持久化回读、回到 English。

## 5. 后端错误本地化（后端不动）

- [ ] 5.1 新增 `src/shared/i18n/error-messages.ts`：已知错误 code / 类型 → 本地化模板 key 映射表（en/zh 入 JSON `errors` 命名空间）。
- [ ] 5.2 实现 `getLocalizedCommandError(error, t)`：命中映射 → `t(key, params)`；未命中 → 返回 `error.message`（英文，不混中文）。
- [ ] 5.3 用户可见错误展示点（toast / confirm / loading dialog / 关键命令失败提示）接入该 helper。
- [ ] 5.4 单测：命中映射返回本地化文案、未命中回退英文 message、参数插值正确。

## 6. 用户可见「英文含中文」泄露修复

- [ ] 6.1 审计 toast / dialog（confirm / loading）/ issue 命令提示 / agents 关键可见面，列出英文 locale 下仍含中文的硬编码点。
- [ ] 6.2 将这些点接入 i18next（en/zh 补齐），消除英文 locale 下中文泄露。
- [ ] 6.3 不改 `run-prompt-builder` 注入 agent 的任务 prompt（业务内容，非 UI 文案），在 tasks / PR 说明边界。
- [ ] 6.4 补回归测试：英文 locale 下典型面无中文残留。

## 7. 文档与验证

- [ ] 7.1 更新 `docs/standards/agent-development-rules.md`「文案与国际化」：改为 i18next + JSON `{{name}}` 规范、默认 zh、术语表（智能体 / 会话 / 任务）、后端错误本地化边界。
- [ ] 7.2 如有必要更新 `docs/architecture-design/settings-page-layout.md`，补语言偏好行位置。
- [ ] 7.3 `pnpm format` → 复查 `git status --short`。
- [ ] 7.4 `pnpm lint`。
- [ ] 7.5 `pnpm typecheck`。
- [ ] 7.6 `pnpm test`（i18n + 迁移触达的各 surface）。
- [ ] 7.7 复查 `git status --short` 无残留，按规范提交。
