---
baseline_commit: 4b70eba
---

# Story 2.2: 编辑并保存最终 Prompt 快照

Status: done

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望在 Run Dialog 中编辑最终 prompt 并保存快照,
以便 Agent Session 能保留当次启动时用户确认过的真实输入。

## Acceptance Criteria

1. 给定 Run Dialog 已显示最终 prompt，当用户编辑 prompt 内容时，编辑后的内容成为本次启动使用的最终 prompt。
2. 给定用户点击 `Start`，当启动流程开始时，系统把最终 prompt 作为 `prompt snapshot` 传给 Rust Core。
3. 给定用户点击 `Start`，当后续 Story 2.3 接入成功启动流程时，启动成功后该 `prompt snapshot` 能保存在 `AgentSession`。
4. 给定用户点击 `Cancel`，当 Run Dialog 关闭时，不创建 `AgentSession`，也不改变 Issue 状态。

## Tasks / Subtasks

- [x] 让 Run Dialog 的最终 prompt 从“只读预览”升级为“用户可编辑的最终输入” (AC: 1)
  - [x] 在 `src/features/issues/issue-run-dialog.tsx` 中引入受控的 prompt 文本状态，默认值来自当前 profile 对应的 prompt 生成结果，而不是继续直接绑定只读 preview。
  - [x] 用户切换 Agent Profile 时，若尚未手动编辑 prompt，则同步刷新默认 prompt；若已经手动修改，则必须给出稳定且可测试的保留策略，避免静默覆盖用户输入。
  - [x] 继续保留 prompt sources 折叠区，sources 负责解释来源，不应把说明性标题重新混入最终 prompt 值。
- [x] 为 Run Dialog 补齐“启动输入 DTO”与前端 command 边界，但不越界承担 Story 2.3 的职责 (AC: 2, 4)
  - [x] 在 `src/features/issues/issue-commands.ts` 或等价边界文件中新增显式启动 command wrapper，输入至少包含 `projectId`、`issueId`、`agentProfileId`、`promptSnapshot`。
  - [x] `Start` 点击后调用统一 command client，把用户当前编辑后的 prompt 原样传给 Rust Core；前端不得直接改 Issue 状态，也不得伪造本地 Session。
  - [x] `Cancel` 继续只关闭 Dialog 并恢复焦点，不写入 `AgentSession`、`IssueAction` 或任何临时假状态。
- [x] 在 Rust Core 增加最小可落地的启动入口与失败路径，为 Story 2.3 预留真实持久化边界 (AC: 2, 3, 4)
  - [x] 在 `src-tauri/src/commands/` 新增 `start_agent_session` command 入口或等价命令名，保持命名与 architecture / addendum 一致。
  - [x] 本 story 只要求 Rust Core 接收并验证启动输入、向后续 service 层传递 `prompt_snapshot`，并为成功后的 `agent_sessions.prompt_snapshot` 落点保留清晰接口；不要在本 story 中抢先实现完整 PTY 启动、Session 列表刷新或 Agents Activity 跳转。
  - [x] 若当前仓库尚未实现 `agent_sessions` / `session_events` 表，本 story 可按最小方案先建立后续 story 需要的类型、command 和失败返回约定，但不得伪造“已成功创建 Session”的结果。
- [x] 把 2.2 与 2.3 的责任边界写死在实现与测试里，避免状态污染 (AC: 2, 3, 4)
  - [x] Story 2.2 负责“编辑最终 prompt + 把 snapshot 交给 Rust Core 启动入口”；Story 2.3 才负责“进程成功启动后创建 AgentSession、写审计、把 Issue 置为 `running`”。
  - [x] 在未证明 Codex 进程成功启动前，不得提前创建有效 `AgentSession`、写入 `running` Issue 或把 UI 导航到伪造的 Agents Activity 成功态。
  - [x] 启动失败时，Run Dialog 需保留在当前界面并显示失败原因；Issue 继续保持 `backlog`。
