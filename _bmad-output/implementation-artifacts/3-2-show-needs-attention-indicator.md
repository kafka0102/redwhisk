---
baseline_commit: ef84c74
---

# Story 3.2: 展示 Needs Attention 标记

Status: done

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望看到哪些运行中的 Codex Session 需要我关注,
以便我可以及时回到等待确认的任务。

## Acceptance Criteria

1. 给定 AgentSession 主状态为 `running`，当系统或用户将 `attention` 设置为 `requested` 时，AgentSession 主状态仍保持 `running`，并且不创建新的 Session 状态值。
2. 给定 Issue card 关联的 AgentSession `attention=requested`，当用户查看 Issues Activity 时，Issue card 显示 Needs Attention 标记，并且标记使用小型 attention marker 和事实文案，不改变整卡背景色。
3. 给定 Agents Activity 左侧 Session list 中的 Session `attention=requested`，当列表渲染时，该 Session item 显示 Needs Attention 标记，并且状态不能只靠颜色表达。

## Tasks / Subtasks

- [x] 先核对现有 attention 数据链路与 3.2 的真实缺口，避免抢跑 3.3 的设置逻辑 (AC: 1, 2, 3)
  - [x] 对照 `src-tauri/src/types/agent_session.rs`、`src-tauri/src/db/agent_session_repository.rs`、`src-tauri/src/db/issue_repository.rs`、`src/features/agents/agent-session-commands.ts` 与 `src/features/issues/issue-commands.ts`，确认哪些边界已经带有 `attention`，哪些仍缺最小透传。
  - [x] 明确本 story 只负责展示 `attention=requested` 的既有事实，不新增设置/清除 attention 的 command、service 或状态机入口；手动设置和清除留给 Story 3.3。
  - [x] 保持 `running` 仍是唯一运行中 Session 主状态，不把 waiting-for-user、needs-attention 或其他新字面量写进 `AgentSessionStatus`。
- [x] 补齐 Issues Activity 对 linked session attention 的最小事实透传与展示 (AC: 1, 2)
  - [x] 在 Rust 侧为 `IssueRecord` 增加 linked session 的 attention 字段，沿用 Story 2.4 已建立的“每个 Issue 最多一个活跃 Agent Session”边界，最小修改 `issue_repository` 查询、`types/issue.rs`、对应 command/service 和前端 `issue-commands.ts` 类型。
  - [x] 在 `src/features/issues/issues-activity.tsx` 的 Issue card 上增加小型 Needs Attention 标记和事实文案 `Codex 需要确认`；仅在 `linkedSessionAttention === "requested"` 时显示，不扩大卡片字段集，不改变整卡背景色。
  - [x] 若 Issue 详情弹窗当前也消费 linked session 摘要，只在确有必要的最小范围内补齐 attention 文案或可访问标签，不新增 3.3 的交互按钮。
- [x] 补齐 Agents Activity Session list 的 attention marker 展示 (AC: 1, 3)
  - [x] 复用 `AgentSessionListItem.attention` 现有字段，在 `src/features/agents/agents-activity.tsx` 的 Session row 中增加小型标记和事实文案；保持 `Running` / `Completed` 分组与既有排序逻辑不变。
  - [x] 为 attention 标记提供文本或 `aria-label`，确保用户不依赖颜色也能识别 Needs Attention。
  - [x] 不顺手改动 Session Header、临时 Session 新建入口、PTY/xterm 区域或 review/completion 流程。
