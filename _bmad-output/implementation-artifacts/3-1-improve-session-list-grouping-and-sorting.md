# Story 3.1: 完善 Session List 分组和排序

Status: done

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望在 Agents Activity 中按运行状态查看最近 Session,
以便我可以快速回到当前正在运行或最近结束的 Agent 工作。

## Acceptance Criteria

1. 给定 Project 中存在多个 AgentSession，当用户打开 Agents Activity 时，左侧 Session list 显示 `Running` 和 `Completed` 分组，并且 `Running` 只展示 `status=running` 的 Session。
2. 给定 `Running` 分组中有多个 Session，当 Session 有输出或用户输入时，系统更新 `last_active_at`，并且 `Running` 分组按 `last_active_at` 倒序展示。
3. 给定 `Completed` 分组存在已结束 Session，当左侧列表渲染时，`Completed` 分组展示 `closed`、`crashed` 或 `stopped` 的最近 20 条 Session，并按最近完成或结束时间排序。

## Tasks / Subtasks

- [x] 先核对 Story 2.5 / 2.7 的现状，收口 3.1 的真实缺口，而不是重复实现已交付能力 (AC: 1, 2, 3)
  - [x] 对照 `src/features/agents/agents-activity.tsx`、`src-tauri/src/core/agent_session_service.rs`、Story 2.5 与 Story 2.7 的收口记录，确认当前 `Running` / `Completed` 分组、`last_active_at` 排序、`Completed` 最近 20 条限制中哪些已经满足、哪些仍缺口。
  - [x] 若 Epic 3 原始文本与当前仓库现实状态发生重叠，以“最小补差”为准，不重做已存在的列表查询、分组或排序链路。
  - [x] 明确本 story 不提前实现 Needs Attention、临时 Session、Session Header 的 review 动作或异常恢复入口。
- [x] 补齐 `Completed` 分组对真实终止状态的最终消费边界 (AC: 1, 3)
  - [x] 结合 Story 2.7 已写入的 `closed` / `crashed` 与后续 Epic 4 才会产出的 `stopped`，确认 `Agents Activity` 左侧列表对三类终止状态都能稳定消费。
  - [x] 若当前 `Completed` 分组仍使用“非 running 即 completed”的宽松前端过滤，收口为显式只接受 `closed`、`crashed`、`stopped`，避免未来新增状态时被误混入列表。
  - [x] 保持 `review` 继续只是 Issue 状态，不新增 Session 状态值，也不新增第三个 Session 列表分组。
- [x] 补齐排序与展示的回归保护，确保后续 Epic 3 / 4 扩展不会破坏当前列表语义 (AC: 2, 3)
  - [x] 若已有 Rust service 层排序已满足 AC，则优先补测试而不是迁移排序责任；只有在现有排序与 AC 不一致时才做最小实现修正。
  - [x] 覆盖 `Running` 依据 `last_active_at` 倒序、`Completed` 依据 `closed_at` 或最近结束事实倒序、并保留最近 20 条的稳定断言。
  - [x] 覆盖 `crashed` 与 `closed` 混排、无 `title` 仅有 `issueTitle`、以及无关联 Issue 的 Session title 回退等最小展示场景，确保后续临时 Session story 不会回退当前列表。
