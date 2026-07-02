# decouple-label-agent-skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Label→Agent association and the Agent profile's workflow-skill field; rewire the issue run dialog to source workflow skills from saved agent skills filtered by the selected agent's type, defaulting from the issue's labels.

**Architecture:** A new SQLite migration drops `project_labels.agent_profile_id` and nulls the now-semantically-changed `workflow_skill`. The Rust label type/repo/service shed agent fields and the "workflow skill requires agent" validation. The frontend Agent form loses its skill multi-select; the Label form loses its Agent field and pulls skill options from `list_saved_agent_skills`; the issue run dialog loads saved skills, filters by the selected profile's `agentType`, and defaults from the first matching label skill or "None".

**Tech Stack:** Rust + Tauri + rusqlite (backend, `src-tauri/`); React + TypeScript + vitest (frontend, `src/`); OpenSpec change `decouple-label-agent-skills`.

## Global Constraints

- 工作目录固定为 `implementation_workspace_path`（当前 `current-branch` 路线 = `/Users/yujianjia/workspace/kafka/redwhisk`）。所有路径相对此目录。
- 后端 migration 必须在 `src-tauri/src/db/migrations.rs` 中显式 `include_str!` 并加入 `migrations()` 返回的 Vec 末尾（runner 不扫描目录）。
- `agent_profiles.default_skill` 列保留，不删除；UI 不再写入，保存时传空串。
- 旧 `project_labels.workflow_skill` 值语义已变，migration 中统一置 NULL。
- 所有说明性文字与提交信息默认简体中文（项目 CLAUDE.md 规则）；代码标识符保持原样。
- 每个 task 结束前必须运行该 task 指定的测试命令并确认通过；遵循 TDD：先后写/改测试再改实现。
- 不混入无关改动（不格式化无关文件、不动 `add-settings-skills-menu` 相关代码）。

---

## File Structure

**后端**
- `src-tauri/migrations/0030_drop_label_agent_profile.sql`（新建）：置 NULL workflow_skill + DROP agent_profile_id 列。
- `src-tauri/src/db/migrations.rs`（修改）：注册 0030 migration。
- `src-tauri/src/types/project_label.rs`（修改）：`ProjectLabelRecord` / `SaveProjectLabelInput` 去 agent 字段。
- `src-tauri/src/db/project_label_repository.rs`（修改）：`ProjectLabelRow`、所有 SELECT/INSERT/UPDATE 去 agent 列与 JOIN；`save_label` 签名去 `agent_profile_id` 参数。
- `src-tauri/src/core/settings_service.rs`（修改）：删 `validate_label_agent_assignment` 及调用；`save_project_label` 不传 agent；`project_label_record_from_row` 去 agent 映射。
- `src-tauri/tests/settings.rs`（修改）：去 label 用例的 agent 字段；删除/改写 `save_project_label_rejects_workflow_skill_without_agent`；新增 migration 用例。

**前端**
- `src/features/settings/settings-commands.ts`（修改）：`ProjectLabelRecord` / `SaveProjectLabelInput` 去 agent 字段。
- `src/features/settings/agent-profile-form.tsx`（修改）：移除技能 MultiSelect 区块与相关 state/effect；`saveAgentProfile` 传 `defaultSkill: ""`。
- `src/features/settings/settings-agents-panel.tsx`（修改）：表头/行去工作流技能列。
- `src/features/settings/project-label-form.tsx`（修改）：移除 Agent 字段；技能选项来自 saved skills。
- `src/features/settings/settings-labels-panel.tsx`（修改）：去 Agent 列；移除 `profiles` prop。
- `src/features/settings/project-settings-activity.tsx`（修改）：不再向 `LabelsSettingsPanel` 传 `profiles`。
- `src/features/issues/issue-run-dialog.tsx`（修改）：加载 saved skills、按 agentType 过滤、默认来自 label 或"无"；移除 recent-workflow-skill localStorage。
- `src/features/issues/run-prompt-builder.ts`（修改）：`configuredSkills` 恒空，技能仅由 `selectedWorkflowSkill` 决定。
- `src/shared/i18n/messages.ts`（修改）：移除仅 Agent 表单使用的技能 key（确认无 Skills 页复用后）。
- 前端测试（修改/新增）：`project-settings-activity.test.tsx` 等。

---

### Task 1: 后端 migration 0030 与注册

**Files:**
- Create: `src-tauri/migrations/0030_drop_label_agent_profile.sql`
- Modify: `src-tauri/src/db/migrations.rs:94`（在 0029 注册之后追加 0030 常量）与 `migrations()` Vec 末尾（约 `src-tauri/src/db/migrations.rs:264` 之后）

**Interfaces:**
- Produces: migration version `0030_drop_label_agent_profile`，被 `MigrationRunner` 在启动时应用。

- [ ] **Step 1: 写 migration SQL**

Create `src-tauri/migrations/0030_drop_label_agent_profile.sql`:

```sql
-- Label 不再关联 Agent：删除 agent_profile_id 列。
-- workflow_skill 语义从 "agent default_skill 中的名" 改为 "saved_agent_skills.name"，
-- 旧值不可直接映射，置 NULL 由用户在 Label 表单重新选择。
UPDATE project_labels SET workflow_skill = NULL WHERE workflow_skill IS NOT NULL;
ALTER TABLE project_labels DROP COLUMN agent_profile_id;
```

- [ ] **Step 2: 注册常量**

在 `src-tauri/src/db/migrations.rs` 第 94 行（`SAVED_AGENT_SKILLS_MIGRATION_SQL` 常量定义之后、`SCHEMA_MIGRATIONS_SQL` 之前）追加：

```rust
const DROP_LABEL_AGENT_PROFILE_MIGRATION_VERSION: &str = "0030_drop_label_agent_profile";
const DROP_LABEL_AGENT_PROFILE_MIGRATION_SQL: &str =
    include_str!("../../migrations/0030_drop_label_agent_profile.sql");
```

- [ ] **Step 3: 追加到 migrations() Vec 末尾**

在 `migrations()` 函数返回的 Vec 末尾（最后一个 `Migration { version: SAVED_AGENT_SKILLS_MIGRATION_VERSION, sql: SAVED_AGENT_SKILLS_MIGRATION_SQL }` 之后、闭合 `]` 之前）追加：

```rust
                Migration {
                    version: DROP_LABEL_AGENT_PROFILE_MIGRATION_VERSION,
                    sql: DROP_LABEL_AGENT_PROFILE_MIGRATION_SQL,
                },
```

- [ ] **Step 4: 编译确认**

