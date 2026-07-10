## Why

只读 Issue 详情页目前是居中单栏布局，缺少与 session 侧栏对称的运行参数与会话信息，用户查看 Issue 后还要切到 session 页才能确认执行上下文。需要把详情改为双栏，并在右侧复用 session issue panel 的信息布局。

## What Changes

- 将只读 Issue 详情页从居中单栏改为左右双栏布局。
- Header 分割线保持顶头全宽；Issue ID 与右侧动作按钮各自留 10px 水平边距。
- 内容区左右栏各留 10px 边距；左侧继续展示标题、描述与标签。
- 右侧栏宽度与 session 页面 side panel 默认宽度一致（400px）。
- 右侧内容布局对齐 session issue panel：上方为“会话信息”卡片（含“查看会话”按钮，跳转 session 页），下方为“运行参数”卡片。
- 通过关联 session 加载运行参数与会话信息；无关联 session 时展示空态。

## Non-goals

- 不改动 Issue 编辑页、看板列表或状态机。
- 不改变 session side panel 的既有 tab 行为。
- 不新增后端 command 或 DTO 字段。

## Impact

- 前端：`src/features/issues/**`、`src/app/app.css`、`src/shared/i18n/messages.ts`（如需）
- 规格：`openspec/specs/issues-ui/spec.md`
- 验证：更新 Issues Activity / 只读详情相关测试
