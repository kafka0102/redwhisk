# Agent 开发通用规则

## 目标

本文档把 `_bmad-output` 中的架构、PRD、UX 与实现故事约束，收敛为后续 Agent 开发可直接引用的通用规则。

当规划文档与当前代码不一致时，以当前代码事实为准。特别是：实体 `id` 当前使用 SQLite `INTEGER` / TypeScript `number`，时间字段当前使用 Unix epoch milliseconds / TypeScript `number`，不是字符串 ID 或 ISO 字符串。

## 代码事实基线

当前项目是单仓库 Tauri 桌面应用：

- 前端：React 19、TypeScript、Vite、Vitest、ESLint、Prettier、Tailwind CSS 4。
- 桌面核心：Tauri 2、Rust 2021、`rusqlite`、`portable-pty`。
- 包管理：`pnpm`，当前不使用 Turbo 或多 package workspace。
- 数据库：SQLite migrations 位于 `src-tauri/migrations/`，结构化业务状态由 Rust Core 读写。
- 前后端边界：Tauri command + Tauri event；不引入 HTTP REST/GraphQL。
- Agent 终端：Codex session 走 `codex app-server` 结构化事件流（NDJSON over stdio），Rust Core 负责 spawn、握手与事件归一化，前端用结构化消息流组件渲染并经底部 composer 输入。PTY + xterm.js 仅保留给 project terminal 等真正交互式终端。

## 目录边界

前端按 feature / workbench surface 组织：

- `src/app/`：应用入口、Activity 路由、Workbench shell、全局壳层样式。
- `src/features/project/`：Project Home、Project card、Project Switcher、Project command wrapper。
- `src/features/issues/`：Issues Activity、Issue Dialog、Run Prompt、Completion、Summary。
- `src/features/agents/`：Agents Activity、Session list、Codex 结构化消息流、composer 输入框、Issue Inspector。
- `src/features/settings/`：Project Settings、Agent Profile 表单和 Settings command wrapper。
- `src/shared/commands/`：Tauri command client、统一 command error 处理。
- `src/components/ui/`：基础 UI primitive。
- `src/shared/styles/`：全局 token。

Rust 按 command adapter、core service、repository、类型和外部能力分层：

- `src-tauri/src/commands/`：Tauri command adapter，只做参数承接、状态注入和错误映射，不承载业务状态机。
- `src-tauri/src/core/`：业务 service、状态流转、事务编排。
- `src-tauri/src/db/`：连接、migration、repository 和 SQL 映射。
- `src-tauri/src/types/`：跨边界 DTO、状态枚举和 command error。
- `src-tauri/src/agent/`：Codex command 检测、PTY session 管理、终端输出广播、结构化事件广播。
- `src-tauri/src/git/`：Git status、HEAD、operation state 检测。

不得把领域逻辑塞进泛化 `utils`。当前已有 `src/lib/utils.ts` 仅作为轻量 class 合并工具使用，新增共享逻辑必须放入有明确领域语义的模块。

## 前端文件复杂度与组件化

前端实现必须控制单文件复杂度，避免单文件承载过多职责。

必须遵守：

- 单个 TypeScript / TSX / JavaScript / JSX 源码文件原则上不得超过 1000 行。
- 新增或修改功能时，如果目标文件接近或超过 1000 行，必须优先拆分为职责清晰的子组件、hooks、工具函数、类型定义或 feature 内部模块，而不是继续追加功能。
- 页面级组件只负责页面编排、数据流衔接和少量状态协调；可复用 UI、业务片段、表单区块、列表项、Dialog、Inspector、Toolbar 等应提取为独立组件。
- 重复出现的交互、展示结构或状态处理逻辑，应优先抽象为可复用组件或 hook，但不得为未出现的未来需求提前设计过度抽象。
- 拆分组件时必须保持既有目录边界：feature 私有组件留在对应 `src/features/**` 内，跨 feature 复用的基础 UI 才放入 `src/components/ui/` 或明确的 shared 模块。

例外要求：

- 如确有特殊原因需要让单文件超过 1000 行，Agent 必须在最终回复或提交说明中明确说明原因、风险，以及后续拆分建议。
- 不得为了满足行数限制进行无语义的机械拆分；拆分后的模块必须有清晰职责，并能降低页面、状态或渲染逻辑的理解成本。

