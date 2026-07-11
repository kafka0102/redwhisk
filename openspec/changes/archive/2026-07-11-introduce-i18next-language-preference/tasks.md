## 进度（2026-07-11）

- §1、§2 已完成并提交（worktree `worktree-introduce-i18next-language-preference`）。
- 实例文件命名为 `i18n-instance.ts`（避免与旧 `i18n.tsx` 在 bundler 解析下撞名）。
- 排序修正：原计划 Task 6「app 接线去 fixedLocale」必须在消费点迁移（§3）**之后**，因为旧 `useI18n`(`i18n.tsx`) 与新 `useI18n`(`i18n-provider.tsx`) 是两套独立 context；提前切 app 会使所有未迁移消费点回退到旧默认 `en`。正确顺序：app root 先共存挂载新 provider（包在旧 provider 外/内）→ 按 namespace 迁移消费点 → 全部迁完再切 app.tsx 并删旧 provider/字典。

## 1. i18next 基础设施

- [x] 1.1 安装 `i18next` + `react-i18next` 依赖。
- [x] 1.2 新增 `src/shared/i18n/locales/en.json`、`zh.json`（按现有 `messages` 顶层分组，1:1 转写）。
- [x] 1.3 新增 `src/shared/i18n/i18n-instance.ts`：初始化 i18next（resources 注入 JSON、`fallbackLng: 'zh'`、插值配置、从 `redwhisk.locale` 读取初始 lng、无值默认 `zh`）。
- [x] 1.4 新增 `src/shared/i18n/i18n-provider.tsx`：包 `I18nextProvider`，收敛 theme / 内容字号偏好（沿用既有 localStorage 键与默认值逻辑）。
- [x] 1.5 `useI18n()` 合并导出（`t`/theme/字号）已并入 `i18n-provider.tsx`，未单独建 `use-i18n.ts`。
- [x] 1.6 i18next 实例/provider/常量/资源均有 colocated 测试；测试内 locale 经 `changeLocale`/localStorage 控制。

## 2. 字典迁移与术语统一

- [x] 2.1 将 `messages.ts` 的 `en` 字典 1:1 转写入 `en.json`（嵌套结构保留）。
- [x] 2.2 将 `messages.ts` 的 `zh` 字典 1:1 转写入 `zh.json`，并完成术语统一：`agent→智能体`、`session→会话`、`Issues→任务` 及其派生词。
- [x] 2.3 将 `settings-messages.ts` 的 en/zh 合并入 `settings` 命名空间 JSON。
- [x] 2.4 将所有闭包式参数化文案改写为 `{{name}}` 模板字符串，记录 key 清单。
- [x] 2.5 补术语对照检查单测（断言 zh 中关键术语为智能体 / 会话 / 任务，无残留 代理 / Agent / 会话 与 任务 混用）。
  - 注：`agentsFeature.taskStatusLabel` 按分支拆为 4 键，`taskStatusLabelFallback={{status}}` 由调用方预处理下划线（原 `status.replace(/_/g,' ')`）。
  - 注：修复源 en 字典中 `toast.issueMarkedDone`、`issues.confirmRunIssue` 的中文泄露。

## 3. 调用点迁移（桥接方式，非逐命名空间重写）

- [x] 3.1 建立 `messages-bridge.ts`：旧 `useI18n().messages` 返回值由 `t()` 派生（按 `{{}}` 判定函数/字符串、位置参数 zip、`taskStatusLabel` 保留 switch 语义）。
- [x] 3.2 `i18n.tsx` 收敛为 re-export `i18n-provider`，55 个既有消费点零改写接入 i18next（等效覆盖 globalSettings/settings/app/issues/agents/其余命名空间）。
- [x] 3.3 provider 改每实例 locale state + `useTranslation({lng})`，无 provider 返回英文回退；全量 587 测试通过，无回归。
- [x] 3.4 （后续清理）删除 `messages.ts` 中已无消费的历史字典数据 `I18N_MESSAGES`，仅保留 `I18nMessages` 接口并 re-export i18n-constants 类型/常量（约 1628→553 行）；删除无消费的 `settings-messages.ts`（键已并入 JSON `settings` 命名空间）。

## 4. 语言偏好 UI 与默认 locale

- [x] 4.1 在 `global-settings-activity.tsx`「主题偏好」与「内容字号」之间新增「语言偏好」section。
- [x] 4.2 选项 `简体中文`（`zh`）/`English`（`en`），回显当前 locale。
- [x] 4.3 `onValueChange → setLocale(lng)`：每实例 state 切换 + 写 `redwhisk.locale`，即时生效。
- [x] 4.4 修复 `setLocale(lng)`（接参 + 持久化，`fixedLocale` 时锁定）。
- [x] 4.5 生产首启默认 `zh`（app.tsx `initialLocale={getDefaultLocale()}`）。
- [x] 4.6 组件测试：默认简体中文、切换 English 即时生效。

## 5. 后端错误本地化（后端不动）

- [x] 5.1 后端 Rust 维持 0 中文 / 0 locale 感知；错误以英文/code 经 `CommandError` 回传（未变）。
- [x] 5.2 策略：前端未命中映射时直接展示后端英文 `message`，不在英文 locale 混入中文；本次已消除前端硬编码中文泄露（见 §6），无已知需要按 code 映射的后端错误。
- [ ] 5.3 （后续）当出现需要按 code 映射的关键后端错误时，再引入 `error-messages.ts` + `getLocalizedCommandError`（YAGNI，当前无具体 code 可映射）。

## 6. 用户可见「英文含中文」泄露修复

- [x] 6.1 审计并修复：源 en 字典 `toast.issueMarkedDone` / `issues.confirmRunIssue`；组件硬编码（confirm-dialog 默认值、permission-card、issue 合并冲突提示、issue-attachment aria-label、composer 错误/标题、session-diff 变更类型、agent-message-cards todo、composer 优先级、app.tsx Project 不存在、issues-activity 会话缺失、settings-agents-panel alt）。
- [x] 6.2 全部接入 i18next（en/zh 补齐），英文 locale 下无用户可见中文残留（注释除外）。
- [x] 6.3 不改 `run-prompt-builder` 注入 agent 的任务 prompt（业务内容）。
- [x] 6.4 测试同步更新（en/zh 断言），全量 587 通过。

## 7. 文档与验证

- [x] 7.1 更新 `docs/architecture-design/agent-development-rules.md`「文案与国际化」：i18next + JSON `{{name}}` 规范、默认 zh、术语表、后端错误边界、测试 locale 约定。
- [x] 7.2 `settings-page-layout.md` 未改（语言行属 Global Settings 内容细节，spec delta 已覆盖；该文档聚焦 Project Settings 模块布局）。
- [x] 7.3 `pnpm format`（无关格式债务文件已回退）。
- [x] 7.4 `pnpm lint`（0 错误 0 警告）。
- [x] 7.5 `pnpm typecheck`。
- [x] 7.6 `pnpm test`（587 通过）。
- [x] 7.7 复查 `git status --short` 无残留，按规范提交。
