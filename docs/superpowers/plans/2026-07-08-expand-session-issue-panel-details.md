# Expand Session Issue Panel Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Session 右侧 `Issue` tab 扩展成三张 card，并补齐运行参数、Session 信息、Issue 返回来源与状态恢复能力。

**Architecture:** 后端只新增一个最小 session 快照字段 `workflow_skill_name`，并在 session 列表 DTO 中补出 `agentProfileName` 与 `workflowSkillName`，避免从 prompt 文本反解析。前端通过轻量 runtime cache 保存“从 session 打开的 Issue 来源上下文”和 side panel 打开状态，尽量把新增逻辑下沉到新 helper 文件，避免继续膨胀已超 1000 行的 Activity 文件。

**Tech Stack:** React 19、TypeScript、Vitest、Tauri 2、Rust、SQLite、pnpm

## Global Constraints

- 所有说明性文案与新增 `docs/` 内容使用简体中文；代码、路径、标识符保持原样。
- 所有用户可见文本必须接入 `src/shared/i18n/**`，不得新增硬编码文案。
- `session-issue-panel.tsx` 必须渲染 3 张 card：`Issue信息`、`运行参数`、`Session信息`；日志路径归入第三张 card，不新增第四张 card。
- `Agent Profile` 当前是逻辑删除；Agent 名称继续按 `agent_profile_id` 关联历史 profile，不新增 Agent 名称快照列。
- workflow skill 必须按 session 保存名称；技能为空或被删除时，前端统一显示 `无`。
- TypeScript/TSX 改动后必须依次运行 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`；命令前先执行 `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"`。
- 不得使用 `@ts-ignore`、`@ts-nocheck`、`eslint-disable` 掩盖问题。
- 修改已超过 1000 行的 Activity 文件时，优先新增 helper / cache 模块承接逻辑，避免继续把状态直接堆进原文件。

---

## File Structure

- 修改 `src-tauri/migrations/`：新增 migration，为 `agent_sessions` 增加 `workflow_skill_name` 列。
- 修改 `src-tauri/src/types/agent_session.rs`：扩展 `StartAgentSessionInput` 和 `AgentSessionListItem`。
- 修改 `src-tauri/src/db/agent_session_repository.rs`：写入/读取 `workflow_skill_name`，并在列表查询中补出 `agent_profile_name`。
- 修改 `src-tauri/src/core/agent_session_service.rs`：启动 issue session 时接收 workflow skill 名称并回填 DTO。
- 修改 `src-tauri/src/db/migrations.rs`、相关 Rust tests：注册 migration 并覆盖新旧数据路径。
- 修改 `src/features/issues/issue-commands.ts`、`src/features/issues/issue-run-dialog.tsx`：把 workflow skill 名称传给 `start_agent_session`。
- 新增 `src/features/agents/session-return-cache.ts`：缓存 session 来源返回上下文与 side panel 状态。
- 新增 `src/features/issues/issue-open-request.ts`：定义 Issue 打开请求结构，避免在 `AppShell`/`ActivityRouter`/`IssuesActivity` 间继续传裸 `issueId`。
- 修改 `src/app/app-shell.tsx`、`src/app/activity-router.tsx`：传递结构化 Issue 打开请求。
- 修改 `src/features/agents/agents-activity.tsx`：写入/恢复 session return cache，但保持主流程最小改动。
- 修改 `src/features/issues/issues-activity.tsx`、`src/features/issues/issue-read-only-page.tsx`：识别 session 来源并改造返回逻辑。
- 修改 `src/features/agents/session-issue-panel.tsx`，必要时新增 `src/features/agents/session-issue-panel-sections.tsx`：实现三张 card 与参数格式化。
- 修改 `src/shared/i18n/messages.ts`、`src/app/app.css`：补文案与样式。
- 修改前端/Rust 测试文件：覆盖 DTO、返回链路、panel 展示与空值兜底。

### Task 1: 扩展 session 持久化字段与列表 DTO

**Files:**
- Create: `src-tauri/migrations/0034_agent_sessions_workflow_skill_name.sql`
- Modify: `src-tauri/src/db/migrations.rs`
- Modify: `src-tauri/src/types/agent_session.rs`
- Modify: `src-tauri/src/db/agent_session_repository.rs`
- Modify: `src-tauri/src/core/agent_session_service.rs`
- Modify: `src-tauri/src/core/issue_service.rs`
- Test: `src-tauri/tests/agent_session.rs`

**Interfaces:**
- Consumes: `StartAgentSessionInput`, `AgentSessionListItem`, `AgentSessionRepository::create_with_*`
- Produces:
  - `StartAgentSessionInput { workflow_skill_name: Option<String> }`
  - `AgentSessionListItem { agent_profile_name: String, workflow_skill_name: Option<String> }`

