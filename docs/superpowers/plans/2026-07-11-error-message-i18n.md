# 错误消息国际化（方案 B + reason 子码）

## 背景与目标

现状（已调研确认）：

- 前端直接展示 `error.message`，后端 message 中英混写（业务校验多为中文，系统/IO 多为英文）。
- `CommandError`（`src-tauri/src/types/errors.rs`）：`code` / `message` / `details?`。`code` 是 `CommandErrorCode` 枚举，**27 个变体，SCREAMING_SNAKE_CASE** 序列化（前端 `isCommandError` 已用 `^[A-Z][A-Z0-9_]*$` 校验，印证形态）。
- `details` 已半结构化：`Vec<{ @type, ...键值 }>`，如 `{ @type:"IssueStatus", issueId, status }`。
- 语言偏好仅存前端 `localStorage`（key `redwhisk.locale`，默认 `zh`），**后端零感知**，无 settings 表、无 i18n 依赖。
- 27 个 code 中 **5 个仅定义未使用**，22 个在用；其中 **10 个单语义**（唯一文案）、**12 个多语义**（同 code 下多条语义不同文案，含 5 个重度承载具体修复引导，如「只有运行中的 Issue 可以标记待验收」）。
- message 全硬编码、分散在约 250 个 `CommandError::new(code, "...")` 调用点，无文案表/模板/i18n。
- 前端消费高度统一：40+ 处 `toCommandError(error).message`，遍布 app/issues/terminals/project/settings 等。

目标：错误消息按用户语言本地化。采用**方案 B**——后端只发 `code + reason + details`，文案在前端 i18next；多语义 code 用 `reason` 子码区分。en/zh 双语。后端 `message` 保留作 fallback。语言偏好不动（仍前端 localStorage，后端不需要语言感知）。

用户已确认：code 用 SCREAMING_SNAKE_CASE；底层系统错误经 `Cause` detail 透传的 `error.to_string()` 不处理；多语义 code 一次到位加 reason 子码。

## 方案总览

- **后端**：`CommandError` 加 `reason: Option<String>` 字段 + `.with_reason()` 链式；给 12 个多语义 code 的调用点（~126 处）加 reason；单语义 10 个不加（reason=None，前端用 `default`）；5 个未使用 code 不动。
- **前端**：新增 `getCommandErrorMessage(error, t)`，按 `code + reason` 查 i18next，查不到 fallback `error.message`；`locales/{zh,en}.json` 加 `errors` 子树；替换 40+ 处 `toCommandError(error).message`。
- **语言偏好**：不动。后端不需读语言，纯前端本地化。

## 后端改动

### 1. `src-tauri/src/types/errors.rs`

- `CommandError` 加字段：`#[serde(skip_serializing_if = "Option::is_none")] pub reason: Option<String>`。
- `CommandError::new(code, message)` 签名不变（`reason` 默认 `None`，向后兼容）。
- 新增链式方法 `.with_reason(impl Into<String>)`（与 `.with_detail` 风格一致）。
- `From<DatabaseError>` 不变（`LocalDataInitializationFailed` 单语义，无需 reason）。

### 2. 给 12 个多语义 code 的调用点加 `.with_reason(...)`

约 126 处 `CommandError::new(code, msg).with_reason("...")`（或链式 `.with_reason(...).with_detail(...)`）。每处按其 message 语义赋 reason。

单语义 10 个 code 不加 reason：`LocalDataInitializationFailed`、`ProjectRepoNotGitRepository`、`ProjectRepoPathUnavailable`、`ProjectNotFound`、`AgentSessionAlreadyExists`、`AgentSessionStreamFailed`、`IssueWorktreeOccupied`、`ProjectTerminalStartFailed`、`SettingsPersistenceFailed`、`AgentCommandUnavailable`。

5 个未使用 code 不动：`AgentSessionStartNotReady`、`AgentSessionUsesStructuredStream`、`AgentSessionPermissionFailed`、`AgentSessionModelUnavailable`、`UnknownCommandError`。