- [x] 测试与验证 (AC: 1, 2, 3)
  - [x] 新增或更新前端测试覆盖：Issues Activity 中带 linked session 且 `attention=requested` 的 Issue card 会显示 `Codex 需要确认`；`attention=none` 时不显示该标记。
  - [x] 新增或更新前端测试覆盖：Agents Activity Session list 中 `attention=requested` 的 Session item 会显示 Needs Attention 标记，并保留既有状态/排序断言。
  - [x] 若 Rust 为 Issue list 补了 attention 透传，新增或更新 Rust 测试覆盖 `list_issues` 返回 linked session attention 的映射；同时确保未关联 Session 或 `attention=none` 的 Issue 不会被误标记。
  - [x] 若本 story 修改了 TypeScript / TSX 运行时逻辑，运行 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`。
  - [x] 若本 story 修改了 Rust command / service / repository / DTO，运行 `cargo fmt --manifest-path src-tauri/Cargo.toml` 与 `cargo test --manifest-path src-tauri/Cargo.toml`。

## Senior Developer Review (AI)

- Outcome: Approve
- Date: 2026-06-07
- Findings: 本轮 review 未发现阻塞交付的问题；改动仅补 `IssueRecord` 的 attention 透传、Issues/Agents 两处 marker 展示和对应测试，没有引入新的 Session 状态、分组或 attention 设置逻辑。

## Dev Notes

### 关键假设与取舍

- Story 3.2 的目标是“展示 attention 事实”，不是“创建 attention 事实”。当前仓库已经在 `agent_sessions` schema、Rust 类型和 Agents Session list DTO 中保留 `attention` 字段，因此这条 story 默认优先补显示链路，而不是新增命令或 heuristics。
- PRD 明确要求 `attention` 不属于 Agent Session 主状态；因此 3.2 不能把 `requested` 转译成新的 `status`，也不能把等待用户输入建成另一类 Session 分组。
- 因为 Story 3.3 才负责手动设置/清除 attention，3.2 的测试可以直接构造 `attention=requested` 的持久化事实或 mock 数据，不需要在本 story 中补操作按钮。

### 范围边界

- 交付：Issues Activity 与 Agents Activity 对 `attention=requested` 的标记展示、最小数据透传、可访问文本/标签、相关测试。
- 不交付：手动设置/清除 attention、启发式识别 Codex 等待用户输入、SessionEvent 记录 attention 变化、Header review 动作、临时 Session。
- 不交付：改造 Issue card 信息密度、重做 Agents 列表布局、引入新 Session 状态值或新分组。

### 架构约束

- `attention` 只取 `none` 或 `requested`，并且不属于 Agent Session 主状态；`running` 仍是唯一运行中主状态。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR-15; `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` §Issue 状态 / Agent Session 状态]
- Issues Activity 与 Agents Activity 都必须能展示 Needs Attention；展示形态是小型 marker 和事实文案 `Codex 需要确认`，不能只靠颜色表达，也不能把整卡或整行刷成 attention 底色。[Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` §State Patterns; `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/DESIGN.md` §Components]
- Rust Core 仍是 Issue / Session 事实的唯一来源；前端只能消费 `list_issues` 和 `list_agent_sessions` 返回的 attention 状态，不能靠 UI 本地推断“这个 Session 可能在等用户”。[Source: `_bmad-output/planning-artifacts/architecture.md` §Architecture Summary, §State Management Patterns]
- Issue card 仍保持极简，只展示 `title`、`status`、`updated_at` 和可选 Session/attention 标记；不要借 3.2 顺手塞入更多字段。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §Issues Activity; `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` §React IA 冻结口径]

### 当前代码状态与修改指引

