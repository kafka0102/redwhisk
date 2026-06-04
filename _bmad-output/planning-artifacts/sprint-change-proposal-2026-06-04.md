# Sprint Change Proposal：修复实施就绪规划缺陷

**Date:** 2026-06-04
**Project:** redwhisk
**Mode:** Incremental
**Status:** Approved and Applied

## 1. Issue Summary

### Trigger

本次 Correct Course 由 `implementation-readiness-report-2026-06-04.md` 触发。Implementation Readiness 结论为 `NEEDS WORK`，原因不是 PRD、UX、Architecture 或 FR 覆盖缺失，而是 epics/stories 中存在实施就绪缺陷。

### Core Problem

当前规划包存在 4 个 Major 级实施风险：

1. Story 4.4 在 Epic 4 中放入未来 completion UI 占位，形成前向依赖。
2. Stories 4.5 / 4.7 在异常 Session 场景中使用不可验证的 resume/continue placeholder。
3. `stopped` vs `crashed` 尚未定为明确状态合同。
4. Epic 5 依赖 Codex completion prompt 注入和 Git commit detection，但缺少明确 Spike gate。

问题类型：规划和实施顺序修正。它不是新产品需求，也不是 PRD MVP pivot。

### Evidence

- Readiness report 标记 Overall Readiness Status 为 `NEEDS WORK`。
- Readiness report 记录 Critical issues 为 0、Major issues 为 4、Minor concerns 为 3。
- `epics.md` Story 4.4 使用“完成类按钮占位或入口”并声明具体行为由 Epic 5 实现。
- `epics.md` Story 4.5 / 4.7 使用“继续会话入口占位”以及“实际 resume 能力以后续 story 或 Spike 结果为准”。
- PRD、UX、Architecture 多处将 `stopped` 作为可选或待确认状态。
- Architecture 和 PRD addendum 已要求 Spike 2 / Spike 3，但 Epics 中缺少对应 gate story。

## 2. Impact Analysis

### Checklist Status

| Checklist Item | Status | Finding |
| --- | --- | --- |
| 1.1 Triggering story | Done | 触发源是 readiness report，不是实施中的单个 story；受影响 stories 为 4.4、4.5、4.6、4.7、5.3-5.6、5.10、1.10。 |
| 1.2 Core problem | Done | 规划 sequencing 和 story quality 问题。 |
| 1.3 Evidence | Done | Evidence 来自 readiness report 与 epics 原文。 |
| 2.1 Current epic impact | Done | Epic 4 和 Epic 5 需要调整；Epic 1 有 minor cleanup。 |
| 2.2 Epic-level changes | Done | 不新增产品 epic；新增两个 Spike gate stories 到 Epic 2。 |
| 2.3 Remaining epics | Done | Epic 5 overview 需要引用 Spike gates；Epic 1 Story 1.10 和 Gate 5.10 需清理。 |
| 2.4 Future epic invalidation | Done | 无 planned epic 作废。 |
| 2.5 Epic order | Done | Epic 顺序保持；只在 Epic 2 末尾加入 Spike gates 作为 Epic 5 前置。 |
| 3.1 PRD conflicts | Done | PRD 目标不变；需将 `stopped` 从 assumption/open question 改为正式状态。 |
| 3.2 Architecture conflicts | Done | Architecture 需同步 `stopped` 正式化和 Spike gate 口径。 |
| 3.3 UI/UX conflicts | Done | UX 需同步 `stopped=已停止` 正式文案；异常 Session 不显示不可执行 continue 控件。 |
| 3.4 Other artifacts | Action-needed | 后续实施时需创建/更新 spike result docs：`spikes/codex-resume-completion-prompt.md`、`spikes/git-commit-detection.md`。 |
| 4.1 Direct Adjustment | Viable | 低到中等工作量，主要更新 planning artifacts。 |
| 4.2 Rollback | Not viable | 尚未进入实施，无需 rollback。 |
| 4.3 PRD MVP Review | Not viable | MVP 目标仍成立，不需缩减范围。 |
| 4.4 Recommended path | Done | 选择 Direct Adjustment。 |
| 5.1-5.5 Proposal components | Done | 本文档包含 issue summary、impact、approach、detailed edits、handoff。 |
| 6.1 Final review | Done | Checklist 已覆盖触发、影响、路径、proposal 和 handoff。 |
| 6.2 Proposal accuracy | Done | Proposal 与已批准 incremental edits 一致。 |
| 6.3 User approval | Done | 用户明确回复 `yes` 批准 proposal。 |
| 6.4 sprint-status update | N/A | 未找到现有 `sprint-status.yaml`；当前仍处于 planning artifacts 修正阶段。 |
| 6.5 Handoff confirmation | Done | Scope 分类为 Moderate，后续应先更新规划并 rerun readiness，再进入 sprint planning。 |