- [x] 测试与验证 (AC: 1, 2, 3)
  - [x] 新增或更新前端测试覆盖：左侧列表固定只有 `Running` / `Completed` 两组；`Completed` 中能展示 `closed` / `crashed` / `stopped`；不存在把 `review` 当作 Session 分组的路径。
  - [x] 新增或更新 Rust 测试覆盖：`list_agent_sessions` 只把 `running` 放进 `Running`，只把 `closed` / `crashed` / `stopped` 放进 `Completed`，并保持排序与最近 20 条限制。
  - [x] 若本 story 修改了 TypeScript / TSX 运行时逻辑，运行 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`。
  - [x] 若本 story 修改了 Rust command / service / repository / DTO，运行 `cargo fmt --manifest-path src-tauri/Cargo.toml` 与 `cargo test --manifest-path src-tauri/Cargo.toml`。

### Review Findings

- [x] [Review][Patch] 强化 Rust completed 顺序断言 [src-tauri/tests/agent_session.rs:514]：当前测试只锁定了 completed 列表的首项、尾项和截断行为，但没有断言中间项的完整顺序；若后续回归只打乱中段顺序，现有测试仍可能通过。

## Senior Developer Review (AI)

- Outcome: Approve
- Date: 2026-06-07
- Findings: 初轮 review 仅留下 1 条 patch action item，用于加强 Rust completed 列表排序回归测试；该修补已完成并复验通过。follow-up blind / auditor 复审 clean，最终一层 edge reviewer 超时未返回，但未再暴露新的阻塞问题。

## Dev Notes

### 关键假设与取舍

- Epic 3 的 Story 3.1 原始描述与已完成的 Story 2.5 有明显重叠：2.5 已经交付 `Running` / `Completed` 分组、`Running` 的 `last_active_at` 排序、`Completed` 最近 20 条限制和基础 Session list。
- Story 2.7 又补上了真实退出状态写回：`closed` 与 `crashed` 已经进入 `agent_sessions.status`，而 `stopped` 仍明确留给 Epic 4 的“应用重启后无法恢复活会话”场景。
- 因此 3.1 的默认取舍不是重做整套列表，而是先核对当前实现与 AC 的真实差距；只有在发现当前列表对 `closed` / `crashed` / `stopped` 的消费边界、排序责任或回归保护不足时，才做最小补差。

### 范围边界

- 交付：Session list 分组/排序语义与当前代码现实对齐后的最小补差，实现或测试任选其必要最小集合。
- 不交付：Needs Attention 标记与手动 attention、临时 Session Dialog/启动、Session Header review 动作、异常恢复入口、日志入口、完成态 UI。
- 不交付：为了“顺手整理”重构 Agents Activity 布局、终端区域、Issue Inspector 或 Git detection 链路。

### 架构约束

- Rust Core 仍是 Agent Session 状态、终止时间和列表数据的唯一事实来源；前端应消费现成查询结果，而不是自行推断 Session 分组。[Source: `_bmad-output/planning-artifacts/architecture.md` §State Management Patterns; `_bmad-output/implementation-artifacts/2-5-show-agents-activity-session-list-and-basic-header.md`]
- `review` 是 Issue 状态，不是 `AgentSession` 状态，也不是 Agents Activity 左侧列表分组。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR-13; `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md`]
- `closed`、`crashed`、`stopped` 的真实生成边界分散在 Story 2.7 与 Epic 4；3.1 只消费这些事实，不提前扩展新的终止状态机。[Source: `_bmad-output/planning-artifacts/epics.md` Story 3.1, Story 4.5-4.7; `_bmad-output/implementation-artifacts/2-7-record-session-logs-and-exit-events.md`]
- 实现应遵守“简单优先、外科手术式修改”：若当前 service 层排序已满足 AC，优先补测试与显式断言，而不是迁移职责或大幅重写列表组件。[Source: `AGENTS.md`]

### 当前代码状态与修改指引

- `src/features/agents/agents-activity.tsx` 当前已经渲染固定的 `Running` / `Completed` 两组，并通过 `session.status === "running"` 与 `session.status !== "running"` 做前端分流；这意味着 3.1 的潜在缺口更可能在“Completed 过宽”而不是“完全没有分组”。
- `src-tauri/src/core/agent_session_service.rs` 当前 `list_agent_sessions` 已显式将 `running` 放入 `running_sessions`，将 `closed` / `crashed` / `stopped` 放入 `completed_sessions`，并在 service 层完成排序与 `truncate(20)`；开发前应先确认这是否已经完全满足 3.1 AC。
- `src/features/agents/agents-activity.test.tsx` 已覆盖基础分组、默认选中、临时 Session title 回退和 linked issue 信息面板；3.1 应优先补“真实终止状态”的回归断言，而不是重写整个测试结构。
- `src-tauri/tests/agent_session.rs` 已包含 Session list 的排序与分组断言；若 AC 与现状一致，3.1 的最低成本实现可能只是补足 `stopped`、`crashed`、边界状态与未来回归的测试。
- 当前工作区存在无关脏改动：`src-tauri/src/commands/settings_commands.rs`、`src-tauri/tests/settings.rs`。后续开发和提交必须避开这两处无关改动。

### 前置故事信息

- Story 2.5 已把 Agents Activity 从占位页升级为真实左右两栏，交付了 Session list 的基础查询、分组、默认选中和 Header 骨架。
- Story 2.7 已写入退出事件并把 `exit_code == 0` 收口为 `closed`、非零退出收口为 `crashed`；这使 3.1 可以在真实终止状态之上补回列表消费与测试。
- Story 2.8 / 2.9 主要聚焦 prompt 注入和 Git detection，不应被 3.1 顺手改动。
- Story 3.2 / 3.3 将承接 Needs Attention；Story 3.4 / 3.5 / 3.6 将承接临时 Session，因此 3.1 只需保证当前列表对这些后续能力“可兼容、不回退”。

### Git Intelligence

- 当前 workflow preflight 记录的基线 `HEAD` 是 `4e05dac`。
- 当前工作区在创建 story 阶段已存在两处无关脏改动：`src-tauri/src/commands/settings_commands.rs`、`src-tauri/tests/settings.rs`；后续提交必须只包含 3.1 直接相关文件。
- 若本 story 只改动 Rust 列表查询或测试，可只运行 Rust 验证；若改动了 TypeScript / TSX 运行时逻辑，则必须补跑前端 `format` / `lint` / `typecheck` / `test`。

### 测试要求

- TypeScript / React 运行时逻辑变更：必须运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`；若格式化配置覆盖到修改文件，先运行 `pnpm format`。
- Rust command / service / repository / DTO 变更：必须运行 `cargo fmt --manifest-path src-tauri/Cargo.toml`、`cargo test --manifest-path src-tauri/Cargo.toml`。
- 所有实际执行的验证命令必须逐条写入 Dev Agent Record，不能只写“已验证”。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 3 / Story 3.1 的原始 AC，以及与 3.2-3.6、Epic 4 的前后依赖。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — FR-13、FR-19、Agents Activity 与 Session 分组语义。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` — `Running` / `Completed` 固定分组约束。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — Session list 的排序与展示体验约束。
- `_bmad-output/planning-artifacts/implementation-readiness-report-2026-06-04.md` — 对 2.5 / 3.1 与 `crashed` / `stopped` 前置依赖的风险提醒。
- `_bmad-output/implementation-artifacts/2-5-show-agents-activity-session-list-and-basic-header.md` — 已交付的 Session list 分组、排序与 Header 骨架。
- `_bmad-output/implementation-artifacts/2-7-record-session-logs-and-exit-events.md` — 已交付的 `closed` / `crashed` 退出事实来源。
- `src/features/agents/agents-activity.tsx`、`src/features/agents/agents-activity.test.tsx`、`src-tauri/src/core/agent_session_service.rs`、`src-tauri/tests/agent_session.rs` — 3.1 的主要改动入口。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-07T11:58:44+0800：`bmad-dev-workflow` preflight 读取 `sprint-status.yaml`，确认当前无 `ready-for-dev` story，按顺序锁定 `3-1-improve-session-list-grouping-and-sorting`，基线 `HEAD` 为 `4e05dac`。
- 2026-06-07T11:58:44+0800：交叉核对 Epic 3.1、PRD、addendum、UX、implementation-readiness-report 与 Story 2.5 / 2.7 / 2.9，确认 3.1 与已完成功能存在部分重叠，开发阶段必须先核对真实缺口再做最小补差。
- 2026-06-07T11:58:44+0800：复查 `src/features/agents/agents-activity.tsx` 与 `src-tauri/src/core/agent_session_service.rs`，确认当前已存在 `Running` / `Completed` 分组、service 层排序与最近 20 条限制，3.1 的高概率工作量在显式边界收口与回归保护。
- 2026-06-07T12:03:40+0800：完成 gap check，确认后端 `list_agent_sessions` 已满足 3.1 的排序与终止状态边界，真实缺口仅剩前端 `Completed` 组过滤过宽和对应回归测试不足。
- 2026-06-07T12:04:xx+0800：将 `src/features/agents/agents-activity.tsx` 的 `Completed` 过滤从“非 running”收紧为显式 `closed | crashed | stopped`，并补前端 / Rust 回归测试。
- 2026-06-07T12:06:00+0800：完成 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`cargo fmt --manifest-path src-tauri/Cargo.toml`、`cargo test --manifest-path src-tauri/Cargo.toml` 全量复验。
- 2026-06-07T12:07:40+0800：进入自动 review 阶段前发现 `bmad-code-review` 依赖并行 reviewer 子流程；当前会话未获得显式 delegation 授权，因此 review 阶段阻塞，等待用户授权或指定替代方式。
- 2026-06-07T12:1x+0800：并行完成 blind / edge / auditor review；dismiss 了“未知终态会消失”的噪音项，保留 1 条 patch finding：强化 Rust completed 顺序断言。
- 2026-06-07T12:38:30+0800：完成 review follow-up，补强 Rust completed 列表完整顺序断言；重新执行 `rustfmt --edition 2021 src-tauri/tests/agent_session.rs`、`cargo test --manifest-path src-tauri/Cargo.toml` 后通过。
- 2026-06-07T12:3x+0800：follow-up blind / auditor 复审 clean；最终一层 edge reviewer 超时未返回，因此将该轮记为“部分层 clean，未新增 finding”。
- 2026-06-07T12:47:20+0800：收到迟到的 edge reviewer 结果后，再补 3 条纯测试增强：completed-only 前端默认选中、`closed_at` 与 `last_active_at` 脱钩保护、以及 `closed_at` 并列时按 `session_id` 倒序的 tie-break 断言；前后端验证已再次通过。

### Completion Notes List

- 2026-06-07：create-story 已为 Story 3.1 生成开发上下文，并将状态推进到 `ready-for-dev`。
- 当前 story 已显式记录与 Story 2.5 / 2.7 的功能重叠，要求开发先做 gap check，再决定是否需要代码改动。
- 当前工作区存在无关脏改动 `src-tauri/src/commands/settings_commands.rs` 与 `src-tauri/tests/settings.rs`；后续实现和提交需显式隔离。
- 2026-06-07：开发阶段完成后确认 3.1 的最小代码修正仅涉及前端 `Completed` 分组的显式终止状态过滤，以及对应前后端回归测试。
- 实际执行的验证命令：`pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`cargo fmt --manifest-path src-tauri/Cargo.toml`、`cargo test --manifest-path src-tauri/Cargo.toml`。
- 验证结果：上述命令均通过；`pnpm test` 输出保留既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- 2026-06-07：review follow-up 已补强 Rust completed 完整顺序断言，并重新通过 Rust 全量测试。
- 2026-06-07：根据迟到的 edge reviewer 建议，再补 completed-only fallback 与 completed 排序 tie-break 测试，未再改动运行时代码。
- 当前 story 的实现、验证和 code review follow-up 已完成，状态可收口为 `done` 并进入提交。

