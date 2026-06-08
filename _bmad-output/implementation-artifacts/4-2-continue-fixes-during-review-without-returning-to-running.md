---
baseline_commit: b83a9ce
---

# Story 4.2: Review 阶段继续修正不退回 Running

Status: done

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望在 review 阶段继续向 Codex 输入修正要求,
以便我可以在同一个 Session 中完成验收和返工循环。

## Acceptance Criteria

1. 给定 Issue 状态为 `review` 且 AgentSession 为 `running`，当用户打开 Codex Native Session View 时，xterm 仍然可输入，并且用户输入继续进入同一个 Codex PTY。
2. 给定用户在 review 阶段继续交互，当 Codex 产生输出或用户输入时，Issue 状态仍为 `review`，并且不退回 `running`。
3. 给定 review 阶段发生新的交互，当系统记录日志和事件时，新内容写入同一个 AgentSession log，并且不创建新的 AgentSession。

## Tasks / Subtasks

- [x] 收口 review Session 的 Header 与终端交互语义，只允许继续修正，不回退 Issue 状态 (AC: 1, 2)
  - [x] 复查 `src/features/agents/agents-activity.tsx` 当前 `canMarkReview`、linked issue pane 和 Header 按钮逻辑，确认 linked `review` Issue 不再显示 `Mark Review`，并为后续完成类入口保留当前产品语义要求的可见状态。
  - [x] 复查 `src/features/agents/codex-terminal.tsx` 与 `writeAgentSessionTerminal`/`readAgentSessionTerminal` 链路，确保选中 `review` Issue 对应的 running Session 时，terminal 不会因为 Issue 状态切换而变成只读、卸载或切换到新 session id。
  - [x] 如需修正前端 gating，保持修改聚焦在“允许 review 继续输入”和“隐藏不该出现的 running 态入口”，不顺手实现 Story 4.3 的 Inspector 交互或 Epic 5 的完成面板。
- [x] 巩固 Rust Core 的 Session 输入与 Issue 状态边界，确保 review 继续修正不会触发状态回退或新 Session 创建 (AC: 1, 2, 3)
  - [x] 复查 `src-tauri/src/core/agent_session_service.rs` 中 `write_terminal_input`、`inject_session_prompt`、attention 清理和 session 查询路径，确认这些路径只校验 `AgentSession.status == running` 与 Project 归属，不要求 linked Issue 必须是 `running`。
  - [x] 如果当前任何 service / repository 路径把 “Issue 进入 review” 误当作 session 不可继续输入的条件，修正为继续复用现有 PTY 与日志文件，并补对应失败路径测试。
  - [x] 明确保持 `review` 只是 Issue 状态；不得新增 `AgentSessionStatus::Review`、不得创建新的 `agent_sessions` 记录、不得把日志切换到新文件。
- [x] 为 review 继续修正补结构化事件与日志回归护栏，证明交互仍落在同一个 Session (AC: 2, 3)
  - [x] 复查 `src-tauri/src/db/event_repository.rs`、`session_events` 与 `issue_actions` 使用边界，确认 review 阶段继续输入最多追加既有 `session_prompt_injected` / terminal 相关 SessionEvent，不新增 “回到 running” 的 IssueAction。
  - [x] 若当前代码已存在 completion prompt 注入链路，优先复用 Story 2.8 的 `inject_agent_session_prompt` 边界验证 follow-up prompt 在 review 阶段仍指向同一 `session_id` / `codex_session_id`。
  - [x] 保持范围收口在同一 Session 的继续修正事实，不提前实现 completion prompt 注入 UI、commit 检测或自动完成策略。
- [x] 用前后端回归测试锁定 review 阶段的继续修正行为，而不是只凭人工阅读代码判断 (AC: 1, 2, 3)
  - [x] 前端测试覆盖：selected session 关联 `review` Issue 且 session 仍为 `running` 时，terminal 容器保持挂载，Header 不显示 `Mark Review`，并且继续输入不会触发切换 session。
  - [x] Rust 测试覆盖：`review` Issue 对应的 running Session 允许 `write_terminal_input` 或 `inject_session_prompt` 成功；Issue 状态保持 `review`；不新增 AgentSession 记录。
  - [x] Rust 或前端测试覆盖：review 阶段继续输入 / 输出后，日志仍写入原 `log_path`，SessionEvent 追加到同一 `session_id`，不存在新 session 的 `session_started` 事件。