## 数据与状态规则

SQLite 是核心业务状态的事实来源，React 不直接读写 SQLite。

必须遵守：

- SQLite 表名使用 `snake_case` 复数名词，例如 `projects`、`issues`、`agent_sessions`。
- 主键统一为 `id INTEGER PRIMARY KEY`；外键统一为 `{entity}_id INTEGER`。
- 时间列统一以 `_at` 结尾，类型为 `INTEGER NOT NULL`，保存 Unix epoch milliseconds。
- 跨 Tauri 边界时字段名使用 `camelCase`，TypeScript 中 ID 和时间字段为 `number`。
- SQLite 内部 payload 字段使用 JSON 字符串列，例如 `payload_json`、`changed_files_json`。
- 新增状态变更时，必须同步写入对应审计记录：`IssueAction`、`SessionEvent` 或 `CompletionAttempt`。

禁止：

- 前端直接把 Issue 或 Agent Session 设置为 `running`、`review`、`completed`、`closed`。
- 绕过 Rust Core 修改 SQLite。
- 用空字符串表达缺失值；缺失值使用 `null`，空集合使用 `[]`。
- 添加与当前状态机冲突的新状态值。

## 状态枚举

当前核心状态值以代码枚举和 migrations 为准：

- Issue：`backlog`、`running`、`review`、`completed`。
- Agent Session：`running`、`closed`、`crashed`、`stopped`。
- Attention：`none`、`requested`。
- Completion Policy：`manual`、`agent_auto_commit`。
- CompletionAttempt option：`complete_manual`、`complete_clean`、`agent_auto_commit`。
- CompletionAttempt result：`completed`、`prompt_sent`、`no_commit_detected`、`git_operation_blocked`。
- Agent Profile scope：`project`、`global`。
- Agent type：当前只有 `codex`。

`review` 是 Issue 状态，不是 Agent Session 状态，也不是 Agents list 分组。`stopped` 表示应用重启后无法恢复原运行中 PTY；`crashed` 表示 Codex/PTY 进程异常退出。

## Command 与错误约定

Tauri command 是业务动作入口，命名使用 `snake_case` 动词短语，例如 `create_project`、`start_agent_session`、`mark_issue_review`。前端 wrapper 使用 `camelCase`，并统一通过 `invokeCommand` 调用。

Command 成功返回显式 DTO。复杂列表返回对象包装数组，例如：

```ts
interface IssueListResponse {
  issues: IssueRecord[];
}
```

Command 失败必须返回统一错误结构：

```json
{
  "code": "ISSUE_VALIDATION_FAILED",
  "message": "只有运行中的 Issue 可以标记待验收。",
  "details": [
    {
      "@type": "IssueStatus",
      "issueId": 1,
      "status": "backlog"
    }
  ]
}
```

错误码来自 Rust `CommandErrorCode`，序列化为 `SCREAMING_SNAKE_CASE`。`details` 可选；存在时每项必须包含 `@type`。

新增 command 时必须同时完成：

- Rust input/output DTO，使用 `#[serde(rename_all = "camelCase")]`。
- Rust command adapter 注册到 `tauri::generate_handler!`。
- 前端 command wrapper 和 TypeScript 类型。
- 至少一个成功路径测试和一个失败路径测试。

当前项目尚未落地 Rust DTO 自动生成 TypeScript 的流水线。新增或修改跨边界 DTO 时，必须手动同步 Rust 类型与前端类型，并用 command client 测试或 feature 测试覆盖关键字段。

## Event 与终端通道

Tauri event 只表示事实发生或终端输出，不发起业务写入。事件名使用 kebab-case，例如 `agent-session-terminal-output`、`agent-session-stream-event`。

事件 payload 必须包含定位实体的 ID，例如 `projectId`、`sessionId`、`issueId`。

当前存在两条并列通道，按 session 类型分流：

- `agent-session-terminal-output`：承载 PTY 原始字节流，仅用于 project terminal 等真正交互式终端。
- `agent-session-stream-event`：承载 Codex session 的结构化 Agent 事件流（`AgentStreamEvent`），由 Rust Core 归一化 `codex app-server` 输出后广播。

终端输出规则：

