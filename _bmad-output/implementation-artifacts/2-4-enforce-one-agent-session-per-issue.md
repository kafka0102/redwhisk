---
baseline_commit: 3cfdb03
---

# Story 2.4: 限制一 Issue 一 Agent Session

Status: done

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望一个 Issue 在 MVP 中只关联一个 Agent Session,
以便任务上下文、日志和后续 review/完成动作都围绕同一条 Session 连续展开，而不会被并列 Session 稀释。

## Acceptance Criteria

1. 给定某个 Issue 已存在关联 `AgentSession`，当用户再次尝试从该 Issue 启动 Agent 时，Rust Core 阻止创建第二个并列 `AgentSession`，并返回可被前端消费的明确错误。
2. 给定已有关联 `AgentSession` 的 Issue 详情弹窗被打开，当该 Session 仍属于该 Issue 时，右侧操作区显示 `Open Session` 入口，并且不再显示可再次创建新 Session 的 `Run`。
3. 给定某个 Issue 已有关联 `AgentSession`，当该 Session 启动后异常退出、停止或只是保留关联关系而恢复能力尚未实现时，系统继续保留现有关联，不自动创建新的 attempt，也不通过再次 `Run` 绕过一 Issue 一 Session 规则。

## Tasks / Subtasks

- [x] 收口 Rust Core 的一 Issue 一 Session 约束，保证真正由核心层拒绝第二次启动 (AC: 1, 3)
  - [x] 以 `src-tauri/src/core/agent_session_service.rs` 为主边界，把“已存在关联 Session 即拒绝再次启动”明确建模为稳定错误语义，而不是只依赖临时文案或偶然分支。
  - [x] 若需要扩展 `src-tauri/src/types/errors.rs`、`src-tauri/src/commands/agent_session_commands.rs` 或跨边界 DTO，保持错误码、消息和 detail 字段可被前端区分为“已有 Session”而非泛化启动失败。
  - [x] 保持当前规则对 `running`、`crashed`、`stopped` 或仅保留关联的历史 Session 都成立；MVP 不引入“自动重试后创建第二条 Session”的例外。
- [x] 更新 Issues Activity / Issue Detail Dialog 的操作呈现，显式暴露 `Open Session` 而不是继续展示 `Run` (AC: 2, 3)
  - [x] 在 `src/features/issues/issues-activity.tsx` 及其依赖边界中，把 Issue 详情右侧 Session 区和 Actions 区改为基于“是否已有 Session 关联”渲染，而不是仅根据 `status === backlog` 判定。
  - [x] 已有关联 Session 的 Issue 在 UI 上显示 `Open Session`，并禁用或移除再次 `Run` 的路径，符合 addendum 的状态表：`backlog` + 已有关联 Session 时展示 `Open Session` / `Run` 禁用。
  - [x] 本 story 只需把入口和文案收口到位；真正切到完整 Agents Activity Session View 的体验由 Story 2.5 / 2.6 承接，不在本 story 抢跑实现完整工作台。
- [x] 明确“异常退出但关联保留”的 MVP 边界，避免错误地通过新建 Session 规避恢复/复盘能力缺口 (AC: 3)
  - [x] 结合 `agent_sessions` 现有 schema 与规划文档，确认当前恢复能力未实现时仍保留同一 `issue_id -> session_id` 关联，前端不提供“再跑一次生成第二条 Session”的旁路。
  - [x] 如果当前仓库还缺少查询关联 Session 的前端数据，按最小范围补齐当前 story 必需的信息，不额外实现完整 Session list、resume 或日志回放。
