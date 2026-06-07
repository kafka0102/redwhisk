# Codex Resume 与 Completion Prompt 注入 Spike

日期：2026-06-07

## 目标

验证 RedWhisk 是否已经具备以下两条 Epic 5 依赖能力：

- 向当前活跃 Codex Session 注入 follow-up prompt 与 completion prompt
- 在 Session 异常退出或应用重启后，通过 `codex resume` 恢复上下文

本次 Spike 的目标是形成可执行结论和降级策略，不是提前交付完整 Completion Policy 或 Resume UI。

## 本次实现

- Rust Core 新增 `inject_agent_session_prompt` 命令边界，前端桥接位于 `src/features/agents/agent-session-commands.ts`。
- `AgentSessionService::inject_session_prompt` 复用现有 PTY writer，把 follow-up / completion prompt 统一写入当前活会话，并记录结构化 `session_prompt_injected` 事件。
- `SessionEventType` 扩展为：
  - `session_started`
  - `session_exited`
  - `session_prompt_injected`
- 启动 Codex Session 后，Rust Core 会最佳努力从 `~/.codex/session_index.jsonl` 与对应 session 文件中推断 `codex_session_id`，并在匹配到当前 `working_dir` 与启动时间窗口时回填到 `agent_sessions.codex_session_id`。

## 自动化证据

已执行：

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test agent_session
pnpm test -- --runInBand src/shared/commands/command-client.test.ts
```

关键证据：

- `src-tauri/tests/agent_session.rs`
  - 新增 `inject_session_prompt_records_event_and_writes_into_running_terminal`
  - 覆盖“向当前活 PTY 注入 prompt 后，日志快照可见输入且会写入 `session_prompt_injected` 事件”
  - 覆盖 session id 检测辅助逻辑的 working directory 匹配与误匹配拒绝
- `src/shared/commands/command-client.test.ts`
  - 覆盖 `inject_agent_session_prompt` 的 Tauri command bridge

## 手工探测

已执行：

```bash
codex --help
codex resume --help
tail -n 5 ~/.codex/session_index.jsonl
find ~/.codex/profiles -path '*/sessions/*' -type f | tail -n 20
```

补充探测：

```bash
script -q /dev/null codex --no-alt-screen -C "$tmpdir" "Reply with one short word, then wait."
```

结果：

- 当前本机 `codex` CLI 官方已经提供 `resume [SESSION_ID] [PROMPT]` 与 `--last`。
- `~/.codex/session_index.jsonl` 确实记录 session id，但顶层索引只有 `id/thread_name/updated_at`，需要再关联 `sessions/**/*.jsonl` 中的 `session_meta.payload.cwd` 才能和 RedWhisk Session 对齐。
- 通过 `script` 启动交互式 Codex 的试验在本环境中超时，且没有可靠地产生可供本次工作流复用的新索引记录，因此“真实在线启动后立刻稳定拿到 session id”仍不能视为强保证。

## 结论

### 已验证成立

- 向当前活跃 PTY Session 注入 follow-up prompt 是可行的。
- completion prompt 与普通 follow-up prompt 可以走同一条 PTY 写入链路；对运行时来说，两者的核心差异只在意图和审计事件。
- 应用侧已经可以把 prompt 注入事实结构化记录到 `session_events`，为后续 Epic 5 的完成流程保留审计边界。
- 当本机 `~/.codex` 里存在可匹配的 session index 和 session file 时，可以基于 `working_dir + 启动时间窗口` 最佳努力推断 `codex_session_id`。

### 未验证为强保证

- 不能保证每次启动后都能立刻稳定捕获精确的 `codex_session_id`。
- 不能保证应用重启后一定能基于已保存的 `codex_session_id` 恢复到原上下文，因为本次没有拿到足够稳定的真实在线样本去证明整条链路。
- 不能把 `codex resume <session_id>` 视为当前 MVP 必然可执行的产品承诺。

## 推荐降级策略

- Epic 5 若需要向当前运行中的 Session 发送 completion prompt，可以依赖本次新增的 prompt 注入边界。
- 若 `agent_sessions.codex_session_id` 已成功捕获，可优先尝试 `codex resume <session_id>`。
- 若 `codex_session_id` 缺失，MVP 只能保守降级到：
  - 保留日志
  - Issue 保持 `review` 或 `running`
  - 如需继续恢复，优先尝试 `codex resume --last`
  - UI 不展示“必然可恢复”的强承诺文案

## 对后续故事的约束

- Story 5.4 可以依赖“向当前活 Session 注入 completion prompt”的能力，但必须接受注入成功不等于 commit 一定产生，commit 检测仍依赖 Story 2.9。
- Story 4.x / 5.x 在设计 Resume 入口时，必须把 `codex_session_id` 缺失作为常态分支处理，而不是只考虑理想路径。
- 若后续要把 `codex resume <session_id>` 作为稳定能力发布，需要补一次真实在线 Codex Session 的端到端恢复验证，并记录稳定样本。
