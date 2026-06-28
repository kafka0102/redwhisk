## 1. OpenSpec

- [x] 1.1 编写 proposal、design、tasks 与 issues-ui spec delta。

## 2. 实现

- [x] 2.1 引入 Quill 依赖并封装通用富文本编辑器组件。
- [x] 2.2 在 Issue 描述编辑器中接入通用组件，支持图片和附件内嵌显示。
- [x] 2.3 移除编辑器下方附件上传图标，保留标签选择入口。
- [x] 2.4 更新样式，匹配 RedWhisk 设计 token 与可访问交互状态。

## 3. 验证与归档

- [x] 3.1 运行 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`。
- [x] 3.2 运行 `openspec validate use-rich-text-issue-description --strict`。
- [x] 3.3 完成 OpenSpec 快速路径归档与提交。