### Epic Impact

- **Epic 1:** 保持目标不变。Story 1.10 需要收窄，避免过早验证 feature-specific 组件。
- **Epic 2:** 新增 Story 2.8 和 Story 2.9，作为 Epic 5 前置 Spike gates。
- **Epic 3:** 无需变更。
- **Epic 4:** 修正 Story 4.4、4.5、4.6、4.7，移除占位控件并正式化 `stopped`。
- **Epic 5:** overview 需声明 `agent_auto_commit` stories 必须在 Spike 2/3 结论可用后实施；Story 5.10 改为 Gate。

### Artifact Impact

- **PRD:** 不修改 FR 范围；只需正式化 `stopped` 状态，删除对应 open question / assumption。
- **Epics:** 需要直接修改。
- **Architecture:** 需要同步 `stopped` 正式状态和 Spike gate 口径。
- **UX:** 需要同步 `stopped=已停止` 正式状态；异常 Session 不显示不可执行继续会话入口。
- **Implementation artifacts:** 尚未生成 sprint plan，无需更新 sprint-status.yaml；若后续已生成，需要同步新 Spike gate entries。

### Technical Impact

- Agent Session schema / enum / i18n 将包含正式 `stopped`。
- `stopped` 状态需要状态机测试和 Completed 分组 UI 测试。
- Epic 5 的 completion implementation 必须引用 Spike 2/3 结果。
- Resume 不作为不可工作的占位入口出现；实现前只提供日志/诊断恢复路径。

## 3. Recommended Approach

选择路径：**Direct Adjustment**

### Rationale

- PRD 和 MVP 目标仍成立，不需要 scope reduction。
- Architecture、UX 和 FR coverage 基本对齐，不需要 fundamental replan。
- 当前缺陷集中在 story sequencing、placeholder UI、状态决策和 Spike gate 表达，可以通过规划文档局部调整解决。
- 无已完成实现需要回滚。

### Effort / Risk / Timeline

- Effort: Medium
- Risk after adjustment: Low to Medium
- Timeline impact: 小幅增加，主要来自新增两个 Spike gate stories；这是必要成本，因为 Epic 5 的完成安全依赖真实验证。

## 4. Detailed Change Proposals

### Change 1: Remove placeholder completion UI from Story 4.4

**Artifact:** `_bmad-output/planning-artifacts/epics.md`

**Story:** `4.4 根据 Issue 状态展示 Header 操作`

**Section:** Acceptance Criteria

OLD:

```markdown
**Given** 当前 AgentSession 关联 `review` Issue
**When** Header 渲染
**Then** Header 显示完成类按钮占位或入口
**And** 具体 completion 行为由 Epic 5 实现
```

NEW:

```markdown
**Given** 当前 AgentSession 关联 `review` Issue
**When** Header 渲染
**Then** Header 显示 Issue title 和打开 Issue Inspector 的入口
**And** 不显示 `Mark Review`
**And** 不显示任何未实现的完成类按钮、占位入口或不可用完成控件
```

**Rationale:** Completion controls should be introduced in Epic 5 when completion behavior exists.

### Change 2: Remove resume/continue placeholders from abnormal Session stories

**Artifact:** `_bmad-output/planning-artifacts/epics.md`

**Story:** `4.5 处理 Codex 进程 crashed`

OLD:

```markdown
**Given** Agents Activity 左侧列表渲染
**When** Session 状态为 `crashed`
**Then** Session 出现在 Completed 展示分组
**And** 标记 `crashed`，并提供日志入口或继续会话入口占位
```

NEW:

```markdown
**Given** Agents Activity 左侧列表渲染
**When** Session 状态为 `crashed`
**Then** Session 出现在 Completed 展示分组
**And** 标记 `crashed`
**And** 提供日志入口或诊断入口
**And** 不显示不可执行的继续会话入口
```

**Story:** `4.7 异常 Session 的日志复盘入口`

OLD:

```markdown
**Given** 异常 Session 仍关联 Issue
**When** 用户查看 Header 或 Inspector
**Then** 不显示会导致 completed 的完成确认
**And** 可提供继续会话入口占位，实际 resume 能力以后续 story 或 Spike 结果为准
```

NEW:

```markdown
**Given** 异常 Session 仍关联 Issue
**When** 用户查看 Header 或 Inspector
**Then** 不显示会导致 completed 的完成确认
**And** 显示日志入口或诊断入口
**And** 不显示继续会话入口，除非 Codex resume 能力已由 Spike 或后续 story 明确实现
```

**Rationale:** Placeholder controls are not independently testable. MVP can still preserve trust through explicit crash/stopped state plus log/diagnostic recovery.