- `src-tauri/src/types/agent_session.rs` 与 `src/features/agents/agent-session-commands.ts` 已经把 `attention` 暴露给 Agents Session list，因此 Agents 侧的高概率缺口仅在渲染层和测试层。
- `src-tauri/src/types/issue.rs`、`src/features/issues/issue-commands.ts` 当前没有 linked session attention 字段；`src-tauri/src/db/issue_repository.rs` 的 `ISSUE_SELECT_COLUMNS` 也只透传 `linked_session_id` 和 `linked_session_status`。若要满足 AC 2，需要从这里补最小事实透传。
- `src/features/issues/issues-activity.tsx` 当前 Issue card 只渲染 id、更新时间、标题和描述摘要；`src/features/agents/agents-activity.tsx` 的 Session row 只渲染 title 与 `agentType · status`。3.2 的核心 UI 变更点就是在这两个位置加入小型 attention 标记。
- `src/features/issues/issues-activity.test.tsx` 与 `src/features/agents/agents-activity.test.tsx` 当前 fixture 几乎都使用 `attention: "none"` 或根本没有 Issue attention 字段；需要新增显式 `requested` 场景，避免后续 story 回退这个展示。
- Story 2.4 已经收口“一 Issue 一 Agent Session”的规则；Issue list 侧若新增 linked session attention，应保持最小子查询/映射修正，不要在 3.2 顺手重写 Issue 与 Session 的关联查询策略。

### 前置故事信息

- Story 2.4 已保证一个 Issue 不能重复启动多个 Agent Session，并为 Issues Activity 注入 `linkedSessionId` / `linkedSessionStatus`；3.2 应沿用这条单 Session 关联边界补 attention 透传。
- Story 2.5 已交付 Agents Activity 的 Session list 和基础 Header；3.2 只在现有列表项上增加 marker，不应重做列表分组或默认选中逻辑。
- Story 2.7 已把 Session 退出状态收口为 `closed` / `crashed`，Story 3.1 又收紧了 `Completed` 列表消费边界；3.2 不应破坏这些既有状态展示。
- Story 3.3 将承接 attention 的手动设置和清除；Story 3.2 现在只需要把 `requested` 事实可见化，为后续交互 story 打基础。

### Git Intelligence

- 当前 workflow preflight 记录的基线 `HEAD` 是 `ef84c74`。
- 当前工作区在 story creation 阶段是干净的；后续开发若出现无关改动，最终提交只能包含 Story 3.2 直接相关文件。
- 预计本 story 至少会改动 TypeScript / TSX；若为了满足 AC 2 同时补 Rust Issue DTO / repository 透传，则按项目规则默认执行：

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

- `_bmad-output/planning-artifacts/epics.md` — Epic 3 / Story 3.2、3.3 的验收标准与边界。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — FR-15、Issues Activity、attention 定义与展示要求。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` — `attention=none|requested`、Issue/Session 状态表和 React IA 冻结口径。
- `_bmad-output/planning-artifacts/architecture.md` — attention 与状态机单一事实来源约束。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — `Codex 需要确认` 文案和 Needs Attention 的体验模式。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/DESIGN.md` — attention marker 视觉约束：小标记、不可整行高亮、不可只靠颜色。
- `_bmad-output/implementation-artifacts/2-4-enforce-one-agent-session-per-issue.md` — 一 Issue 一 Session 约束与 linked session 数据来源。
- `_bmad-output/implementation-artifacts/2-5-show-agents-activity-session-list-and-basic-header.md` — Agents / Issues 当前 UI 骨架与数据边界。
- `_bmad-output/implementation-artifacts/3-1-improve-session-list-grouping-and-sorting.md` — Session list 当前分组与已收口状态过滤边界。
- `src/features/issues/issues-activity.tsx`、`src/features/issues/issues-activity.test.tsx`、`src/features/agents/agents-activity.tsx`、`src/features/agents/agents-activity.test.tsx` — 3.2 的主要前端改动入口。
- `src-tauri/src/db/issue_repository.rs`、`src-tauri/src/types/issue.rs`、`src/features/issues/issue-commands.ts` — 3.2 的 Issues attention 透传入口。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-07T13:00:00+0800：`bmad-dev-workflow` preflight 读取 `sprint-status.yaml`，确认当前无 `ready-for-dev` story，按顺序锁定 `3-2-show-needs-attention-indicator`，基线 `HEAD` 为 `ef84c74`。
- 2026-06-07T13:10:00+0800：交叉核对 Epic 3.2、PRD FR-15、UX `Needs Attention` 说明、architecture 状态机约束，以及 Story 2.4 / 2.5 / 3.1 的现有边界。
- 2026-06-07T13:18:00+0800：复查代码后确认 `AgentSessionListItem` 已带 `attention`，但 `IssueRecord` 仍未透传 linked session attention；3.2 的高概率实现范围为“Issues 最小数据透传 + Issues/Agents 双端 marker 展示 + 测试”。
- 2026-06-07T13:34:00+0800：在 `src-tauri/src/types/issue.rs`、`src-tauri/src/db/issue_repository.rs` 与 `src/features/issues/issue-commands.ts` 补齐 linked session attention 透传，保持一 Issue 一 Session 的既有查询边界不变。
- 2026-06-07T13:37:00+0800：在 `src/features/issues/issues-activity.tsx` 与 `src/features/agents/agents-activity.tsx` 落地 attention marker；Issue card 通过 `aria-describedby` 暴露 `Codex 需要确认` 文案，Session row 保留 `running` 主状态，仅叠加 marker。
- 2026-06-07T13:44:00+0800：完成 `pnpm format`、`cargo fmt --manifest-path src-tauri/Cargo.toml`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`cargo test --manifest-path src-tauri/Cargo.toml` 全量复验。
- 2026-06-07T13:46:00+0800：同会话 review 完成，确认无阻塞 finding，故事可收口为 `done`。

