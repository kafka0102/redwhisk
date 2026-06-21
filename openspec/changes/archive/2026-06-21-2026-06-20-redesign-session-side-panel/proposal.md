# Session 右侧页面改版

## 背景

Agents Activity 当前的 Session 右侧工作区顶部仍以类 Card 方式展示当前 Issue 信息，右侧详情抽屉也仍围绕 Issue 详情展开。新的工作流需要在同一 Session 工作区内快速查看当前变更文件、浏览项目文件树，并通过点击文件在左侧主内容区打开文件或 Diff 占位页。

用户已确认第一版静态原型：

- `openspec/changes/2026-06-20-redesign-session-side-panel/prototype.html`

## 目标

- 将 Session 顶部 Issue 信息区改为无 Card、无外边距的紧凑顶栏，并与左侧 Agents Issue 行高度对齐。
- 在 Session 工作区右侧提供宽度约 `300px` 的辅助面板，包含 `变更` 与 `文件` 两个 Tab。
- `变更` Tab 先用 mock 数据展示未提交文件列表，并支持点击文件在左侧打开唯一的变更 Tab。
- `文件` Tab 展示项目文件树占位效果，并支持点击文件在左侧打开唯一的文件 Tab。
- 左侧主内容区固定保留不可关闭的 `Session` Tab，同时最多保留一个可关闭的文件 Tab 和一个可关闭的变更 Tab；重复点击同类文件时替换现有 Tab 内容。

## 非目标

- 本次不接入真实 Git status、commit history 或 Diff 渲染。
- 本次不实现 `已提交` 列表内容。
- 本次不实现真实代码文件读取和语法高亮。
- 本次不新增后端 Tauri command、数据库表或持久化状态。
- 本次不改变 Agent Session 的结构化消息流、composer、Issue 状态流转或 Completion 行为。

## 影响范围

- `src/features/agents/` 下的 Session 工作区、顶部工具栏、右侧辅助面板与相关测试。
- `src/app/app.css` 或等价样式入口中的 Agents 工作区样式。
- 仅使用现有 React、TypeScript、lucide-react 与项目 UI/token 体系，不新增第三方依赖。

## 验收标准

- 顶部 Issue 信息区没有 Card 外观和外边距，只显示 `#<Issue ID> <Issue 标题>`。
- 顶部操作区移除 `Open Issue`，保留动作下拉按钮、终端图标、左右分割图标；分割图标选中时打开右侧辅助面板并显示浅色选中态。
- 右侧辅助面板默认宽度为 `300px`，顶部 `变更/文件` Tab 高度与左侧 Agents Issue 行一致。
- `变更` 面板的筛选行使用菜单式下拉，保留状态图标和下拉图标，右侧仅保留刷新按钮。
- `未提交` 文件列表一行一条，行宽铺满，新增标签与增删行数位于最右侧，间距紧凑；鼠标悬停时显示项目内路径 tooltip。
- 点击变更文件后，左侧打开或替换唯一变更 Tab，Tab 标题仅为文件名，内容区显示 Diff 占位。
- 点击文件树文件后，左侧打开或替换唯一文件 Tab，Tab 标题仅为文件名，内容区显示代码预览占位。
- `Session` Tab 始终存在且不可关闭。
