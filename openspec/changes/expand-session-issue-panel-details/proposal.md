## Why

当前 Agents Activity 右侧 `Issue` tab 只展示标题、描述和标签，缺少用户在 session 场景真正需要的运行参数与 session 元信息。`查看 issue` 跳到 Issues Activity 后，返回按钮也无法识别来源，导致用户回不到原 session，且右侧面板打开状态会丢失。

另外，当前 session 数据没有单独保存“本次运行选择的 workflow skill 名称”，只把技能影响折叠进 `prompt_snapshot`。一旦技能被删除，Issue 面板就无法稳定展示当时的运行参数。

## What Changes

- 把 `src/features/agents/session-issue-panel.tsx` 的内容重组为 3 张 card：
  - `Issue信息`
  - `运行参数`
  - `Session信息`（含日志路径 section）
- 第一张 card 保留现有 Issue 标题、描述、标签内容，但用 card 容器包裹；`查看 issue` 改成紧凑普通按钮。
- 从 session side panel 打开 Issue 详情时，携带来源 session 上下文；Issue 详情页返回时，若来源是 session，则返回该 session，并恢复右侧面板之前的打开状态。
- 为 session 增加运行参数展示：
  - Agent 名称
  - workflow skill 名称；为空或已缺失时显示 `无`
  - 开发模式；`当前分支 (<branch>)` 或 `工作树 (<branch>) <worktree-name>`
- 为 session 增加信息展示：
  - 开始时间
  - 结束时间（未结束显示 `-`）
  - 当前状态
  - 日志路径（运行中显示 runtime log，归档后显示 archive log）
- 在 session 启动时持久化本次选择的 workflow skill 名称，并把 Agent 名称与 workflow skill 名称补充进 session 列表 DTO，供 side panel 直接展示。

## Non-goals

- 不改动 `变更` / `文件` tab 的数据加载与交互。
- 不在本次任务中改造 Issue run dialog 的字段顺序或选项来源。
- 不新增独立第四张 `日志` card；日志路径归入第三张 `Session信息` card。

## Impact

- 前端：`src/features/agents/**`、`src/features/issues/**`、`src/app/**`、`src/shared/i18n/messages.ts`、`src/app/app.css`
- 后端：`src-tauri/src/types/agent_session.rs`、`src-tauri/src/db/agent_session_repository.rs`、`src-tauri/src/core/agent_session_service.rs`、相关 migration 与测试
- 规格：`openspec/specs/agents-ui/spec.md`、`openspec/specs/issues-ui/spec.md`
