# Session Attention Auto Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让运行中的 Codex Session 在等待用户下一步输入时自动亮起 attention，并把 Agents 列表状态改为标题左侧圆点。

**Architecture:** Rust Core 负责维护 `attention=none|requested` 的业务事实，依据 session log 尾部启发式判断是否进入“等待用户输入”状态，并在成功写入输入后清除 attention。React 侧只轮询 session 列表并消费 `attention` 与主状态，渲染绿色、灰色、黄色圆点，不再显示文字状态。

**Tech Stack:** Rust + rusqlite + Tauri commands，React + TypeScript + Vitest

---

### Task 1: Rust attention 自动维护

**Files:**
- Modify: `src-tauri/src/db/agent_session_repository.rs`
- Modify: `src-tauri/src/core/agent_session_service.rs`
- Test: `src-tauri/tests/agent_session.rs`

- [ ] **Step 1: 写失败测试，覆盖“等待输入 => requested”和“成功输入 => none”**
- [ ] **Step 2: 运行 `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`，确认新测试先失败**
- [ ] **Step 3: 在 repository 增加最小 attention 更新入口，在 service 增加日志尾部启发式检测与 reconcile helper**
- [ ] **Step 4: 在 `list_agent_sessions` / `read_terminal_snapshot` 路径上触发自动设为 `requested`，在 `write_terminal_input` / prompt inject 成功后清回 `none`**
- [ ] **Step 5: 重跑 `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`，确认通过**

### Task 2: Agents 列表轮询与圆点状态 UI

**Files:**
- Modify: `src/features/agents/agents-activity.tsx`
- Modify: `src/app/app.css`
- Test: `src/features/agents/agents-activity.test.tsx`

- [ ] **Step 1: 写失败测试，覆盖黄色/绿色/灰色圆点语义，以及不再显示 `running` 文字**
- [ ] **Step 2: 运行 `pnpm test src/features/agents/agents-activity.test.tsx`，确认新断言先失败**
- [ ] **Step 3: 给 AgentsActivity 增加列表轮询，保证 attention 变化能刷到左侧列表**
- [ ] **Step 4: 把 session row 改成标题左侧圆点状态，保留 `Codex` 元信息和无障碍标签**
- [ ] **Step 5: 重跑 `pnpm test src/features/agents/agents-activity.test.tsx`，确认通过**

### Task 3: 全量验证与提交

**Files:**
- Modify: `docs/superpowers/plans/2026-06-07-session-attention-auto-detection-plan.md`（如需勾选记录）
- Commit related source/test files only

- [ ] **Step 1: 运行 `pnpm lint`**
- [ ] **Step 2: 运行 `pnpm typecheck`**
- [ ] **Step 3: 运行 `pnpm test src/features/agents`**
- [ ] **Step 4: 运行 `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`**
- [ ] **Step 5: 暂存本任务相关文件并创建 git commit**
