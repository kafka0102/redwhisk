# 任务清单

## 1. OpenSpec 与后端能力

- [x] 1.1 补充 agents-ui / project-terminals spec delta。
- [x] 1.2 新增临时 Session 终端启动 DTO 与 Tauri command wrapper。
- [x] 1.3 后端根据 `agentSessionId` 读取当前 Agent Session 的 `working_dir`，启动临时 PTY。
- [x] 1.4 确保临时终端不创建或更新 Project Terminal 持久配置。
- [x] 1.5 Agent Session 列表返回 `workingDir` / `workspacePath`。

## 2. 前端内联终端面板

- [x] 2.1 新增 Session 内联终端面板组件，复用 `ProjectTerminal` 渲染 PTY。
- [x] 2.2 接入标题栏 Terminal 图标，首次打开默认创建一个终端。
- [x] 2.3 实现多 Tab、新增、关闭和最后终端关闭自动隐藏。
- [x] 2.4 实现默认高度 `200px`、上下拖动调整大小和主内容最大化/恢复。
- [x] 2.5 Tab 名称显示当前终端工作目录最终路径名。

## 3. 测试与验证

- [x] 3.1 补充 React 测试覆盖打开、新增、关闭隐藏、最大化和使用 agent workspace。
- [x] 3.2 补充 Rust 测试覆盖临时终端不写持久配置且 cwd 来自 Agent Session。
- [x] 3.3 运行 `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm format`。
- [x] 3.4 运行 `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm lint`。
- [x] 3.5 运行 `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm typecheck`。
- [x] 3.6 运行 `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm test`。
- [x] 3.7 运行 `cd src-tauri && cargo test`。
- [x] 3.8 运行 `openspec validate session-inline-terminals --strict`。
