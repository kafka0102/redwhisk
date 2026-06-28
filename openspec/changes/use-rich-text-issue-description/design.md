# 设计说明

## 编辑器选型

采用 Quill 2 的直接集成方式，而不是 `react-quill` 包装层。Quill 官方提供独立编辑器实例、toolbar module 和自定义 embed 能力，适合在 React 组件中通过 `ref` 生命周期管理。Markdown 快捷输入不是 Quill 的内置核心能力，因此在通用组件内实现当前需要的常用快捷规则。

## 数据格式

Issue 描述继续以 Markdown 文本保存。组件接收 Markdown 字符串，将其转换为 Quill Delta 渲染；编辑时再从 Delta 序列化回 Markdown。这样不改变 Rust DTO、SQLite 字段和 Agent run prompt 的输入格式。

附件仍由 Issue feature 维护数组状态。通用组件只接收附件 view model 与插入/预览/下载/删除回调，不负责读取文件系统或调用 Tauri command。

## 组件边界

- `src/components/ui/rich-text-editor.tsx`：通用 Quill 组件、Markdown 转换、快捷输入、附件 embed 渲染。
- `src/features/issues/issue-description-editor.tsx`：Issue 专用适配层，提供附件类型定义、图标、业务回调和文案透传。
- `IssueEditablePage`：移除附件 footer 按钮，把上传回调传入描述编辑器。

## 适用性与限制

Quill 适合本次需求中的常规富文本、toolbar、自定义 embed 和图片展示。它不直接负责文件上传、Markdown 完整语法解析或附件持久化；这些由应用层补足。本次仅实现标题、加粗、列表和常见 Markdown 快捷输入，避免把完整 Markdown 解析器引入当前范围。