- [ ] **Step 1: 先写 Rust 失败测试**

在 `src-tauri/tests/agent_session.rs` 增加覆盖：
- 启动 issue session 时保存 `workflow_skill_name`
- `list_agent_sessions` 返回 `agentProfileName`
- 旧 session 数据未写 skill 时返回 `None`

- [ ] **Step 2: 运行单测确认失败**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml agent_session -- --nocapture
```

Expected: FAIL，提示缺少 `workflow_skill_name` 字段或 DTO/SQL 不匹配。

- [ ] **Step 3: 最小实现 migration、类型与查询**

实现点：
- migration 新增 `workflow_skill_name TEXT`
- `StartAgentSessionInput` 增加 `workflow_skill_name`
- repository 在 insert/list SQL 中写入和读出 `workflow_skill_name`
- 列表 SQL 额外选择 `agent_profiles.name AS agent_profile_name`
- service 映射 DTO

- [ ] **Step 4: 重新运行 Rust 单测**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml agent_session -- --nocapture
```

Expected: PASS

- [ ] **Step 5: 提交本任务相关改动**

```bash
git add src-tauri/migrations/0034_agent_sessions_workflow_skill_name.sql \
  src-tauri/src/db/migrations.rs \
  src-tauri/src/types/agent_session.rs \
  src-tauri/src/db/agent_session_repository.rs \
  src-tauri/src/core/agent_session_service.rs \
  src-tauri/src/core/issue_service.rs \
  src-tauri/tests/agent_session.rs
git commit -m "feat: persist session workflow skill name"
```

### Task 2: 让 issue run flow 传递 workflow skill，并定义结构化 Issue 打开请求

**Files:**
- Create: `src/features/issues/issue-open-request.ts`
- Modify: `src/features/issues/issue-commands.ts`
- Modify: `src/features/issues/issue-run-dialog.tsx`
- Modify: `src/app/app-shell.tsx`
- Modify: `src/app/activity-router.tsx`
- Test: `src/shared/commands/command-client.test.ts`

**Interfaces:**
- Consumes: `startAgentSession`, `AppShell`, `ActivityRouter`
- Produces:
  - `IssueOpenRequest`
  - `StartAgentSessionInput['workflowSkillName']`

- [ ] **Step 1: 先写前端失败测试**

新增测试覆盖：
- `start_agent_session` command payload 带 `workflowSkillName`
- `AppShell` / `ActivityRouter` 接收结构化 `IssueOpenRequest` 而不是裸 `issueId`

- [ ] **Step 2: 运行受影响测试确认失败**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"
pnpm test -- --run src/shared/commands/command-client.test.ts
```

Expected: FAIL，payload 缺失 `workflowSkillName` 或类型不匹配。

- [ ] **Step 3: 最小实现前端类型与透传**

实现点：
- `issue-commands.ts` 扩展 `StartAgentSessionInput`
- `issue-run-dialog.tsx` 把选中的 workflow skill 名称传给 command
- 新建 `issue-open-request.ts`，定义 session 来源字段，为后续返回链路做准备
- `AppShell` / `ActivityRouter` 改为传结构化请求

- [ ] **Step 4: 重新运行受影响测试**

Run:

```bash
pnpm test -- --run src/shared/commands/command-client.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交本任务相关改动**

```bash
git add src/features/issues/issue-open-request.ts \
  src/features/issues/issue-commands.ts \
  src/features/issues/issue-run-dialog.tsx \
  src/app/app-shell.tsx \
  src/app/activity-router.tsx \
  src/shared/commands/command-client.test.ts
git commit -m "feat: pass session workflow skill through issue launch"
```

### Task 3: 实现 session 来源返回与 side panel 状态恢复

**Files:**
- Create: `src/features/agents/session-return-cache.ts`
- Modify: `src/features/agents/agents-activity.tsx`
- Modify: `src/features/issues/issues-activity.tsx`
- Modify: `src/features/issues/issue-read-only-page.tsx`
- Test: `src/features/agents/agents-activity.test.tsx`
- Test: `src/features/issues/issues-activity.test.tsx`

**Interfaces:**
- Consumes: `IssueOpenRequest`, `useSessionWorkspaceCache`, `AgentsActivity`, `IssuesActivity`
- Produces:
  - cache helpers for `selectedSessionId` / `isSidePanelOpen` / `sidePanelTab`
  - Issue back action that can route to session

- [ ] **Step 1: 先写返回链路失败测试**

新增测试覆盖：
- 从 session side panel 打开 Issue 后，返回按钮跳回原 session
- 返回后 side panel 仍保持打开
- 返回后仍恢复原 tab（`issue`/`changes`/`files`）