- PTY 原始输出继续写入 session log 文件。
- project terminal 的 xterm 主渲染使用实时输出事件与 restore 结果，不再以轮询日志尾部作为主路径。
- `read_agent_session_terminal` 只适合作为非活跃 PTY Session、Open Log 或诊断降级路径；Codex session 改用 `read_agent_timeline` 拉结构化历史。
- 前端不得重放截断 ANSI 日志作为 Codex TUI 恢复方案。
- Codex session 不得使用 PTY/xterm 链路；其输入走 `send_agent_message`，输出走 `agent-session-stream-event`。
- Inspector、Dialog、Header 操作不得卸载当前 xterm 或结构化消息流。

## Issue 与 Agent Session 流程规则

启动 Issue 关联 Agent Session：

- 只能从 `backlog` Issue 启动。
- 一个 Issue 最多关联一个 Agent Session。
- 只有进程/PTY 成功启动后，Rust Core 才创建 Agent Session，并把 Issue 改为 `running`。
- 启动失败时 Issue 保持 `backlog`，不得创建有效 Agent Session。

Review 阶段：

- 只有 `running` Issue 且存在运行中关联 Session 时，才能标记 `review`。
- 标记 `review` 后 Agent Session 仍保持 `running`。
- 用户在 review 中继续输入修正要求时，不得把 Issue 退回 `running`，也不得创建第二个 Session。

异常状态：

- Codex/PTY 异常退出时 Agent Session 进入 `crashed`。
- 应用重启后无法恢复原运行中 PTY 时进入 `stopped`。
- `crashed` / `stopped` 不会让关联 Issue 自动完成，UI 必须提供事实性提示和日志/诊断入口。

Completed：

- `completed` Issue 不提供 `Run`、`Reopen`、重新完成或重新运行主路径。
- 复盘入口是 Summary 和 Open Log。
- 日志路径缺失或文件不存在时必须显示明确错误。

## Completion 与 Git 安全边界

Completion Policy 只有 `manual` 和 `agent_auto_commit`。

必须遵守：

- 应用不得执行 `git add .`，不得静默提交全部改动。
- `agent_auto_commit` 只能向当前 Codex Session 注入 completion prompt，然后由 Rust Core 检测 Git HEAD/status/changed files。
- completion prompt 不能只写成“提交当前 Issue 相关改动”这类概括要求；必须显式要求 Agent 运行本任务所需验证命令，并在验证后执行 `git status --short` 检查 format / lint / typecheck / test 带出的额外文件
- 若验证命令改写了当前 Issue 相关文件，这些文件必须在同一次提交中一并处理；若改写了无关文件，必须先回退再允许提交
- 检测到新 commit 后，记录 `commit_hash` 并完成 Issue。
- “检测到新 commit”只是必要条件，不是充分条件；自动提交成功前还必须确认工作区中没有残留当前任务相关的未提交改动，尤其不能遗漏由格式化或验证命令带出的文件
- 未检测到新 commit 时，记录 `no_commit_detected`，Issue 保持 `review`。
- 检测到 merge/rebase/cherry-pick 等 Git operation 进行中时，记录 `git_operation_blocked`，提示用户手动处理，不自动完成。
- 每次完成尝试必须写入 `completion_attempts`。

## UI 与 UX 规则

RedWhisk 是本地桌面开发工具，不是 SaaS 管理后台或营销页面。

必须遵守：