### File List

- _bmad-output/implementation-artifacts/3-1-improve-session-list-grouping-and-sorting.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/bmad-dev-workflow-handoff.yaml
- src/features/agents/agents-activity.tsx
- src/features/agents/agents-activity.test.tsx
- src-tauri/tests/agent_session.rs

### Validation Commands

- `pnpm format`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `rustfmt --edition 2021 src-tauri/tests/agent_session.rs`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `pnpm format`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml`

### Validation Results

- `pnpm format`：通过。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test`：通过，8 个测试文件、87 个测试通过；输出包含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：通过。
- `rustfmt --edition 2021 src-tauri/tests/agent_session.rs`：通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：review follow-up 后复跑通过。
- `pnpm format`：根据 edge reviewer 的测试增强 follow-up 复跑，通过。
- `pnpm lint`：根据 edge reviewer 的测试增强 follow-up 复跑，通过。
- `pnpm typecheck`：根据 edge reviewer 的测试增强 follow-up 复跑，通过。
- `pnpm test`：根据 edge reviewer 的测试增强 follow-up 复跑，通过，8 个测试文件、88 个测试通过；输出包含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：根据 edge reviewer 的测试增强 follow-up 复跑，通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：根据 edge reviewer 的测试增强 follow-up 复跑，通过；`agent_session` 集成测试现为 15 个测试全部通过。

### Change Log

- 2026-06-07：创建 Story 3.1 开发上下文并将状态推进到 `ready-for-dev`。
- 2026-06-07：完成 gap check，确认 3.1 与 Story 2.5 / 2.7 存在重叠后仅做最小补差：前端 `Completed` 显式终止状态过滤与前后端回归测试，状态推进到 `review`。
- 2026-06-07：完成 code review follow-up，补强 Rust completed 完整顺序断言并复验通过，状态推进到 `done`。
- 2026-06-07：吸收迟到的 edge reviewer 测试建议，追加 completed-only fallback 与 completed 排序 tie-break 回归测试，并再次通过前后端验证。
