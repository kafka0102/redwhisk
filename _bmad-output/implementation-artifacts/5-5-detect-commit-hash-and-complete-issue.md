---
baseline_commit: 702197d
---

# Story 5.5: 检测 Commit Hash 并完成 Issue

Status: ready-for-dev

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望系统在 Agent Commit 后检测真实 Git commit,
以便 `completed` 状态有可信 commit hash 支撑。

## Acceptance Criteria

1. 给定 completion prompt 已发送给当前 Codex Session，当系统检测到 Git `HEAD` 相比 `head_before` 发生前进式变化时，则 `CompletionAttempt` 记录 `head_after` 和 `commit_hash`，并把结果标记为成功。
2. 给定检测到新的有效 commit，当 Rust Core 完成状态更新时，则 AgentSession 状态变为 `closed`，Issue 状态变为 `completed`，且该状态收口只发生在当前 `review + running + agent_auto_commit` 的目标 Issue / Session 上。
3. 给定 Issue 完成成功，当系统写入审计记录时，则 `IssueAction`、`SessionEvent`、`CompletionAttempt` 均可复盘，且 Header 不再显示完成类主按钮。

## Tasks / Subtasks

- [ ] 收口 Story 5.4 之后的“检测 commit 并完成”最小闭环，不提前混入 5.6 / 5.8 / 5.9 (AC: 1, 2, 3)
  - [ ] 复查 [src-tauri/src/core/issue_service.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/core/issue_service.rs)、[src-tauri/src/db/completion_attempt_repository.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/db/completion_attempt_repository.rs)、[src-tauri/src/types/completion_attempt.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/types/completion_attempt.rs)、[src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx) 和 [src/features/issues/issue-commands.ts](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issue-commands.ts)，确认 5.4 已经落地的 `prompt_sent` 审计、确认面板与 Rust 命令边界。
  - [ ] 明确本 story 只处理“检测到真实新 commit 后完成 Issue”的成功路径；`HEAD` 未变时保持 `review` 属于 Story 5.6，Git operation blocker 的统一入口防护属于 Story 5.7。
  - [ ] 默认沿用 Story 2.9 的 Git detection 结论，只实现当前需求所需的最小消费层，不新增完整 Git 历史、Diff 浏览、轮询框架或后台 watcher。
- [ ] 在 Rust Core 增加 Agent Commit 成功检测与完成收口命令 (AC: 1, 2)
  - [ ] 基于 Story 5.4 已记录的 `CompletionAttempt(option=agent_auto_commit, result=prompt_sent, head_before, changed_files_json)`，新增明确的检测入口，在当前 Project 仓库重新读取 Git snapshot 并判断 `HEAD` 是否发生前进式变化，而不是只相信 Agent 输出文本。
  - [ ] 仅当当前 Issue 仍为 `review`、linked AgentSession 仍为 `running`、Project `completion_policy=agent_auto_commit` 且检测结果为真实新 commit 时，才在单事务中完成 `Issue -> completed`、`AgentSession -> closed` 的状态收口；否则返回显式错误或交给后续 story 处理。
  - [ ] 复用 [src-tauri/src/git/status.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/git/status.rs) 中已有的 `detect_commit_result` / Git snapshot 能力，确保 `checkout` / `reset` / 非前进式 HEAD 移动不会被误判成成功提交。
- [ ] 补齐 CompletionAttempt、IssueAction 和 SessionEvent 的成功态审计 (AC: 1, 3)
  - [ ] 扩展 `CompletionAttempt` 成功路径，至少补齐 `head_after`、`commit_hash` 和成功结果；不要在本 story 提前引入 5.6 所需的 `no_commit_detected` 失败收口。
  - [ ] 在成功完成时写入可区分来源的 `IssueAction` 与 `SessionEvent`，并与 Issue / Session 状态更新保持单事务一致性，避免出现 commit 已记录但 Issue 未完成，或 Issue 已完成但审计缺失的中间态。
  - [ ] 明确 completed 后对应 Header 不再显示 `Complete`、`Complete with Agent Commit`、`Complete Manually` 等完成类按钮，保持 UI 与结构化状态一致。
- [ ] 把成功检测命令接入现有 Agent Commit UI 闭环 (AC: 2, 3)
  - [ ] 在现有 Completion Confirmation / review Header 流中增加“检测并完成”的前端调用点，成功后刷新会话与 Issue 事实源，展示 completed 后的只读状态，而不是停留在旧的 `review` overlay。
  - [ ] 若命令失败但不属于“未检测到 commit”分支，前端显示事实性错误并保留当前上下文，不卸载 xterm 或 inspector。
  - [ ] 保持应用侧不直接执行 `git add .` / `git commit`；前端只能调用新的业务命令，不直接拼装 Git 检测和状态收口逻辑。
