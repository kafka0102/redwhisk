# 任务清单

## 1. OpenSpec 与数据边界

- [x] 1.1 为 `agents-ui` 补充 session issue panel 三张 card、运行参数与 session 信息展示的规格。
- [x] 1.2 为 `issues-ui` 补充“从 session 打开的 Issue 详情返回 session 并恢复右侧面板状态”的规格。
- [x] 1.3 明确 session 运行参数的数据来源：Agent 名称复用 profile 关联，workflow skill 名称改为 session 级持久化字段。

## 2. 后端与 DTO

- [x] 2.1 为 `agent_sessions` 增加 `workflow_skill_name` 持久化字段，并补 migration。
- [x] 2.2 扩展 `start_agent_session` 输入、session repository 查询与 `AgentSessionListItem` DTO，返回 `agentProfileName`、`workflowSkillName`。
- [x] 2.3 更新 Rust 测试，覆盖旧数据缺省值与新字段返回。

## 3. 前端交互与展示

- [x] 3.1 重构 `session-issue-panel.tsx`，按三张 card 展示 Issue 信息、运行参数、Session 信息与日志路径。
- [x] 3.2 更新 i18n 文案与样式，保证新增标题、字段名、空值文案、按钮文案全部国际化。
- [x] 3.3 扩展 `AppShell` / `ActivityRouter` / `AgentsActivity` / `IssuesActivity` 的来源上下文与缓存恢复逻辑。
- [x] 3.4 新增或更新前端测试，覆盖：
  - 从 session side panel 打开 Issue
  - Issue 返回 session
  - 右侧面板打开状态恢复
  - 运行参数与 session 信息展示

## 4. 验证

- [x] 4.1 `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm format`
- [x] 4.2 `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm lint`
- [x] 4.3 `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm typecheck`
- [x] 4.4 `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm test`
