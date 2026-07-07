## Why

当前 Agents Activity 的右侧 Session side panel 只有 `变更` 和 `文件` 两个 tab。用户想在查看 Agent Session 时直接看到关联 Issue 的关键信息，但现在只能从顶部标题看到 `#id + 标题`，无法在侧边栏里查看描述和标签，也无法从这里直接跳回 Issue 看板详情。

## What Changes

- 在 Session side panel 顶部新增一个名为 `Issue` 的 tab，并放在第一个位置。
- 当当前 Session 存在关联 Issue 时，打开侧边栏后默认展示 `Issue` tab。
- `Issue` tab 展示：
  - 标题行：左侧显示 Issue 标题，右侧显示 `查看 issue` link button。
  - 第一条分割线后展示 Issue 描述。
  - 若存在标签，再显示第二条分割线和标签列表。
- 点击 `查看 issue` 后，切换到 Issues Activity，并定位到对应 Issue 的详情页。
- 对无关联 Issue 的 Session，保持现有 `变更` / `文件` 体验，不新增额外主路径。

## Non-goals

- 不改动 Issue 数据模型、后端 command 或 Issue 看板详情布局。
- 不在本次任务中为 Session side panel 新增 Markdown 富文本渲染能力。
- 不调整 `变更` / `文件` tab 的已有数据加载逻辑。

## Impact

- 前端：`src/features/agents/**`、`src/app/**`、`src/shared/i18n/messages.ts`、`src/app/app.css`
- 规格：`openspec/specs/agents-ui/spec.md`
- 验证：更新 Agents Activity 测试，覆盖 side panel 默认打开 Issue tab、Issue 内容展示与跳转行为