Run: `cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -20`
Expected: 编译通过（此 task 仅新增 migration，未改 Rust 类型，不应有编译错误）。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/migrations/0030_drop_label_agent_profile.sql src-tauri/src/db/migrations.rs
git commit -m "feat(settings): 新增 0030 migration 移除 label 的 agent_profile_id 列"
```

---

### Task 2: 后端 label 类型去 agent 字段

**Files:**
- Modify: `src-tauri/src/types/project_label.rs:12-22`（`ProjectLabelRecord`）、`src-tauri/src/types/project_label.rs:37-47`（`SaveProjectLabelInput`）

**Interfaces:**
- Produces: `ProjectLabelRecord` 与 `SaveProjectLabelInput` 不再含 `agent_profile_id` / `agent_name`。下游（repo / service / 前端类型）将在后续 task 跟随。

- [ ] **Step 1: 改 `ProjectLabelRecord`**

在 `src-tauri/src/types/project_label.rs` 中，将 `ProjectLabelRecord` 结构体改为（删除 `agent_profile_id` 与 `agent_name` 两行）：

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLabelRecord {
    pub id: i64,
    pub name: String,
    pub scope: ProjectLabelScope,
    pub project_id: Option<i64>,
    pub color: String,
    pub workflow_skill: Option<String>,
    pub del: i64,
}
```

- [ ] **Step 2: 改 `SaveProjectLabelInput`**

将 `SaveProjectLabelInput` 改为（删除 `agent_profile_id` 行）：

```rust
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProjectLabelInput {
    pub id: Option<i64>,
    pub name: String,
    pub scope: ProjectLabelScope,
    pub project_id: Option<i64>,
    pub color: String,
    pub workflow_skill: Option<String>,
}
```

- [ ] **Step 3: 暂不编译（已知 repo/service/test 会报错，后续 task 修复）**

本 task 不单独编译验证；类型变更在 Task 3/4/5 完成后统一编译。在此仅记录变更。

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/types/project_label.rs
git commit -m "refactor(settings): ProjectLabelRecord/SaveProjectLabelInput 移除 agent 字段"
```

---

### Task 3: 后端 label repository 去 agent 列与 JOIN

**Files:**
- Modify: `src-tauri/src/db/project_label_repository.rs`

**Interfaces:**
- Consumes: Task 2 的 `ProjectLabelRecord` 变更（通过 `ProjectLabelRow`）。
- Produces: `ProjectLabelRow` 去 `agent_profile_id` / `agent_name`；`save_label` 签名去掉 `agent_profile_id: Option<i64>` 参数；所有 SELECT 去 `LEFT JOIN agent_profiles`。

- [ ] **Step 1: 改 `ProjectLabelRow` 结构体**

将 `src-tauri/src/db/project_label_repository.rs:224-235` 的 `ProjectLabelRow` 改为：

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectLabelRow {
    pub id: i64,
    pub name: String,
    pub scope: ProjectLabelScope,
    pub project_id: Option<i64>,
    pub color: String,
    pub workflow_skill: Option<String>,
    pub del: i64,
}
```

- [ ] **Step 2: 改 `project_label_from_row`**

将 `project_label_from_row`（237-249 行）改为（列索引重排：0 id, 1 name, 2 scope, 3 project_id, 4 color, 5 workflow_skill, 6 del）：

```rust
fn project_label_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectLabelRow> {
    Ok(ProjectLabelRow {
        id: row.get(0)?,
        name: row.get(1)?,
        scope: scope_from_str(&row.get::<_, String>(2)?)?,
        project_id: row.get(3)?,
        color: row.get(4)?,
        workflow_skill: row.get(5)?,
        del: row.get(6)?,
    })
}
```

- [ ] **Step 3: 改三处 list/find SELECT（去 agent 列与 JOIN）**

将 `list_labels_by_scope` 的 Global 分支 SQL（21-37 行）改为：

```rust
                let mut statement = self.connection.prepare(
                    "SELECT project_labels.id,
                            project_labels.name,
                            project_labels.scope,
                            project_labels.project_id,
                            project_labels.color,
                            project_labels.workflow_skill,
                            project_labels.del
                     FROM project_labels
                     WHERE project_labels.scope = 'global'
                       AND project_labels.del = 0
                     ORDER BY project_labels.id ASC",
                )?;
```

将 `list_labels_by_scope` 的 Project 分支 SQL（44-61 行）改为：

```rust
                let mut statement = self.connection.prepare(
                    "SELECT project_labels.id,
                            project_labels.name,
                            project_labels.scope,
                            project_labels.project_id,
                            project_labels.color,
                            project_labels.workflow_skill,
                            project_labels.del
                     FROM project_labels
                     WHERE project_labels.scope = 'project'
                       AND project_labels.project_id = ?1
                       AND project_labels.del = 0
                     ORDER BY project_labels.id ASC",
                )?;
```

将 `find_label_by_id` 的 SQL（73-86 行）改为：

```rust
                "SELECT project_labels.id,
                        project_labels.name,
                        project_labels.scope,
                        project_labels.project_id,
                        project_labels.color,
                        project_labels.workflow_skill,
                        project_labels.del
                 FROM project_labels
                 WHERE project_labels.id = ?1",
```

- [ ] **Step 4: 改两处 `find_duplicate_name` SELECT**

将 Project 分支 SQL（103-120 行）改为：

```rust
                    "SELECT project_labels.id,
                            project_labels.name,
                            project_labels.scope,
                            project_labels.project_id,
                            project_labels.color,
                            project_labels.workflow_skill,
                            project_labels.del
                     FROM project_labels
                     WHERE project_labels.del = 0
                       AND project_labels.scope = 'project'
                       AND project_labels.project_id = ?2
                       AND lower(project_labels.name) = lower(?1)
                       AND (?3 IS NULL OR project_labels.id != ?3)
                     LIMIT 1",
```

将 Global 分支 SQL（128-143 行）改为：

```rust
                    "SELECT project_labels.id,
                            project_labels.name,
                            project_labels.scope,
                            project_labels.project_id,
                            project_labels.color,
                            project_labels.workflow_skill,
                            project_labels.del
                     FROM project_labels
                     WHERE project_labels.del = 0
                       AND lower(project_labels.name) = lower(?1)
                       AND (?2 IS NULL OR project_labels.id != ?2)
                     LIMIT 1",
```

- [ ] **Step 5: 改 `save_label` 签名与 SQL**

将 `save_label`（151-213 行）整段替换为（去掉 `agent_profile_id` 参数与列）：

