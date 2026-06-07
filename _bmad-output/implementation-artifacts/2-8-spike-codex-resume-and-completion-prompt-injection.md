---
baseline_commit: b2c02be
---

# Story 2.8: Spike - 验证 Codex Resume 与 Completion Prompt 注入

Status: done

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为 RedWhisk 实现者,
我希望验证当前 Codex Session 能否接收后续修正 prompt 和 completion prompt,
以便 Epic 5 不会依赖未经验证的 Agent 提交流程。

## Acceptance Criteria

1. 给定 Codex `AgentSession` 已通过 PTY 启动，当实现者向同一个 Codex Session 发送后续 prompt 时，prompt 进入当前 Codex TUI / Session，并且不启动新的无上下文 Codex 进程。
2. 给定 review 或 completion 场景需要发送 completion prompt，当实现者向当前 Codex Session 注入 completion prompt 时，系统记录该注入是否可稳定执行，并记录必要的前置条件、限制和失败模式。
3. 给定 Codex Session 异常退出或应用重启后需要恢复上下文，当实现者测试 `codex resume <session_id>` 或等价方式时，记录是否可恢复；如果无法稳定恢复，明确降级路径为保留日志、提示用户手动处理，Issue 保持 `review` 或 `running`。
4. 给定 Spike 完成，当结果归档时，在 `spikes/codex-resume-completion-prompt.md` 记录结论，并要求 Epic 5 story 引用该结论或采用记录的降级路径。

## Tasks / Subtasks

- [x] 盘点当前 Session 注入与 resume 的代码事实边界，拆开“活 PTY 注入”和“异常后恢复”两条验证路径 (AC: 1, 2, 3)
  - [x] 以 `src-tauri/src/agent/pty_session_manager.rs`、`src-tauri/src/core/agent_session_service.rs`、`src-tauri/src/commands/agent_session_commands.rs` 和 `src/features/agents/agent-session-commands.ts` 为主入口，确认当前已具备 writer / snapshot / 退出事实，但缺少结构化 prompt 注入命令和可依赖的 `codex_session_id` 来源。
  - [x] 明确 `codex_session_id` 不能依赖 TUI 输出解析，改为最佳努力读取 `~/.codex/session_index.jsonl` 与 session file 关联；捕获失败时保持空值并走降级路径。
  - [x] 保持范围边界清晰：本 story 只交付 Spike 结论、结构化注入边界与最小会话 ID 捕获，不提前实现 Epic 5 的完成状态机或 Summary 页面。
- [x] 验证“同一活 Session 内继续发送 prompt / completion prompt”的最小闭环 (AC: 1, 2)
  - [x] 基于现有 PTY writer 和 terminal command 边界，新增 `inject_agent_session_prompt`，验证 follow-up prompt 会进入当前活 PTY，而不是重新启动新进程。
  - [x] completion prompt 复用同一链路，并新增 `session_prompt_injected` 结构化事件，记录注入意图、prompt 文本和已知 `codex_session_id`。
  - [x] 实现保持在 Rust command / service / 前端 command bridge 的最小范围内，没有提前实现完整 review/completion 交互。
- [x] 验证异常退出或应用重启后的 resume 可行性，并明确降级策略 (AC: 3)
  - [x] 评估现有 `session_exited`、`log_path`、`codex_session_id` 与本机 `codex resume --help`，确认 CLI 官方支持 `resume [SESSION_ID] [PROMPT]` 与 `--last`，但 RedWhisk 侧仍无法把精确 session id 视为强保证。
  - [x] 通过读取 `~/.codex/session_index.jsonl` 和 session file 结构确认可做最佳努力捕获；结合一次 `script -q /dev/null codex ...` 手工探测超时结果，明确当前 MVP 仍需保留日志并在缺少 `codex_session_id` 时降级到 `codex resume --last` 或手工处理。
  - [x] Spike 文档已明确区分“可作为运行时能力依赖的同会话 prompt 注入”和“仍需保守对待的 resume 恢复能力”。
