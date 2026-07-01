## 1. Saved Agent Skills 数据模型

- [ ] 1.1 为 saved_agent_skills 增加数据库表与 migration。
- [ ] 1.2 定义 Rust `SavedAgentSkill` 类型、前后端输入/输出类型。
- [ ] 1.3 实现 repository layer 用于 CRUD 操作。
- [ ] 1.4 在 settings_service 中新增保存/列出/删除 saved skill 的方法。
- [ ] 1.5 新增 Tauri commands：`list_saved_agent_skills`、`save_saved_agent_skill`、`delete_saved_agent_skill`。
- [ ] 1.6 为 saved agent skills 增加后端测试。

## 2. Settings Skills 页面 UI

- [ ] 2.1 在 `project-settings-activity.tsx` 中新增 Skills 菜单项与状态管理。
- [ ] 2.2 创建 `settings-skills-panel.tsx` 组件，展示 skills 表格。
- [ ] 2.3 实现 skill 表格：名称列、scope 列、skill 路径列（agent 图标 + 路径列表）、操作列（编辑/删除 link）。
- [ ] 2.4 在 i18n messages 中新增 Skills 相关文案。

## 3. 新建/编辑 Skill Modal

- [ ] 3.1 创建 skill form 组件，包含 scope 选择、名称搜索下拉、路径选择 checkbox 列表。
- [ ] 3.2 实现 scope 切换时重新加载可用 skills 并按名称归一化分组。
- [ ] 3.3 实现选择 skill 后的 agent type paths 列表展示与 checkbox 选择。
- [ ] 3.4 实现保存时的名称唯一性验证、项目级相对路径处理。

## 4. 验证

- [ ] 4.1 新增/更新相关前端测试。
- [ ] 4.2 运行 `pnpm lint`。
- [ ] 4.3 运行 `pnpm typecheck`。
- [ ] 4.4 运行相关前端测试。
- [ ] 4.5 运行 `cargo test --manifest-path src-tauri/Cargo.toml --test settings`。
