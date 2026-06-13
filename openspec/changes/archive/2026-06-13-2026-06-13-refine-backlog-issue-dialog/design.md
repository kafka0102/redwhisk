## 概览

本次 change 拆成三个部分：

1. backlog issue 弹窗布局分流
2. issue 描述附件插入 / 预览 / 下载 / 删除
3. run prompt 附件路径注入

## 当前实现观察

### backlog / 非 backlog 弹窗尚未分流

- `src/features/issues/issues-activity.tsx` 中的创建与编辑弹窗统一使用 `.issue-dialog` + `.issue-dialog__body`。
- 右侧固定渲染 `Session` 与 `Actions` 两个 panel。
- `Run` 按钮只对 backlog 且未关联 session 的 issue 可用，但仍放在统一右侧栏里。
- `running`、`review`、`completed` 的详情操作依赖这个右侧栏，因此不能直接全局删除。

### Run Dialog 当前为统一宽度

- `src/features/issues/issue-run-dialog.tsx` 复用 `.issue-dialog` 默认宽度。
- backlog issue 的运行入口会打开这个弹窗；用户这次要求 backlog 相关弹窗整体更紧凑。

### 描述区当前只有 Markdown 字符串

- `IssueDescriptionEditor` 仅维护 Markdown 文本，没有文件选择、拖拽、粘贴上传或附件节点。
- `issues` 表只有 `description TEXT`，没有附件元数据表，也没有附件路径字段。
- `buildRunPromptPreview` 只把 issue `description` 作为纯文本 prompt 输入。
- `start_agent_session` 只接收 `promptSnapshot: string`，启动 Agent 时也只透传纯文本 prompt。

## backlog 弹窗布局方案

### 目标

- backlog 的 `New Issue` / `Issue Detail` 改为单栏编辑弹窗，不再保留任何右侧区域。
- `running` / `review` / `completed` 保持原有编辑 + 操作侧栏结构。

### 方案

- 在 `IssuesActivity` 内基于 `dialogMode` 和 `selectedIssue.status` 派生 `isBacklogDialog`。
- backlog 分支：
  - 单栏：标题输入、描述编辑器
  - 不渲染任何右侧 `aside`
  - footer 保持 `Cancel` / `Create Issue` 或 `Save`
- 非 backlog 分支：
  - 继续使用现有 `Session` / `Actions` 侧栏

### 样式策略

- 为 backlog 弹窗增加 modifier class，例如 `.issue-dialog--backlog`。
- backlog 弹窗缩小默认宽度；非 backlog 继续保留当前宽度。
- 移动端仍退化为单栏，保持现有响应式规则。

## 附件实现方案

### 目标交互

- 在 create / edit issue 弹窗 footer 左侧增加一个文件小图标按钮。
- 点击后通过系统文件选择器选择单个文件。
- 选中文件后，在描述编辑器当前光标位置插入一个附件卡片块，效果参考用户截图。
- 附件卡片内容：
  - 左侧：文件类型 icon + 文件名
  - 右侧：条件性 `查看`、`下载`、`删除`
- `查看` 规则：
  - 图片：支持预览
  - 文本类非二进制文件（如 `md`、`json`、`txt`、`yaml`、`yml`、`ts`、`tsx`、`js`、`jsx`、`css`、`html`、`xml`、`csv` 等）：支持预览
  - 其它二进制文件：不显示 `查看`

### 存储方案

#### 持久化目录

- 附件实际文件存储到项目 repo 内隐藏目录：
  - `.redwhisk/issues/<issue-id>/attachments/<attachment-id>-<sanitized-name>`
- 这样运行 Agent Session 时，工作目录位于 repo 根目录，prompt 中注入相对路径后，Agent 可以直接读取这些文件。

#### 数据模型

- 新增 `issue_attachments` 表，建议字段：
  - `id`
  - `issue_id`
  - `display_name`
  - `stored_name`
  - `relative_path`
  - `absolute_path`
  - `mime_type`
  - `file_size`
  - `kind`（`image` / `pdf` / `word` / `text` / `generic`）
  - `is_previewable`
  - `created_at`
