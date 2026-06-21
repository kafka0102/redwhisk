# Session 工作区真实变更与文件浏览

## 背景

Agents Activity 的 Session 右侧辅助面板已经完成静态版：`变更` Tab 显示 mock 未提交文件，`文件` Tab 显示 mock 文件树，点击后左侧主工作区只展示占位内容。现在需要把这两块能力接入真实项目仓库，并让左侧 Tab 直接展示只读文件内容或类似 VS Code 的 diff 内容。

## 目标

- `变更` Tab 展示当前项目仓库的真实未提交变更文件，包含新增、修改、删除、重命名/复制等 Git 状态和增删行统计。
- 右侧面板打开期间定时刷新未提交变更，默认约每 `2s` 检测一次；文件列表、状态、数量或统计变化时刷新 UI。
- 前端在内存中缓存每个 Session 的变更列表、文件树、文件内容和 diff 内容；切换 Session 后保留旧 Session 的已加载内容，切回时先展示缓存。
- 点击变更文件后，左侧唯一 `变更` Tab 直接展示 diff 内容，不再显示“diff 哪个文件”的提示。
- diff 展示接近 VS Code：新增文件以整文件新增内容展示，修改文件左右分栏展示旧/新内容，删除文件在列表中有明确删除标识且 diff 可查看旧内容。
- `文件` Tab 展示真实项目仓库文件目录树；点击文件后左侧唯一 `文件` Tab 用只读代码编辑器展示文件内容，点击目录不改变主工作区。
- 文件树在内存中定时检测变化，默认约每 `5s` 刷新一次。
- 引入 React 开源依赖支撑 VS Code 风格代码查看、diff 和高性能目录树，避免自行实现编辑器或 diff 算法 UI。

## 非目标

- 不实现文件编辑、保存、重命名、删除或拖拽移动。
- 不实现已提交变更列表、commit history、stage/unstage 或提交操作。
- 不把 Session 右侧面板缓存写入 SQLite；本次只做前端运行期内存缓存。
- 不监听操作系统文件事件；本次使用轮询和文件/Git 元数据检测。
- 不改变 Agent Session 消息流、composer、Issue 状态流转或 Completion 行为。
- 不暴露任意绝对路径读取能力；只能读取项目仓库根目录内的相对路径。

## 技术方案推荐

- 代码编辑器与 diff：引入 `@monaco-editor/react` 和 `monaco-editor`。理由是 Monaco 是 VS Code 编辑器核心，提供只读 `Editor` 与左右分栏 `DiffEditor`，React 19 peer dependency 兼容，MIT license。
- 文件树：引入 `react-arborist`。理由是它提供虚拟滚动、展开折叠、键盘导航和大树性能，适合仓库文件树；视觉层可用 RedWhisk token 与 lucide 图标定制到接近 VS Code。
- 备选 diff 库：`@git-diff-view/react` 可作为后续 GitHub 风格 unified diff 的备选，但本次不推荐作为主方案，因为主工作区明确希望接近 VS Code 左右分栏。

## 影响范围

- `src-tauri/src/commands/`、`src-tauri/src/core/`、`src-tauri/src/types/`：新增项目工作区读取 command、DTO 和安全路径校验。
- `src-tauri/src/git/`：复用或扩展 Git status/diff 能力，读取未提交文件列表、增删行数、旧/新内容。
- `src/features/agents/`：替换 mock 数据源，实现 Session 级内存缓存、轮询刷新、Monaco 只读文件和 diff 展示、react-arborist 文件树。
- `package.json` / `pnpm-lock.yaml`：新增前端依赖。
- 相关 React 测试、Rust 单元测试和 command 行为测试。

## 验收标准

- 右侧 `变更` Tab 打开后展示真实未提交文件；工作区从 3 个文件变为 4 个文件时，约 2 秒内列表刷新。
- 对已有变更文件，如果文件修改时间、大小或 Git diff 元数据变化，前端更新缓存中的增删行统计和 diff 内容。
- 新文件在主工作区显示只读新增内容，行背景/装饰使用新增样式，且有文本状态说明“新增”。
- 修改文件在主工作区以左右分栏显示旧内容和新内容。
- 删除文件在右侧列表有删除文本标签或文件名删除线；点击后可看到旧内容，且状态不只靠颜色表达。
- 主工作区变更 Tab 不再显示“diff 哪个文件”的提示文案。
- 右侧 `文件` Tab 展示真实项目文件树，忽略 `.git`、`node_modules`、构建产物等高噪声目录；点击文件显示只读内容，点击目录只展开/折叠，不切换主工作区内容。
- 切换 Session 后，旧 Session 已加载的变更、文件树和打开的文件/diff 内容仍留在内存；切回时立即展示缓存，再按轮询刷新。
- 新增 command 只能读取当前 project repo 内相对路径，路径穿越或绝对路径输入会返回结构化错误。
