## 1. 后端：migration 与数据模型

- [ ] 1.1 新增 `src-tauri/migrations/0030_drop_label_agent_profile.sql`：置 NULL `workflow_skill`，DROP `agent_profile_id` 列。
- [ ] 1.2 `ProjectLabelRecord` / `SaveProjectLabelInput` 移除 `agent_profile_id`、`agent_name` 字段。
- [ ] 1.3 `project_label_repository.rs`：SELECT 去 `agent_profiles` LEFT JOIN 与 `agent_name`；INSERT/UPDATE 去 `agent_profile_id` 列与参数；`find_label_by_id` 同步。
- [ ] 1.4 `settings_service.rs`：删除 `validate_label_agent_assignment` 及调用；`save_project_label` 不再处理 `agent_profile_id`；`project_label_record_from_row` 去 agent 映射。
- [ ] 1.5 注册新 migration（确认 migration 注册机制，如 `migrations` 宏或 `_sqlx_migrations`）。

## 2. 后端：测试

- [ ] 2.1 更新 `cargo test --test settings` 中 label CRUD 用例：移除 agent 字段断言、覆盖 `workflow_skill` 单独保存（无 agent）成功。
- [ ] 2.2 新增 migration 测试：旧 label 行在迁移后 `agent_profile_id` 列不存在、`workflow_skill` 为 NULL。

## 3. 前端：类型与 Agent 表单

- [ ] 3.1 `settings-commands.ts`：`ProjectLabelRecord` 去 `agentProfileId`/`agentName`；`SaveProjectLabelInput` 去 `agentProfileId`。
- [ ] 3.2 `agent-profile-form.tsx`：移除工作流技能 MultiSelect 区块、skill 状态、`listAgentSkills` 调用、`agent-skills-updated` 监听、`workflowSkillOptions`；`saveAgentProfile` 提交 `defaultSkill: ""`。
- [ ] 3.3 `settings-agents-panel.tsx`：表头与行移除"工作流技能"列；清理 `formatDefaultSkills` / `agent-profile-skills` import（确认无其他引用）。

## 4. 前端：Label 表单与列表

- [ ] 4.1 `project-label-form.tsx`：移除 Agent 字段与 `agentProfileId` 状态；加载 saved skills（项目 + 全局合并）作为"工作流技能"单选选项（value = skill name）；保存不传 agentProfileId。
- [ ] 4.2 `settings-labels-panel.tsx`：移除 Agent 列；评估移除 `profiles` prop（含上层 `project-settings-activity` 透传）。
- [ ] 4.3 i18n：移除 Agent 表单技能文案、Label 表单 `agent` 文案（grep 确认无 Skills 设置页复用后再删）。

## 5. 前端：issue-run-dialog

- [ ] 5.1 `loadRunDialogContext` 追加 `list_saved_agent_skills`（project + global）两次调用并合并为 `savedSkills`。
- [ ] 5.2 `workflowSkillOptions` 改为按 `selectedProfile.agentType` 过滤 `savedSkills`（`skillPaths` 含该 agentType）。
- [ ] 5.3 重写 `resolveInitialWorkflowSkill`：遍历 `issue.labels`，取第一个 `workflow_skill` 存在于过滤后选项的 name；否则 null（"无"）。
- [ ] 5.4 移除 `readRecentWorkflowSkill` / `saveRecentWorkflowSkill` / `RECENT_WORKFLOW_SKILL_STORAGE_KEY`；Agent 切换时按新 agentType 重算选项与默认。
- [ ] 5.5 技能下拉始终展示（含"无"），不再受 `shouldShowWorkflowSkill` 隐藏。
- [ ] 5.6 `run-prompt-builder.ts`：`configuredSkills` 恒 `[]`，`defaultSkills` 仅由 `selectedWorkflowSkill` 决定；`buildSkillInstruction` 不变。

## 6. 验证

- [ ] 6.1 新增/更新前端测试：run dialog 技能按 agentType 过滤、默认来自 Label 或"无"、Agent 切换重算。
- [ ] 6.2 新增/更新前端测试：Label 表单技能选项来自 saved skills、无 Agent 字段；Agent 表单无技能字段。
- [ ] 6.3 运行 `pnpm lint`。
- [ ] 6.4 运行 `pnpm typecheck`。
- [ ] 6.5 运行相关前端测试。
- [ ] 6.6 运行 `cargo test --manifest-path src-tauri/Cargo.toml --test settings`。