- [ ] 用测试锁定“真实新 commit 才能完成”的边界 (AC: 1, 2, 3)
  - [ ] Rust 测试覆盖：`prompt_sent` 后仓库出现新 commit 时，命令会记录 `head_after` / `commit_hash`，并把 Issue 标记为 `completed`、Session 标记为 `closed`。
  - [ ] Rust 测试覆盖：非前进式 HEAD 变化、无 linked running session、Issue 已离开 `review`、跨 Project、repo 不可访问等路径不会产生部分写入，也不会误完成。
  - [ ] 前端测试覆盖：成功检测后 review Header 不再显示完成类主按钮；错误路径保留当前上下文。`HEAD` 未变的专门交互提示不在本 story 断言范围内，由 Story 5.6 覆盖。
- [ ] 按项目规则执行并记录必要验证命令 (AC: 1, 2, 3)
  - [ ] 本 story 预计会修改 TypeScript / TSX 渲染逻辑、Rust Core 状态事务、CompletionAttempt 审计模型与测试，默认至少执行：

```bash
pnpm format
cargo fmt --manifest-path src-tauri/Cargo.toml
pnpm lint
pnpm typecheck
pnpm test -- --run src/features/agents/agents-activity.test.tsx src/shared/commands/command-client.test.ts
cargo test --manifest-path src-tauri/Cargo.toml --test issue
cargo test --manifest-path src-tauri/Cargo.toml --test agent_session
cargo test --manifest-path src-tauri/Cargo.toml --test git_detection
pnpm test
git diff --check
```

## Dev Notes

### 关键假设与取舍

- Story 5.5 的最小目标是“确认 Agent Commit 真的产生了新 commit，并在成功时完成 Issue / Session 收口”。它不是整个 Epic 5 的最终收尾，不负责 `HEAD` 未变时的事实性提示 UI，也不负责 completed Summary / Open Log。
- 本 story 默认依赖 Story 5.4 已经完成的 `prompt_sent` 审计事实。如果当前实现允许同一 Issue 多次发送 completion prompt，需要先厘清“检测哪一次尝试”的选择规则；最小方案优先消费最新一条未完成的 `agent_auto_commit` 尝试。
- commit 成功必须建立在 Git 事实之上，而不是 Codex 输出文本。检测逻辑应沿用 Story 2.9 对“前进式 HEAD 变化”的定义，避免把 `reset`、`checkout`、`rebase` 等 HEAD 变化误判为成功提交。
- 本 story 不提前吞并 Story 5.6 的 `no_commit_detected` 业务分支；若实现时必须触达该路径，也只允许返回显式结果并把完整交互留给 5.6。

### 范围边界

- 交付：消费 `prompt_sent` 尝试、检测真实新 commit、记录 `head_after` / `commit_hash`、成功时完成 Issue / Session 状态收口、更新 Header / Session 视图、前后端测试。
- 不交付：`HEAD` 未变时的完整提示交互与保持 `review` 的专门 UX、completed Summary、Open Log、重新打开 completed Issue、Git Diff / History 浏览。
- 不交付：自动轮询 watcher、后台守护任务、跨 Issue 批量完成、应用直接执行 Git 提交。

### 当前代码状态与修改指引

- [src-tauri/src/core/issue_service.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/core/issue_service.rs) 已经具备 `prepare_agent_commit_completion` 和 `send_agent_commit_prompt` 两段业务命令；5.5 适合在这里新增“检测并完成”的第三段收口命令，而不是把检测逻辑塞进前端。
- [src-tauri/src/types/completion_attempt.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/types/completion_attempt.rs) 当前只有 `Completed` 与 `PromptSent` 结果，且 `CompletionAttemptRecord` 已具备 `head_after` 字段但尚未表达 `commit_hash`；5.5 很可能需要最小扩展类型与持久化模型。
- [src-tauri/src/db/completion_attempt_repository.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/db/completion_attempt_repository.rs) 已经承担 clean-path / prompt-sent 尝试写入；成功 commit 的收口应继续沿用同一个 repository，而不是额外新造平行审计表。
- [src-tauri/src/git/status.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/git/status.rs) 与 [src-tauri/tests/git_detection.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/tests/git_detection.rs) 已经验证 `detect_commit_result` 的核心事实边界；5.5 应优先复用既有夹具和能力。
- [src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx) 目前已经有 manual、clean-path 和 agent-commit confirmation 的 review Header gating；成功完成后需要让 UI 正确退出 review 完成态，而不是依赖下一次全量刷新碰运气。