### Change 3: Formalize `stopped`

**Artifacts:** PRD, PRD addendum, Epics, Architecture, UX

**Decision:**

- `crashed`: Codex/PT​Y 进程异常退出。
- `stopped`: 应用重启或生命周期中断后，原 `running` AgentSession 的活 PTY 无法恢复。
- Both enter Completed display group and never auto-complete an Issue.

**PRD FR-19 OLD:**

```markdown
- 应用重启后无法恢复活进程时，Agent Session 可以标记为 `crashed` 或 `stopped`。[ASSUMPTION: MVP 可以使用 `stopped` 表示应用重启导致活进程不可恢复的降级状态。]
```

**PRD FR-19 NEW:**

```markdown
- 应用重启后无法恢复活进程时，Agent Session 必须标记为 `stopped`；`stopped` 表示应用生命周期中断导致原 `running` PTY 无法恢复。
```

**PRD removals:**

```markdown
6. `stopped` 是否作为正式 Agent Session 状态保留，还是只使用 `crashed` 覆盖应用重启后的不可恢复状态？
```

```markdown
- §5.6 FR-19 — MVP 可以使用 `stopped` 表示应用重启导致活进程不可恢复的降级状态。
```

**Epics Story 4.6 OLD:**

```markdown
**Then** Rust Core 将该 AgentSession 标记为 `stopped` 或 `crashed`
...
**Given** `stopped` 是否保留为正式状态仍是开放项
**When** 实现状态机
**Then** 必须在实现前选择 `stopped` 或统一用 `crashed`
**And** 选择结果应更新架构或 ADR
```

**Epics Story 4.6 NEW:**

```markdown
**Then** Rust Core 将该 AgentSession 标记为 `stopped`
...
**Given** AgentSession 状态为 `stopped`
**When** UI、事件和持久化记录渲染或保存该状态
**Then** `stopped` 使用正式状态枚举和 i18n 文案
**And** Completed 分组包含该 Session
```

**Architecture addition:**

```markdown
`stopped` 是正式 Agent Session 状态，用于应用重启后无法恢复活 PTY 的场景。
```

**UX replacement:**

```markdown
Agent Session 标记为 `stopped=已停止`。`stopped` 表示应用生命周期中断后原运行中 PTY 无法恢复。
```

**Rationale:** Formalizing `stopped` removes schema / enum / i18n ambiguity while preserving a precise distinction from process crash.

### Change 4: Add Spike gate stories before Epic 5

**Artifact:** `_bmad-output/planning-artifacts/epics.md`

Add after `Story 2.7`.

```markdown
### Story 2.8: Spike - 验证 Codex Resume 与 Completion Prompt 注入

As a RedWhisk 实现者,
I want 验证当前 Codex Session 能否接收后续修正 prompt 和 completion prompt,
So that Epic 5 不会依赖未经验证的 Agent 提交流程。

**Requirements:** FR18、FR21、NFR5；架构 Spike 2

**Acceptance Criteria:**

**Given** Codex AgentSession 已通过 PTY 启动
**When** 实现者向同一个 Codex Session 发送后续 prompt
**Then** prompt 进入当前 Codex TUI / Session
**And** 不启动新的无上下文 Codex 进程

**Given** review 或 completion 场景需要发送 completion prompt
**When** 实现者向当前 Codex Session 注入 completion prompt
**Then** 系统记录是否可稳定注入
**And** 记录必要的前置条件、限制和失败模式

**Given** Codex Session 异常退出或应用重启后需要恢复上下文
**When** 实现者测试 `codex resume <session_id>` 或等价方式
**Then** 记录是否可恢复
**And** 如果无法稳定恢复，明确降级路径为保留日志、提示用户手动处理，Issue 保持 `review` 或 `running`

**Given** Spike 完成
**When** 结果归档
**Then** 在 `spikes/codex-resume-completion-prompt.md` 记录结论
**And** Epic 5 story 必须引用该结论或采用记录的降级路径
```

```markdown
### Story 2.9: Spike - 验证 Git Commit Detection

As a RedWhisk 实现者,
I want 在真实 Git 仓库中验证 completion 前后 HEAD/status/changed files 检测,
So that Agent Commit 完成不会只相信 Agent 输出文本。

**Requirements:** FR21、FR22、NFR5、NFR6；架构 Spike 3

**Acceptance Criteria:**

**Given** 一个本地 Git Repository 有未提交改动
**When** 系统在 completion 前记录 Git 状态
**Then** 记录 `HEAD`、`git status --porcelain` 和 changed files 摘要

**Given** completion prompt 发送后仓库产生新 commit
**When** 系统重新读取 Git 状态
**Then** 检测到 `HEAD` 改变
**And** 记录新 commit hash

**Given** completion prompt 发送后未产生新 commit
**When** 系统重新读取 Git 状态
**Then** 结果记录为 `no_commit_detected`
**And** Issue 保持 `review`

**Given** 仓库处于 merge、rebase、cherry-pick 等进行中状态
**When** 用户尝试完成 Issue
**Then** 系统能识别该状态
**And** 记录降级行为：提示用户手动处理，不自动 completed

**Given** Spike 完成
**When** 结果归档
**Then** 在 `spikes/git-commit-detection.md` 记录结论
**And** Epic 5 story 必须引用该结论或采用记录的降级路径
```

