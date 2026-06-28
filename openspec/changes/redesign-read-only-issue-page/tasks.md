## 1. OpenSpec

- [x] 1.1 编写 proposal、design、tasks 与 issues-ui spec delta。

## 2. 实现

- [x] 2.1 调整只读 Issue Header：删除独立删除按钮，新增更多菜单并接入编辑、会话、总结、删除动作。
- [x] 2.2 将只读 Issue 详情主体改为单栏布局，移除右栏展示。
- [x] 2.3 修复描述附件渲染：图片 token 转绝对路径展示，非图片附件在描述中展示并支持下载与可用预览。
- [x] 2.4 在有标签时于描述下方增加分割线并平铺展示标签，沿用现有标签样式。
- [x] 2.5 补齐新增或变更的用户可见文案国际化。

## 3. 验证与归档

- [x] 3.1 运行 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`。
- [x] 3.2 运行 `openspec validate redesign-read-only-issue-page --strict`。
- [x] 3.3 完成 OpenSpec 快速路径归档与提交。
