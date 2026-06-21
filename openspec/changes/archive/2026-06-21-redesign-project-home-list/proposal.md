# Project Home 列表化改版

## 背景

Project Home 当前使用 Card 网格展示项目，并在页面顶部展示 `RedWhisk`、`Projects` 和说明文案。用户已确认第三版静态原型方向：

- `.superpowers/brainstorm/43971-1782012801/content/project-home-redesign-v3.html`

新的首页需要更像本地桌面工具的紧凑项目选择器：窗口 Header 支持常见桌面窗口交互，项目列表改为 List，每行一个项目，并在列表上方提供无边框本地搜索与 `New Project` 入口。

## 目标

- 让未进入 Project 工作台的小窗口 Header 区域支持拖动窗口。
- 双击 Header 区域在最大化与恢复之间切换，最大化是窗口最大化而不是全屏。
- 移除 Project Home 顶部 `RedWhisk`、`Projects` 和说明文案。
- 将项目展示从 Card 网格改为 List，每行展示一个项目。
- 每个项目行左侧显示项目名称首字母，使用稳定生成的彩色背景，文字为白色。
- 项目名称紧随图标并加粗显示，项目路径显示在名称下方。
- 当项目路径以用户 Home 目录开头时，将 Home 目录缩短为 `~/`。
- 在 List 上方增加分割线；分割线上方右侧保留 `New Project` 按钮。
- 在 `New Project` 左侧增加无边框搜索框，占位符为 `searching projects`。
- 搜索框按项目名称进行本地实时匹配；输入搜索条件后仅渲染匹配项目。
- 有搜索条件时显示清除按钮，点击后清空搜索并展示全部项目。

## 非目标

- 本次不改变项目创建确认表单、Git 仓库校验、持久化模型或 Tauri command。
- 本次不新增项目排序、最近打开时间、收藏、右键菜单或键盘导航增强。
- 本次不实现路径搜索；搜索范围仅限项目名称。
- 本次不引入新的 UI 组件库或第三方依赖。
- 本次不修改 Project 工作台内部 Activity Bar、Project Switcher 或已打开项目后的 Header 结构，除非复用窗口 Header 交互时必须调整共享逻辑。

## 影响范围

- `src/features/project/project-home.tsx` 及相关 Project Home 列表组件。
- `src/features/project/project-card-grid.tsx`、`project-card.tsx`、`create-project-card.tsx` 的替换或移除路径。
- `src/app/app-shell.tsx` 或承载未选择 Project 时窗口 Header 的相关 shell 代码。
- `src/app/app.css` 或等价样式入口中的 Project Home 与窗口 Header 样式。
- Project Home 相关测试。

## 验收标准

- Project Home 首屏不再显示 `RedWhisk`、`Projects` 和 `Local Git repositories available to this workbench...`。
- Project Home 顶部工具栏左侧显示无边框搜索框，placeholder 为 `searching projects`；右侧显示 `New Project`。
- 搜索框输入字符后立即按项目名称过滤；不匹配的项目不会被渲染，也不能被点击。
- 搜索条件非空时显示清除按钮；点击后搜索框变空并展示全部项目。
- 项目列表每行只对应一个项目，点击项目行打开该项目。
- 项目行左侧图标显示项目名称首字母，图标背景色由项目数据稳定生成，文字为白色。
- 项目名称加粗显示，路径位于项目名下方；Home 目录前缀显示为 `~/`。
- 列表上方存在清晰分割线；整体视觉符合 RedWhisk 设计系统的紧凑、安静、低装饰原则。
- 小窗口 Header 空白区域可拖动窗口。
- 双击小窗口 Header 空白区域可最大化窗口；再次双击可恢复。