- Project Home 是首屏；未选择 Project 前不显示 Activity Bar。
- Project 工作台 Activity Bar 只包含 `Issues`、`Agents`、`Settings`。
- Project Switcher 属于窗口顶部 chrome，不属于内容 Header。
- Activity Bar 主分组里的 `Settings` 是 Project Settings；Global Settings 是左侧菜单底部的仅图标 shell action，不属于 Project Activity 列表。
- Agents Activity 使用左右两栏：左侧 Session list，右侧 Codex Session View。Codex Session View 由结构化消息流与底部固定 composer 输入框组成，不再使用 xterm。
- Settings 页面外层布局遵守 [Settings 页面布局规范](./settings-page-layout.md)。
- 基础视觉使用 `src/shared/styles/tokens.css` 的 token；不要局部重新发明字体、圆角、焦点和色板体系。
- 前端交互控件默认使用 `src/components/ui/` 下的 shadcn 组件；除非存在明确的语义、可访问性或第三方集成需要，不新增手写基础按钮、输入框、选择器、菜单、对话框等控件。
- 页面和 feature 代码应组合 shadcn 组件完成界面，不在单个页面里为基础控件重复编写大量局部样式。若 shadcn 默认样式与 RedWhisk 设计差异较小，优先接受默认样式；若差异较大，应在主题 token、全局样式或 `src/components/ui/` 组件层统一覆盖。
- 图标优先使用已有 `lucide-react`。
- 核心状态不能只靠颜色表达，必须有文本或可访问 label。
- Dialog 打开后焦点进入 Dialog，关闭后回到触发控件；`Esc` 关闭最上层 Dialog/Inspector。
- `Enter` 在 Dialog 中提交主动作；在 composer 中提交消息，`Shift+Enter` 换行；在 project terminal 的 xterm 中原样传给终端。
- `prefers-reduced-motion: reduce` 下必须禁用或显著收敛非必要动画。
- 执行类前端操作调用后端 command 失败时，应统一使用 `src/components/ui/alert-dialog.tsx` 的 `AlertDialog` 或 `src/components/ui/use-alert-dialog.tsx` 的 `useAlertDialog` 展示错误信息。典型场景包括状态切换、标记完成、删除、启动/停止、确认/审批等由按钮或菜单触发的业务动作；错误类型使用 `error`，头部显示红色错误图标、错误文本，底部使用主色调“知道了”确认按钮。
- 表单类操作保留表单内原有错误展示方式，包括创建/编辑表单提交、字段校验、附件选择、表单内加载失败等需要与具体输入区域关联的错误，不应强制改为全局 AlertDialog。
- 原先渲染在页面或窗口下方的红色执行类错误信息（例如 `issues-status`、`agents-session-status-stack` 这类操作失败提示）新增或修改时应迁移为 AlertDialog；页面上方的非表单执行类错误可按上下文酌情迁移，加载态或诊断态错误不属于强制迁移范围。

禁止：

- 新增营销式 hero、渐变装饰、大圆角卡片墙、彩色阶段柱或管理后台式重型组件库。
- 在 feature 页面中绕过 shadcn 组件，直接用原生标签和散落 class 重做通用控件。
- 在 Codex 结构化消息流之外另起 xterm 或独立输入框；Codex session 的输入必须经底部 composer 与 `send_agent_message`。
- Header 无关联 Issue 时显示 `No linked issue`。
- Inspector/Dialog 打开关闭导致 xterm 或结构化消息流重建。

## Codex app-server 接入边界

Codex session 通过 `codex app-server` 子进程接入，不走 PTY。职责边界如下：

- Rust Core 负责 spawn `codex app-server`、NDJSON over stdio 握手、JSON-RPC 请求/响应/通知分发，并把 Codex 私有输出归一化为 `AgentStreamEvent` 结构化事件后广播。
- Rust Core 维护单 session 状态机：`threadId`、`currentTurnId`、待审批权限请求、事件 `seq`/`epoch` 游标。
- 切换模型经 `turn/start` 的 `model` 字段；Think 模式经 `turn/start` 的 `effort` 字段（即 reasoning effort）。两者均由 Rust Core 透传，前端只发 command。
- 上下文窗口用量来自 `thread/tokenUsage/updated` 通知，由 Rust Core 解析为 `AgentUsage` 后随 `usage_updated` 事件广播。
- 工具调用权限（命令执行、文件改动、用户输入）由 app-server 发起 server→client request，Rust Core 转为 `permission_requested` 事件广播，前端审批后经 `respond_agent_permission` 回复。
- 附件（图片/文件）落盘到 app data dir 后，以本地路径形式随 `turn/start` 的 `input` 传入，由 agent 自行读取，不内联文件字节。
- 非 Codex agent（如未来引入的 claude）在未实现对应 provider 适配前，可临时降级走 PTY 链路；Codex session 不允许降级到 PTY。

## Agent Profile 与 Settings 规则

当前代码事实中，Agent Profile 使用同表 scope 模型：

- `agent_profiles.scope` 为 `project | global`。
- Project 级 profile 用 `project_id` 关联 Project。
- 当前 migrations 已移除早期 `project_agent_overrides` 表。
- 字段包括 `name`、`agent_type`、`command`、`scope`、`project_id`、`mode`、`dangerous`、`default_skill`、`prompt_template`。