- [x] 按项目规则执行并记录必要验证命令 (AC: 1, 2, 3)
  - [x] 本 story 预计会修改 TypeScript / TSX 与 Rust 运行时 / 测试逻辑，默认至少执行：

```bash
pnpm format
cargo fmt --manifest-path src-tauri/Cargo.toml
pnpm lint
pnpm typecheck
pnpm test -- --run src/features/agents/agents-activity.test.tsx
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml --test agent_session
cargo test --manifest-path src-tauri/Cargo.toml
git diff --check
```

## Dev Notes

### 关键假设与取舍

- Story 4.2 不是重新进入 `running` 的状态机，也不是“再开一个修正 Session”。最小目标是：Issue 已经进入 `review` 后，用户仍能对当前 running Codex Session 继续输入，且所有交互事实继续落在同一个 Session 上。
- Story 4.1 已经建立 `mark_issue_review`，并明确 `review` 是 Issue 状态、不是 AgentSession 状态。4.2 必须沿用这个边界，不能把 `review` 混成 Session 分组、Session status 或新的 PTY 生命周期。
- Story 2.8 已验证同一活 PTY 会话内注入 follow-up prompt / completion prompt 的能力，并把 resume 能力定为最佳努力。4.2 应优先复用这条既有“同会话继续输入”能力，而不是重新设计注入协议。

### 范围边界

- 交付：review Issue 对应 running Session 的继续输入、Header/terminal 不回退、同一 Session 日志与事件连续性，以及对应前后端回归测试。
- 不交付：Issue Inspector 打开与编辑、完成按钮与 Completion Confirmation、commit 检测、Summary / Log View、crashed / stopped 处理入口。
- 不交付：新的 Session 状态值、第二条 Codex 进程启动链路、自动把 Issue 从 `review` 改回 `running` 的逻辑。

### 架构约束

