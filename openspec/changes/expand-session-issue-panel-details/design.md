## 概述

本次变更同时涉及前端布局重组、session 元数据补充与跨 Activity 返回链路。核心原则是只补当前面板展示所需的最小结构化字段，不从 `prompt_snapshot` 反推运行参数，也不把整套 Agents Activity 状态提升到全局。

## 设计决策

### 1. 右侧 Issue tab 重组为 3 张 card

- 第一张 `Issue信息` card 复用现有 title / description / labels 渲染。
- 第二张 `运行参数` card 用纯文本键值行展示 3 个参数：
  - `Agent`
  - `工作流技能`
  - `开发模式`
- 第三张 `Session信息` card 先展示开始时间、结束时间、状态，再用分割线隔开日志路径。
- `查看 issue` 改成紧凑 secondary/ghost 按钮，不再使用 link variant。

### 2. session 运行参数字段来源

#### 2.1 Agent 名称

- 当前 `Agent Profile` 是逻辑删除：删除命令仅把 `agent_profiles.del` 置为 `1`。
- 因此 session 仍可通过 `agent_profile_id` 关联到历史 profile 记录。
- 本次不新增 Agent 名称快照列；直接在 session 列表查询里补出 `agent_profile_name`。
- 这样 profile 改名后，session 面板会跟随显示最新名称，符合当前数据模型事实，也避免额外 migration。

#### 2.2 workflow skill 名称

- 当前 Issue run dialog 选择的是 saved skill 的 `name`，session 侧没有独立字段，只体现在 `prompt_snapshot`。
- 不能从 prompt 文本反解析 skill 名称；本次改为在 `start_agent_session` 输入与 `agent_sessions` 表中显式保存 `workflow_skill_name`。
- 存储方案保持最小：只存名称，空字符串按 `NULL` 处理。
- side panel 展示时，`NULL` 或空值统一显示 `无`。

#### 2.3 开发模式

- 继续复用现有 `workspace_mode`、`workspace_branch`、`working_dir` / `workspace_path`。
- `current_branch` 显示为 `当前分支 (<origin/current branch>)`。
- `worktree` 显示为 `工作树 (<workspace_branch>) <worktree-name>`，其中 `worktree-name` 取 `workspace_path` 或 `working_dir` 的 basename。

### 3. session 来源返回链路

- `AppShell` 目前只保存 `requestedIssueId`，不足以表达“这个 Issue 是从哪个 session 打开的”。
- 本次把 issue 打开请求扩展为带来源信息的结构，例如：
  - `issueId`
  - `sourceSessionId`
  - `returnTo: "issues" | "session"`
- `IssueReadOnlyPage` 的返回动作新增“来源 session 时返回 session，否则维持现有关闭逻辑”的分支。
- 为了在 Activity 切换卸载后仍恢复右侧面板状态，新增 feature-local runtime cache，按 `projectId` 保存最小 UI 状态：
  - `selectedSessionId`
  - `isSidePanelOpen`
  - `sidePanelTabBySessionId`
- `AgentsActivity` 挂载时先读取该缓存；从 session side panel 打开 Issue 前先把当前状态写回缓存；回到 session 时优先恢复缓存状态。

### 4. DTO 与兼容性

- 扩展 `StartAgentSessionInput`：新增 `workflowSkillName?: string | null`
- 扩展 `AgentSessionListItem`：新增
  - `agentProfileName`
  - `workflowSkillName`
- 前后端类型、command wrapper、测试同步更新。
- migration 为 `agent_sessions` 新增可空列 `workflow_skill_name TEXT`；旧数据默认 `NULL`，面板按 `无` 展示。

## 验证关注点

- 从 session side panel 打开 Issue 后，返回按钮应回到原 session。
- 返回后右侧面板需保持打开；若离开前在 `Issue` / `变更` / `文件` 之间切换，也应恢复对应 tab。
- 已删除 workflow skill 或旧 session 无该字段时，面板展示 `无`，不报错。
- 运行中 session 与已归档 session 分别展示 runtime log / archive log 路径。
