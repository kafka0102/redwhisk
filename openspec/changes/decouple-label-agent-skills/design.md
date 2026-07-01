# Design — decouple-label-agent-skills

记录跨层改动的技术设计：DB migration、后端类型/仓储/服务、前端类型与 run dialog 技能解析算法、prompt 构建变更。

## 1. 数据库 migration

新增 migration `src-tauri/migrations/0030_drop_label_agent_profile.sql`（编号顺延当前最大）：

```sql
-- 旧 label->agent 关联与 workflow_skill 语义已废弃：
-- agent 关联整列删除；workflow_skill 语义从"agent default_skill 中的名"
-- 改为"saved_agent_skills.name"，旧值不可直接映射，置 NULL 由用户重选。
UPDATE project_labels SET workflow_skill = NULL WHERE workflow_skill IS NOT NULL;
-- SQLite 不允许 DROP COLUMN 被 FOREIGN KEY 引用的列，走表重建。
CREATE TABLE project_labels_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('global', 'project')),
  project_id INTEGER,
  color TEXT NOT NULL,
  workflow_skill TEXT,
  del INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
INSERT INTO project_labels_new (id, name, scope, project_id, color, workflow_skill, del, created_at, updated_at)
SELECT id, name, scope, project_id, color, workflow_skill, del, created_at, updated_at FROM project_labels;
DROP TABLE project_labels;
ALTER TABLE project_labels_new RENAME TO project_labels;
```

- 不删 `agent_profiles.default_skill`（Non-goals）。
- `agent_profile_id` 是 FK（`REFERENCES agent_profiles(id)`），SQLite 不允许 `ALTER TABLE DROP COLUMN` 删除被 FK 引用的列，故采用 SQLite 官方推荐的表重建流程（CREATE new → INSERT copy → DROP old → RENAME）。
- 0023 未在 `project_labels` 上建任何索引，无其他表 FK 引用 `project_labels`，故 `DROP TABLE` 无副作用。
- 迁移在 `BEGIN IMMEDIATE` 事务内执行，重建原子可回滚。

## 2. 后端类型与仓储

`src-tauri/src/types/project_label.rs`（或对应位置）：

- `ProjectLabelRecord`：移除 `agent_profile_id`、`agent_name` 字段。
- `SaveProjectLabelInput`：移除 `agent_profile_id` 字段。

`src-tauri/src/db/project_label_repository.rs`：

- `list_labels_by_scope` 等 SELECT 去掉 `LEFT JOIN agent_profiles` 与 `agent_profiles.name AS agent_name`。
- `save_label` 的 INSERT/UPDATE 去掉 `agent_profile_id` 列与绑定参数。
- `find_label_by_id` 同步去 JOIN。

`src-tauri/src/core/settings_service.rs`：

- 删除 `validate_label_agent_assignment`（"workflow_skill ⇒ agent_profile_id"校验）及其调用。
- `save_project_label` 不再读取 / 传递 `agent_profile_id`。
- `project_label_record_from_row` 去掉 agent 字段映射。

`issue_service.rs::to_issue_label_record` 已只产出 id/name/scope/project_id/color/workflow_skill，无需改动。

## 3. 前端类型

`src/features/settings/settings-commands.ts`：

- `AgentProfileRecord`：保留 `defaultSkill` 字段（后端仍返回，UI 不再写）。
- `ProjectLabelRecord`：移除 `agentProfileId`、`agentName`。
- `SaveProjectLabelInput`：移除 `agentProfileId`。

## 4. Agent 表单 / 列表

`agent-profile-form.tsx`：

- 移除 `SearchableMultiSelect` 工作流技能区块、`selectedSkillKeys` 状态、`listAgentSkills` 调用、`agent-skills-updated` 监听、`workflowSkillOptions` 计算。
- `saveAgentProfile` 提交 `defaultSkill: ""`。
- 保留 Name / Type / Command / Scope 字段与命令测试逻辑。

`settings-agents-panel.tsx`：

- 表头移除 `messages.settings.workflowSkill` 列、行移除 `formatDefaultSkills(profile.defaultSkill)` 单元格、移除 `formatDefaultSkills` / `agent-profile-skills` import（若仅此处使用）。

## 5. Label 表单 / 列表

`project-label-form.tsx`：