- [x] 测试与验证 (AC: 1, 2, 3)
  - [x] 新增 Rust 测试覆盖：已有 `AgentSession` 时再次调用 `start_agent_session` 被拒绝，且不会生成第二条 Session、不会重复写 Issue 状态流转。
  - [x] 新增前端测试覆盖：Issue 已有关联 Session 时，Issue Detail Dialog 显示 `Open Session`，不再显示可触发二次启动的 `Run`。
  - [x] 若本 story 修改了 TypeScript / TSX 运行时逻辑，运行 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`。
  - [x] 若本 story 修改了 Rust command / service / repository，运行 `cargo fmt` 与 `cargo test`。

## Senior Developer Review (AI)

- Outcome: Approve
- Date: 2026-06-06
- Findings:
  - 已修复 `Open Session` 丢失 `sessionId` 上下文的问题，`Agents` Activity 现在会保留当前选中的 session 占位上下文。
  - 已修复 stale `Run` 对话框在命中 `AGENT_SESSION_ALREADY_EXISTS` 时仍停留失败态的问题；现在会刷新 Issue 列表并关闭对话框，回到现有 Session 入口。
  - 已修复 `completed` / `crashed` 仍错误显示 `Open Session` 的规格偏差。
  - 已修复插入阶段命中 `agent_sessions.issue_id` 唯一约束时仍返回泛化持久化错误的问题；现在会映射到 `AgentSessionAlreadyExists`。
  - “`linked_session_id` / `linked_session_status` 双子查询会错配”未采纳为阻塞项：当前 schema 已通过 `uidx_agent_sessions_issue_id` 保证每个非空 `issue_id` 至多一条 Session，这不是本次变更引入的新回归。

## Dev Notes

### 关键假设与取舍

- Story 2.3 已经在 `start_agent_session` 里加入“若 `find_by_issue_id(issue_id)` 命中则拒绝启动”的最小阻断，但当前 UI 仍只按 `selectedIssue.status === "backlog"` 展示 `Run`，还没有把“一 Issue 一 Session”规则完整暴露为产品行为。
- 本 story 的默认取舍是把“一 Issue 一 Session”视为跨层一致性约束：Rust Core 负责最终拒绝，UI 负责提前展示正确入口与禁用路径；两层都要落地，不能只做其中一层。
- 规划文档明确指出异常退出或恢复能力未完成时，应保留现有关联并提供 `Open Session` / 日志复盘方向，而不是新建第二个 attempt；因此本 story 不扩展多 attempt、resume 或自动清理历史关联。

### 范围边界

- 交付：阻止同一 Issue 创建第二条 Agent Session、Issue Detail Dialog 显示 `Open Session`、二次 `Run` 入口收口、相关测试。
- 不交付：完整 Agents Activity Session list、Session Header、Issue Inspector、PTY/xterm、resume、Open Log 最终落点、completion flow。
- 不交付：允许手动解绑 Session 与 Issue、允许为同一 Issue 创建多次 attempt、自动恢复 crashed/stopped Session。

### 架构约束

- `start_agent_session(issue_id, profile_id, prompt)` 只允许在 Rust Core 成功校验后创建 Session；是否允许创建第二条 Session 的裁决必须在 Rust Core 完成，React 不能自行绕过。[Source: `_bmad-output/planning-artifacts/architecture.md` §Pattern Examples]
- addendum 的状态表明确规定：`backlog` 且“已有关联 Agent Session”时展示 `Open Session`，`Run` 禁用。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` §Session Header / Issue 操作状态表]
- MVP 保持一 Issue 一 Agent Session；若 Session 异常退出，系统优先提供 resume 或日志复盘路径，而不是创建新的 attempt。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` FR-12; `addendum.md`]
- UI 不得直接伪造核心状态；若需要展示是否已有 Session，应通过 command/query 返回的事实字段驱动，而不是写死本地猜测。[Source: `_bmad-output/planning-artifacts/architecture.md` §Component Boundaries, §Anti-Patterns]

### 当前代码状态与修改指引

- `src-tauri/src/core/agent_session_service.rs` 已有 `find_by_issue_id` 检查，并在命中时返回 `AgentSessionValidationFailed` / “当前 Issue 已存在关联 Agent Session。”；Story 2.4 需要评估是否保持该错误码，还是补齐更稳定的专用错误语义供前端区分。
- `src-tauri/src/db/agent_session_repository.rs` 已提供 `find_by_issue_id`，这是当前“一 Issue 一 Session”约束的事实来源。
- `src-tauri/tests/agent_session.rs` 已覆盖成功启动与失败回滚，但尚未锁定“已有 Session 再次启动被拒绝”的专门回归测试。
- `src/features/issues/issues-activity.tsx` 当前 Session 区固定显示 `No session linked.`，Actions 区仅在 `selectedIssue?.status === "backlog"` 时展示 `Run`；这里与规划文档的 `Open Session` 行为存在明显缺口。
- `src/features/issues/issue-commands.ts` 当前只暴露 issue CRUD 和 `startAgentSession`；若 UI 需要知道关联 Session，可能需要在现有 `IssueRecord` 或新增查询边界中补齐最小字段，但应优先选择最小改动方案。

### 前置故事信息

- Story 2.3 已完成 `agent_sessions` / `session_events` schema、真实启动成功后写 Session 和 Issue `running` 状态流转，并把已有 Session 的二次启动在 Core 层做了最小阻断。
- Story 2.5 将负责展示 Agents Activity Session list 和基础 Header，因此 Story 2.4 只需把 `Open Session` 入口、文案和禁止二次启动规则收口，不需要完整实现打开后的工作台内容。
- Story 2.6 将承接 PTY/xterm 的 Session View；因此 2.4 不需要在本 story 中实现真实终端恢复，只需避免为绕过能力缺口而创建第二条 Session。

### Git Intelligence

- 当前 workflow preflight 记录的基线 `HEAD` 是 `3cfdb03`。
- 当前工作区在 story creation 阶段是干净的；开发阶段若出现无关改动，最终提交只能包含 Story 2.4 直接相关文件。
- 本 story 预计会同时改动 TypeScript/TSX 与 Rust 源码，默认至少运行：

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

### 测试要求

- 因本 story 会修改 TypeScript / React 运行时逻辑，必须运行 `pnpm lint` 与 `pnpm typecheck`。
- 因本 story 会影响运行时行为、分支逻辑和测试依赖实现，必须运行 `pnpm test`。
- 因本 story 会修改 Rust Core command / service / repository 行为，必须运行 `cargo fmt --manifest-path src-tauri/Cargo.toml` 与 `cargo test --manifest-path src-tauri/Cargo.toml`。
- 若仓库格式化配置覆盖到本次修改文件，先运行 `pnpm format` 再进行 lint/typecheck/test。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 2 / Story 2.4、2.5、2.6 的验收标准与相邻 story 边界。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — FR-12、FR-13、Issue Detail / Run / Open Session 的产品行为。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` — 一 Issue 一 Session、状态表与 `Open Session` 入口约束。
- `_bmad-output/planning-artifacts/architecture.md` — Core 状态边界、command 模式与 UI 反模式。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — Issue Detail Dialog、Run Dialog、Agents Activity 的体验边界。
- `_bmad-output/implementation-artifacts/2-3-create-agent-session-and-update-issue-after-successful-start.md` — Story 2.3 已交付的 Session 持久化与最小阻断上下文。
- `src/features/issues/issues-activity.tsx`、`src/features/issues/issue-commands.ts` — 当前前端 Issue 详情与启动入口边界。
- `src-tauri/src/core/agent_session_service.rs`、`src-tauri/src/db/agent_session_repository.rs`、`src-tauri/tests/agent_session.rs` — 当前 Rust Core 一 Issue 一 Session 事实来源与测试落点。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-06T20:08+0800：`bmad-dev-workflow` preflight 读取 `sprint-status.yaml`，确认 `2-4-enforce-one-agent-session-per-issue` 已处于 `ready-for-dev`，基线 `HEAD` 为 `3cfdb03`，初始工作区无脏改动。
- 2026-06-06T20:15+0800：核对 Epic 2、PRD、addendum、architecture 与 UX，确定本 story 只补“一 Issue 一 Session”的稳定错误语义、Issue 详情入口和最小关联字段，不提前实现 2.5 / 2.6 的完整 Session View。
- 2026-06-06T20:28+0800：为 `IssueRecord` 补充 `linkedSessionId` / `linkedSessionStatus`，让 Issue 列表与详情弹窗都能基于核心返回的事实字段判断是否显示 `Run` 或 `Open Session`。
- 2026-06-06T20:36+0800：把 `start_agent_session` 的重复启动拦截升级为专用错误码 `AgentSessionAlreadyExists`，并补充 `sessionId`、`status` detail；同时新增 Rust 回归测试覆盖第二次启动被拒绝且不写入第二条 Session。
- 2026-06-06T20:48+0800：完成前端 Issue 详情侧栏调整与测试，`Open Session` 会切到现有 `Agents` Activity，占位承接后续 2.5 / 2.6，不再向用户暴露二次 `Run` 路径。
- 2026-06-06T20:50+0800：按 story 要求执行 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`cargo fmt --manifest-path src-tauri/Cargo.toml`、`cargo test --manifest-path src-tauri/Cargo.toml`；首次 Rust 全量测试因错误优先级不对失败，调整为先检查关联 Session 后复跑通过。
- 2026-06-06T21:03+0800：并行 reviewer 返回 4 个有效 follow-up，修复了 `Open Session` 上下文传递、stale `AGENT_SESSION_ALREADY_EXISTS`、`completed/crashed` 错误入口与插入阶段唯一约束映射，并重新执行前后端全量验证。

