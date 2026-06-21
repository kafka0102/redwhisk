# 设计方案

## 歧义扫描

判定结果：低歧义。

触发原因：

- 范围集中在 Agents Session 工作区右侧 `变更/文件` 两个 Tab 和左侧唯一文件/变更 Tab。
- 用户已明确要求真实未提交变更、真实文件树、Session 切换内存保留、轮询刷新和 VS Code 风格展示。
- 技术方案存在多个库候选，但“接近 VS Code”强约束使 Monaco + react-arborist 成为更稳妥的主方案。

处理方式：直接起草 OpenSpec proposal；实现前仍需用户通过批准 Gate 明确确认依赖选择与执行路径。

## 关键假设

- “当前项目仓库”指 RedWhisk Project 记录中的 `repo_path`，不是 RedWhisk 自身源码仓库。
- 未提交变更包括 worktree 与 index 中相对 `HEAD` 的变更；不区分 staged/unstaged 的两个分组，本次统一展示为 `未提交`。
- Session 工作区读取的仓库路径以 Project 为准；如果某个 Session 在 worktree 中运行，后续实现可优先读取 `AgentSessionRecord.workspace_path`，但本次 spec 的最低要求是项目仓库根目录。
- 二进制文件和超大文本文件只展示明确占位，不把大文件完整读入 Monaco。
- `已提交` Tab 仍保持占位，不在本次实现 commit history。

## 开源依赖选择

### 主方案

1. `@monaco-editor/react` + `monaco-editor`
   - 用途：左侧文件 Tab 的只读 `Editor`、变更 Tab 的 `DiffEditor`。
   - 优点：VS Code 同源编辑器体验；支持左右 diff、语法高亮、只读模式、暗色主题适配。
   - 约束：包体较大，需确认 Vite/Tauri 打包 worker 配置；首屏不应因 Monaco 阻塞 Session 消息流。

2. `react-arborist`
   - 用途：右侧真实仓库文件树。
   - 优点：虚拟滚动适合大仓库；展开/折叠、键盘导航、选择态和自定义 row 渲染成熟。
   - 约束：默认支持拖拽，本次必须禁用创建、重命名、拖拽等编辑能力，只作为只读树。

### 备选

- `@git-diff-view/react`：适合 unified diff 或 GitHub 风格 diff；本次不作为主选，因为它不满足“接近 VS Code 左右分栏”的优先目标。

## 后端命令设计

新增 workspace command wrapper，命名保持 snake_case：

- `get_project_worktree_changes(project_id, session_id?)`
- `get_project_worktree_file_tree(project_id, session_id?)`
- `read_project_worktree_file(project_id, session_id?, file_path)`
- `read_project_worktree_diff(project_id, session_id?, file_path)`

DTO 建议：

```ts
type WorkspaceChangeKind = "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked" | "binary";

interface WorkspaceChangedFile {
  filePath: string;
  oldPath: string | null;
  fileName: string;
  kind: WorkspaceChangeKind;
  status: string;
  additions: number;
  deletions: number;
  isBinary: boolean;
  contentHash: string;
  metadataSignature: string;
}

interface WorkspaceFileTreeNode {
  id: string;
  name: string;
  path: string;
  kind: "directory" | "file";
  children?: WorkspaceFileTreeNode[];
  sizeBytes?: number;
  modifiedAt?: number;
}

interface WorkspaceFileContent {
  filePath: string;
  language: string | null;
  content: string;
  modifiedAt: number | null;
  sizeBytes: number;
  isBinary: boolean;
}

interface WorkspaceDiffContent {
  filePath: string;
  oldPath: string | null;
  kind: WorkspaceChangeKind;
  language: string | null;
  originalContent: string;
  modifiedContent: string;
  isBinary: boolean;
}
```

安全规则：

- Rust command 先通过 `project_id` 查询 Project，再解析可用 workspace root。
- `file_path` 必须是相对路径，规范化后仍位于 workspace root 内；拒绝绝对路径、`..` 穿越和符号链接逃逸。
- 文件树默认忽略 `.git`、`node_modules`、`target`、`dist`、`build`、`.next`、`.turbo`、`.vite` 等高噪声目录。
- 文本读取设置大小上限；超过上限或检测为二进制时返回 `isBinary: true` 和占位元数据，不返回完整内容。

## Git diff 数据策略