### 架构约束

- Completion Policy 的安全边界不变：应用不得直接执行 `git add .` 或自行提交全部改动，只能通过已发送的 completion prompt 和后续 Git 检测闭环判断结果。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR21, §NFR5]
- Issue、AgentSession、CompletionAttempt、IssueAction、SessionEvent 的状态与审计写入必须由 Rust Core 统一控制，并尽量保持单事务一致性。[Source: `_bmad-output/planning-artifacts/architecture.md` §状态机一致性, §审计与可复盘]
- completed 结果必须可追溯到真实 commit hash；若没有可证明的新 commit，就不能把 Issue 伪装成完成。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR22, §SM-3]
- Header、Inspector、Completion Confirmation 等 UI 操作不能卸载当前 xterm；完成后只更新事实源和可见动作，不重建无关终端上下文。[Source: `_bmad-output/planning-artifacts/architecture.md` §Cross-Cutting Concerns]

### 前置故事信息

- Story 2.8 已证明 completion prompt 可以注入当前活 Session，但这不等于 commit 已成功。
- Story 2.9 已提供 Git snapshot、operation-state 和“前进式 HEAD 变化才算真实新 commit”的检测结论，是 5.5 的直接技术前置。
- Story 5.2 已实现 clean-path `Complete` 的成功收口，可复用 completed 后隐藏完成动作、关闭 Session 的既有模式。
- Story 5.3 已实现 dirty-path Completion Confirmation，Story 5.4 已实现 `prompt_sent` 尝试与最小审计；5.5 需要在此基础上补上 commit 成功检测，而不是重写前两步。

### 非目标

- 不实现 `no_commit_detected` 的事实性提示和留在 `review` 的完整交互闭环。
- 不实现 completed Issue Summary、Open Log、commit hash 展示页。
- 不重构整个 completion policy 流程、Git 检测模块或 Session Header 布局，除非缺少本 story 必需的最小事实源。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 5 / Story 5.5、5.6、5.7 的验收标准与故事边界。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — FR20、FR21、FR22、FR23、NFR3、NFR5、NFR6。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` — completion policy 状态表、`HEAD` 改变与 `no_commit_detected` 语义。
- `_bmad-output/planning-artifacts/architecture.md` — Rust Core 单一状态写入、Git 检测职责边界、审计与 xterm 上下文连续性。
- `spikes/git-commit-detection.md` — Story 2.9 的 Git commit detection 结论与前进式 HEAD 变化约束。
- `_bmad-output/implementation-artifacts/2-9-spike-git-commit-detection.md` — 可复用的 Git 检测实现与测试边界。
- `_bmad-output/implementation-artifacts/5-2-complete-directly-when-no-uncommitted-changes.md`、`5-3-show-agent-commit-completion-confirmation-panel.md`、`5-4-inject-completion-prompt-into-current-codex-session.md` — Epic 5 已交付边界与可复用实现锚点。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-09T11:xx+08:00：`bmad-dev-workflow` preflight 读取完整 `sprint-status.yaml`，确认当前没有 `ready-for-dev` story，按顺序锁定首个 backlog story `5-5-detect-commit-hash-and-complete-issue`，当前基线 `HEAD` 为 `702197d`。
- 2026-06-09T11:xx+08:00：交叉核对 Epic 5.5、PRD FR20 / FR21 / FR22、addendum 的 completion 状态表，以及 Story 2.9、5.2、5.3、5.4 的已交付边界，确认本 story 只处理“检测到真实新 commit 后完成”。
- 2026-06-09T11:xx+08:00：复查当前仓库实现，确认 `prompt_sent` 审计与 Git detection 能力已存在，但 success-path 的 `commit_hash` 记录与完成收口尚未落地；因此将本 story 范围收口为最小成功闭环，不提前混入 5.6 的 no-commit UX。

### Completion Notes List

- 2026-06-09：create-story 已为 Story 5.5 生成开发上下文，并将范围锁定为“检测真实新 commit 并完成 Issue”的最小可靠切片。
- 2026-06-09：已显式标注 Story 5.5 与 5.6 / 5.7 / 5.8 / 5.9 的边界，避免开发阶段把 no-commit 提示、Git blocker 防护和 completed Summary 混入同一实现。
- 2026-06-09：已把 `prompt_sent` 尝试、Git detection 事实、completed 收口模式和预计测试面写入上下文，供 dev-story 直接消费。

### File List

- _bmad-output/implementation-artifacts/5-5-detect-commit-hash-and-complete-issue.md