### Completion Notes List

- create-story 已为 Story 2.4 生成完整开发上下文。
- 已显式记录 2.4 与 2.3 / 2.5 / 2.6 的职责边界，避免把完整 Session 工作台、PTY 或 resume 一起混入本 story。
- 已把 addendum 的 `backlog + 已有关联 Session => Open Session / Run 禁用` 状态表写入 story，作为实现验收的直接依据。
- Rust Core 现在先检查 `issue_id -> session_id` 关联，再判定 Issue 状态；已有 Session 时稳定返回 `AgentSessionAlreadyExists`，并附带 `sessionId` 与 `status` detail，避免前端只能依赖文案分支。
- `IssueRecord` 现在携带最小关联事实 `linkedSessionId` / `linkedSessionStatus`，Issue 详情弹窗的 Session 区和 Actions 区都改为基于关联事实渲染，不再只看 `status === backlog`。
- 已有关联 Session 的 Issue 会显示 `Open Session` 入口并隐藏 `Run`；当前入口切到现有 `Agents` Activity，占位承接后续 story，而不是提前做完整 Session 工作台。
- 新增 Rust 与 React 回归测试，分别锁定“第二次启动被拒绝且不创建第二条 Session”以及“Issue 详情出现 `Open Session`、不再显示 `Run`”。
- review follow-up 后，`Open Session` 会携带 `sessionId` 切到 `Agents` Activity，占位文案会保留当前选中的 Session 上下文，避免入口名义上存在但实际丢失目标会话。
- 若用户在过期的 Run Dialog 中再次点击 `Start` 并命中 `AGENT_SESSION_ALREADY_EXISTS`，界面现在会刷新 Issue 列表并关闭对话框，而不是停留在失败消息。
- review 结果确认 `completed` Issue 与 `crashed` Session 不再错误渲染为 `Open Session`；当前 MVP 在这些场景下继续保持“无可执行入口”，后续 `Open Log` / `View Summary` 由后续 story 承接。
- review 结果确认插入阶段唯一约束冲突也会映射到 `AgentSessionAlreadyExists`，把并发/竞态下的错误语义收口到与串行重复启动一致。