- [ ] **Step 2: 运行受影响测试确认失败**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"
pnpm test -- --run src/features/agents/agents-activity.test.tsx src/features/issues/issues-activity.test.tsx
```

Expected: FAIL，仍回到 Issues 或 side panel 状态丢失。

- [ ] **Step 3: 最小实现 return cache 与返回逻辑**

实现点：
- 新增 `session-return-cache.ts`，承接 runtime cache，减少向超大 Activity 文件塞状态
- `AgentsActivity` 在打开 Issue 前缓存当前 session / side panel 状态
- `IssuesActivity` 识别 `IssueOpenRequest`
- `IssueReadOnlyPage` 的 back action 根据来源选择返回 session 或维持旧行为

- [ ] **Step 4: 重新运行受影响测试**

Run:

```bash
pnpm test -- --run src/features/agents/agents-activity.test.tsx src/features/issues/issues-activity.test.tsx
```

Expected: PASS

- [ ] **Step 5: 提交本任务相关改动**

```bash
git add src/features/agents/session-return-cache.ts \
  src/features/agents/agents-activity.tsx \
  src/features/issues/issues-activity.tsx \
  src/features/issues/issue-read-only-page.tsx \
  src/features/agents/agents-activity.test.tsx \
  src/features/issues/issues-activity.test.tsx
git commit -m "feat: restore session context when returning from issue detail"
```

### Task 4: 重构 session issue panel 为三张 card 并补文案样式

**Files:**
- Create: `src/features/agents/session-issue-panel-sections.tsx`
- Modify: `src/features/agents/session-issue-panel.tsx`
- Modify: `src/features/agents/agent-session-commands.ts`
- Modify: `src/shared/i18n/messages.ts`
- Modify: `src/app/app.css`
- Test: `src/features/agents/agents-activity.test.tsx`

**Interfaces:**
- Consumes: `AgentSessionListItem`, `SessionIssuePanelProps`
- Produces:
  - three-card `SessionIssuePanel`
  - display helpers for `Agent` / `工作流技能` / `开发模式` / `Session信息`

- [ ] **Step 1: 先写面板展示失败测试**

新增测试覆盖：
- 右侧面板展示三张 card
- workflow skill 为空时显示 `无`
- worktree 模式展示 `工作树 (<branch>) <worktree-name>`
- 运行中与归档 session 分别显示正确日志路径

- [ ] **Step 2: 运行受影响测试确认失败**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"
pnpm test -- --run src/features/agents/agents-activity.test.tsx
```

Expected: FAIL，缺少 card 标题或参数/日志路径展示。

- [ ] **Step 3: 最小实现组件拆分、i18n 与样式**

实现点：
- 把参数行/Session 信息格式化 helper 拆到新文件，控制 `session-issue-panel.tsx` 复杂度
- `查看 issue` 改为紧凑普通按钮
- 新增全部中英文文案
- 使用扁平 card 样式，不引入装饰性阴影

- [ ] **Step 4: 重新运行受影响测试**

Run:

```bash
pnpm test -- --run src/features/agents/agents-activity.test.tsx
```

Expected: PASS

- [ ] **Step 5: 提交本任务相关改动**

```bash
git add src/features/agents/session-issue-panel-sections.tsx \
  src/features/agents/session-issue-panel.tsx \
  src/features/agents/agent-session-commands.ts \
  src/shared/i18n/messages.ts \
  src/app/app.css \
  src/features/agents/agents-activity.test.tsx
git commit -m "feat: expand session issue panel details"
```

### Task 5: 全量验证、OpenSpec 回填与最终提交

**Files:**
- Modify: `openspec/changes/expand-session-issue-panel-details/tasks.md`
- Modify: `openspec/changes/expand-session-issue-panel-details/.onespec.yaml`

**Interfaces:**
- Consumes: 前 4 个任务完成后的代码与测试结果
- Produces: 勾选完成的 OpenSpec tasks、review handoff、最终 git commit

- [ ] **Step 1: 运行格式化**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"
pnpm format
git status --short
```

Expected: 仅当前任务相关文件有改动。

- [ ] **Step 2: 运行 lint 与 typecheck**

Run:

```bash
pnpm lint
pnpm typecheck
git status --short
```

Expected: PASS，且无无关文件被带出。

- [ ] **Step 3: 运行完整测试**

Run:

```bash
pnpm test
git status --short
```

Expected: PASS

- [ ] **Step 4: 回填 OpenSpec**

执行：
- 勾选 `openspec/changes/expand-session-issue-panel-details/tasks.md`
- 用 OneSpec state 记录 plan、phase、touched files
- 运行 `openspec validate expand-session-issue-panel-details --strict`

- [ ] **Step 5: 提交最终改动**

```bash
git add openspec/changes/expand-session-issue-panel-details \
  docs/superpowers/plans/2026-07-08-expand-session-issue-panel-details.md
git add [本次任务直接相关代码文件]
git commit -m "feat: expand session issue panel details"
```