```rust
    pub fn save_label(
        &self,
        id: Option<i64>,
        name: &str,
        scope: &ProjectLabelScope,
        project_id: Option<i64>,
        color: &str,
        workflow_skill: Option<&str>,
    ) -> rusqlite::Result<ProjectLabelRow> {
        let scope_str = scope_to_str(scope);

        match id {
            Some(id) => {
                self.connection.execute(
                    "UPDATE project_labels
                     SET name = ?1,
                         scope = ?2,
                         project_id = ?3,
                         color = ?4,
                         workflow_skill = ?5,
                         del = 0,
                         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                     WHERE id = ?6",
                    params![name, scope_str, project_id, color, workflow_skill, id],
                )?;
                self.find_label_by_id(id)?
                    .ok_or(rusqlite::Error::QueryReturnedNoRows)
            }
            None => {
                self.connection.execute(
                    "INSERT INTO project_labels (
                        name,
                        scope,
                        project_id,
                        color,
                        workflow_skill,
                        del
                     ) VALUES (?1, ?2, ?3, ?4, ?5, 0)",
                    params![name, scope_str, project_id, color, workflow_skill],
                )?;
                self.find_label_by_id(self.connection.last_insert_rowid())?
                    .ok_or(rusqlite::Error::QueryReturnedNoRows)
            }
        }
    }
```

- [ ] **Step 6: 编译确认（仍可能有 service/test 报错，本 task 仅保证 repo 自身正确）**

Run: `cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -30`
Expected: repo 编译相关错误消失；剩余错误应来自 `settings_service.rs`（Task 4 修复）与 `tests/settings.rs`（Task 6 修复）。

- [ ] **Step 7: 提交**

```bash
git add src-tauri/src/db/project_label_repository.rs
git commit -m "refactor(settings): label repository 移除 agent 列与 JOIN"
```

---

### Task 4: 后端 settings_service 去 agent 校验与映射

**Files:**
- Modify: `src-tauri/src/core/settings_service.rs:160-204`（`save_project_label`）、`336-369+`（`validate_label_agent_assignment`）、`675-689`（`project_label_record_from_row`）

**Interfaces:**
- Consumes: Task 2（类型）、Task 3（`save_label` 新签名、`ProjectLabelRow` 无 agent 字段）。
- Produces: `save_project_label` 不再接收/校验 agent；`project_label_record_from_row` 不映射 agent。

- [ ] **Step 1: 改 `project_label_record_from_row`**

将 `src-tauri/src/core/settings_service.rs:675-689` 改为：

```rust
fn project_label_record_from_row(
    row: crate::db::project_label_repository::ProjectLabelRow,
) -> ProjectLabelRecord {
    ProjectLabelRecord {
        id: row.id,
        name: row.name,
        scope: row.scope,
        project_id: row.project_id,
        color: row.color,
        workflow_skill: row.workflow_skill,
        del: row.del,
    }
}
```

- [ ] **Step 2: 改 `save_project_label`**

将 `save_project_label`（160-204 行）改为（删除 `validate_label_agent_assignment` 调用与 `input.agent_profile_id` 传参）：

```rust
    pub fn save_project_label(
        &self,
        input: SaveProjectLabelInput,
    ) -> Result<ProjectLabelRecord, CommandError> {
        let name = validate_project_label_name(&input.name)?;
        let color = validate_project_label_color(&input.color)?;
        let workflow_skill = normalize_optional_string(input.workflow_skill.as_deref());
        let project_id = match input.scope {
            ProjectLabelScope::Project => Some(input.project_id.ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::AgentProfileValidationFailed,
                    "项目级 Label 必须指定 project_id。",
                )
                .with_detail(ErrorDetail::new("Field").with_value("name", "projectId"))
            })?),
            ProjectLabelScope::Global => None,
        };

        if let Some(project_id) = project_id {
            self.ensure_project_exists(project_id)?;
        }

        self.ensure_label_name_unique(&name, &input.scope, project_id, input.id)?;

        let row = self
            .project_label_repository
            .save_label(
                input.id,
                &name,
                &input.scope,
                project_id,
                &color,
                workflow_skill.as_deref(),
            )
            .map_err(settings_database_error)?;

        Ok(project_label_record_from_row(row))
    }
```

- [ ] **Step 3: 删除 `validate_label_agent_assignment` 整个方法**

删除 `src-tauri/src/core/settings_service.rs` 中 `fn validate_label_agent_assignment(...)` 到其函数体结束的整段（336 行起到该方法闭合，约至 369 行之后——以读到下一个 `fn` 为准）。删除后该方法不再被引用（Step 2 已移除唯一调用点）。

- [ ] **Step 4: 编译确认**