### File List

- _bmad-output/implementation-artifacts/2-4-enforce-one-agent-session-per-issue.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- src/app/activity-router.tsx
- src/app/app-shell.tsx
- src/features/issues/issue-commands.ts
- src/features/issues/issue-run-dialog.tsx
- src/features/issues/issues-activity.tsx
- src/features/issues/issues-activity.test.tsx
- src/features/agents/agents-activity.tsx
- src-tauri/src/core/agent_session_service.rs
- src-tauri/src/db/issue_repository.rs
- src-tauri/src/types/errors.rs
- src-tauri/src/types/issue.rs
- src-tauri/tests/agent_session.rs
- src-tauri/tests/issue.rs

### Validation Commands

- `pnpm format`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `pnpm format`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `pnpm lint`
- `pnpm typecheck`

### Validation Results

- `pnpm format`：通过。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test`：通过，6 个测试文件、67 个测试通过；输出包含既有 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：首次失败；新加回归测试暴露“第二次启动”先命中 `IssueStatus != backlog`，没有返回专用重复 Session 错误码。已调整 `start_agent_session` 校验顺序。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：修正校验顺序后复跑，通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：修正校验顺序后复跑，通过。
- `pnpm format`：review follow-up 后复跑，通过。
- `pnpm lint`：review follow-up 后复跑，通过。
- `pnpm typecheck`：review follow-up 后复跑，通过。
- `pnpm test`：review follow-up 后首次复跑失败，原因是组件测试未传入 `onOpenAgentsActivity` 导致 `Open Session` 在孤立渲染场景中保持 disabled；补齐测试夹具后复跑通过，6 个测试文件、70 个测试通过；输出仍包含既有 `Could not parse CSS stylesheet` 警告。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：review follow-up 后首次复跑失败，原因是使用了当前 Rust edition 不支持的 `let chain`；改回兼容语法后复跑通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：review follow-up 后复跑通过。
- `pnpm lint`：补测试夹具与 Rust 兼容语法后再次复跑，通过。
- `pnpm typecheck`：补测试夹具与 Rust 兼容语法后再次复跑，通过。

### Change Log

- 2026-06-06：创建 Story 2.4 开发上下文并将状态推进到 `ready-for-dev`。
- 2026-06-06：完成一 Issue 一 Session 的错误语义、Issue 详情 `Open Session` 入口、关联 Session 事实字段与前后端回归测试，状态推进到 `review`。
- 2026-06-06：吸收 reviewer follow-up，修复 `Open Session` 上下文、stale existing-session 启动、规格偏差与唯一约束错误映射后通过复验，状态推进到 `done`。