Update Epic 5 overview:

```markdown
Epic 5 的 `agent_auto_commit` stories 必须在 Story 2.8 和 Story 2.9 的 Spike 结论可用后实施。
```

**Rationale:** Completion safety requires feasibility evidence before implementation.

### Change 5: Minor cleanup for story structure

**Artifact:** `_bmad-output/planning-artifacts/epics.md`

**Story 5.10 OLD:**

```markdown
### Story 5.10: 完成闭环端到端验收
```

**Story 5.10 NEW:**

```markdown
### Gate 5.10: 完成闭环端到端验收

**Note:** This is an E2E Validation Gate, not a regular implementation story. It must run after the preceding Epic 5 implementation stories are complete.
```

**Story 1.10 OLD:**

```markdown
**Given** 用户使用基础控件
**When** Button、Dialog、Inspector、Toolbar、Tooltip、Activity Bar 图标渲染
**Then** 控件使用自建桌面工作台组件层和 CSS/token 层
**And** 不引入大型管理后台组件库作为视觉基底
```

**Story 1.10 NEW:**

```markdown
**Given** 用户使用基础控件
**When** Button、Dialog、Toolbar、Tooltip、Activity Bar 图标渲染
**Then** 控件使用自建桌面工作台组件层和 CSS/token 层
**And** 不引入大型管理后台组件库作为视觉基底
**And** Issue Inspector、Completion Confirmation 等 feature-specific 组件在对应 feature story 中验证
```

**Rationale:** Gate 5.10 is an E2E acceptance gate, not a normal story. Story 1.10 should cover baseline primitives without forcing later feature components into Epic 1.

## 5. Implementation Handoff

### Scope Classification

**Moderate**

Reason: The change primarily reorganizes planning artifacts and story sequencing, but it touches multiple artifacts and changes implementation gates. It should be executed by Product Owner / Developer planning agents before sprint planning starts.

### Handoff Recipients

- **Product Owner / Planning Agent:** Apply approved changes to `epics.md`.
- **Product Manager:** Apply PRD cleanup for `stopped` formalization.
- **Solution Architect:** Update architecture notes for formal `stopped` and Spike gate expectations.
- **UX Designer:** Update UX state pattern and open item language for `stopped`, and remove non-functional continue/resume placeholder language.
- **Developer Agent:** Do not start Epic 5 `agent_auto_commit` implementation until Spike 2 and Spike 3 evidence exists.

### Success Criteria

- `epics.md` contains no placeholder completion or resume controls.
- `stopped` is a formal state across PRD, Architecture, UX, Epics, i18n/story requirements.
- Story 2.8 and Story 2.9 exist as Spike gates before Epic 5.
- Epic 5 overview references the Spike gate requirement.
- Story 5.10 is labeled as a Gate.
- Story 1.10 no longer requires feature-specific components before their stories.
- Rerun `bmad-check-implementation-readiness` and confirm status can move from `NEEDS WORK` to `READY` or only minor residual issues remain.

## Approval Log

- Proposal 1 approved by user: remove Story 4.4 completion placeholder.
- Proposal 2 approved by user: remove abnormal Session continue/resume placeholders.
- Proposal 3 approved by user: formalize `stopped`.
- Proposal 4 approved by user: add Spike gate stories 2.8 and 2.9.
- Proposal 5 approved by user: mark Story 5.10 as Gate and narrow Story 1.10.

## Final Approval

Approved by user on 2026-06-04.

## Application Log

Applied on 2026-06-04.

Artifacts modified:

- `_bmad-output/planning-artifacts/epics.md`
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md`
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md`
- `_bmad-output/planning-artifacts/architecture.md`
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md`
- `_bmad-output/planning-artifacts/sprint-change-proposal-2026-06-04.md`

Workflow result:

- Issue addressed: readiness report identified planning-level implementation readiness defects.
- Change scope: Moderate.
- Routed to: Product Owner / Planning Agent for rerun readiness, then Sprint Planning if ready.
- Success criteria: rerun `bmad-check-implementation-readiness` and confirm the previous Major issues are closed.