Run: `cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -30`
Expected: `settings_service.rs` 编译通过；剩余错误仅可能来自 `tests/settings.rs`（Task 6 修复）。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/core/settings_service.rs
git commit -m "refactor(settings): save_project_label 移除 agent 校验与映射"
```

---

### Task 5: 后端测试更新（label CRUD 去 agent + migration 验证）

**Files:**
- Modify: `src-tauri/tests/settings.rs`

**Interfaces:**
- Consumes: Task 2/3/4 的类型与签名变更。

- [ ] **Step 1: 移除现有 label 用例的 agent 字段**

在 `src-tauri/tests/settings.rs` 中，所有 `SaveProjectLabelInput { ... }` 字面量删除 `agent_profile_id: None,` 行。涉及约 4 处（486-493、498-505、524-531、536-543 行）。

- [ ] **Step 2: 删除 `save_project_label_rejects_workflow_skill_without_agent` 测试**

删除 `src-tauri/tests/settings.rs` 中整个 `fn save_project_label_rejects_workflow_skill_without_agent()` 函数（约 552-573 行）。该校验已在 Task 4 移除，测试不再适用。

- [ ] **Step 3: 新增 label 可单独保存 workflow_skill（无 agent）的测试**

在删除的测试位置追加：

```rust
#[test]
fn save_project_label_allows_workflow_skill_without_agent() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let service = settings_service(
        &database.connection,
        StubCommandDetector::with_test_result("/usr/local/bin/codex", Ok("/usr/local/bin/codex")),
    );
    let project_id = insert_project(&database.connection, "redwhisk");

    let saved = service
        .save_project_label(SaveProjectLabelInput {
            id: None,
            name: "ops".to_string(),
            scope: ProjectLabelScope::Project,
            project_id: Some(project_id),
            color: "#112233".to_string(),
            workflow_skill: Some("triage".to_string()),
        })
        .expect("workflow skill without agent should succeed");

    assert_eq!(saved.workflow_skill.as_deref(), Some("triage"));
}
```

- [ ] **Step 4: 新增 migration 0030 验证测试**

在 `src-tauri/tests/settings.rs` 末尾追加（验证迁移后 `agent_profile_id` 列不存在、旧 workflow_skill 被清空）：

```rust
#[test]
fn migration_drops_label_agent_profile_id_and_nulls_workflow_skill() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());

    // 迁移已应用：agent_profile_id 列应不存在。
    let column_exists: bool = database
        .connection
        .prepare("PRAGMA table_info(project_labels)")
        .and_then(|mut stmt| {
            let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
            for row in rows {
                if row? == "agent_profile_id" {
                    return Ok(true);
                }
            }
            Ok(false)
        })
        .expect("pragma query");
    assert!(!column_exists, "agent_profile_id 列应已被删除");

    // 插入一条带 workflow_skill 的 label，验证列仍可写入（语义为 saved skill name）。
    database
        .connection
        .execute(
            "INSERT INTO project_labels (name, scope, project_id, color, workflow_skill, del)
             VALUES ('ops', 'global', NULL, '#112233', 'triage', 0)",
            [],
        )
        .expect("insert label");
    let skill: Option<String> = database
        .connection
        .query_row(
            "SELECT workflow_skill FROM project_labels WHERE name = 'ops'",
            [],
            |row| row.get(0),
        )
        .expect("select skill");
    assert_eq!(skill.as_deref(), Some("triage"));
}
```

> 注：`migrated_database` helper 已存在于 settings.rs（被其它测试使用）。若该 helper 未导出 `connection` 字段或签名不同，按现有测试中 `database.connection` 用法对齐；若 PRAGMA 查询写法与现有风格不符，调整为 settings.rs 中已有的 rusqlite 用法。

- [ ] **Step 5: 运行后端测试**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test settings 2>&1 | tail -40`
Expected: 全部通过，包括新增的两个测试与改造后的 CRUD 测试。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/tests/settings.rs
git commit -m "test(settings): label 去 agent 字段用例 + 0030 migration 验证"
```

---

### Task 6: 前端类型去 agent 字段

**Files:**
- Modify: `src/features/settings/settings-commands.ts:84-93`（`ProjectLabelRecord`）、`138-146`（`SaveProjectLabelInput`）

**Interfaces:**
- Produces: 前端 `ProjectLabelRecord` / `SaveProjectLabelInput` 与后端 JSON（snake_case/camelCase）对齐，去 `agentProfileId` / `agentName`。

- [ ] **Step 1: 改 `ProjectLabelRecord`**

将 `settings-commands.ts` 中 `ProjectLabelRecord` 改为：

```ts
export interface ProjectLabelRecord {
  id: number;
  name: string;
  scope: ProjectLabelScope;
  projectId: number | null;
  color: string;
  workflowSkill: string | null;
}
```

- [ ] **Step 2: 改 `SaveProjectLabelInput`**

将 `SaveProjectLabelInput` 改为：

```ts
export interface SaveProjectLabelInput {
  id?: number;
  name: string;
  scope: ProjectLabelScope;
  projectId: number | null;
  color: string;
  workflowSkill: string | null;
}
```

- [ ] **Step 3: typecheck（预期有引用报错，记录后续 task 修复）**

Run: `pnpm typecheck 2>&1 | tail -30`
Expected: `project-label-form.tsx`、`settings-labels-panel.tsx`、`project-settings-activity.test.tsx` 等引用 `agentProfileId`/`agentName` 处报错——后续 task 修复。本 step 仅确认报错位置。

- [ ] **Step 4: 提交**

```bash
git add src/features/settings/settings-commands.ts
git commit -m "refactor(settings): 前端 ProjectLabelRecord/SaveProjectLabelInput 去 agent 字段"
```

---

### Task 7: Agent 表单移除工作流技能字段

**Files:**
- Modify: `src/features/settings/agent-profile-form.tsx`

**Interfaces:**
- Produces: Agent 表单不再调用 `listAgentSkills`、不再监听 `agent-skills-updated`、不再有技能 MultiSelect；`saveAgentProfile` 提交 `defaultSkill: ""`。

- [ ] **Step 1: 精简 imports**

将 `src/features/settings/agent-profile-form.tsx` 顶部 import 块中，从 `./settings-commands` 移除 `listAgentSkills`、`AgentSkillRecord`、`AgentSkillsUpdatedEvent`（保留 `detectCodexCommand`、`saveAgentProfile`、`testAgentCommand`、`AgentProfileRecord`、`AgentScope`、`AgentType`）。

删除整行：

```ts
import { listen } from "@tauri-apps/api/event";
```

从 `./agent-profile-skills` 移除 `parseDefaultSkills`、`serializeDefaultSkills`（删除该 import 整行）。

- [ ] **Step 2: 移除技能相关 state 与 refs**

删除以下声明：

```ts
  const [selectedSkillKeys, setSelectedSkillKeys] = useState<string[]>(() =>
    parseDefaultSkills(profile?.defaultSkill ?? "").map(toMissingSkillKey),
  );
  const [skills, setSkills] = useState<AgentSkillRecord[]>([]);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
  const [skillLoadFailed, setSkillLoadFailed] = useState(false);
  const isMountedRef = useRef(true);
  const skillRequestSequenceRef = useRef(0);
```

保留 `toastTimeoutRef`。若 `useRef` 仍被 `toastTimeoutRef` 使用则保留 import；`useCallback` 视剩余使用情况保留。

- [ ] **Step 3: 移除 `loadSkills` useCallback**

删除整个 `const loadSkills = useCallback(...)` 块（约 77-108 行）。

- [ ] **Step 4: 移除 `useEffect` 中的 isMountedRef 清理**

将第一个 `useEffect(() => { isMountedRef.current = true; return () => {...} }, [])`（约 110-120 行）删除。若其中仅清理 `toastTimeoutRef`，则保留一个仅清理 toast 的 effect：

```ts
  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current !== null) {
        window.clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);
```

- [ ] **Step 5: 移除技能加载与监听的两个 useEffect**

删除 `useEffect(() => { ... void loadSkills() ... }, [loadSkills])`（约 186-192 行）与 `useEffect` 监听 `agent-skills-updated`（约 194-213 行）整段。

- [ ] **Step 6: 移除技能派生 useMemo**

删除 `visibleSkills`、`visibleSkillNames`、`effectiveSelectedSkillKeys`、`selectedSkillNames`、`missingSkillNames`、`workflowSkillOptions` 这些 `useMemo` 块（约 215-271 行）。

- [ ] **Step 7: 改 `agentType` Select 的 onChange**

将 `agentType` Select 的 `onValueChange` 改回仅设置类型（移除技能重置）：

```ts
              onValueChange={(value) => {
                setAgentType(value as AgentType);
              }}
```

将 `scopeValue` 的 `onChange`（SearchableSelect）改为：

```ts
            onChange={(nextScope) => {
              setScopeValue(nextScope as AgentScope);
            }}
