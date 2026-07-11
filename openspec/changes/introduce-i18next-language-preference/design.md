## Context

前端 i18n 已有自研实现：`src/shared/i18n/i18n.tsx`（`I18nProvider` 持有 locale / theme / 内容字号 状态），`messages.ts`（1628 行，`en` / `zh` 双字典，嵌套对象，参数化文案用闭包 `(p) => \`…${p}…\``），`settings-messages.ts`（settings 专用字典）。约 60 个非测试组件经 `useI18n().messages.*.*` 消费文案。

`settings-ui` spec 仍声明 "Global Preferences language"（默认 English），但 `global-settings-activity.tsx` 现仅渲染主题偏好 + 内容字号，language section 已不在代码中——spec 与代码漂移。`setLocale` 实现未接参、未持久化（潜在 bug）。默认 locale = `en`。

后端 Rust 0 中文、0 展示文本；错误以 `CommandError { code, message, details }` 回传，`message` 为英文 / code。前端 `src/shared/commands/command-error.ts` 消费。

## Decisions

### D1. 选 i18next + react-i18next（而非 react-intl）

- `{{name}}` 默认插值更轻量，符合现有「简单插值为主」的文案；复数 / select 可后续按需挂 `i18next-icu` 或用内置 `_one/_other`。
- JSON 嵌套命名空间与现有 `messages` 嵌套对象结构同构，迁移路径最短。
- 生态最大、文档最全；Tauri 桌面环境无 SSR 顾虑。
- react-intl 的 ICU MessageFormat 更强但学习与迁移成本更高，当前文案复杂度不需要。

### D2. 资源文件结构

新增：

```
src/shared/i18n/
  locales/
    en.json
    zh.json
  i18n.ts              # i18next 实例初始化（resources / fallback / 持久化）
  i18n-provider.tsx    # 收敛 theme / 内容字号；包 I18nextProvider
  use-i18n.ts          # 暴露 useTranslation() + theme/font 便捷 hook
  error-messages.ts    # 后端错误 code → 本地化模板映射 + getLocalizedCommandError()
```

JSON 按现有 `messages` 顶层分组（`app`、`settings`、`issues`、`agents`、`globalSettings`、`common` …）平移。闭包式参数化文案改为 `{{name}}` 字符串模板，例：

- 旧：`deleteAgentProfileConfirm: (name) => \`确认删除 Agent Profile「${name}」吗？\``
- 新 key：`settings.deleteAgentProfileConfirm`，`zh`：`确认删除智能体配置「{{name}}」吗？`，`en`：`Are you sure you want to delete Agent Profile "{{name}}"?`

### D3. 迁移策略：按命名空间分批 + TDD 守护，非大爆炸

1. 引入 i18next 实例与 `en.json` / `zh.json`（先把现有字典 1:1 转写，含术语统一见 D6）。
2. 提供临时桥接：`useI18n()` 仍返回 `messages` 对象，但其值由 `t()` 派生（字符串项直接 `t(key)`，函数项改为 `t(key, params)`）。保证未迁移调用点不崩。
3. 按顶层命名空间（`globalSettings` → `settings` → `app` → `issues` → `agents` → 其余）逐个把调用点从 `messages.x.y` 改为直接 `t('x.y')`；每个命名空间迁完跑该 surface 的组件测试。
4. 全部迁完删除桥接与旧 `messages.ts` 字典，仅保留 i18next JSON。

### D4. locale 状态归属与默认值

- locale 由 i18next 管理：初始化时读 `localStorage[redwhisk.locale]`；无值时 **默认 `zh`**（D5 用户预期）。
- 切换语言：`i18next.changeLanguage(lng)` + 写 `redwhisk.locale`。
- `I18nProvider` 不再持有 locale，仅保留 theme / 内容字号（仍走 `localStorage` `redwhisk.theme` / `redwhisk.content-font-size`）。
- 修复原 `setLocale` bug：新 `setLocale(lng)` 真正接参并持久化。

### D5. 语言偏好 UI

- 位置：`global-settings-activity.tsx` 「主题偏好」section 与「内容字号」section **之间**新增一个 section（"主题偏好正下方"）。
- 控件：复用 `Select`（同内容字号样式），`aria-label` 国际化。
- 选项：`简体中文`（值 `zh`，默认选中）、`English`（值 `en`）。
- 行为：`onValueChange` → `setLocale` → i18next 即时切换 + 持久化；当前 locale 回显选中态。

### D6. 术语统一（仅 zh 用户可见文案）

在 `zh.json` 中统一：`agent → 智能体`、`session → 会话`、`Issues → 任务`（含其派生：`Agent Profile → 智能体配置`、`sessions → 会话`、`issues 列表/标题 → 任务…`）。en 不受影响。仅改文案值，不改 key、不改标识符 / 文件名 / 路由。迁移字典时一并完成，并补术语对照检查测试。

### D7. 后端错误本地化（后端不动）

- Rust 不改；`CommandError` 仍回英文 / code。
- 新增 `error-messages.ts`：维护「已知错误 code / 类型 → 本地化模板 key」映射。
- `getLocalizedCommandError(error, t)`：命中映射 → 返回 `t(key, params)`；未命中 → 返回 `error.message`（英文），不再出现「英文 locale 下混入中文」。
- 用户可见错误展示点（toast / dialog）改用该 helper；本次覆盖关键面，未覆盖面随后续审计 change 补齐。

## Migration / Compatibility

- locale 持久化键不变（`redwhisk.locale`），老用户偏好保留。
- 默认值由 `en` → `zh`：已存偏好的老用户不受影响；仅首次启动新用户 / 无偏好时变 zh。属预期行为变更，写入 tasks 验证。
- 组件测试默认 locale 仍可在测试 i18next 实例中显式指定（建议测试默认 `en` 以稳住既有英文断言），生产默认 `zh`。

## Alternatives Considered

- 沿用闭包模板并仅立规范：被否——用户已选引入 i18next。
- 引入 react-intl：被否——见 D1。
- Rust 加 rust-i18n 消息目录：被否——后端无展示文本，且 Tauri 无 locale 上下文。
- 后端只回 code + 参数、本地化全归前端：被否——重构面过大，与「后端不动」决策冲突。

## Validation

- `pnpm format` / `lint` / `typecheck` 全过。
- `pnpm test`：i18next 初始化、默认 zh、语言切换持久化、语言选择器、术语对照、错误映射单测；以及迁移触达的各 surface 组件测试（`src/app`、`src/features/settings`、`src/features/issues`、`src/features/agents`）。
- `cd src-tauri && cargo test`（确认后端未被波及，可选）。
- 手动验证：全局设置语言偏好行位置 / 默认简体中文 / 切换即时生效 / 重启保留；英文 locale 下无中文泄露典型面。
