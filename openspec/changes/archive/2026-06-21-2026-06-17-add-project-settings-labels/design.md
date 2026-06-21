## Overview

本次改动在现有 Project Settings 框架内新增一个 `Labels` 配置模块。实现重点不是视觉重构，而是补齐一条完整的 label 配置链路：左侧菜单入口、右侧列表与弹窗、前后端 CRUD、以及跨 scope 的唯一性规则。

## Data Model

建议新增 `project_labels` 表或等价持久化结构，至少包含：

- `id`
- `name`
- `scope`：`global` | `project`
- `project_id`：全局 label 为 `null`
- `color`
- `agent_profile_id`：可空
- `workflow_skill`：可空
- `created_at` / `updated_at`
- `del`：沿用项目现有软删除约定时使用

约束规则：

- `name` 以 trim 后值参与校验与保存。
- `scope=project` 时，唯一性范围是 `(project_id, normalized_name)`。
- `scope=global` 时，唯一性范围覆盖所有未删除 label；若任意项目级或全局级已存在同名 label，则拒绝保存。
- `workflow_skill` 仅在 `agent_profile_id` 非空时允许非空；未选择 agent 时，保存时强制清空 `workflow_skill`。

## Frontend Behavior

### Settings 菜单

- 在 `SettingsMenu` 联合类型与菜单配置中新增 `labels`。
- `Labels` 位于 `Agents` 下方，沿用既有 splitter、80% 右侧内容宽度与 section header 模式。

### Labels Table

- 顶部 header 显示 `Labels` 标题，右上角按钮文案为 `+ New label`。
- table 列定义：
  - `Name`：主行显示 label 名称，次行显示 agent 名称；未选 agent 时显示稳定占位。
  - `Scope`：显示 `Global` 或 `Project`。
  - `Color`：显示 `#RRGGBB` 文本，文本颜色即该颜色值。
  - `Workflow Skill`：未配置时显示稳定占位。
  - `Actions`：仅包含删除 link button。
- 点击 `Name` 列中的 label 名称，打开编辑弹窗。

### Label Dialog

- 创建与编辑复用同一弹窗组件。
- 字段顺序：
  - `Name`
  - `Scope`
  - `Color`
  - `Agent`
  - `Workflow Skill`（仅在已选择 agent 时显示）
- `Color` 可以采用原生 `input[type="color"]` 加 10 个左右固定常用颜色快捷项的组合，减少实现复杂度并满足“自选或固定色”需求。
- `Agent` 下拉列表需要合并当前项目 profile 与全局 profile，默认 `None`。
- 当用户切换 agent 为 `None` 时，立即隐藏并清空 `Workflow Skill`。
- `Workflow Skill` 为单选，选项来源于当前所选 agent 对应的 skills 数据。

## Backend and Validation

- 新增 `list_project_labels`、`save_project_label`、`delete_project_label` 命令。
- `save_project_label` 服务层负责名称长度、trim、唯一性和 agent/skill 关联校验，前端只做轻量同步校验。
- 若提交了不存在的 `agent_profile_id`，或该 agent 不属于当前项目 / 全局可见范围，则拒绝保存。
- 若提交了 `workflow_skill` 但 `agent_profile_id` 为空，则拒绝保存或自动清空，建议直接拒绝以保持契约明确。
- 若提交了 `workflow_skill` 且该 skill 不属于所选 agent 的可选 skill 集，则拒绝保存。

## Testing Strategy

- 前端测试覆盖：
  - 菜单顺序为 `General`、`Agents`、`Labels`
  - `Labels` 页标题、按钮与表格列
  - 新建弹窗字段显隐与颜色快捷选择
  - 名称长度限制
  - 点击 label 名称进入编辑
  - 删除动作
- Rust 测试覆盖：
  - 项目级唯一性
  - 全局级唯一性跨项目拦截
  - agent / workflow skill 关联校验
  - CRUD 基本路径
