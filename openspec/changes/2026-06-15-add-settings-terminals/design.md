## Context

当前仓库已经具备两块可直接复用的基础：

- Project Settings 已有稳定的左右两栏布局、可拖动 splitter 和统一的右侧内容 frame。
- Agents 页面里的 `CodexTerminal` 已经打通 `xterm`、窗口 resize、输入回写、输出订阅、恢复快照和 PTY 后端。

真正缺的是“终端 UI 内核”和“本地终端 session 语义”这两个抽象层。若继续把终端逻辑留在 `CodexTerminal` 内部，后续任何非 Agent 场景都只能复制一套；若直接把本地终端也塞进 agent session 命令，则模型会持续混淆。

## Scope Assumptions

- `Terminals` 放在 Project Settings 左侧菜单内，顺序位于 `Agents` 下方。
- 本次 MVP 的终端默认启动于当前项目仓库路径，使用系统默认 shell。
- 终端列表仅要求在当前运行期可用；跨应用重启恢复留到后续 change。

## UI Structure

`Terminals` 页面沿用 Settings 现有容器：

1. 左侧菜单宽度和 splitter 行为不变。
2. 右侧 header 显示 `Terminals`，右上角为 `+` 按钮。
3. body 使用紧密堆叠的 terminal list，不额外引入 table 或间隔 card 组。
4. 每个 list item 由“可点击 header + 可展开 body”组成：
   - header 左侧：终端图标、终端名称。
   - header 右上角：hover 时出现删除按钮。
   - body 右侧：共享终端内容组件，占据主要空间。
5. 背景色不做完全随机 HSL，而是从有限的 light/dark 调色板中伪随机选取，保证视觉稳定和文本对比度。

默认交互选择：

- 新建终端后立即插入列表末尾并自动展开，减少一次额外点击。
- 同时允许多个 terminal card 处于展开状态，避免用户在多个终端间来回切换时丢失上下文。

## Shared Terminal Component

将现有 `CodexTerminal` 拆成两层：

- `TerminalSurface`：纯终端渲染内核，负责 `xterm` 初始化、fit、主题切换、输入、输出、恢复、状态提示。
- `CodexTerminal`：Agent session 适配器，只负责把现有 `read/restore/write/resize/subscribe` 命令映射给 `TerminalSurface`。

`TerminalSurface` 对外暴露一个 transport 适配接口，而不是耦合到 agent session：

- `restore()`
- `readStatus()`
- `write(data)`
- `resize(rows, cols)`
- `subscribeOutput(handler)`

这样后续不论是 Agent session、项目本地 shell、任务 runner、还是只读日志终端，都可以复用同一个渲染内核。

## Local Terminal Backend Strategy

最佳扩展路径不是复刻一套新终端后端，而是把现有 PTY manager 向“通用终端 session”抽象推进一层：

- 新增独立于 Agent session 的 project terminal session 命令，例如 `create_project_terminal`、`read_project_terminal`、`write_project_terminal`、`resize_project_terminal`、`restore_project_terminal`、`close_project_terminal`。
- session 创建时绑定 `projectId`、工作目录和显示名称；MVP 直接用项目 repo path 作为 cwd，名称默认 `New Terminal`。
- PTY 继续复用现有 `PtySessionManager`，但前端命令与数据类型不再借用 `agent_session` 命名，避免未来能力语义漂移。

这样做的收益：

- 避免把“本地终端”误建模成假的 agent session。
- 共享同一套 PTY 可靠性、恢复与输出广播能力。
- 允许后续增量加入 rename、持久化、启动命令模板、shell 选择、split view，而不需要推倒现有 UI 组件。

## Validation

实现阶段至少运行：

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `cargo test --manifest-path src-tauri/Cargo.toml project_terminal`

如果 Rust 测试名需要按最终文件调整，可等价替换为受影响终端命令 / service 测试命令，但必须实际执行。