- [x] 测试与验证 (AC: 1, 2, 4)
  - [x] 新增前端测试覆盖：最终 prompt 可编辑；手动编辑后点击 `Start` 时，command 收到的是编辑后的 `promptSnapshot` 而非初始 preview。
  - [x] 新增前端测试覆盖：点击 `Cancel` 仅关闭 Dialog 并恢复焦点；不触发启动 command。
  - [x] 新增前端测试覆盖：启动 command 失败时，Dialog 保持打开并显示失败文案；Issue 不变更状态。
  - [x] 若新增 `run-prompt-builder` 或启动 DTO 的纯函数/映射逻辑，补其单测，锁定 profile 切换与已编辑 prompt 的保留规则。
  - [x] 新增 Rust command / service 测试，覆盖启动输入校验与失败路径返回。
  - [x] 运行 `pnpm format`。
  - [x] 运行 `pnpm lint`。
  - [x] 运行 `pnpm typecheck`。
  - [x] 运行 `pnpm test`。
  - [x] 若引入 Rust command / service / migration，运行受影响范围内的 Rust 测试。

## Senior Developer Review (AI)

- Outcome: Approve
- Date: 2026-06-06
- Findings: 本轮 review 未发现需要阻塞 Story 2.2 的功能、边界或回归问题；已额外补齐独立的 `AgentSessionPersistenceFailed` 错误码，避免复用 Issue 持久化错误语义。

## Dev Notes

### 关键假设与取舍

- Epic / PRD 原文把 Story 2.2 描述为“点击 `Start` 后把最终 prompt 作为 snapshot 传给 Rust Core，并在启动成功后保存到 `AgentSession`”。但当前仓库现实状态仍停留在 Story 2.1：Run Dialog 只有只读 preview，`Start` 只是提示文案，没有任何启动 command。
- 默认取舍是把 Story 2.2 收口为“前端可编辑最终 prompt + 跨边界提交 `promptSnapshot` + Rust Core 接住该输入”，而不提前完成 Story 2.3 的成功启动、副作用写库和 Issue `running` 状态流转。
- `prompt snapshot` 的语义必须是“用户本次点击 `Start` 时确认过的最终字符串”，不是重新按 profile / template 惰性现算，也不是仅存来源结构。
- 当前仓库的 Agent Profile 真实模型已在 `0007_restructure_agent_profiles.sql` 中收敛为 scoped profiles（`scope`、`project_id`、`mode`、`dangerous`、`default_skill`、`prompt_template`），不再恢复 `project_agent_overrides` 表；Story 2.2 必须继续以此真实模型实现。

### 范围边界

- 交付：Run Dialog 最终 prompt 可编辑、`Start` 把编辑后的 `promptSnapshot` 传入统一 command 边界、失败时保留 Dialog 并展示错误。
- 不交付：只有在 Codex 进程成功启动后才创建 `AgentSession`、写 `session_events` / `issue_actions`、把 Issue 改为 `running`、切换到 Agents Activity。这些继续留给 Story 2.3。
- 不交付：PTY/xterm、Codex resume、commit 检测、Session list、Issue Inspector、Completion Policy。

### 架构约束

- 前端只能通过 `src/shared/commands/command-client.ts` 调用 Rust commands，不得在 React 里直接访问 SQLite、shell 或 Git。[Source: `_bmad-output/planning-artifacts/architecture.md` §Integration Points, §Component Boundaries]
- 新增 command 时，必须同时补统一错误码、前端 wrapper 和至少一个失败路径测试。[Source: `_bmad-output/planning-artifacts/architecture.md` §Enforcement Guidelines]
- 真正的业务状态变化必须由 Rust Core service 执行；React 不得提前把 Issue 改成 `running`，也不得伪造 Session 成功态。[Source: `_bmad-output/planning-artifacts/architecture.md` §Pattern Examples, §Anti-Patterns]
- 规划文档建议的命令名是 `start_agent_session(issue_id, profile_id, prompt)`；若实现时需要额外字段，优先在 DTO 中补齐而不是改写语义。[Source: `_bmad-output/planning-artifacts/architecture.md` §Pattern Examples; `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md`]

### 当前代码状态与修改指引

- `src/features/issues/issue-run-dialog.tsx` 当前把 `Final prompt preview` 渲染为只读 `textarea`，`Start` 点击后仅设置一条占位提示文案；这是 Story 2.2 的直接切入点。
- `src/features/issues/run-prompt-builder.ts` 当前只返回 `finalPrompt` 与 sources，且 `finalPrompt` 直接等于 Issue description。若要支持“编辑后保留最终值”，应把 builder 保持为“生成初始值”的纯函数，不要把用户编辑态重新塞回 builder。
- `src/features/issues/issue-commands.ts` 当前只有 `listIssues`、`createIssue`、`updateIssue`，没有任何启动 command；需要在这里或等价边界新增启动入口。
- `src-tauri/src/commands/mod.rs` 与 `src-tauri/src/lib.rs` 当前尚未注册任何 `start_agent_session` 类命令；若新增 command，必须同步接线到 invoke handler。
- `src-tauri/src` 目前还没有 `agent_session_service.rs`、`session_event` 类型或 `agent_sessions` migration；这意味着 Story 2.2 实现时要坚持最小方案，只补本 story 真正需要的边界，不要把 2.3/2.6 的整套基础设施一次性拉进来。

