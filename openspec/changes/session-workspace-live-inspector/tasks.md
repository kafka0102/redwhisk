# 任务清单

## 1. 依赖与基础集成

- [x] 1.1 新增 `@monaco-editor/react`、`monaco-editor`、`react-arborist` 依赖并更新 lockfile。
- [x] 1.2 确认 Monaco 在 Vite/Tauri 中的 worker 加载方式，避免影响现有 Agents Session 消息流首屏。
- [x] 1.3 建立 `src/features/agents/session-workspace-commands.ts`，定义前端 DTO 与 command wrapper。

## 2. Rust workspace command

- [x] 2.1 新增 workspace DTO：变更文件、文件树节点、文件内容、diff 内容和列表响应类型。
- [x] 2.2 实现 workspace root 解析：优先使用 Session workspace path（如可用），否则使用 Project repo path。
- [x] 2.3 实现安全相对路径校验，拒绝绝对路径、路径穿越和符号链接逃逸。
- [x] 2.4 实现 `get_project_worktree_changes`，返回真实未提交变更、增删行统计和 metadata signature。
- [x] 2.5 实现 `get_project_worktree_file_tree`，返回忽略高噪声目录后的真实仓库文件树。
- [x] 2.6 实现 `read_project_worktree_file`，返回只读文本内容或二进制/超大文件占位。
- [x] 2.7 实现 `read_project_worktree_diff`，返回新增、修改、删除、重命名等状态的旧/新内容。
- [x] 2.8 注册 Tauri commands，并补齐 Rust 单元测试和 command 错误映射。

## 3. 前端 Session 缓存与轮询

- [x] 3.1 将现有 `MockChangedFile` / `MockTreeNode` 替换为真实 workspace DTO。
- [x] 3.2 实现按 `sessionId` 分区的内存缓存，保留 changes、file tree、已打开文件/diff 和当前 Tab 状态。
- [x] 3.3 `变更` Tab 打开时每约 `2s` 刷新 changes，signature 未变化时不替换列表。
- [x] 3.4 `文件` Tab 激活时每约 `5s` 刷新文件树，signature 未变化时不替换树。
- [x] 3.5 refresh 按钮触发立即刷新真实 changes，并显示加载和错误状态。
- [x] 3.6 切换 Session 时恢复旧缓存；没有缓存时懒加载当前 Session 数据。

## 4. 真实变更展示

- [x] 4.1 更新 `SessionChangesPanel` 展示真实未提交文件状态、增删行数、删除/新增/重命名标签和路径 tooltip。
- [x] 4.2 点击变更文件读取 diff 内容，打开或替换唯一 `变更` Tab。
- [x] 4.3 新增 Monaco diff 展示组件，修改/重命名文件用左右分栏，新增文件显示全量新增，删除文件显示旧内容和删除状态。
- [x] 4.4 移除主工作区上方“diff 哪个文件”或 placeholder 类提示。
- [x] 4.5 对二进制或超大 diff 显示明确不可预览状态。

## 5. 真实文件树与只读文件查看

- [x] 5.1 用 `react-arborist` 替换 mock 文件树，并保持 RedWhisk 紧凑样式和文件类型图标。
- [x] 5.2 目录点击只展开/折叠，不改变左侧主工作区。
- [x] 5.3 文件点击读取内容，打开或替换唯一 `文件` Tab。
- [x] 5.4 新增 Monaco 只读文件查看组件，设置语言、只读、无 minimap，并处理二进制/超大文件占位。

## 6. 测试与验证

- [x] 6.1 新增 Rust 测试覆盖 Git diff 状态、路径安全和文件树忽略规则。
- [x] 6.2 更新 Agents React 测试覆盖 changes 轮询刷新、Session 缓存恢复、删除标签、文件树目录/文件点击行为。
- [x] 6.3 运行 `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm format`。
- [x] 6.4 运行 `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm lint`。
- [x] 6.5 运行 `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm typecheck`。
- [x] 6.6 运行 `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm test`。
- [x] 6.7 运行 `cd src-tauri && cargo test`。
