# Session 内联多终端面板

## 背景

Agents Activity 的 Session 标题栏已有 Terminal 图标，但当前没有实际交互。用户在处理 Issue Session 时需要临时打开多个 shell，并且 shell 必须运行在当前 Agent Session 的实际工作区内：如果该 Session 是 worktree 模式，应进入对应 worktree，而不是项目主仓库路径。

## 目标

- 点击 Session 标题栏右侧 Terminal 图标后，在 Session 主内容下方显示上下结构的内联终端面板。
- 面板默认高度为 `200px`，支持上下拖动调整高度。
- 默认创建一个终端，Tab 名称显示终端工作目录最终路径名。
- Tab 栏支持新增、关闭多个终端；当所有终端关闭后，终端区域自动隐藏。
- Tab 栏最右侧提供放大/恢复按钮；放大后隐藏下方终端面板，让 Session 主内容占满可用区域，再次点击恢复。
- 终端启动路径必须取当前 Agent Session 的实际 `working_dir`；worktree Session 使用 worktree 路径，current branch Session 使用主仓库路径。
- 临时终端不写入 Project Settings 的持久终端配置。

## 非目标

- 不改变 Codex 结构化消息流和 composer；Session 主内容仍然是结构化消息视图。
- 不在本次实现持久化内联终端 Tab、面板高度或最大化状态。
- 不新增任意路径终端启动入口；终端 cwd 由后端根据选中的 Agent Session 解析。
- 不改变 Project Terminals Activity 的既有持久终端行为。

## 影响范围

- `src-tauri/src/types/project_terminal.rs`：新增临时终端启动 DTO。
- `src-tauri/src/core/project_terminal_service.rs`：新增基于 Agent Session 实际工作目录启动临时 PTY 的逻辑。
- `src-tauri/src/commands/project_terminal_commands.rs` / `src-tauri/src/lib.rs`：注册新 command。
- `src-tauri/src/types/agent_session.rs` / `src-tauri/src/core/agent_session_service.rs`：Agent Session 列表暴露 `workingDir` / `workspacePath`，供前端展示与兜底判断。
- `src/features/agents/`：新增 Session 内联终端面板，接入标题栏 Terminal 图标。
- `src/features/terminals/project-terminal-commands.ts`：新增前端 command wrapper。
- `src/app/app.css`：新增紧凑的内联终端布局样式。

## 验收标准

- 点击有 linked Issue 的 Session 标题栏 Terminal 图标后，下方出现内联终端区域，初始高度为 `200px`。
- 首次打开时自动创建一个终端，Tab 文案为当前 Agent Session 实际工作目录最后一段。
- 点击 `+` 可新增终端；点击 Tab 上关闭按钮可关闭该终端。
- 关闭最后一个终端后，终端区域隐藏。
- 点击 Tab 栏最右侧放大按钮后，Session 主内容最大化且终端面板隐藏；再次点击恢复原上下结构。
- 拖动分隔条可以调整下方终端区域高度。
- 后端启动临时终端时基于 `agent_sessions.working_dir`，不会写入 `project_terminal_configs`。
