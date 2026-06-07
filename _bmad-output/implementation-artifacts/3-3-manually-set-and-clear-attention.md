---
baseline_commit: 43f71e9
---

# Story 3.3: 手动设置和清除 Attention

Status: done

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望能手动标记或清除 Session 的关注状态,
以便在启发式识别不可靠时仍能维护自己的工作流提醒。

## Acceptance Criteria

1. 给定 AgentSession 正在运行，当用户对该 Session 执行标记关注操作时，Rust Core 将 `attention` 更新为 `requested`，并写入 `SessionEvent`。
2. 给定 AgentSession `attention=requested`，当用户清除关注状态时，Rust Core 将 `attention` 更新为 `none`，并且 Issues Activity 和 Agents Activity 的标记消失。
3. 给定未来可能加入启发式输出识别，当当前 MVP 实现手动 attention 时，不要求完全可靠解析 Codex TUI 状态，并且不把等待用户输入建成 AgentSession 主状态。

## Tasks / Subtasks

- [x] 先核对 3.2 之后 attention 的真实事实来源与缺口，避免重复实现已有 heuristics (AC: 1, 2, 3)
  - [x] 对照 `src-tauri/src/core/agent_session_service.rs`、`src-tauri/src/db/agent_session_repository.rs`、`src-tauri/src/types/session_event.rs` 与 `src/features/agents/agents-activity.tsx`，确认当前已经存在的能力：`attention=none|requested` 持久化、基于终端快照的自动请求 attention、成功写入终端后自动清除 attention、Issues/Agents 的 marker 展示。
  - [x] 明确 3.3 只补“用户显式设置 / 清除 attention”的命令入口、事件记录和最小 UI，不重写现有 heuristics，也不删除自动清除逻辑；若手动设置与 heuristics 并存，以同一 `attention` 字段为单一事实来源。
  - [x] 保持 `running` 仍是唯一运行中 Session 主状态；不要引入 `waiting-for-user`、`needs-attention` 或其他新 `AgentSessionStatus` 字面量。
- [x] 补齐 Rust Core 的手动 attention 更新入口与 `SessionEvent` 审计 (AC: 1, 2, 3)
  - [x] 在 `src-tauri/src/types/agent_session.rs`、`src-tauri/src/commands/agent_session_commands.rs`、`src/features/agents/agent-session-commands.ts` 增加最小输入 DTO 和 command，例如“设置指定 Session 的 attention”或等价的显式 action；前后端边界继续使用现有 `shared/commands` 通道。
  - [x] 在 `src-tauri/src/core/agent_session_service.rs` 中新增显式的手动 attention 更新路径，复用现有 `find_project_session` / `update_attention` 校验 Project 归属和 Session 存在性，只允许更新当前 Project 下的目标 Session。
  - [x] 为手动 attention 变化新增 `SessionEventType` 枚举与事件 payload，至少区分“手动请求 attention”与“手动清除 attention”，并通过 `EventRepository` 写入 `session_events`。
  - [x] 若目标 Session 不处于 `running`，按最小可解释规则拒绝该操作或保持无副作用，并用测试锁定行为；不要把已结束 Session 重新带回 attention 流程。
- [x] 在 Agents Activity 落地最小可用的手动 attention 交互 (AC: 1, 2, 3)
  - [x] 基于当前 `src/features/agents/agents-activity.tsx` 结构，在“已选中 Session 的工作区 chrome”内增加最小动作入口，让用户能够对当前 Session 执行“标记关注”或“清除关注”；不要为了 3.3 抢跑完整 `Session Header` 架构。
  - [x] 当 `attention === "none"` 时显示“标记关注”动作；当 `attention === "requested"` 时显示“清除关注”动作；操作完成后刷新 Session 列表，使左侧 Session row 的状态点与 linked issue 的 marker 一致更新。
  - [x] 若当前 Session 关联 Issue，确认右侧 linked issue pane / Issues Activity 在刷新后同步消失或出现 `Codex 需要确认` 标记；不新增额外说明卡片、toast 或复杂状态机。
  - [x] 保持所有 attention 提示仍以小型 marker 和文本 / `aria-label` 表达，不把整行、整卡或整个终端区域改成 attention 背景色。