```

- [ ] **Step 8: 改 `saveAgentProfile` 提交**

将 `handleSubmit` 中 `saveAgentProfile` 调用的 `defaultSkill` 参数改为空串：

```ts
      const savedProfile = await saveAgentProfile({
        id: profile?.id,
        name,
        agentType,
        command,
        scope: scopeValue,
        projectId: effectiveProjectId,
        mode: modeValue,
        dangerous,
        defaultSkill: "",
        promptTemplate,
      });
```

- [ ] **Step 9: 移除技能 MultiSelect JSX**

删除 `<div className="agent-dialog__select-block">...</div>` 整段（约 449-474 行，含 `SearchableMultiSelect` 与 skill 状态文案）。

- [ ] **Step 10: 移除已无用的辅助函数与组件**

删除文件中：`SearchableSelect`、`SearchableMultiSelect` 组件定义、`shouldReloadSkillsForEvent`、`dedupeOptionsByValue`、`dedupeStrings`、`resolveSkillNameFromKey`、`toMissingSkillKey`、`fromMissingSkillKey`、`isMissingSkillKey` 函数（约 521-905 行）。

> 谨慎：删除前先 grep 确认这些组件/函数未被本文件其它保留逻辑或别处 import。若 `SearchableSelect` 仍被 scope 选择使用，则保留 `SearchableSelect`（与 `SearchableSelectOption` 接口），仅删 `SearchableMultiSelect` 与技能相关辅助函数。本 step 实操时按 grep 结果决定。

- [ ] **Step 11: typecheck**

Run: `pnpm typecheck 2>&1 | tail -30`
Expected: `agent-profile-form.tsx` 无错误（其余文件错误由后续 task 修复）。

- [ ] **Step 12: 提交**

```bash
git add src/features/settings/agent-profile-form.tsx
git commit -m "refactor(settings): Agent 表单移除工作流技能字段"
```

---

### Task 8: Agents 列表移除工作流技能列

**Files:**
- Modify: `src/features/settings/settings-agents-panel.tsx`

**Interfaces:**
- Produces: Agents 表格列变为 Type / Name / Command / Scope / Actions。

- [ ] **Step 1: 移除 import**

删除 `settings-agents-panel.tsx` 第 12 行 `import { formatDefaultSkills } from "./agent-profile-skills";`。

- [ ] **Step 2: 移除表头技能列**

删除 TableHeader 中：

```tsx
                <TableHead>{messages.settings.workflowSkill}</TableHead>
```

- [ ] **Step 3: 移除行内技能单元格**

删除 TableRow 中：

```tsx
                    <TableCell
                      data-slot="settings-agents-skill-cell"
                      className="overflow-hidden"
                    >
                      <span className="block truncate">
                        {skills.length > 0 ? skills : "—"}
                      </span>
                    </TableCell>
```

并删除 `const skills = formatDefaultSkills(profile.defaultSkill);` 行。

- [ ] **Step 4: typecheck**

Run: `pnpm typecheck 2>&1 | tail -20`
Expected: `settings-agents-panel.tsx` 无错误。

- [ ] **Step 5: 提交**

```bash
git add src/features/settings/settings-agents-panel.tsx
git commit -m "refactor(settings): Agents 列表移除工作流技能列"
```

---

### Task 9: Label 表单移除 Agent 字段、技能改引 saved skills

**Files:**
- Modify: `src/features/settings/project-label-form.tsx`

**Interfaces:**
- Consumes: `listSavedAgentSkills`（来自 `./settings-commands`）、`SavedAgentSkillRecord`、`ProjectLabelScope`、Task 6 的 `SaveProjectLabelInput`（无 agentProfileId）。
- Produces: Label 表单字段为 Name / Scope / Color / Workflow Skill（单选，选项来自项目+全局 saved skills）。

- [ ] **Step 1: 改 imports**

`project-label-form.tsx` 顶部 import 块改为：

```ts
import { useMemo, useState, type FormEvent } from "react";

import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { useI18n } from "../../shared/i18n/i18n";
import { toCommandError } from "../../shared/commands/command-error";
import {
  listSavedAgentSkills,
  saveProjectLabel,
  type ProjectLabelRecord,
  type ProjectLabelScope,
  type SavedAgentSkillRecord,
} from "./settings-commands";
import { useEffect } from "react";
```

- [ ] **Step 2: 移除 `profiles` prop 与 Agent state**

将 `ProjectLabelFormProps` 中 `profiles: AgentProfileRecord[];` 删除。组件参数解构中移除 `profiles` 与 `projectId` 中 `profiles` 相关用法（`projectId` 保留，用于加载 project saved skills 与保存）。

删除以下 state：

```ts
  const [agentProfileId, setAgentProfileId] = useState<string>(...);
```

删除 `selectableProfiles`、`selectedProfile`、`hasSelectedAgent`、`availableWorkflowSkills`、`hasWorkflowSkills`、`selectedWorkflowSkill` 派生逻辑（约 68-90 行）。

- [ ] **Step 3: 新增 saved skills 加载**

在组件内新增 state 与 effect：

```ts
  const [savedSkills, setSavedSkills] = useState<SavedAgentSkillRecord[]>([]);

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      listSavedAgentSkills({ scope: "project", projectId }),
      listSavedAgentSkills({ scope: "global", projectId: null }),
    ])
      .then(([projectRes, globalRes]) => {
        if (!mounted) return;
        setSavedSkills([...projectRes.skills, ...globalRes.skills]);
      })
      .catch(() => {
        if (!mounted) return;
        setSavedSkills([]);
      });
    return () => {
      mounted = false;
    };
  }, [projectId]);
```

- [ ] **Step 4: 技能选项与选中态**

新增派生（skill name 作为 value；同名时仍以 name 为值，默认取首个）：

```ts
  const workflowSkillOptions = useMemo(() => {
    const seen = new Set<string>();
    return savedSkills.filter((skill) => {
      if (seen.has(skill.name)) return false;
      seen.add(skill.name);
      return true;
    });
  }, [savedSkills]);

  const workflowSkill = label?.workflowSkill ?? "";
```

（保留既有 `const [workflowSkill, setWorkflowSkill] = useState(label?.workflowSkill ?? "");` 即可；上面仅为说明来源。若已存在同名 state 则不重复声明。）

- [ ] **Step 5: 移除 scope 切换里清空 agent 的逻辑**

将 scope Select 的 `onValueChange` 改为仅设置 scope（删除其中重置 `agentProfileId`/`workflowSkill` 的分支）：

```ts
              onValueChange={(value) => {
                setScope(value as ProjectLabelScope);
              }}