### 前置故事信息

- Story 2.1 已完成 Run Dialog 打开、profile 选择、prompt sources 展示与“最终预览只显示 Issue description 原文”的边界收敛。
- Story 2.1 明确把 `Start` 接线、prompt snapshot 持久化和 Session 启动责任留给 Story 2.2 / 2.3；本 story 必须延续这个切分，不应回滚到大而全实现。
- Epic 质量评审指出 Story 2.3 依赖 PTY/Codex 启动能力，而该能力在 Story 2.6 之后才完全验证；因此 Story 2.2 更应控制范围，只建立 snapshot 提交边界，不抢跑完整启动状态机。

### Git Intelligence

- 当前 workflow preflight 记录的基线 `HEAD` 是 `4b70eba`。
- 当前工作区在 workflow 开始时是干净的；若开发阶段出现无关改动，最终提交必须只包含 Story 2.2 直接相关文件。
- 本 story 预期会改动 TypeScript/TSX 源码，默认至少要运行 `pnpm lint`、`pnpm typecheck`；由于会影响交互行为、分支逻辑和测试依赖实现，还必须运行 `pnpm test`。
- 若新增或修改 Rust command / service / migration，必须补充受影响范围的 Rust 验证命令，并在 Dev Agent Record 中逐条记录实际执行命令与结果。

### 测试要求

- 因本 story 会修改 TypeScript / React 源码，必须运行 `pnpm lint` 与 `pnpm typecheck`。
- 因本 story 会修改 Run Dialog 交互、command 调用与失败分支，必须运行 `pnpm test`。
- 若引入 Rust command / service / migration，必须运行受影响范围内的 Rust 测试；至少覆盖新增 command 的成功/失败边界。
- 若仓库格式化配置覆盖到本次修改文件，先运行 `pnpm format` 再进行 lint/typecheck/test。
- 最小验证命令清单：

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
```

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 2 / Story 2.2、2.3 的验收标准与责任边界。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — FR-9、FR-10、FR-11、Run Dialog 的产品行为。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` — `start_agent_session`、`agent_sessions.prompt_snapshot` 的数据与命令建议。
- `_bmad-output/planning-artifacts/architecture.md` — command/service/data boundary、命名与反模式约束。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — Run Dialog 成功/失败态行为。
- `_bmad-output/implementation-artifacts/2-1-generate-and-preview-issue-run-prompt.md` — Story 2.1 已交付范围与留给 2.2 / 2.3 的边界。
- `src/features/issues/issue-run-dialog.tsx`、`src/features/issues/run-prompt-builder.ts`、`src/features/issues/issue-commands.ts` — 当前前端真实落点。
- `src-tauri/src/commands/core_commands.rs`、`src-tauri/src/commands/mod.rs`、`src-tauri/src/lib.rs` — 当前 Rust command 注册边界。
- `src-tauri/migrations/0007_restructure_agent_profiles.sql` — 现行 Agent Profile 数据模型事实来源。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-06T18:xx+0800：`bmad-dev-workflow` preflight 识别 `2-2-edit-and-save-final-prompt-snapshot` 为 Epic 2 下一条 backlog story，基线 `HEAD` 为 `4b70eba`。
- 2026-06-06T18:xx+0800：核对 Epic 2、PRD、UX 与 architecture，确认 Story 2.2 负责编辑并提交 `promptSnapshot`，Story 2.3 才负责成功启动后的 Session 创建与 Issue 状态流转。
- 2026-06-06T18:xx+0800：读取当前 `issue-run-dialog.tsx`、`run-prompt-builder.ts`、`issue-commands.ts` 与 Rust command 注册边界，确认仓库尚无启动 command，需要以最小方式补齐跨边界 DTO 与失败路径。
- 2026-06-06T18:40+0800：完成 Run Dialog 可编辑 prompt、前端 `startAgentSession` command wrapper 和 Rust `start_agent_session` 输入校验链路，保持启动结果为 Story 2.3 待接入。
- 2026-06-06T18:46+0800：补齐前端测试覆盖 prompt 编辑/切换/失败态与 `Cancel` 不触发启动 command；新增 Rust `agent_session` 测试覆盖输入校验与 not-ready 边界。
- 2026-06-06T18:47+0800：按 review follow-up 拆出 `AgentSessionPersistenceFailed` 错误码，避免复用 `IssuePersistenceFailed`。