### reason 命名规范

- camelCase，稳定标识符，描述子场景语义（非文案字面）。
- 一旦定义不可改名（前端文案 key 依赖）。
- 单语义 code 后端不设 reason（None），前端用 `"default"` 占位。

### 多语义 code 的 reason 划分概要（代表性，完整清单实现时逐一定）

| code | 代表 reason |
|---|---|
| `IssueValidationFailed`（~30） | `mustBeRunningToAccept`、`mustBeCompletedToViewSummary`、`titleRequired`、`labelsInvalid`、`gitStatusUnavailable`、`gitOperationBlockingCommit`、`worktreeNotFoundForDelete`、`attachmentTooLarge` … |
| `AgentSessionPersistenceFailed`（~30） | `startFailed`、`queryFailed`、`deleteFailed`、`restoreFailed`、`closeFailed`、`titleUpdateFailed`、`messageSendFailed`、`modelListLoadFailed` … |
| `AgentSessionValidationFailed`（~28） | `issueNotInProject`、`onlyBacklogCanStart`、`finalPromptRequired`、`sessionTitleRequired`、`unsupportedCollaborationMode`、`gitStatusUnparseable`、`gitCommandFailed`、`unsupportedPermissionDecision` … |
| `AgentProfileValidationFailed`（~18） | `profileNameRequired`、`agentCommandRequired`、`labelNameRequired`、`labelNameTooLong`、`labelColorInvalid`、`skillNameRequired`、`profileNotFound`、`projectLabelRequiresProjectId`、`labelNameMustBeUnique` … |
| `IssuePersistenceFailed`（~20） | `saveFailed`、`queryFailed`、`deleteFailed`、`completeFailed`、`completePrecheckFailed`、`autoCommitFailed`、`summaryLoadFailed`、`attachmentPreviewFailed`、`archiveSessionMissing`、`worktreeDeleteFailed` … |
| `ProjectTerminalValidationFailed`（~11） | `terminalNotFound`、`terminalNotInProject`、`terminalUnavailable`、`agentSessionNotFound`、`agentSessionNotInProject`、`shortcutNotFound`、`shortcutLimitExceeded`、`shortcutEmpty`、`shortcutTooLong` … |
| `AgentSessionStartFailed`（6） | `worktreeDeleteFailed`、`projectWorkdirUnavailable`、`worktreeInitDirUnavailable`、`worktreeInitCommandFailed`、`agentCommandEmpty`、`agentProcessStartFailed` |
| `ProjectRepoPathInvalid`（4） | `pathInvalid`、`nameEmpty`、`gitignoreMissingWorktrees`、`gitignoreMustIgnoreWorktrees` |
| `IssueNotFound`（3） | `issueNotFound`、`attachmentNotFound`、`agentSessionNotFound` |
| `ProjectPersistenceFailed`（3） | `saveFailed`、`loadFailed`、`openWindowFailed` |
| `ProjectTerminalPersistenceFailed`（3） | `saveFailed`、`deleteFailed`、`dynamic` |
| `AgentSessionNotRunning`（2） | `injectRequiresRunning`、`structuredStreamNotRunning` |

## 前端改动

### 1. `src/shared/commands/command-error.ts`

- `CommandError` 接口加 `reason?: string`。
- `isCommandError` 不强制 reason（可选字段）。
- 新增 `getCommandErrorMessage(error: unknown, t: TFunction): string`：
  - `const ce = toCommandError(error);`
  - `const key = \`errors.${ce.code}.${ce.reason ?? "default"}\`;`
  - `const localized = t(key);` 若 `localized && localized !== key` 返回 `localized`；
  - 否则 fallback `ce.message`。

### 2. `src/shared/i18n/locales/zh.json` + `en.json`