- 移除 `agentProfileId` 状态、Agent 字段 Select、`selectableProfiles`、`availableWorkflowSkills`（来自 `selectedProfile.defaultSkill`）逻辑。
- 新增：加载 saved skills（项目 + 全局，两次 `list_saved_agent_skills` 合并），作为"工作流技能"单选下拉选项（label = skill name，value = skill name）。
- `workflowSkill` 状态存 saved skill name；保存时 `saveProjectLabel` 不传 agentProfileId。
- scope 切换不再清空 agent（已无 agent）；仍可保留清空技能逻辑或不变。

`settings-labels-panel.tsx`：

- 表头移除 `messages.settings.agent` 列、行移除 `label.agentName` 单元格。
- `profiles` prop 若不再被 Label 表单使用，可从 panel props 移除（连带上层 `project-settings-activity` 透传）。

## 6. issue-run-dialog 技能解析

替换现有 `workflowSkillOptions` / `resolveInitialWorkflowSkill` / `resolveLabelWorkflowSkill` 逻辑。

### 6.1 数据加载

在 `loadRunDialogContext` 的 `Promise.all` 中追加：

```ts
listSavedAgentSkills({ scope: "project", projectId }),
listSavedAgentSkills({ scope: "global", projectId: null }),
```

合并为 `savedSkills: SavedAgentSkillRecord[]`。

### 6.2 技能列表（按 agentType 过滤）

```ts
const workflowSkillOptions = useMemo(() => {
  if (!selectedProfile) return [];
  return savedSkills.filter((skill) =>
    skill.skillPaths.some((p) => p.agentType === selectedProfile.agentType),
  );
}, [savedSkills, selectedProfile]);
```

下拉值 = saved skill `name`；始终展示（含"无"选项），不再依赖 `shouldShowWorkflowSkill` 隐藏。

### 6.3 默认技能

```ts
function resolveInitialWorkflowSkill({
  issue,
  options, // 已按 agentType 过滤的 saved skills
}: {
  issue: Pick<IssueRecord, "labels">;
  options: SavedAgentSkillRecord[];
}): string | null {
  const optionNames = new Set(options.map((s) => s.name));
  for (const label of issue.labels ?? []) {
    const name = (label.workflowSkill ?? "").trim();
    if (name.length > 0 && optionNames.has(name)) {
      return name;
    }
  }
  return null; // "无"
}
```

- Agent 切换时重新计算选项与默认（`resolveInitialWorkflowSkill` 以新 agentType 的选项重跑）。
- 移除 `readRecentWorkflowSkill` / `saveRecentWorkflowSkill` / `RECENT_WORKFLOW_SKILL_STORAGE_KEY`（基于 profileId 的 recent 逻辑不再需要；默认完全由 Label 决定，否则"无"）。
- `NO_WORKFLOW_SKILL_VALUE` 保留表示"无"。

### 6.4 Agent 默认选择

`resolveInitialProfile` 已用最近 issue 会话 + 末位 profile，符合"默认最近一次使用"，保留。移除任何对 `issue.labels` 的 agent 解析（当前代码本就没有，仅确认）。

## 7. run-prompt-builder

`buildRunPromptPreview`：

- 入参 `profile.defaultSkill` 不再用于 `configuredSkills`；`configuredSkills` 恒为 `[]`。
- `defaultSkills` 仅由 `selectedWorkflowSkill` 决定：非空且非"无" → `[name]`，否则 `[]`。
- `buildSkillInstruction(name)` 不变。
- `RunPromptSource` 的 `default-skill` 段保留。

`issue-run-dialog` 传 `selectedWorkflowSkill` = 选中的 saved skill name 或 null（"无"）。

## 8. i18n

- 移除：Agent 表单技能相关 key（`workflowSkill` 若仅 Agent 用、`loadingSkills`/`noSkills`/`skillLoadFailed`/`unavailableInCurrentScope` 等，需确认是否 Skills 设置页仍用）。
- Label 表单 `agent` key 若无其他引用则移除。
- 保留：run dialog `workflowSkill`、`none`。

注意：部分 key 可能被 Skills 设置页（`settings-skills-panel`）复用，删除前 grep 确认引用。

## 9. 风险与验证

- **旧数据**：label 旧 `workflow_skill` 置 NULL 后，已有 issue 的 label 在 run dialog 默认"无"，符合预期。
- **跨 scope 同名 saved skill**：dropdown 重名时展示加 scope 后缀，默认取首个匹配；可接受。
- **agent_profiles.default_skill 残留**：UI 不再写，旧值仍在 DB 但不被任何路径消费。
- 验证：后端 `cargo test --test settings` 覆盖 label CRUD 无 agent 字段、migration 生效；前端测试覆盖 run dialog 技能过滤与默认、Label 表单技能源自 saved skills、Agent 表单无技能字段。
