## Why

Issue 新建 / 编辑弹窗目前只有标题和描述字段，虽然项目已经支持在 Settings 中维护项目级与全局 labels，但 issue 无法直接关联这些 labels，也缺少从 issue 编辑流跳去管理 labels 的入口。结果是 labels 配置与 issue 执行入口之间断开，用户无法在创建 backlog issue 时快速标记 agent / workflow 语义。

## What Changes

- 为 issue 数据模型增加 `labels` 字段，在 create / update / list 流程中持久化 label 关联。
- 在 backlog issue 的新建 / 编辑弹窗里，于描述字段下方新增 `labels` 行：左侧是文本标签，右侧是小型多选下拉框。
- 下拉框合并展示当前项目 labels 与全局 labels；列表底部提供 `管理 labels` 入口，并与 labels 选项之间加入分隔线。
- 当当前没有任何可选 labels 时，下拉列表改为显示 `添加标签` 入口，点击后跳转到项目设置页的 `labels` tab。
- 已选 labels 在触发框内部以带颜色的 label chip 形式展示；下拉列表中的 label 行也以白底 / 深色模式黑底承载彩色 label chip 展示。
- 补充 issue labels 的交互测试、持久化测试，以及跳转到 settings labels 的页面状态。

## Non-goals

- 不在本次改动 issue 卡片、只读详情页或 run prompt 的 label 展示。
- 不改动 labels 配置页现有 CRUD 规则。
- 不引入新的通用下拉框抽象；仅为 issue dialog 实现当前需要的最小交互。

## Capabilities

### New Capabilities

- `issues-ui`: 定义 issue 新建 / 编辑弹窗中的 labels 选择、空状态与设置跳转行为。

## Impact

- 前端：`src/features/issues/**`、`src/app/**`、相关样式与测试。
- 后端：issue 类型、repository、service、migration、Tauri tests。
- 验证：至少覆盖 label 选择展示、无 labels 时的 `添加标签` 入口、settings labels tab 跳转，以及 issue label 持久化。