### Completion Notes List

- 2026-06-07：create-story 已为 Story 3.2 生成开发上下文，并将实现范围收口为“展示 Needs Attention 事实”，不包含设置/清除 attention。
- 2026-06-07：已明确 3.2 与 3.3 的边界，避免把手动 attention 命令、启发式识别或新 Session 状态混入当前 story。
- 2026-06-07：已识别当前仓库的真实缺口：Agents Session list DTO 已有 `attention`，但 Issues Activity 仍缺 linked session attention 的 Rust->TS 透传与双端标记渲染。
- 2026-06-07：已补齐 `IssueRecord.linkedSessionAttention` 的 Rust->TS 透传，并在不改变查询策略的前提下把 linked session 的 attention 事实带到 Issues Activity。
- 2026-06-07：Issue card 与 Agents Session row 均已按 UX 约束展示轻量 marker；未改变整卡/整行底色，也未新增新的 Session 状态值。
- 2026-06-07：实际执行的验证命令为 `pnpm format`、`cargo fmt --manifest-path src-tauri/Cargo.toml`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`cargo test --manifest-path src-tauri/Cargo.toml`，均通过。
- 2026-06-07：`pnpm test` 仍输出既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但不影响通过，且本 story 未扩大这些既有告警范围。

### File List

- _bmad-output/implementation-artifacts/3-2-show-needs-attention-indicator.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/bmad-dev-workflow-handoff.yaml
- src/app/app.css
- src/features/agents/agents-activity.tsx
- src/features/agents/agents-activity.test.tsx
- src/features/issues/issue-commands.ts
- src/features/issues/issues-activity.tsx
- src/features/issues/issues-activity.test.tsx
- src-tauri/src/db/issue_repository.rs
- src-tauri/src/types/issue.rs
- src-tauri/tests/issue.rs

### Validation Commands

- `pnpm format`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `cargo test --manifest-path src-tauri/Cargo.toml`

### Validation Results

- `pnpm format`：通过。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：通过。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test`：通过，8 个测试文件、90 个测试通过；输出包含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `cargo test --manifest-path src-tauri/Cargo.toml`：通过；Rust 全量测试通过，其中 `issue` 测试集 13 个测试全部通过。

### Change Log

- 2026-06-07：创建 Story 3.2 开发上下文并将状态推进到 `ready-for-dev`。
- 2026-06-07：完成 linked session attention 的 Rust->TS 透传、Issues / Agents 的 Needs Attention marker 展示，以及前后端测试，状态推进到 `review`。
- 2026-06-07：完成同会话代码审查，未发现阻塞问题，状态推进到 `done`。