- `review` 是 Issue 状态，不是 `AgentSession` 状态，也不是 Session list 分组；React 不得自行回写业务状态。[Source: `_bmad-output/planning-artifacts/architecture.md` §Pattern Enforcement, §State Management Patterns]
- Session Header 与 Inspector、Dialog 操作都不得卸载 xterm；review 继续修正必须复用同一个运行中的 PTY / xterm 承载面。[Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` Flow 2, 用户担忧映射]
- review 阶段继续修正后，Issue 仍保持 `review`，Session 仍保持 `running`，并继续写入同一个 Agent Session 日志和事件流。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR-18]
- 新增状态变更或命令边界时，必须同时补 SessionEvent / IssueAction 或失败路径测试；不得绕过 Rust Core 直接写 SQLite 或改业务状态。[Source: `_bmad-output/planning-artifacts/architecture.md` §Pattern Enforcement]

### 当前代码状态与修改指引

- `src/features/agents/agents-activity.tsx` 当前已经在 `linkedIssue.issueStatus === "running"` 时显示 `Mark Review`，并在成功后通过 `reviewedIssueIdsRef` 覆盖旧轮询响应；这意味着 4.2 更可能是补“review 态继续输入”的显示与回归护栏，而不是新增一个全新交互入口。
- `src/features/agents/codex-terminal.tsx` 当前 terminal 输入只依赖 `projectId + sessionId` 调用 `writeAgentSessionTerminal`，没有直接读取 Issue 状态。若 4.2 出现回归，优先排查 selected session 切换、Header gating 或 polling 覆盖，而不是修改 xterm 基础设施。
- `src-tauri/src/core/agent_session_service.rs` 的 `write_terminal_input` / `inject_session_prompt` 当前只按 Project + Session 查找 running Session 并写入 PTY；理论上已满足 review 继续修正。开发前应先用测试确认，再决定是否只补回归而不改运行时代码。
- `src/features/agents/agent-session-commands.ts` 与 `src-tauri/src/types/agent_session.rs` 已定义 `InjectAgentSessionPromptInput` 和 `IssueStatus = "review"`；若 4.2 需要显式注入 follow-up prompt 入口，应沿用这些现有 DTO，不新增平行命令。
- `src-tauri/tests/agent_session.rs` 已有 attention、terminal write、prompt injection 与 log/session event 覆盖；4.2 的 Rust 回归更适合落在这里，验证 linked `review` Issue 的 running Session 继续输入不失败且不新建 session。

### 前置故事信息

- Story 4.1 已完成手动 `Mark Review`，并确认切换到 `review` 后 AgentSession 保持 `running`。
- Story 2.6 建立了 PTY/xterm 最小闭环，Story 2.7 建立了 session log 与 exit facts，Story 2.8 建立了同会话 prompt 注入能力；4.2 应基于这些既有能力做连续性交付。
- Story 3.1 已明确 `review` 不是 Session list 分组；Story 3.6 已明确无关联 Session 不触发 Issue 流转。4.2 不能破坏这些已收口边界。

### 测试要求

- 只要修改 TypeScript / TSX，必须至少运行 `pnpm lint`、`pnpm typecheck`，且因本 story 涉及渲染逻辑与交互链路，必须运行 `pnpm test`。
- 只要修改 Rust Core / repository / tests，必须至少运行 `cargo fmt --manifest-path src-tauri/Cargo.toml` 与受影响 Rust 测试；若继续输入、prompt injection 或 SessionEvent 路径被改动，至少覆盖 `agent_session` 测试组。
- 所有实际执行的验证命令必须逐条写入 Dev Agent Record；未运行的命令不能写成“已验证”。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 4 / Story 4.2 的原始需求、验收标准和相邻 story 边界。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — FR-18、FR-11、NFR2、NFR3。
- `_bmad-output/planning-artifacts/architecture.md` — Session / Issue 状态边界、Pattern Enforcement、命令命名与事件约束。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — Flow 2、xterm 不卸载与 review 继续修正交互约束。
- `_bmad-output/implementation-artifacts/4-1-manually-mark-review-in-session-header.md` — 前置的 Mark Review 状态转换、UI overlay 和测试边界。
- `_bmad-output/implementation-artifacts/2-8-spike-codex-resume-and-completion-prompt-injection.md` — 同会话 prompt 注入与 resume 降级结论。
- `src/features/agents/agents-activity.tsx`、`src/features/agents/agents-activity.test.tsx` — review 阶段 Header / terminal / polling 回归入口。
- `src/features/agents/codex-terminal.tsx`、`src/features/agents/agent-session-commands.ts` — 当前 terminal 输入与 prompt 注入入口。
- `src-tauri/src/core/agent_session_service.rs`、`src-tauri/src/db/agent_session_repository.rs`、`src-tauri/src/db/event_repository.rs`、`src-tauri/tests/agent_session.rs` — review 阶段继续修正的 Rust Core、日志 / 事件与测试入口。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-08T18:xx:xx+08:00：`bmad-dev-workflow` preflight 读取 `sprint-status.yaml`，确认当前无 `ready-for-dev` story，按顺序锁定 `4-2-continue-fixes-during-review-without-returning-to-running`，基线 `HEAD` 为 `b83a9ce`。
- 2026-06-08T18:xx:xx+08:00：交叉核对 Epic 4.2、PRD FR-18、UX Flow 2、Architecture 的状态边界，以及 Story 4.1 / 2.8 / 3.1 / 3.6 的既有实现与非范围约束。
- 2026-06-08T18:xx:xx+08:00：复查当前代码后确认 terminal 输入链路与 prompt 注入链路主要只依赖 running Session，而不直接依赖 Issue 为 `running`；已将“先补回归证明，再决定是否需要运行时代码改动”设为本 story 的默认实现路径。
- 2026-06-08T15:55:35+08:00：先补 `AgentsActivity` 与 `agent_session` 红测，分别锁定 review Issue 的 running Session 保持选中且 terminal 不卸载，以及 review 阶段 `write_terminal_input` / `inject_session_prompt` 继续复用同一 `session_id` / `log_path`。
- 2026-06-08T15:56:06+08:00：前端定向测试首轮失败，原因是新用例使用了过宽的 `/Review issue/i` 查询命中 Session row 与 linked issue card；已改为在 Running group 内断言选中态。
- 2026-06-08T15:56:55+08:00：Rust 定向 / 全量测试首轮暴露两类测试假设错误：把 `list_by_project_id` 轻量投影当成完整 session 记录使用，以及错误假设 PTY 注册后会保留预写日志内容；已收紧断言到 4.2 真正关心的事实。
- 2026-06-08T15:58:xx+08:00：补充 `IssueAction` 基线计数断言时一度把变量插入到相邻旧测试，导致作用域错误；修正后重跑 `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session` 与 `cargo test --manifest-path src-tauri/Cargo.toml` 全部通过。
- 2026-06-08T16:00:05+08:00：自动 review 阶段复核本次 diff 后确认无需改运行时代码；当前交付是前后端回归护栏，覆盖 review 阶段继续修正不退回 `running`、不新建 Session、不中断 terminal 的关键事实。

### Completion Notes List

- 2026-06-08：create-story 已为 Story 4.2 生成开发上下文，并将范围收口为“review 阶段继续复用同一 Session 修正，不退回 running、不新建 Session”。
- 2026-06-08：已显式记录 Story 4.2 与 4.3 / 4.4 / Epic 5 的边界，避免提前混入 Inspector、完成面板或 commit 检测。
- 2026-06-08：已将 Story 4.1 的 `Mark Review` 结果、Story 2.8 的 prompt 注入能力、Story 3.1 的分组约束和 Story 3.6 的隔离约束纳入实现上下文，供 dev-story 直接消费。
- 2026-06-08：复查当前 `AgentsActivity`、`CodexTerminal`、`write_terminal_input` 与 `inject_session_prompt` 后确认 4.2 的运行时契约已存在；本次实现不扩展功能，只补回归护栏，避免未来改动让 review 阶段错误回退到 `running` 或切走当前 Session。
- 2026-06-08：前端新增 `keeps the same review session selected with terminal mounted`，锁定 review Issue 对应 running Session 被选中时不会显示 `Mark Review`，并保持 terminal 容器挂载。
- 2026-06-08：Rust 新增 `write_terminal_input_keeps_review_issue_bound_to_same_running_session` 与 `inject_session_prompt_keeps_review_issue_in_same_session_and_log`，证明 review 阶段继续输入与 follow-up prompt 注入仍落在同一 `session_id` / `log_path`，Issue 状态保持 `review`，且不会额外新增 `IssueAction`。
- 2026-06-08：自动 code review 结论为 clean；未发现需要继续修补的运行时、边界或回归问题，Story 状态可直接收口为 `done`。

### File List

- _bmad-output/implementation-artifacts/4-2-continue-fixes-during-review-without-returning-to-running.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- src/features/agents/agents-activity.test.tsx
- src-tauri/tests/agent_session.rs

### Validation Commands

- `pnpm test -- --run src/features/agents/agents-activity.test.tsx -t "review session|Mark Review|mark review"`
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session write_terminal_input_keeps_review_issue_bound_to_same_running_session`
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session inject_session_prompt_keeps_review_issue_in_same_session_and_log`
- `pnpm format`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx`
- `pnpm test`
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `git diff --check`

### Validation Results

- `pnpm test -- --run src/features/agents/agents-activity.test.tsx -t "review session|Mark Review|mark review"`：首轮失败，原因是新用例查询范围过宽；改为在 Running group 内断言后通过，8 个测试文件、112 个测试通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session write_terminal_input_keeps_review_issue_bound_to_same_running_session`：首轮命令因误传多个测试名失败；拆分单测命令后继续执行，并在修正投影字段断言、日志预置假设和 `IssueAction` 基线计数后通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session inject_session_prompt_keeps_review_issue_in_same_session_and_log`：首轮命令因误传多个测试名失败；拆分单测命令后继续执行，并在修正投影字段断言、日志预置假设和 `IssueAction` 基线计数后通过。
- `pnpm format`：通过；Prettier 对无关文件 `src/features/agents/codex-terminal-snapshot.ts` 产生折行差异，已回退，不纳入本 story。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：通过。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx`：通过，8 个测试文件、112 个测试通过；输出包含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `pnpm test`：通过，8 个测试文件、112 个测试通过；输出包含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`：通过，28 个 `agent_session` 测试通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：通过，Rust 单元测试、集成测试与 doc tests 全部通过。
- `git diff --check`：通过。

### Change Log

- 2026-06-08：创建 Story 4.2 开发上下文并将状态推进到 `ready-for-dev`。
- 2026-06-08：补齐 review 阶段继续修正的前后端回归测试，验证现有实现已满足 AC，状态推进到 `review`。
- 2026-06-08：完成自动 code review，未发现阻塞问题，状态推进到 `done`。