后续 Agent 不应继续按早期规划文档中的 `ProjectAgentOverride` 表实现新功能；涉及 Settings 数据模型时，以 `src-tauri/migrations/0007_restructure_agent_profiles.sql`、`src-tauri/src/types/agent_profile.rs` 和当前 repository/service 为准。

Codex command 检测和测试由 Rust Core 完成，React 不直接执行 shell。command 不可用时，不得保存或启用会在启动时失败的 Agent Profile。

Agent command 检测必须考虑桌面应用启动环境与用户终端环境的差异。macOS 上从 Finder、Dock 或 Tauri 启动的进程通常不会继承交互终端中的 `PATH`、`nvm`、`rbenv` 等初始化结果；Rust Core 做 `command -v` 时不得只依赖当前进程环境。检测裸命令名（例如 `codex`）时，应优先保持非交互登录 shell 查询，并在失败时补充交互登录 shell 查询，以覆盖用户在 `.zshrc` 等交互 shell 启动脚本中配置的命令路径。

## 文案与国际化

当前项目已具备 `src/shared/i18n` 运行时能力。前端页面文本必须按 locale 统一管理，不再允许继续扩大硬编码文案范围。

必须遵守：

- 所有用户可见文本都必须国际化：包括页面标题、按钮、表单标签、占位符、空态、加载态、错误态、菜单项、提示语、`title`、`aria-label`、Dialog / Drawer / Popover 文案和状态文本。
- 新增或修改页面文案时，不得直接在 TSX 中新增散落硬编码字符串；应接入 `src/shared/i18n/**`，或在 feature 内部建立由 locale 驱动的 formatter / messages helper。
- 若一个 feature 内同时存在通用文案和复杂格式化文案，通用短文案优先进入共享消息字典，复杂拼接文案可保留在 feature formatter 中，但必须以 locale 为输入。
- 不把 Codex 写死为通用 UI 命令语义；按钮和流程文案使用 Agent 泛称，配置项中体现 Codex。
- 迁移旧页面时，优先处理运行时真实可见路径，并顺手清理同一区域未国际化的 `placeholder`、`aria-label`、状态文案与空态文案，避免只做一半。

推荐实现方式：

1. 在 `src/shared/i18n/messages.ts` 中为稳定、跨页面复用的文案新增 namespace 或字段。
2. 组件内通过 `useI18n()` 读取 `locale` 与 `messages`，不要直接访问 `localStorage` 或自行维护第二套 locale 状态。
3. 对状态名、动态标题、确认文案、错误摘要等需要格式化的文本，优先封装为 `messages.xxx.someFormatter(...)` 或 feature 内 `formatXxx(locale, ...)`。
4. 对大型 feature，不要把所有文案都堆进单个页面组件；可拆到同 feature 下的 `*-messages.ts`、formatter 或 helper，以降低页面复杂度。
5. 测试中如果断言可见文案，默认以英文为基线；需要覆盖中文切换时，应显式设置 locale 并断言切换后的文本。

## 测试与验证规则

改动 TypeScript / TSX / JavaScript 后，默认至少运行：

```bash
pnpm lint
pnpm typecheck
```

改动运行时行为、分支逻辑、数据流、渲染逻辑或测试依赖实现后，还必须运行：

```bash
pnpm test
```

影响构建、样式、Vite 配置或打包路径时，补充运行：

```bash
pnpm build
```

改动 Rust / Tauri / SQLite migrations 后，至少运行：

```bash
cd src-tauri && cargo test
```

改动文档时，至少检查：

```bash
find docs -maxdepth 3 -type f | sort
rg -n "相对链接|目标路径关键字" docs
git diff -- docs
```

如果因环境、耗时或外部依赖无法运行某项验证，最终说明必须写明未运行什么、为什么没运行、风险是什么。

## 参考来源

本规则整理自以下文档和代码事实：

- `_bmad-output/planning-artifacts/architecture.md`
- `_bmad-output/planning-artifacts/epics.md`
- `_bmad-output/planning-artifacts/implementation-readiness-report-2026-06-04.md`
- `_bmad-output/planning-artifacts/sprint-change-proposal-integer-ids-and-epoch-ms-2026-06-05.md`
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/DESIGN.md`
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md`
- `_bmad-output/implementation-artifacts/6-1-stabilize-agent-session-terminal-rendering.md`
- `package.json`
- `src/`
- `src-tauri/src/`
- `src-tauri/migrations/`