- [x] 补齐前后端测试与回归保护 (AC: 1, 2, 3)
  - [x] 新增或更新前端测试覆盖：点击手动 attention 动作后，会调用对应 command、刷新列表，并在 Agents Activity / Issues Activity 呈现正确的 marker 显隐。
  - [x] 新增或更新前端测试覆盖：`attention=requested` 时展示“清除关注”而不是“标记关注”；`attention=none` 时反之；并校验无障碍标签或事实文案存在。
  - [x] 新增或更新 Rust 测试覆盖：手动设置 / 清除 attention 会更新 `agent_sessions.attention`、写入正确的 `session_events`，且不会把 `running` 之外的状态误当作可操作目标。
  - [x] 若本 story 修改了 TypeScript / TSX 运行时逻辑，运行 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`。
  - [x] 若本 story 修改了 Rust command / service / repository / DTO，运行 `cargo fmt --manifest-path src-tauri/Cargo.toml` 与 `cargo test --manifest-path src-tauri/Cargo.toml`。

## Senior Developer Review (AI)

- Outcome: Approve
- Date: 2026-06-07
- Findings: 同会话审查初轮发现 1 条 patch 级问题：`Completed` Session 不应暴露手动 attention 按钮。该问题已在 `src/features/agents/agents-activity.tsx` 收口为仅 `running` Session 显示操作，并补前端断言后复验通过；当前无未解决 finding。

## Dev Notes

### 关键假设与取舍

- 当前仓库已经有“自动 attention”链路：`reconcile_running_session_attention` 会在运行中 Session 的终端快照以 Codex 输入提示结尾时，把 `attention` 更新为 `requested`；写入终端成功后又会自动清回 `none`。3.3 不能把这些既有 heuristics 当成缺失能力重做一遍。
- Epic 3.3 的真实增量是“用户显式覆盖 / 补充 attention 事实”，用于兜底 heuristic 不可靠的场景。因此实现应复用现有 `attention` 字段和展示链路，而不是新增第二套“manual attention”状态。
- 当前仓库尚无独立 `session-header.tsx`；Epic 4.1 才会进入“在 Session Header 中手动 Mark Review”。所以 3.3 只应在现有 `AgentsActivity` 结构中放置最小动作入口，不提前搭完整 Header / Inspector 操作架构。

### 范围边界

- 交付：手动设置 / 清除 attention 的 command、Rust service 更新、`SessionEvent` 审计、Agents Activity 最小交互入口、以及前后端回归测试。
- 不交付：重做 attention heuristics、解析 Codex TUI 的更高可靠性方案、把 waiting-for-user 升级为新 Session 主状态、完整 Session Header、Mark Review、Completion、临时 Session。
- 不交付：改造 Issues 四泳道结构、重做 linked issue pane、引入全局通知系统或新的 attention 专属视图状态。

### 架构约束

- `attention` 只取 `none` 或 `requested`，并且不属于 Agent Session 主状态；等待用户输入必须继续建模为 `running + attention=requested`，不能扩展新的 `AgentSessionStatus`。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR-15; `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` §Issue 状态 / Agent Session 状态]
- Rust Core 仍是 Session / Issue 事实的唯一来源；前端必须通过 command 调用触发手动 attention 更新，再刷新查询结果消费事实，不在 React 本地伪造 marker 状态。[Source: `_bmad-output/planning-artifacts/architecture.md` §Component Boundaries, §Service Boundaries, §Data Boundaries]
- Needs Attention 的视觉表达继续使用小型 marker 和事实文案 `Codex 需要确认`，不能只靠颜色表达，也不能把整行或整卡刷成 attention 背景。[Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` §State Patterns; `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/DESIGN.md` §Status Markers]
- `SessionEvent` 应继续记录关键会话事实。3.3 新增的手动 attention 变化应作为 session event 写入，而不是只更新 `agent_sessions` 而不留审计轨迹。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §术语 / FR-15]

### 当前代码状态与修改指引

- `src-tauri/src/db/agent_session_repository.rs` 已经提供 `update_attention`，`src-tauri/src/types/agent_session.rs` 也已有 `AgentSessionAttention` 枚举；3.3 不需要新增 attention 存储结构，高概率只需把现有 repository 能力暴露到手动 command / service。
- `src-tauri/src/core/agent_session_service.rs` 已存在 `reconcile_running_session_attention` 与 `clear_attention_after_successful_input`；开发时要避免把“手动清除”误实现成删除这些自动路径。更合理的做法是增加显式 service 方法，与现有 heuristics 共享 repository 更新和 Project/Session 校验。
- `src-tauri/src/types/session_event.rs` 与 `src-tauri/src/db/event_repository.rs` 目前只覆盖 `session_started`、`session_exited`、`session_prompt_injected`；3.3 的关键缺口之一是缺少 attention 变化事件类型和对应测试。
- `src/features/agents/agent-session-commands.ts` 当前只有 list / terminal read-write / prompt inject / resize，没有手动 attention command；`src/features/agents/agents-activity.tsx` 也只有列表、终端和 linked issue pane，没有任何用户可点击的 attention toggle。
- `src/features/issues/issues-activity.tsx` 与 `src/features/agents/agents-activity.tsx` 已在 3.2 展示 `Codex 需要确认` marker；3.3 的 UI 最小实现应尽量复用这条展示链路，只补“如何改变 attention”的入口与刷新。

### 前置故事信息