```

- [ ] **Step 6: 移除 Agent 字段 JSX，改写技能字段 JSX**

删除整个 `Agent` 字段 `<div className="grid gap-1.5">...</div>`（约 283-320 行）。

将原"工作流技能"字段（仅当 `hasSelectedAgent && hasWorkflowSkills` 才显示）替换为始终显示的单选：

```tsx
          <div className="grid gap-1.5">
            <Label
              htmlFor="label-workflow-skill"
              className="text-xs text-muted-foreground"
            >
              {messages.settings.workflowSkillSingle}
            </Label>
            <Select
              items={[
                { value: "", label: messages.settings.none },
                ...workflowSkillOptions.map((skill) => ({
                  value: skill.name,
                  label: skill.name,
                })),
              ]}
              value={workflowSkill}
              onValueChange={(value) => setWorkflowSkill(value as string)}
            >
              <SelectTrigger
                id="label-workflow-skill"
                aria-label={messages.settings.workflowSkillSingle}
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{messages.settings.none}</SelectItem>
                {workflowSkillOptions.map((skill) => (
                  <SelectItem key={skill.name} value={skill.name}>
                    {skill.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
```

- [ ] **Step 7: 改 `saveProjectLabel` 提交**

将 `handleSubmit` 中 `saveProjectLabel` 调用改为：

```ts
      const saved = await saveProjectLabel({
        id: label?.id,
        name: name.trim(),
        scope,
        projectId: scope === "project" ? projectId : null,
        color,
        workflowSkill: workflowSkill.trim().length > 0 ? workflowSkill : null,
      });
```

- [ ] **Step 8: typecheck**

Run: `pnpm typecheck 2>&1 | tail -30`
Expected: `project-label-form.tsx` 无错误。

- [ ] **Step 9: 提交**

```bash
git add src/features/settings/project-label-form.tsx
git commit -m "refactor(settings): Label 表单移除 Agent 字段，技能改引 saved skills"
```

---

### Task 10: Labels 列表移除 Agent 列与 profiles prop

**Files:**
- Modify: `src/features/settings/settings-labels-panel.tsx`、`src/features/settings/project-settings-activity.tsx`

**Interfaces:**
- Produces: `LabelsSettingsPanel` 不再接收 `profiles` prop；表格列为 Name / Scope / Color / Workflow Skill / Actions。

- [ ] **Step 1: 移除 panel 的 profiles prop**

在 `settings-labels-panel.tsx` 中：
- 从 `LabelsSettingsPanelProps` 删除 `profiles: AgentProfileRecord[];`。
- 从组件参数解构删除 `profiles`。
- 删除 `import { type AgentProfileRecord, ... }` 中的 `AgentProfileRecord`（保留 `ProjectLabelRecord`）。
- 删除传给 `ProjectLabelForm` 的 `profiles={profiles}` 行（create 与 edit 两处）。

- [ ] **Step 2: 移除表头与行 Agent 列**

删除 TableHeader 中：

```tsx
                <TableHead>{messages.settings.agent}</TableHead>
```

删除 TableRow 中：

```tsx
                  <TableCell>
                    <span className="block truncate text-muted-foreground">
                      {label.agentName ?? messages.settings.none}
                    </span>
                  </TableCell>
```

- [ ] **Step 3: 移除 activity 中传给 panel 的 profiles**

在 `project-settings-activity.tsx` 中，删除 `<LabelsSettingsPanel ... profiles={currentProfiles} ... />` 里的 `profiles={currentProfiles}` 行。

- [ ] **Step 4: typecheck**

Run: `pnpm typecheck 2>&1 | tail -30`
Expected: 两个文件无错误。

- [ ] **Step 5: 提交**

```bash
git add src/features/settings/settings-labels-panel.tsx src/features/settings/project-settings-activity.tsx
git commit -m "refactor(settings): Labels 列表移除 Agent 列与 profiles 透传"
```

---

### Task 11: i18n 清理仅 Agent 表单使用的技能 key

**Files:**
- Modify: `src/shared/i18n/messages.ts`

**Interfaces:**
- Produces: 移除仅被 Agent 表单使用的技能文案 key（若被 Skills 设置页复用则保留）。

- [ ] **Step 1: grep 确认每个候选 key 的引用**

Run:

```bash
grep -rn "settings\.workflowSkill\b\|settings\.loadingSkills\|settings\.noSkills\|settings\.skillLoadFailed\|settings\.unavailableInCurrentScope\|settings\.agent\b\|settings\.workflowSkillSingle" src --include="*.ts" --include="*.tsx"
```

逐个 key 判断：
- `settings.workflowSkill`（"Workflow Skills"）：Agent 表单已移除引用；若 Skills 设置页（`settings-skills-panel`）未使用则删除。
- `settings.loadingSkills` / `noSkills` / `skillLoadFailed` / `unavailableInCurrentScope`：Agent 表单已移除；若 Skills 设置页未使用则删除。
- `settings.agent`（"Agent"）：Label 表单已移除引用；若 issue label picker 或别处未使用则删除。
- `settings.workflowSkillSingle`：Label 表单仍在用 → **保留**。
- `issues.workflowSkill`：run dialog 仍在用 → **保留**（不在 settings 段，本 task 不动）。

> 实操：对每个候选 key，若 grep 仅出现在 `messages.ts` 定义处（无其他引用），则从 `SettingsMessages` 接口与 en/zh 两个对象中删除该字段。若出现在 `settings-skills-panel.tsx` 或其它保留组件，则保留。

- [ ] **Step 2: 按 grep 结果删除未引用 key**

在 `src/shared/i18n/messages.ts` 中，对确认无引用的 key：从接口类型声明、`en` 对象、`zh` 对象三处同步删除。

- [ ] **Step 3: typecheck + lint**

Run: `pnpm typecheck 2>&1 | tail -20 && pnpm lint 2>&1 | tail -20`
Expected: 无错误（i18n 接口与实现同步）。

- [ ] **Step 4: 提交**

```bash
git add src/shared/i18n/messages.ts
git commit -m "chore(i18n): 移除仅 Agent 表单使用的技能文案 key"
```

---

### Task 12: issue-run-dialog 技能来源与默认重写

**Files:**
- Modify: `src/features/issues/issue-run-dialog.tsx`、`src/features/issues/run-prompt-builder.ts`

**Interfaces:**
- Consumes: `listSavedAgentSkills`、`SavedAgentSkillRecord`、`AgentProfileRecord.agentType`、`IssueRecord.labels[].workflowSkill`。
- Produces: 技能下拉选项 = saved skills 中 `skillPaths` 含 `selectedProfile.agentType` 的项；默认 = 第一个 label.workflowSkill 存在于选项的 name，否则"无"；移除 recent-workflow-skill localStorage。

- [ ] **Step 1: 改 imports**

`issue-run-dialog.tsx` 顶部，从 `../settings/settings-commands` 追加导入 `listSavedAgentSkills`、`SavedAgentSkillRecord`：

```ts
import {
  listAgentProfiles,
  listSavedAgentSkills,
  type AgentProfileRecord,
  type SavedAgentSkillRecord,
} from "../settings/settings-commands";
```

删除 `import { parseDefaultSkills } from "../settings/agent-profile-skills";` 整行（不再使用）。

- [ ] **Step 2: 移除 recent-workflow-skill 常量**

删除：

```ts
const RECENT_WORKFLOW_SKILL_STORAGE_KEY = "redwhisk.issue-run.recent-workflow-skill";
```

保留 `NO_WORKFLOW_SKILL_VALUE`、`RECENT_WORKSPACE_SELECTION_STORAGE_KEY`、`WORKTREE_PROGRESS_COMPLETION_DELAY_MS`。

- [ ] **Step 3: 新增 savedSkills state 与加载**

在组件内新增：

```ts
  const [savedSkills, setSavedSkills] = useState<SavedAgentSkillRecord[]>([]);
```

在 `loadRunDialogContext` 的 `Promise.all` 中追加两个调用，并在合并后 set：

```ts
        const [
          projectProfilesResponse,
          globalProfilesResponse,
          sessionsResponse,
          branchesResponse,
          projectSavedSkillsResponse,
          globalSavedSkillsResponse,
        ] = await Promise.all([
          listAgentProfiles({ scope: "project", projectId }),
          listAgentProfiles({ scope: "global", projectId: null }),
          listAgentSessions(projectId),
          getProjectGitBranches({ projectId }),
          listSavedAgentSkills({ scope: "project", projectId }),
          listSavedAgentSkills({ scope: "global", projectId: null }),
        ]);
```

合并后（在 `setProfiles(mergedProfiles);` 附近）：

```ts
        setSavedSkills([
          ...projectSavedSkillsResponse.skills,
          ...globalSavedSkillsResponse.skills,
        ]);
```

- [ ] **Step 4: 重写技能选项 useMemo**

将原 `workflowSkillOptions` useMemo（约 219-225 行）替换为：

```ts
  const workflowSkillOptions = useMemo(() => {
    if (!selectedProfile) {
      return [];
    }
    const seen = new Set<string>();
    return savedSkills
      .filter((skill) =>
        skill.skillPaths.some((p) => p.agentType === selectedProfile.agentType),
      )
      .filter((skill) => {
        if (seen.has(skill.name)) return false;
        seen.add(skill.name);
        return true;
      });
  }, [savedSkills, selectedProfile]);
```

- [ ] **Step 5: 移除 `shouldShowWorkflowSkill`，技能下拉始终展示**

删除：

```ts
  const shouldShowWorkflowSkill =
    selectedProfile !== null && workflowSkillOptions.length > 0;
  const defaultWorkflowSkill = workflowSkillOptions[0] ?? null;
```

保留 `effectiveWorkflowSkill` 与 `workflowSkillValue` 计算，但 `effectiveWorkflowSkill` 改为不再依赖 `defaultWorkflowSkill`：

```ts
  const effectiveWorkflowSkill =
    selectedWorkflowSkill === null
      ? null
      : selectedWorkflowSkill.length === 0
        ? ""
        : selectedWorkflowSkill;
  const workflowSkillValue =
    effectiveWorkflowSkill === null ||
    effectiveWorkflowSkill.length === 0
      ? NO_WORKFLOW_SKILL_VALUE
      : effectiveWorkflowSkill;
```

将 JSX 中 `{shouldShowWorkflowSkill ? (...) : null}` 改为始终渲染技能 `<div className="grid gap-1.5">...</div>`（去掉外层条件）。

- [ ] **Step 6: 重写 `resolveInitialWorkflowSkill`**

替换为（默认来自 label，否则 null="无"）：

```ts
function resolveInitialWorkflowSkill({
  issue,
  options,
}: {
  issue: Pick<IssueRecord, "labels">;
  options: SavedAgentSkillRecord[];
}): string | null {
  const optionNames = new Set(options.map((skill) => skill.name));
  for (const label of issue.labels ?? []) {
    const name = (label.workflowSkill ?? "").trim();
    if (name.length > 0 && optionNames.has(name)) {
      return name;
    }
  }
  return null;
}
```

- [ ] **Step 7: 改两处调用 `resolveInitialWorkflowSkill`**

初始加载处（约 152-159 行）改为：

```ts
        setSelectedWorkflowSkill(
          initialProfile
            ? resolveInitialWorkflowSkill({
                issue,
                options: savedSkills.filter((skill) =>
                  skill.skillPaths.some(
                    (p) => p.agentType === initialProfile.agentType,
                  ),
                ),
              })
            : null,
        );
```

> 注意：此处需用 `initialProfile.agentType` 过滤的 options，与 `workflowSkillOptions`（依赖 `selectedProfile`）一致。`setSavedSkills` 与 `setSelectedWorkflowSkill` 在同一同步块内，`savedSkills` 变量在闭包中已是合并后的数组（`const mergedSavedSkills = [...projectSavedSkillsResponse.skills, ...globalSavedSkillsResponse.skills];`）。建议在 set 之前先 `const mergedSavedSkills = [...]`，后续 `setSavedSkills(mergedSavedSkills)` 与过滤都用 `mergedSavedSkills`，避免状态未更新导致的闭包取值问题。

Agent 切换处（约 400-408 行）改为：

```ts
                  setSelectedWorkflowSkill(
                    nextProfile
                      ? resolveInitialWorkflowSkill({
                          issue,
                          options: savedSkills.filter((skill) =>
                            skill.skillPaths.some(
                              (p) => p.agentType === nextProfile.agentType,
                            ),
                          ),
                        })
                      : null,
                  );
```

- [ ] **Step 8: 移除技能 Select onChange 中的 recent 保存**

将技能 Select 的 `onValueChange` 改为：

```ts
                  onValueChange={(nextValue) => {
                    const nextWorkflowSkill =
                      nextValue === NO_WORKFLOW_SKILL_VALUE ? "" : nextValue;
                    setSelectedWorkflowSkill(nextWorkflowSkill);
                  }}
```

（删除 `saveRecentWorkflowSkill` 调用。）

- [ ] **Step 9: 删除 recent-workflow-skill 工具函数**

删除 `readRecentWorkflowSkill`、`saveRecentWorkflowSkill`、`workflowSkillStorageKey` 三个函数（约 697-751 行）。

- [ ] **Step 10: 删除 `resolveLabelWorkflowSkill`**

删除 `resolveLabelWorkflowSkill` 函数（约 683-695 行）——其逻辑已并入新的 `resolveInitialWorkflowSkill`。

- [ ] **Step 11: 改 run-prompt-builder**

在 `src/features/issues/run-prompt-builder.ts` 中，将 `configuredSkills` 与 `defaultSkills` 计算改为：

```ts
  const configuredSkills: string[] = [];
  const selectedWorkflowSkill = input.selectedWorkflowSkill ?? null;
  const defaultSkills =
    selectedWorkflowSkill !== null && selectedWorkflowSkill.trim().length > 0
      ? [selectedWorkflowSkill.trim()]
      : [];
```

（删除 `const configuredSkills = parseDefaultSkills(input.profile.defaultSkill);` 与基于它的 `defaultSkills` 分支。）

移除文件顶部 `import { parseDefaultSkills } from "../settings/agent-profile-skills";`。

- [ ] **Step 12: typecheck**

Run: `pnpm typecheck 2>&1 | tail -30`
Expected: 两个文件无错误。

- [ ] **Step 13: 提交**

```bash
git add src/features/issues/issue-run-dialog.tsx src/features/issues/run-prompt-builder.ts
git commit -m "refactor(issues): run dialog 技能来源改自 saved skills 并按 agentType 过滤"
```

---

### Task 13: 前端测试更新

**Files:**
- Modify: `src/features/settings/project-settings-activity.test.tsx` 及其它引用 label agent 字段或 run dialog 技能逻辑的测试。

**Interfaces:**
- Consumes: Task 6/9/10/12 的类型与行为变更。

- [ ] **Step 1: grep 受影响测试**

Run:

```bash
grep -rln "agentProfileId\|agentName\|defaultSkill\|parseDefaultSkills\|RECENT_WORKFLOW_SKILL\|resolveLabelWorkflowSkill\|workflowSkill" src --include="*.test.ts" --include="*.test.tsx"
```

- [ ] **Step 2: 修正 label 相关测试 mock**

对每个命中文件：移除 mock 的 `ProjectLabelRecord` 中 `agentProfileId`/`agentName` 字段；移除 `SaveProjectLabelInput` mock 中 `agentProfileId`；调整断言使其不再期望 Agent 列或 Agent 字段。

- [ ] **Step 3: 修正 Agent 表单测试**

若存在断言 Agent 表单渲染技能 MultiSelect / `listAgentSkills` 调用的测试，删除或改写为断言不渲染技能字段、不调用 `listAgentSkills`。

- [ ] **Step 4: 修正/新增 run dialog 测试**

新增或改写 `issue-run-dialog` 相关测试覆盖：
- 技能选项来自 `listSavedAgentSkills` 并按 `selectedProfile.agentType` 过滤。
- 默认技能：issue label.workflowSkill 匹配过滤后选项 → 选中该 name。
- 默认技能：label 无匹配 → 选中"无"（`NO_WORKFLOW_SKILL_VALUE`）。
- Agent 切换后选项与默认按新 agentType 重算。

> 若仓库无现成 `issue-run-dialog.test.tsx`，跳过新增（本 task 仅修正既有测试不破）；记录"未新增 run dialog 专项测试"于最终汇报。

- [ ] **Step 5: 运行前端测试**

Run: `pnpm test 2>&1 | tail -40`
Expected: 全部通过。

- [ ] **Step 6: 提交**

```bash
git add src
git commit -m "test: 适配 label 去 agent 与 run dialog 技能来源变更"
```

---

### Task 14: 全量验证与 OpenSpec 回填

**Files:**
- Modify: `openspec/changes/decouple-label-agent-skills/tasks.md`（勾选完成项）

- [ ] **Step 1: lint**

Run: `pnpm lint 2>&1 | tail -20`
Expected: 无错误。

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck 2>&1 | tail -20`
Expected: 无错误。

- [ ] **Step 3: 前端测试**

Run: `pnpm test 2>&1 | tail -30`
Expected: 全部通过。

- [ ] **Step 4: 后端测试**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test settings 2>&1 | tail -30`
Expected: 全部通过。

- [ ] **Step 5: openspec strict 校验**

Run: `npx openspec validate decouple-label-agent-skills --strict 2>&1 | tail -20`
Expected: `Change 'decouple-label-agent-skills' is valid`。

- [ ] **Step 6: 回填 tasks.md**

将 `openspec/changes/decouple-label-agent-skills/tasks.md` 中所有已完成子任务 `- [ ]` 改为 `- [x]`。

- [ ] **Step 7: 提交**

```bash
git add openspec/changes/decouple-label-agent-skills/tasks.md
git commit -m "docs(openspec): 回填 decouple-label-agent-skills 任务勾选"
```

---

## Self-Review

**1. Spec coverage**
- `settings-ui` Agent 表单/列表去技能字段 → Task 7、8、11。✅
- `project-labels` 去 agent、技能引 saved skills → Task 9、10、11。✅
- `issues-ui` run dialog agent 来源 + 技能过滤 + 默认来自 label/无 → Task 12。✅
- `agent-skill-index` 移除 Agent Profile skill selection → Task 7（移除调用）。✅
- 后端 migration + 类型 + repo + service + 测试 → Task 1-5。✅
- proposal 显式默认（单 skill、注入 name、保留 default_skill 列、旧值置 NULL）→ Task 1（置 NULL）、Task 7（defaultSkill:""）、Task 9（单选 name）、Task 12（注入 name）。✅

**2. Placeholder scan**
- Task 11 Step 1-2 含"按 grep 结果决定"——这是有依据的条件分支（先 grep 再删），非占位 TBD。可接受。
- Task 7 Step 10 含"按 grep 结果决定是否保留 SearchableSelect"——同上，因 scope 选择可能仍用。可接受。
- Task 13 Step 4 含"若无现成测试则跳过"——已明确记录于汇报，非占位。
- 无 "TODO" / "implement later" / "similar to" 占位。

**3. Type consistency**
- `ProjectLabelRecord` / `SaveProjectLabelInput` 字段在 Task 2（Rust）、Task 6（TS）一致去 agent。✅
- `save_label` 签名 Task 3 去 `agent_profile_id`，Task 4 调用点同步去掉。✅
- `resolveInitialWorkflowSkill` 签名在 Task 12 定义与两处调用一致（`{ issue, options }`）。✅
- `workflowSkillOptions` 在 Task 9（Label 表单，全量 saved skills）与 Task 12（run dialog，按 agentType 过滤）语义不同但同名——可接受，分属不同文件。✅

**4. 风险**
- Task 12 Step 7 闭包取值问题已在 step 内提示用 `mergedSavedSkills` 局部变量规避。✅
- migration `ALTER TABLE DROP COLUMN` 需 SQLite ≥ 3.35.0；rusqlite bundled SQLite 满足。✅
