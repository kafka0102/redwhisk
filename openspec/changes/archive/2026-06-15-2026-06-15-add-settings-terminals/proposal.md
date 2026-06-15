## Why

Project Settings 当前只有 `General` 和 `Agents` 两个菜单项，缺少一个集中承载项目级终端的入口。现有终端实现主要绑定在 Agents 会话页，虽然已经有 PTY 与 `xterm` 基础设施，但还没有抽成可复用的终端区域组件，也无法自然扩展到“本地终端”这类不依附 Agent session 的场景。

## What Changes

- 在 Project Settings 左侧菜单中于 `Agents` 下方新增 `Terminals` 菜单项，继续沿用现有左右两栏与 splitter 布局，左侧宽度规则与其他 Settings 模块一致。
- `Terminals` 右侧页面顶部第一行显示标题 `Terminals` 和右上角加号按钮；下方按紧密堆叠的列表展示终端条目。
- 每个终端条目支持点击展开为 card；card 左侧显示终端小图标和终端名称，默认名称为 `New Terminal`；右侧显示终端内容区域。
- 鼠标悬停 card 时，在右上角显示删除叉号，点击后删除当前终端。
- 每个 terminal card 从一组 theme-aware 调色板中随机分配背景色，保证 light / dark 主题下都维持足够对比度。
- 将当前 Agents 使用的终端渲染能力抽成可复用组件，由 Agent session 包装器和新的本地终端页面共同复用。
- 为后续本地终端扩展预留统一的 PTY transport 抽象；本次 MVP 默认在当前项目仓库路径启动本地 shell，不覆盖多标签持久化、重命名和跨重启恢复。

## Capabilities

### Modified Capabilities

- `settings-ui`: 扩展 Project Settings 菜单，定义 `Terminals` 页面结构、终端列表交互和 theme-aware 卡片表现。

### New Capabilities

- `project-terminals`: 定义项目级本地终端的创建、展示、删除，以及与共享终端渲染组件的集成方式。

## Non-goals

- 不在本次 change 内支持终端重命名、拖拽排序、拆分面板或跨应用重启恢复。
- 不改造 Issues / Agents 的业务流程，只把现有终端显示内核抽成可复用组件。

## Impact

- 前端：`src/features/settings/project-settings-activity.tsx`、终端相关新组件、样式和测试。
- 现有终端：`src/features/agents/codex-terminal.tsx` 需要降为基于共享终端组件的适配层。
- Tauri / Rust：新增项目本地终端 session 命令与状态管理，复用现有 PTY 能力而不是重新引入终端依赖。
- 测试：补充 Settings 页面交互测试、共享终端组件测试，以及本地终端命令 / service 的受影响测试。