- Story 2.5 已建立 `AgentsActivity` 的左右两栏和已选中 Session 上下文，是 3.3 放置最小操作入口的基础。
- Story 2.7 已建立 SessionEvent 与日志记录边界；3.3 应沿用这套审计机制写入 attention 变化事件，而不是自造旁路记录。
- Story 3.2 已把 attention 事实显示在 Issues / Agents 两侧；3.3 只负责补“手动改变 attention 事实”，不要重做 marker 展示。
- Epic 4.1 才会引入 Session Header 的 review 入口；3.3 如果需要工作区顶部动作，只能保持最小、只服务 attention，不得顺手实现 review / completion 入口。

### Git Intelligence

- 当前 workflow preflight 记录的基线 `HEAD` 是 `43f71e9`。
- 当前工作区在 story creation 阶段是干净的；后续开发若出现无关改动，最终提交只能包含 Story 3.3 直接相关文件。
- 预计本 story 会同时改动 TypeScript / TSX 与 Rust command / service / event 类型，默认至少运行：

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

### 测试要求

- TypeScript / React 运行时逻辑变更：必须运行 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`。
- Rust command / service / repository / DTO 变更：必须运行 `cargo fmt --manifest-path src-tauri/Cargo.toml` 与 `cargo test --manifest-path src-tauri/Cargo.toml`。
- 所有实际执行的验证命令必须逐条写入 Dev Agent Record；不能只写“已验证”。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 3 / Story 3.2、3.3、4.1 的验收标准和职责边界。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — FR-15、attention 定义、SessionEvent 要求与 Needs Attention 展示边界。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` — `attention=none|requested` 与 `running + attention` 的状态机口径。
- `_bmad-output/planning-artifacts/architecture.md` — React -> command -> Rust Core -> repository / event 的边界，以及 `features/agents` / `core` / `db` 职责划分。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — `Codex 需要确认` 文案、Needs Attention 体验模式和“不能只靠颜色表达”的约束。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/DESIGN.md` — attention marker 的视觉约束：小标记、不整行高亮。
- `_bmad-output/implementation-artifacts/2-5-show-agents-activity-session-list-and-basic-header.md` — 当前 Agents Activity 布局与 linked issue pane 的边界。
- `_bmad-output/implementation-artifacts/2-7-record-session-logs-and-exit-events.md` — SessionEvent 与退出事实的既有模式。
- `_bmad-output/implementation-artifacts/3-2-show-needs-attention-indicator.md` — attention 展示链路、3.2 / 3.3 范围切分和 linked session attention 透传现状。
- `src/features/agents/agents-activity.tsx`、`src/features/agents/agent-session-commands.ts`、`src-tauri/src/commands/agent_session_commands.rs`、`src-tauri/src/core/agent_session_service.rs`、`src-tauri/src/types/session_event.rs`、`src-tauri/src/db/event_repository.rs` — 3.3 的主要改动入口。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-07T15:28:16+0800：`bmad-dev-workflow` preflight 读取 `sprint-status.yaml`，确认当前无 `ready-for-dev` story，按顺序锁定 `3-3-manually-set-and-clear-attention`，基线 `HEAD` 为 `43f71e9`。
- 2026-06-07T15:31:00+0800：交叉核对 Epic 3.3、PRD FR-15、addendum 状态机约束、UX attention marker 说明，以及 Story 2.5 / 2.7 / 3.2 的既有边界。
- 2026-06-07T15:34:00+0800：复查代码后确认 attention 存储、自动 heuristics 与 marker 展示均已存在，真实缺口收口为“手动 attention command + SessionEvent + 最小 UI 入口 + 回归测试”。
- 2026-06-07T15:36:00+0800：先补前端 `AgentsActivity` 行为测试和 Rust `agent_session` 回归测试，再实现 `set_agent_session_attention` command、手动 attention service 路径、`SessionEventType` 扩展和最小工具栏按钮。
- 2026-06-07T15:39:00+0800：完成一轮全量验证时，`pnpm lint` 报出 `react-hooks/set-state-in-effect`；随后把 `AgentsActivity` 初始加载逻辑收口为 effect 内部异步函数、把手动 attention 刷新逻辑独立到 action handler。
- 2026-06-07T15:42:00+0800：同会话审查发现 `Completed` Session 仍会显示手动 attention 按钮；已补 UI 边界和测试断言，并再次通过格式化、lint、typecheck、前端测试与 Rust 全量测试。
- 2026-06-07T15:44:00+0800：review follow-up 后又重跑前端 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`，确认最新 UI 边界改动没有引入回退。

### Completion Notes List

