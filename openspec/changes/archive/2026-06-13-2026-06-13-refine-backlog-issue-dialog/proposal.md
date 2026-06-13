## Why

Issues 页面当前所有 issue 详情弹窗都复用同一套双栏结构。对于 backlog 的新建 issue 和 issue 详情，这个结构右侧仍然保留 Session / Actions 信息，占用了主要编辑空间，也让运行按钮弹出的 Run Dialog 显得偏宽。与此同时，描述区目前仍是纯 Markdown 文本，不能像用户给出的参考图那样内嵌附件卡片，也无法为执行 prompt 提供可读取的附件路径。

## What Changes

- 将 backlog 专属的 `New Issue` 与 `Issue Detail` 弹窗改为单栏布局，只保留标题和描述编辑区，不再渲染任何右侧内容，也不再展示原有 `Session` / `Actions` 侧栏。
- backlog issue card 右下角保留运行 icon 入口；从 backlog 打开的 `Run Dialog` 采用更窄的宽度。
- `running`、`review`、`completed` 三种状态的 issue 详情弹窗保持现有结构与宽度，不受本次改动影响。
- 在 create / edit issue 弹窗 footer 左侧新增文件 icon 入口，点击后调用系统文件选择器，把所选文件以附件卡片块插入描述编辑器，视觉效果对齐参考图。
- 附件卡片左侧根据类型显示特定 icon：PDF、Word、图片使用专属 icon，其它文件使用通用文件 icon。
- 附件卡片右侧提供删除与下载按钮；若附件可预览，则额外显示眼睛 icon 的 `查看` 按钮。图片和文本类非二进制文件支持预览；二进制文件不显示 `查看`。
- 为 issue 增加附件持久化与预览 / 下载链路，并在运行 prompt 中注入附件路径，确保 Agent 能读取附件文件。
- 补充 backlog 弹窗、附件卡片、附件预览框与 Run Dialog 的样式分支和测试。

## Non-goals

- 不调整 `running`、`review`、`completed` issue 的既有操作区文案和交互。
- 不改动 Agents 页面或其它 Settings / Session 相关布局。
- 不在本次为所有二进制格式实现应用内预览；只有图片和文本类非二进制文件支持预览。
- 不保证底层 Agent 一定能“理解”图片内容；本次只保证运行 prompt 能拿到附件路径，图片理解仍取决于底层 Agent CLI / 模型能力。

## Capabilities

### New Capabilities

- `issues-ui`: 定义 Issues backlog 弹窗、附件块编辑体验、附件预览和 Run Dialog 的状态分支布局规则。
- `issue-attachments`: 定义 issue 附件的持久化、预览、下载和 prompt 路径注入行为。

## Impact

- 前端：`src/features/issues/issues-activity.tsx`、`src/features/issues/issue-description-editor.tsx`、`src/features/issues/issue-run-dialog.tsx`、相关样式与测试。
- 后端：issue 类型、命令、service、repository、migration，以及附件预览 / 下载相关 Tauri command。
- Prompt：`run-prompt-builder.ts` 需要追加附件路径段，运行时让 Agent 能读取 repo 内附件。
- 验证：至少覆盖 backlog / 非 backlog 弹窗差异、附件插入 / 删除 / 预览 / 下载、Run Dialog 宽度分支，以及现有运行 / 完成态详情不回归。