- 新增 `errors` 顶层 key。
- 结构：`errors.{CODE}.{reason} = 文案`。单语义 code 用 `default`；多语义 code 每条 reason 一项。
- en/zh key 树**完全一致**（满足 `locales.test.ts` 的 `have identical key trees`）。
- 占位符 `{{x}}` 若用，en/zh 必须匹配（满足 `placeholders match`）。

### 3. 替换 40+ 调用点

- `toCommandError(error).message` → `getCommandErrorMessage(error, t)`。
- `t` 从 `useI18n()` 取。
- 实现第一步：抽样确认 40+ 调用点的 `t` 可达性（多数在组件事件处理/hook 内，能 `useI18n()`）；少数非组件上下文单独处理（就近传 `t` 或保留 `.message`）。

### 4. `src/shared/i18n/messages.ts`

- `errors` 走 `t()` 动态查，**不进 `I18nMessages` 接口**（动态 key 不适合强类型 proxy）。`messages-bridge` 的 proxy 基于 `en.json` schema 自动派生，`errors` 子树会被 proxy 暴露但不影响现有消费。

## 文案与翻译规则

- **zh**：复用后端现有中文 message 作为基础，专名（Issue/Project/Agent Session/Worktree/Label/Skill/Terminal/Agent Profile/CompletionAttempt 等）保留英文，保证 zh 用户体验与现状一致。
- **en**：全英文翻译。
- 不用「代理」（避免 `locales.test.ts` 的 `not.toMatch(/代理/)` 失败）；Agent Session 保留英文或用「智能体会话」（与现有 zh.json 术语「智能体/会话/任务」一致）。
- 动态参数用 i18next 占位符 `{{x}}`（如 `{{max}}`、`{{count}}`），en/zh 必须匹配。

## t 获取设计

- `getCommandErrorMessage(error, t)` 接收 `t`，调用方从 `useI18n()` 传。
- **不动全局 i18next**：尊重现有「实例绑定 locale、不改全局」设计（`i18n-provider.tsx` 用 `useTranslation({ lng: locale })`，全局 `i18next.language` 默认 `en`）。避免测试隔离风险。
- 非组件上下文（少数工具函数）：就近传 `t` 或保留 `.message`。

## 测试与门禁

- 后端：`cd src-tauri && cargo test`。检查现有错误相关测试是否断言 `CommandError` 的 JSON 结构，按需更新（`reason` 为 `None` 时 `skip_serializing_if` 不出现在 JSON，多数断言不受影响）。
- 前端：
  - `command-error.test.ts` 加 `reason` 字段解析 + `getCommandErrorMessage`（命中/fallback）测试。
  - `locales.test.ts` 自动覆盖 `errors` 子树 en/zh key 树一致、占位符匹配。
- 门禁（按序）：`pnpm format` → 复查 `git status --short` → `pnpm lint` → `pnpm typecheck` → `pnpm test` → `cd src-tauri && cargo test`。
- 无新增 `@ts-ignore` / `@ts-nocheck` / `eslint-disable` / 跳过测试。

## 执行策略

工作量大（后端 ~126 调用点加 reason + 前端 ~130 条双语 + 40+ 调用点替换）。建议同一分支、分批 commit：

1. 后端 `errors.rs` 加 `reason` 字段 + `.with_reason()`。
2. 后端 12 个多语义 code 加 reason（可按 code 分批，每批一个 commit）。
3. 前端 `errors` 文案 zh/en + `getCommandErrorMessage`。
4. 前端 40+ 调用点替换 + 测试更新。

## 风险

- 量大，reason 命名需逐一确定（~126 个），是主要工作量。
- 遗漏 reason → 前端 fallback 到 `message`（en 下显示中文，不致命但不一致）。
- `t` 可达性需在实现第一步抽样确认。
- en/zh `errors` key 树必须完全对齐，否则 `locales.test.ts` 失败。
- 后端若有测试断言完整 serialized JSON，加 `reason` 字段后需同步更新。
