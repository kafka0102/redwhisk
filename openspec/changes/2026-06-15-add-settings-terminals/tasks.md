## 1. Project Settings 菜单与页面骨架

- [x] 1.1 在 Project Settings 左侧菜单中新增 `Terminals` 项，并保持与现有 Settings 菜单相同的宽度、splitter 与右侧内容容器规则。
- [x] 1.2 新增 `Terminals` 页面 header，显示标题 `Terminals` 与右上角加号按钮。
- [x] 1.3 补充前端测试，覆盖菜单项顺序、页面切换与基础布局。

## 2. 共享终端组件抽象

- [x] 2.1 从 `CodexTerminal` 中抽出通用 `TerminalSurface` 或等价共享组件，封装 `xterm` 渲染与 transport 生命周期。
- [x] 2.2 让现有 Agents 页面改为通过适配器复用共享终端组件，确保原有 Agent session 终端行为不回退。
- [x] 2.3 补充组件测试，覆盖 theme 切换、restore / live output、输入回写和不可用环境降级提示。

## 3. 项目本地终端 session

- [x] 3.1 在 Tauri 侧新增项目本地终端 session 命令与类型，复用现有 PTY manager。
- [x] 3.2 默认以项目仓库路径启动系统 shell，并支持前端 read / write / resize / restore / close。
- [x] 3.3 补充 Rust 测试，覆盖 session 创建、输出恢复、输入回写、关闭与异常路径。

## 4. Terminals 页面交互

- [x] 4.1 新建终端时创建一个默认名为 `New Terminal` 的条目，并自动展开。
- [x] 4.2 每个 terminal card 显示图标、标题、右侧终端内容区域，并允许多个 card 同时展开。
- [x] 4.3 card hover 时显示删除按钮；删除后关闭对应 session 并移除条目。
- [x] 4.4 为每个 card 分配 theme-aware 随机背景色，并保持 card 间紧密排列。
- [x] 4.5 补充前端测试，覆盖新增、展开、删除、颜色 class 分配和共享终端区域挂载。

## 5. 验证

- [x] 5.1 运行 `pnpm lint`。
- [x] 5.2 运行 `pnpm typecheck`。
- [x] 5.3 运行 `pnpm test`。
- [x] 5.4 运行受影响的 Rust 终端测试命令。