- 2026-06-07：create-story 已为 Story 3.3 生成开发上下文，并将实现范围收口为“手动改变 attention 事实”，不包含重做 heuristics 或扩展 Session 主状态。
- 2026-06-07：已明确当前仓库没有独立 `Session Header` 组件，3.3 的 UI 只能在 `AgentsActivity` 现有结构内做最小动作入口，避免抢跑 Epic 4.1。
- 2026-06-07：已识别当前仓库的真实缺口：repository 已可更新 `attention`，但尚未暴露手动 command、attention 变化 `SessionEvent`，以及用户可点击的 attention toggle。
- 2026-06-07：新增 `set_agent_session_attention` 前后端命令链路，复用现有 `attention` 字段和 `find_project_session` / `update_attention` 校验，不引入新的 Session 主状态。
- 2026-06-07：为手动 attention 变化新增 `session_attention_requested` / `session_attention_cleared` 事件类型，并在 Rust 测试中覆盖 request、clear 和非 running 拒绝路径。
- 2026-06-07：`AgentsActivity` 当前会话工具栏新增“标记关注 / 清除关注”最小入口；操作后刷新 Session list，既有 Needs Attention marker 会随事实更新。
- 2026-06-07：同会话 review 修掉了一个 UI 边界问题：`Completed` Session 不再显示手动 attention 操作。
- 2026-06-07：最终实际验证命令包括局部前置测试、两轮全量验证和一轮 review follow-up 前端复验；最新一轮 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test` 全部通过。

### File List

- _bmad-output/implementation-artifacts/3-3-manually-set-and-clear-attention.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/bmad-dev-workflow-handoff.yaml
- src-tauri/src/commands/agent_session_commands.rs
- src-tauri/src/core/agent_session_service.rs
- src-tauri/src/db/event_repository.rs
- src-tauri/src/lib.rs
- src-tauri/src/types/agent_session.rs
- src-tauri/src/types/session_event.rs
- src-tauri/tests/agent_session.rs
- src/app/app.css
- src/features/agents/agent-session-commands.ts
- src/features/agents/agents-activity.test.tsx
- src/features/agents/agents-activity.tsx

### Validation Commands

- `pnpm test -- src/features/agents/agents-activity.test.tsx`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_session`
- `cargo test --manifest-path src-tauri/Cargo.toml set_session_attention`
- `cargo test --manifest-path src-tauri/Cargo.toml write_terminal_input_clears_requested_attention_after_successful_write`
- `pnpm format`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `pnpm format`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm format`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `cargo test --manifest-path src-tauri/Cargo.toml`

### Validation Results

- `pnpm test -- src/features/agents/agents-activity.test.tsx`：通过，`AgentsActivity` 相关测试在新增 attention toggle 行为后仍全部通过。
- `cargo test --manifest-path src-tauri/Cargo.toml agent_session`：通过，但该过滤参数主要命中了包含 `agent_session` 关键字的既有测试名，没有覆盖新加的 `set_session_attention` 用例，因此随后补跑了更精确过滤。
- `cargo test --manifest-path src-tauri/Cargo.toml set_session_attention`：通过，3 个新增手动 attention Rust 测试全部通过。
- `cargo test --manifest-path src-tauri/Cargo.toml write_terminal_input_clears_requested_attention_after_successful_write`：通过，确认既有自动清除 attention 行为未回退。
- `pnpm format`：第一轮通过。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：第一轮通过。
- `pnpm lint`：第一轮失败，报 `src/features/agents/agents-activity.tsx` 触发 `react-hooks/set-state-in-effect`；已修正加载方式后再次复验。
- `pnpm typecheck`：第一轮通过。
- `pnpm test`：第一轮通过，8 个测试文件、98 个测试通过；输出包含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `cargo test --manifest-path src-tauri/Cargo.toml`：第一轮通过，Rust 全量测试通过。
- `pnpm format`：第二轮通过。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：第二轮通过。
- `pnpm lint`：第二轮通过。
- `pnpm typecheck`：第二轮通过。
- `pnpm test`：第二轮通过，8 个测试文件、98 个测试通过；输出仍包含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `cargo test --manifest-path src-tauri/Cargo.toml`：第二轮通过，Rust 全量测试通过，其中 `agent_session` 集成测试 21 个用例全部通过。
- `pnpm format`：第三轮通过；仅重新折行了无关文件 `src/features/agents/codex-terminal-snapshot.ts`，随后已从当前 story 的改动范围中剔除。
- `pnpm lint`：第三轮通过。
- `pnpm typecheck`：第三轮通过。
- `pnpm test`：第三轮通过，8 个测试文件、98 个测试通过；输出仍包含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。

### Change Log

- 2026-06-07：create-story 为 Story 3.3 生成开发上下文并推进到 `ready-for-dev`。
- 2026-06-07：完成手动 attention command / service / event 扩展、`AgentsActivity` 最小操作入口，以及前后端回归测试，状态推进到 `review`。
- 2026-06-07：同会话 review 修复 `Completed` Session 错误暴露 attention 操作的问题并复验通过，状态推进到 `done`。