- `issues.description` 继续保留为 Markdown 文本。

### 编辑器内嵌方案

- 为 `IssueDescriptionEditor` 增加自定义 attachment block node。
- Markdown 持久化不直接嵌入二进制内容，而是嵌入稳定标记，例如：
  - `{{issue-attachment:123}}`
- 编辑器加载 description 时，将标记解析为 attachment node；保存时再序列化回标记。
- 这样可以同时满足：
  - 附件块“插入到编辑器里”的视觉和光标行为
  - description 仍是纯文本字段，不需要整体切换到 JSON document 存储
  - 附件顺序由 description 中的标记位置决定

### 新建 issue 与编辑 issue 的差异

#### 新建 issue

- issue 尚未创建前，附件先保存在前端 draft state 中，记录：
  - 本地选中文件路径
  - 文件名
  - 类型
  - 是否可预览
  - 临时 attachment token
- 点击 `Create Issue` 时：
  - 先创建 issue
  - 再把选中的本地文件复制到 repo 附件目录
  - 写入 `issue_attachments`
  - 用真实 attachment id 替换 description 里的临时 token
  - 最后更新 issue description

#### 编辑已有 issue

- 已存在的附件从后端读取后渲染为 attachment node。
- 新选中的附件先进入前端 draft state，不立即持久化。
- 点击 `Save` 时统一提交：
  - 新增附件复制入库
  - 被删除附件执行删除
  - 更新 description 中 attachment token 顺序

### 预览方案

- 新增附件预览 dialog。
- 图片：
  - 通过 Tauri 可访问文件路径渲染预览图
- 文本类文件：
  - 由后端读取文件内容，返回 UTF-8 文本
  - 设定合理大小上限，避免一次性读取超大文件
- 二进制文件：
  - 后端标记 `is_previewable = false`
  - 前端不显示 `查看` 按钮

### 下载方案

- 下载按钮对所有附件可见。
- 实现方式：
  - 调用保存路径对话框
  - 通过 Tauri command 把原文件复制到用户选择的位置
- 对 draft 附件也支持下载，直接从原始选中文件路径复制。

### 文件类型 icon 规则

- `pdf`：PDF icon
- `doc` / `docx`：Word icon
- `png` / `jpg` / `jpeg` / `gif` / `webp` / `svg`：图片 icon
- 其它：通用文件 icon

## Run Prompt 附件路径注入

- `buildRunPromptPreview` 追加 `Issue attachments` source。
- prompt 中列出 repo 相对路径，并明确要求 Agent 在执行前先读取这些附件。
- 推荐格式：
  - `Attachments:`
  - `- .redwhisk/issues/23/attachments/101-tsconfig.json`
- 对文本文件，这足以让 Agent 直接读取。
- 对图片文件，本次只提供路径；能否真正理解图片内容取决于底层 Agent CLI / 模型能力。

## 现有调研结论更新

### 当前现状结论

- 当前 **不支持** 在 issue 描述中上传附件，包括普通文件和图片。
- 当前执行链路 **不能直接传输附件二进制内容** 到 Agent；只有纯文本 prompt。

### 本次改动后的可行路径

- 通过 repo 内附件目录 + `issue_attachments` 表 + prompt 路径注入，可让 Agent 在执行时读取附件文件。
- 对图片附件，本次保证“路径可读”，不保证“图片语义一定可读”。

## Run Dialog 宽度分支

- `IssueRunDialog` 新增紧凑宽度 modifier，仅用于从 backlog issue 打开的场景。
- 内容结构不变，只减少桌面端宽度，避免影响现有运行流程和测试行为。

## 验证计划

- 前端测试：覆盖 backlog 与非 backlog 弹窗差异、附件插入 / 删除 / 预览按钮显隐 / 下载交互、backlog Run Dialog 紧凑宽度、运行态 / 完成态操作不回归。
- 后端测试：覆盖附件元数据保存、文件复制、文本预览判定、二进制文件禁预览和 description token 替换。
- 静态检查：`lint`、`typecheck`。
- 行为测试：受影响的 issues 前端测试与 issue service / repository 测试。