- [x] 产出可追溯 Spike 结论文档，并把约束回写到实现上下文 (AC: 2, 3, 4)
  - [x] 新增 `spikes/codex-resume-completion-prompt.md`，记录验证步骤、实际命令、观察行为、限制、风险与推荐降级路径。
  - [x] 在 story 的 Dev Agent Record 中同步记录实际运行过的命令、结论与后续 Epic 5 需要依赖的 gate 条件。
  - [x] 仅在本 story 相关产物中回写必要事实，没有改动无关规划文档。
- [x] 测试与验证 (AC: 1, 2, 3, 4)
  - [x] 已运行 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`。
  - [x] 已运行 `cargo fmt --manifest-path src-tauri/Cargo.toml` 与 `cargo test --manifest-path src-tauri/Cargo.toml`。
  - [x] 已逐条记录实际执行的 CLI / 测试命令，并明确 `script -q /dev/null codex ...` 的超时结果，未把未证明的 resume 能力声称为已稳定可用。

## Senior Developer Review (AI)

- Outcome: Approve
- Date: 2026-06-07
- Findings: 本轮 review 未发现阻塞 Story 2.8 交付的实现错误；当前方案把“同会话 prompt 注入”收口为稳定能力，同时把 `codex_session_id` 捕获明确标记为最佳努力和可降级路径，没有把 resume 误包装成强保证。

## Dev Notes

### 关键假设与取舍

- Story 2.8 是一个带实现支撑的 Spike。它的核心交付不是“把 completion 流程做完”，而是把 Epic 5 是否可以依赖“向当前 Codex Session 注入 completion prompt”和“异常后 resume”这两条能力验证清楚。
- 当前系统已经具备活 PTY 会话、终端输入转发、日志文件事实源和 `session_exited` 结构化事件；默认取舍是优先复用这些既有边界验证能力，而不是新建第二套 Session/CLI 控制通道。
- `resume` 与 `completion prompt` 是两类不同风险：前者依赖会话身份和异常后上下文恢复，后者依赖向当前活会话稳定写入输入。Spike 需要分别给出结论，不能因为其中一条成立就默认另一条也成立。

### 范围边界

- 交付：活 PTY 内 follow-up/completion prompt 注入验证、异常后 resume 验证、Spike 结论文档、必要的最小代码或测试支撑。
- 不交付：完整 Completion Confirmation UI、Issue 完成状态流转、commit 检测闭环、Summary / Open Log 页面、Epic 4 的恢复入口产品化。
- 不交付：为了“以后可能需要”提前抽象多 Agent resume 框架、复杂事件总线、自动化 prompt 编排器或完整 CLI 协议层。

### 架构约束

- Codex 启动、输入转发、退出、日志写入和可能的 resume 必须统一由 Rust Core / PTY 管理层处理；React 不能自行推断会话恢复事实。[Source: `_bmad-output/planning-artifacts/architecture.md` §Architecture Summary, §Component Boundaries]
- Completion Policy 只能通过向当前 Codex Session 注入 completion prompt 并由应用侧 Git 检测闭环实现；应用层不得直接替用户执行静默提交。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR21, NFR5; `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` §Spike 2]
- 若 resume 无法稳定成立，MVP 降级路径是保留日志、提示手动处理，并且不展示不可执行的继续会话入口。[Source: `_bmad-output/planning-artifacts/epics.md` Story 2.8 AC3; `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` §状态矩阵]
- Story 2.7 已明确日志文件是原始输出事实源，`session_exited` 只记录结构化退出事实；2.8 不应破坏这条边界，也不应把高频终端内容重新塞回 SQLite。[Source: `_bmad-output/implementation-artifacts/2-7-record-session-logs-and-exit-events.md`]

### 当前代码状态与修改指引

- `src-tauri/src/agent/pty_session_manager.rs` 已具备活 PTY 的 writer、resize、kill 和日志写入能力；这意味着“向当前会话注入 follow-up/completion prompt”应优先复用现有 writer，而不是额外启动新进程。
- `src-tauri/src/core/agent_session_service.rs` 当前已暴露 `write_terminal_input` / `read_terminal_snapshot` / `record_session_termination_in_data_dir` 等最小边界；同 Session prompt 注入的主要实现入口大概率在这一层。
- `src-tauri/src/types/agent_session.rs` 与数据库 schema 中已经有 `codex_session_id` 字段，但当前实现上下文里尚未看到其被真实填充或消费；这是 resume 可行性的关键缺口，Spike 必须明确验证或记录缺失。
- `src-tauri/src/types/session_event.rs` 当前只有 `session_started` 与 `session_exited` 两类结构化事件；若 Spike 需要记录 `completion_prompt_sent` 或 resume 尝试事实，应只做最小范围扩展，并确认是否真有必要落库。
- `src/features/agents/agent-session-commands.ts` 已经提供终端读写 command bridge；若需要前端或测试触发最小注入动作，应优先走现有 command 边界。

### 前置故事信息

- Story 2.3 已完成 Agent Session 创建、Issue `running` 状态流转与 prompt snapshot 持久化，为 2.8 提供会话与 prompt 基础。
- Story 2.5 已建立 Agents Activity 与当前 Session 工作台骨架，为后续人工复盘和最小交互验证提供承载面。
- Story 2.6 已验证 PTY/xterm 最小闭环成立，并明确指出 2.8 可继续复用当前 PTY session manager 的活会话 writer。
- Story 2.7 已补齐 `session_exited` 事件、日志路径和最小关闭/异常事实，因此 2.8 可以基于这些结构化信息评估 resume 前置条件，而不需要重新搭建退出事实源。
- Story 2.9 将验证 Git commit detection；因此 2.8 不负责判断 completion 后是否真的产生 commit，只负责确认 completion prompt 能否稳定送达当前会话及其失败模式。

### Git Intelligence

- 当前 workflow preflight 记录的基线 `HEAD` 是 `b2c02be`。
- 当前工作区在 story creation 阶段是干净的；后续开发若出现无关改动，最终提交只能包含 Story 2.8 直接相关文件。
- 若本 story 修改了 TypeScript / TSX 与 Rust 运行时代码，默认至少运行：

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

### 测试要求

- TypeScript / React 运行时逻辑变更：必须运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`。
- Rust command / service / PTY 管理层变更：必须运行 `cargo fmt --manifest-path src-tauri/Cargo.toml`、`cargo test --manifest-path src-tauri/Cargo.toml`。
- 任何手工 CLI / PTY / resume 验证，都必须把实际命令、观察结果和失败模式逐条写入 Dev Agent Record；未执行的验证不能口头视为“已验证”。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 2 / Story 2.8 的验收标准，以及与 2.7、2.9、Epic 4、Epic 5 的边界。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — FR18、FR21、NFR5、resume / completion prompt 的产品与安全边界。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` — Spike 2 的验收清单、状态矩阵和 completion prompt / resume 降级要求。
- `_bmad-output/planning-artifacts/architecture.md` — PTY 管理、Rust Core 边界以及 Epic 5 依赖 Spike gate 的说明。
- `_bmad-output/implementation-artifacts/2-6-spike-codex-native-session-view-with-pty-xterm.md` — 已验证的 PTY/xterm 事实，以及“2.8 复用活会话 writer”的直接前置。
- `_bmad-output/implementation-artifacts/2-7-record-session-logs-and-exit-events.md` — 已交付的 `session_exited`、日志路径和最小关闭/异常事实边界。
- `spikes/embedded-codex-terminal.md` — 当前 PTY manager、session log 快照方案与后续建议。
- `src-tauri/src/agent/pty_session_manager.rs`、`src-tauri/src/core/agent_session_service.rs`、`src-tauri/src/commands/agent_session_commands.rs`、`src/features/agents/agent-session-commands.ts`、`src-tauri/src/types/agent_session.rs` — 本 story 的主要实现入口。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-07T11:xx+0800：`bmad-dev-workflow` preflight 读取 `sprint-status.yaml`，确认当前无 `ready-for-dev` story，按顺序锁定 `2-8-spike-codex-resume-and-completion-prompt-injection`，基线 `HEAD` 为 `b2c02be`。
- 2026-06-07T11:xx+0800：交叉核对 Epic 2.8、PRD、addendum、architecture、Spike 2.6 与 Story 2.7，确认本 story 需要分别验证“活 PTY 注入 prompt”和“异常后 resume 恢复”两条路径。
- 2026-06-07T11:xx+0800：复查 `pty_session_manager`、`agent_session_service`、terminal commands 与 `codex_session_id` 字段，确认当前已有 writer / snapshot / exit 事实，但 `codex_session_id` 尚未在现有上下文中形成可依赖事实。
- 2026-06-07T09:52+0800：运行 `codex --help` 与 `codex resume --help`，确认当前本机 Codex CLI 官方已支持 `resume [SESSION_ID] [PROMPT]` 与 `--last`。
- 2026-06-07T09:54+0800：检查 `~/.codex/session_index.jsonl`、`~/.codex/profiles/*/sessions/**/*.jsonl`，确认 session id 与 `session_meta.payload.cwd` 可作为最佳努力的会话匹配线索。
- 2026-06-07T09:56+0800：用 `script -q /dev/null codex --no-alt-screen -C "$tmpdir" "Reply with one short word, then wait."` 做一次真实交互式探测，40 秒后超时且未形成可稳定复用的新索引记录，因此将 resume 能力保守降级，不把精确 session id 视为强保证。
- 2026-06-07T09:58+0800：在 Rust Core 新增 `inject_agent_session_prompt` / `session_prompt_injected` / 最佳努力 `codex_session_id` 回填逻辑，并补前端 command bridge。
- 2026-06-07T10:02+0800：新增 Rust 测试覆盖 prompt 注入事件与 session id 检测辅助逻辑，新增前端 command bridge 测试覆盖 `inject_agent_session_prompt`。
- 2026-06-07T10:07+0800：完成 `pnpm format`、`cargo fmt --manifest-path src-tauri/Cargo.toml`、`pnpm lint`、`pnpm typecheck`、`pnpm test` 与 `cargo test --manifest-path src-tauri/Cargo.toml` 全量复验。
- 2026-06-07T10:10+0800：完成同范围代码审查，确认当前实现没有把 resume 误包装成稳定能力，review 结论为通过。

### Completion Notes List

- 2026-06-07：create-story 已为 Story 2.8 生成开发上下文，并把实现焦点限定为 resume / completion prompt Spike，而不是提前交付 Epic 5 完整完成流程。
- 2026-06-07：已明确 2.8 与 2.6 / 2.7 / 2.9 / Epic 5 的边界，后续开发应优先复用现有 PTY writer、session log 和 `session_exited` 事实源。
- 新增 `inject_agent_session_prompt` 命令边界，follow-up prompt 与 completion prompt 现在都可以通过同一条 Rust Core -> PTY writer 链路注入当前活 Session。
- 新增 `session_prompt_injected` 结构化事件，记录注入意图、prompt 文本、提交事实和当时可见的 `codex_session_id`，为后续 Epic 5 提供审计边界。
- RedWhisk 现在会在启动 Codex Session 后最佳努力读取 `~/.codex/session_index.jsonl` 与 session file，按 `working_dir + 启动时间窗口` 尝试回填 `agent_sessions.codex_session_id`；匹配失败时保持空值。
- 本机 Codex CLI 已确认支持 `codex resume [SESSION_ID] [PROMPT]` 与 `--last`，但本 story 也确认了 RedWhisk 侧仍不能把“精确 session id 总能拿到”视为稳定承诺，因此 Spike 文档把 resume 能力保守降级到日志保留与 `--last` 兜底。
- 新增 Spike 文档 `spikes/codex-resume-completion-prompt.md`，把自动化证据、手工探测、风险与 Epic 5 gate 结论落成可追溯事实。

### File List

- _bmad-output/implementation-artifacts/2-8-spike-codex-resume-and-completion-prompt-injection.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/bmad-dev-workflow-handoff.yaml
- spikes/codex-resume-completion-prompt.md
- src-tauri/src/commands/agent_session_commands.rs
- src-tauri/src/core/agent_session_service.rs
- src-tauri/src/db/agent_session_repository.rs
- src-tauri/src/db/event_repository.rs
- src-tauri/src/lib.rs
- src-tauri/src/types/agent_session.rs
- src-tauri/src/types/session_event.rs
- src-tauri/tests/agent_session.rs
- src/features/agents/agent-session-commands.ts
- src/shared/commands/command-client.test.ts

### Validation Commands

- `rg -n "2\\.8|2-8|resume|completion prompt|prompt injection" _bmad-output/planning-artifacts/epics.md _bmad-output/planning-artifacts/architecture.md _bmad-output/planning-artifacts/ux-designs _bmad-output/planning-artifacts/prds -S`
- `rg -n "resume|completion prompt|session id|write_agent_session_terminal|pty_session_manager|codex_session_id" src-tauri src spikes _bmad-output/implementation-artifacts -S`
- `codex --help`
- `codex resume --help`
- `tail -n 5 ~/.codex/session_index.jsonl`
- `find ~/.codex/profiles -path '*/sessions/*' -type f | tail -n 20`
- `script -q /dev/null codex --no-alt-screen -C "$tmpdir" "Reply with one short word, then wait."`
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`
- `pnpm test -- --runInBand src/shared/commands/command-client.test.ts`
- `pnpm format`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `cargo test --manifest-path src-tauri/Cargo.toml`