### Completion Notes List

- create-story 已为 Story 2.2 生成完整开发上下文。
- 已显式记录 2.2 / 2.3 的边界，避免把 Session 创建与 `running` 状态流转提前混入本 story。
- 已记录当前仓库与规划文档在 Agent Profile 数据模型上的现实差异，并默认以现行 scoped profiles 为准。
- Run Dialog 现在允许用户直接编辑最终 prompt，并在未手动修改前跟随默认 profile 生成值初始化。
- `Start` 现在会把当前 `promptSnapshot` 传给新的 Rust command；Rust 侧会校验 `projectId`、`issueId`、`agentProfileId`、Issue 状态和非空 prompt。
- 本 story 仍不创建 `AgentSession`、不写 `running` Issue，只返回明确的 “Story 2.3 接入” 失败语义，保证 2.2 / 2.3 边界不被破坏。
- 新增前后端测试覆盖 prompt 编辑保留、启动失败态与项目级 profile 边界。
- 自动 review 通过，未发现阻塞性问题。

### Validation Commands

- `test -f _bmad-output/planning-artifacts/epics.md`
- `test -f _bmad-output/planning-artifacts/architecture.md`
- `test -f _bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md`
- `test -f src/features/issues/issue-run-dialog.tsx`
- `test -f src-tauri/src/lib.rs`
- `pnpm format`
- `cargo fmt`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `cargo test`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `cargo test`

### Validation Results

- `test -f _bmad-output/planning-artifacts/epics.md`：通过。
- `test -f _bmad-output/planning-artifacts/architecture.md`：通过。
- `test -f _bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md`：通过。
- `test -f src/features/issues/issue-run-dialog.tsx`：通过。
- `test -f src-tauri/src/lib.rs`：通过。
- `pnpm format`：通过。
- `cargo fmt`：通过。
- `pnpm lint`：首次失败，`issue-run-dialog.tsx` 在 effect 内同步 `setState` 触发 `react-hooks/set-state-in-effect`；已改为在加载 profile 与切换 profile 时事件驱动更新 prompt。
- `pnpm typecheck`：通过。
- `pnpm test`：通过，62 个测试通过；输出包含既有 `Could not parse CSS stylesheet` 警告。
- `cargo test`：首次失败，`agent_session.rs` 测试夹具误按过期 `projects` schema 插入 `completion_policy`；已按当前 migration 修正夹具。
- `pnpm lint`：通过（review follow-up）。
- `pnpm typecheck`：通过（review follow-up）。
- `pnpm test`：通过，63 个测试通过；输出包含既有 `Could not parse CSS stylesheet` 警告（review follow-up）。
- `cargo test`：通过，新增 4 个 `agent_session` 测试与既有 Rust 测试全部通过（review follow-up）。

### File List

- _bmad-output/implementation-artifacts/2-2-edit-and-save-final-prompt-snapshot.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/bmad-dev-workflow-handoff.yaml
- src/features/issues/issue-commands.ts
- src/features/issues/issue-run-dialog.tsx
- src/features/issues/issues-activity.test.tsx
- src-tauri/src/commands/agent_session_commands.rs
- src-tauri/src/commands/mod.rs
- src-tauri/src/core/agent_session_service.rs
- src-tauri/src/core/mod.rs
- src-tauri/src/lib.rs
- src-tauri/src/types/agent_session.rs
- src-tauri/src/types/errors.rs
- src-tauri/src/types/mod.rs
- src-tauri/tests/agent_session.rs

### Change Log

- 2026-06-06：创建 Story 2.2 开发上下文并将状态推进到 `ready-for-dev`。
- 2026-06-06：完成可编辑 prompt、前端 `startAgentSession` 接线与 Rust `start_agent_session` 输入校验链路，状态推进到 `review`。
- 2026-06-06：自动 code review 通过，补齐独立 `AgentSessionPersistenceFailed` 错误码与测试后，状态推进到 `done`。