- 列表来源使用 `git status --porcelain=v1 -z` 确定文件状态，沿用现有 `src-tauri/src/git/status.rs` 的解析方式并补充统计。
- 增删行数优先使用 `git diff --numstat HEAD -- <path>`；untracked 文件可通过读取文件内容计算新增行数，删除数为 `0`。
- 修改文件 diff 内容：
  - `originalContent`：`git show HEAD:<path>` 或 rename 时读取 `oldPath`。
  - `modifiedContent`：读取工作区当前文件内容。
- 新增或 untracked 文件：
  - `originalContent` 为空字符串。
  - `modifiedContent` 为当前文件内容。
- 删除文件：
  - `originalContent` 为 `HEAD` 中内容。
  - `modifiedContent` 为空字符串。
- 二进制或超大文件：
  - 不进入 Monaco 内容渲染，显示文件类型、大小和不可预览说明。

## 前端状态与缓存

在 `AgentsActivity` 或 feature-local hook 中维护按 Session 分区的内存缓存：

```ts
interface SessionWorkspaceCache {
  changes: WorkspaceChangedFile[];
  fileTree: WorkspaceFileTreeNode[];
  openedFileByPath: Map<string, WorkspaceFileContent>;
  openedDiffByPath: Map<string, WorkspaceDiffContent>;
  activeWorkspaceTab: SessionWorkspaceTabKind;
  fileTab: SessionWorkspaceFile | null;
  changeTab: WorkspaceChangedFile | null;
  lastChangesSignature: string | null;
  lastFileTreeSignature: string | null;
}
```

规则：

- key 使用 `sessionId`；没有 Session 时不轮询。
- 切换 Session 时保存当前打开 Tab 状态并恢复目标 Session 缓存。
- 打开右侧面板后启动 changes 轮询，默认 `2s`；切走或关闭面板后停止对应轮询。
- 文件树 Tab 激活后启动 tree 轮询，默认 `5s`；只在 signature 变化时替换树数据。
- 变更列表对比优先使用由 `filePath/status/additions/deletions/metadataSignature/contentHash` 组成的 signature，避免无变化时重复渲染。

## UI 展示方案

### 变更列表

- 保留现有紧凑行样式。
- 行右侧显示 `新增`、`修改`、`删除`、`重命名` 等文本标签和 `+N -M`。
- 删除文件使用删除标签，允许文件名加删除线，但不能只靠删除线表达状态。
- refresh 按钮触发立即重新读取，不等待下一次轮询。

### Diff Tab

- `modified` / `renamed` / `copied`：使用 Monaco `DiffEditor`，左侧为 `originalContent`，右侧为 `modifiedContent`。
- `added` / `untracked`：可使用 `DiffEditor` 空左侧 + 全量右侧新增；视觉上显示新增样式，并在 Tab 内容顶部或状态行显示 `新增`。
- `deleted`：使用 `DiffEditor` 左侧旧内容 + 空右侧；状态行显示 `删除`。
- 移除当前占位中“Diff placeholder / diff 哪个文件”类提示，只保留实际 diff 或不可预览状态。

### 文件树与文件 Tab

- `react-arborist` 渲染树，row 自定义为 RedWhisk 紧凑样式和 lucide 文件类型图标。
- 目录点击只展开/折叠；文件点击读取内容并打开唯一 `文件` Tab。
- 文件 Tab 使用 Monaco `Editor`，设置 `readOnly: true`、`minimap.enabled: false`，主题跟随 RedWhisk light/dark token。

## 测试策略

- Rust：
  - Git status/diff 解析覆盖新增、修改、删除、rename、untracked、二进制/超大文件。
  - 路径校验覆盖绝对路径、`..`、symlink escape 和正常相对路径。
  - command 成功/失败路径覆盖项目不存在、repo 不可用、文件不存在。
- React：
  - mock command wrapper，验证 changes 轮询在列表数量或 signature 变化时刷新。
  - 验证点击变更文件打开唯一 change tab，并渲染 Monaco diff 容器或测试替身。
  - 验证删除文件有文本状态标签。
  - 验证文件树点击目录不打开 tab，点击文件打开只读文件 tab。
  - 验证切换 Session 后缓存恢复，不重新清空 UI。
- 验证命令：
  - `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm format`
  - `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm lint`
  - `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm typecheck`
  - `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm test`
  - 涉及 Rust command 时补充 `cd src-tauri && cargo test`
