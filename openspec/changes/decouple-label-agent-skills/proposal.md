## Why

当前 Label 通过 `agent_profile_id` 关联 Agent，再借 Agent 的 `default_skill` 限定 Label 可选的工作流技能；issue 运行对话框也依赖所选 Agent 的 `default_skill` 提供技能选项。这套耦合存在三个问题：

1. Label 必须先选 Agent 才能选技能，而用户实际只想给标签挂一个技能。
2. Agent 表单承担了"工作流技能配置"职责，与 Settings 已新增的 Skills 管理能力（`saved_agent_skills`）重复。
3. issue 运行时技能来源绑死在所选 Agent 的 `default_skill`，无法跨 Agent 复用已保存的技能。

解耦后：Agent 只管命令与执行参数；Label 直接引用 saved skill；issue 运行时从 saved skills 按所选 Agent 类型取技能列表。

## What Changes

- Agent 创建/编辑表单移除"工作流技能"字段；Agents 列表移除"工作流技能"列。`agent_profiles.default_skill` 列保留但不再由 UI 写入（保存时置空）。
- Label 数据移除 `agent_profile_id` / `agent_name`；Labels 列表移除 Agent 列。Label 表单移除 Agent 字段，"工作流技能"改为从 saved skills 表取（单选，项目 + 全部全局 saved skills，不再按 agent 过滤），存 saved skill 的 `name`。
- 后端：新增 migration 移除 `project_labels.agent_profile_id` 列；移除 `validate_label_agent_assignment` 校验；`project_label_repository` 去掉与 `agent_profiles` 的 LEFT JOIN；`save_project_label` / `ProjectLabelRecord` / `SaveProjectLabelInput` 去掉 agent 字段；migration 将旧 `workflow_skill` 值置 NULL（语义已变，需用户重新选择）。
- issue-run-dialog：
  - Agent 下拉直接来自已配置 Agent（项目 + 全局合并），默认最近一次 issue 会话使用的 Agent；移除任何基于 Label 的 Agent 解析。
  - 工作流技能列表来自 saved skills（项目 + 全局合并，两次 `list_saved_agent_skills` 调用），按所选 Agent 的 `agentType` 过滤（保留 `skillPaths` 中含该 agentType 的 saved skill）。
  - 默认技能：遍历 issue 关联 Label，取第一个其 `workflow_skill`（saved skill name）存在于上述过滤后列表中的 skill 选中；若都不匹配或无 Label 关联技能，默认"无"。
- run-prompt-builder：不再从 `profile.defaultSkill` 取技能；"Default skills"段仅由所选 saved skill（name）构成，`buildSkillInstruction` 行为不变（仍用 skill name 拼 prompt）。
- i18n：移除 Agent 表单技能相关文案、Label 表单 Agent 文案；保留 run dialog 技能文案。

## Non-goals

- 不改动 `saved_agent_skills` 数据模型与 Skills 设置页本身（由 `add-settings-skills-menu` change 负责）。
- 不改动 `start_agent_session` 后端启动逻辑（prompt 仍由前端构建后作为 `prompt_snapshot` 传入）。
- 不删除 `agent_profiles.default_skill` 列（仅停止写入），避免破坏旧数据读取与回滚风险。
- 不改动 issue label picker、label 颜色 / 名称 / scope 校验。
- 不自动把旧 `workflow_skill` 值映射到 saved skill name（语义已变，统一置 NULL 由用户重选）。

## Capabilities

- MODIFIED `settings-ui`：Agent 表单 / 列表移除工作流技能字段。
- MODIFIED `project-labels`：Label 移除 agent 关联，工作流技能改引 saved skills。
- MODIFIED `issues-ui`：run dialog 技能来源与默认逻辑、Agent 默认选择。
- MODIFIED `agent-skill-index`：移除"Agent Profile skill selection"要求（Agent 表单不再选技能）。

## Impact

- 前端：`settings-agents-panel.tsx`、`agent-profile-form.tsx`、`settings-labels-panel.tsx`、`project-label-form.tsx`、`issue-run-dialog.tsx`、`run-prompt-builder.ts`、`settings-commands.ts` 类型、i18n messages、相关测试。
- 后端：新 migration、`project_label_repository.rs`、`settings_service.rs`（移除校验 / JOIN）、`types`（`ProjectLabelRecord` / `SaveProjectLabelInput` 去 agent 字段）、`issue_service.rs`（`to_issue_label_record` 已不含 agent 字段，无需改）、相关测试。
- 数据迁移：旧 label 的 `agent_profile_id` 列删除；`workflow_skill` 旧值置 NULL。用户需在 Label 表单重新选择 saved skill。
- 验证：覆盖 Label 表单无 agent、技能源自 saved skills；run dialog 技能按 agentType 过滤、默认来自 Label 或"无"；Agent 表单无技能字段；后端 label CRUD 不再写 agent 字段。

## 显式默认（批准 gate 可修正）

1. **Label 技能基数**：单个 saved skill 引用（已与用户确认）。`project_labels.workflow_skill` 存 saved skill 的 `name`。
2. **run-prompt-builder 注入值**：注入 saved skill 的 **name**（与现有 `buildSkillInstruction` 一致），不注入文件系统 path。
3. **`agent_profiles.default_skill` 列**：保留，UI 不再写入，保存时传空串。
4. **旧 `workflow_skill` 数据**：migration 置 NULL。
5. **saved skill 同名冲突**（项目级与全局级同名）：dropdown 仍以 name 为值；若重名，展示时追加 scope 后缀，默认选择取合并列表中第一个匹配项。此为已知边角，不在本次专门处理。
