## 1. Label 持久化与命令

- [x] 1.1 新增 label 数据模型、repository、service 和 migration，支持项目级与全局级 label 持久化。
- [x] 1.2 新增 label 的 list/save/delete Tauri commands 与前端 command types。
- [x] 1.3 实现服务端校验：名称 trim、最大 15 字符、项目级唯一性、全局级跨项目唯一性，以及 agent / workflow skill 关联约束。
- [x] 1.4 补充 Rust 测试，覆盖 CRUD 与唯一性、非法 agent/skill 组合。

## 2. Project Settings Labels UI

- [x] 2.1 在 Project Settings 左侧菜单中新增 `Labels` 项，并保持顺序为 `General`、`Agents`、`Labels`。
- [x] 2.2 在右侧新增 `Labels` 页面，包含标题、`+ New label` 按钮和 table 布局。
- [x] 2.3 实现 labels table 的 `Name`、`Scope`、`Color`、`Workflow Skill`、`Actions` 列，以及点击名称进入编辑。
- [x] 2.4 实现删除 link button 与列表刷新逻辑。

## 3. Label 弹窗交互

- [x] 3.1 新增创建 / 编辑 label 弹窗，包含名称、scope、颜色、agent 和条件渲染的 workflow skill 字段。
- [x] 3.2 实现颜色选择：支持颜色面板自选，并提供约 10 个常用颜色快捷选项。
- [x] 3.3 合并当前项目与全局 agent profiles 作为 agent 下拉选项，默认 `None`。
- [x] 3.4 在选择 agent 后加载并限制 workflow skill 为单选；取消 agent 时清空该字段。
- [x] 3.5 实现前端同步校验与错误展示，包括 15 字符上限和保存失败反馈。

## 4. Spec 与测试回填

- [x] 4.1 更新 `settings-ui` spec，补充 `Labels` 菜单与页面需求，并修正 Project Settings 菜单基线描述。
- [x] 4.2 新增 `project-labels` spec，定义 label 数据规则与唯一性语义。
- [x] 4.3 补充前端测试，覆盖菜单顺序、列表展示、弹窗字段显隐、编辑与删除。

## 5. 验证

- [x] 5.1 运行 `pnpm lint`。
- [x] 5.2 运行 `pnpm typecheck`。
- [x] 5.3 运行 `pnpm test -- src/features/settings/project-settings-activity.test.tsx`。
- [x] 5.4 运行受影响的 Rust label / settings 测试命令。
