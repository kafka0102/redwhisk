## Why

Project Settings 当前只有 `General` 和 `Agents` 两个菜单项，缺少用于维护项目标签（Label）的配置入口。用户无法在 Settings 中集中管理标签名称、作用域、颜色、关联 Agent 与对应 workflow skill，也无法在项目级和全局级之间施加唯一性约束。

此外，现有 `settings-ui` spec 对 Project Settings 菜单结构仍残留 `Terminals` 约束，但当前实现基线并未在该页面渲染该菜单项。若继续在此基础上新增 `Labels`，formal spec 会与当前产品行为进一步分叉。

## What Changes

- 在 `Project Settings` 左侧菜单中，于 `Agents` 下方新增 `Labels`，使菜单顺序为 `General`、`Agents`、`Labels`。
- 新增 `Labels` 页面：右侧沿用与 `Agents` 相同的 Settings 布局，顶部显示 `Labels` 标题，右上角提供 `+ New label` 按钮，下方显示 labels table。
- labels table 包含 `Name`、`Scope`、`Color`、`Workflow Skill` 和 `Actions` 列。其中 `Name` 列同时展示 label 名称与所选 agent 名称。
- 新增 label 创建与编辑弹窗，支持填写名称、scope、颜色、可选 agent，以及在已选择 agent 时出现的单选 `Workflow Skill`。
- 在保存 label 时增加业务校验：
  - 名称最长 15 个字符。
  - 项目级 label 在单个项目内唯一，不同项目之间允许重名。
  - 全局级 label 在全局范围以及所有项目中都必须唯一。
- 当用户点击 table 中的 label 名称时，弹出编辑窗口并允许修改；`Actions` 列提供删除 link button。

## Capabilities

### Modified Capabilities

- `settings-ui`: 扩展 Project Settings 菜单与右侧内容区，新增 `Labels` 模块、table 展示与 label 弹窗交互。
- `agent-skill-index`: label 弹窗在已选 agent 时需要按选中 agent 提供 workflow skill 单选数据。

### Added Capabilities

- `project-labels`: 定义项目与全局 label 的存储模型、唯一性校验、增删改查命令，以及在 Settings 页面中的配置体验。

## Non-goals

- 不在本次 change 内把 labels 接入 issue、agent session、过滤器、搜索、统计或其他执行流。
- 不支持多选 workflow skills，也不支持为未选择 agent 的 label 强制填写 skill。
- 不引入颜色分组、排序、拖拽、批量删除、导入导出或远程同步。

## Impact

- 前端：`src/features/settings/project-settings-activity.tsx`、相关设置命令、样式与测试，新增 labels 页面状态与弹窗组件。
- Tauri / Rust：新增 label 类型、repository、service、command 和必要 migration。
- 数据：需要新增 labels 持久化表或等价结构，以保存名称、scope、颜色、关联 agent profile 与 workflow skill。
- OpenSpec：更新 `settings-ui` spec，并新增 `project-labels` spec。