### Validation Results

- `rg -n "2\\.8|2-8|resume|completion prompt|prompt injection" _bmad-output/planning-artifacts/epics.md _bmad-output/planning-artifacts/architecture.md _bmad-output/planning-artifacts/ux-designs _bmad-output/planning-artifacts/prds -S`：通过，确认 Story 2.8 的原始 AC、Spike gate、降级要求和 Epic 5 依赖关系。
- `rg -n "resume|completion prompt|session id|write_agent_session_terminal|pty_session_manager|codex_session_id" src-tauri src spikes _bmad-output/implementation-artifacts -S`：通过，确认当前代码已具备 PTY writer / terminal command 边界，但 `codex_session_id` 仍需在实现阶段验证其真实来源与可用性。
- `codex --help`：通过，确认当前本机 Codex CLI 提供 `resume` 子命令。
- `codex resume --help`：通过，确认 `resume [SESSION_ID] [PROMPT]` 与 `--last` 的 CLI 形态。
- `tail -n 5 ~/.codex/session_index.jsonl`：通过，确认本机 `~/.codex/session_index.jsonl` 存在并记录 session id。
- `find ~/.codex/profiles -path '*/sessions/*' -type f | tail -n 20`：通过，确认 profile 级 session 文件存在，可读取 `session_meta` 做 working directory 匹配。
- `script -q /dev/null codex --no-alt-screen -C "$tmpdir" "Reply with one short word, then wait."`：超时，40 秒内未形成可稳定复用的新在线样本；因此未把“实时启动后必然可捕获精确 session id”视为已验证能力。
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`：通过，新增 `inject_session_prompt_records_event_and_writes_into_running_terminal` 与 session id 检测辅助测试通过。
- `pnpm test -- --runInBand src/shared/commands/command-client.test.ts`：通过，新增 `inject_agent_session_prompt` command bridge 测试通过。
- `pnpm format`：通过。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：通过。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test`：通过，8 个测试文件、86 个测试通过；仍有既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `cargo test --manifest-path src-tauri/Cargo.toml`：通过；Rust 单测、集成测试与文档测试全部通过。

### Change Log

- 2026-06-07：创建 Story 2.8 开发上下文并将状态推进到 `ready-for-dev`。
- 2026-06-07：完成同会话 prompt/completion prompt 注入能力、`session_prompt_injected` 审计事件、最佳努力 `codex_session_id` 捕获、Spike 结论文档与全量验证，状态推进到 `done`。
