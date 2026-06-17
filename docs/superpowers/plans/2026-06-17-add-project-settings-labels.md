# Project Settings Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Project Settings 中新增 `Labels` 菜单、label 列表与创建/编辑弹窗，并补齐 Rust 持久化、唯一性校验和测试。

**Architecture:** 后端沿用现有 settings service 模式，新增独立的 project label 类型、repository、migration 和 Tauri commands，由 service 统一处理名称长度、scope 唯一性和 agent/skill 关联校验。前端继续复用 `project-settings-activity.tsx` 作为 Settings 入口，在同一页面中增加 `Labels` 模块、table 和 dialog，并复用现有 agent profile/skill 查询能力。

**Tech Stack:** React 19 + TypeScript + Vitest、Tauri 2、Rust + rusqlite、OpenSpec

## Global Constraints

- 只实现本次 labels 配置能力，不把 labels 接入 issue、session、过滤器或其他执行流。
- label 名称保存前必须 trim，且最长 15 个字符。
- 项目级 label 在单个项目内唯一；全局级 label 在所有项目和全局范围内唯一。
- 只有在选择 agent 后才允许选择单个 workflow skill；未选择 agent 时必须清空该字段。
- Project Settings 左侧菜单顺序必须是 `General`、`Agents`、`Labels`。
- TypeScript / JavaScript 改动默认至少运行受影响包的 `lint` 与 `typecheck`。
- 改动了运行时行为、分支逻辑、数据流、渲染逻辑或测试依赖实现，除 `lint` 和 `typecheck` 外还必须运行对应 `test`。

---

## File Map

- Modify: `src/features/settings/project-settings-activity.tsx`
  扩展 settings 左侧菜单、labels 页面状态和主列表交互。
- Create: `src/features/settings/project-label-form.tsx`
  承载新建/编辑 label 弹窗。
- Modify: `src/features/settings/settings-commands.ts`
  增加 project label 的类型和命令封装。
- Modify: `src/features/settings/project-settings-activity.test.tsx`
  覆盖菜单顺序、labels 列表、弹窗、编辑和删除。
- Modify: `src/shared/i18n/messages.ts`
  增加 labels 页面与表单相关文案。
- Modify: `src/app/app.css`
  增加 labels table、颜色预设和 dialog 的样式。
- Create: `src-tauri/migrations/0023_project_labels.sql`
  新增 `project_labels` 表。
- Modify: `src-tauri/src/db/migrations.rs`
  注册 `0023_project_labels` migration。
- Create: `src-tauri/src/types/project_label.rs`
  定义 label record、list/save/delete input。
- Create: `src-tauri/src/db/project_label_repository.rs`
  封装 label 的 list/save/delete 和唯一性查询。
- Modify: `src-tauri/src/db/mod.rs`
  导出 `project_label_repository`。
- Modify: `src-tauri/src/core/settings_service.rs`
  接入 label list/save/delete service 逻辑和校验。
- Modify: `src-tauri/src/commands/settings_commands.rs`
  暴露 `list_project_labels`、`save_project_label`、`delete_project_label`。
- Modify: `src-tauri/src/lib.rs`
  注册新的 settings commands。
- Modify: `src-tauri/src/types/errors.rs`
  如有必要补充 label 复用的 settings validation error 语义；优先复用现有 `AgentProfileValidationFailed` 风格对应的 settings 校验错误。
- Modify: `openspec/changes/2026-06-17-add-project-settings-labels/tasks.md`
  在实现完成后勾选对应 task。
- Modify: `openspec/specs/settings-ui/spec.md`
  合并本次 `settings-ui` delta。
- Create: `openspec/specs/project-labels/spec.md`
  合并本次新增 capability spec。

### Task 1: Rust label 数据模型、migration 与命令

**Files:**
- Create: `src-tauri/migrations/0023_project_labels.sql`
- Modify: `src-tauri/src/db/migrations.rs`
- Create: `src-tauri/src/types/project_label.rs`
- Create: `src-tauri/src/db/project_label_repository.rs`
- Modify: `src-tauri/src/db/mod.rs`
- Modify: `src-tauri/src/core/settings_service.rs`
- Modify: `src-tauri/src/commands/settings_commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/core/settings_service.rs`

**Interfaces:**
- Consumes: `AgentProfileRepository::list_profiles_by_scope`, `SettingsService::ensure_project_exists`
- Produces:
  - `ProjectLabelRecord`
  - `ListProjectLabelsInput`
  - `SaveProjectLabelInput`
  - `DeleteProjectLabelInput`
  - `SettingsService::list_project_labels(input) -> Result<ProjectLabelListResponse, CommandError>`
  - `SettingsService::save_project_label(input) -> Result<ProjectLabelRecord, CommandError>`
  - `SettingsService::delete_project_label(input) -> Result<(), CommandError>`

- [ ] **Step 1: 为 migration 与 service 新增失败测试**

在 `src-tauri/src/core/settings_service.rs` 的测试模块中增加：

```rust
#[test]
fn save_project_label_rejects_name_longer_than_fifteen_chars() {
    let database = test_database();
    let service = test_settings_service(&database.connection);

    let error = service
        .save_project_label(SaveProjectLabelInput {
            id: None,
            name: "1234567890abcdef".to_string(),
            scope: ProjectLabelScope::Project,
            project_id: Some(insert_project(&database.connection, "repo")),
            color: "#112233".to_string(),
            agent_profile_id: None,
            workflow_skill: None,
        })
        .expect_err("name should be rejected");

    assert_eq!(error.code, CommandErrorCode::AgentProfileValidationFailed);
}

#[test]
fn save_global_project_label_rejects_duplicate_name_from_project_scope() {
    let database = test_database();
    let service = test_settings_service(&database.connection);
    let project_id = insert_project(&database.connection, "repo");

    let first = service
        .save_project_label(SaveProjectLabelInput {
            id: None,
            name: "ops".to_string(),
            scope: ProjectLabelScope::Project,
            project_id: Some(project_id),
            color: "#112233".to_string(),
            agent_profile_id: None,
            workflow_skill: None,
        })
        .expect("first label");

    assert_eq!(first.name, "ops");

    let error = service
        .save_project_label(SaveProjectLabelInput {
            id: None,
            name: "ops".to_string(),
            scope: ProjectLabelScope::Global,
            project_id: None,
            color: "#445566".to_string(),
            agent_profile_id: None,
            workflow_skill: None,
        })
        .expect_err("global duplicate should fail");

    assert_eq!(error.code, CommandErrorCode::AgentProfileValidationFailed);
}
```

- [ ] **Step 2: 运行受影响 Rust 测试并确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml settings_service -- --nocapture`

Expected: FAIL，提示缺少 `project_labels` 类型、repository 或 service 方法。

- [ ] **Step 3: 实现 migration 与基础类型**

在 `src-tauri/migrations/0023_project_labels.sql` 中创建表：

```sql
CREATE TABLE project_labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('global', 'project')),
  project_id INTEGER,
  color TEXT NOT NULL,
  agent_profile_id INTEGER,
  workflow_skill TEXT,
  del INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```

在 `src-tauri/src/types/project_label.rs` 中定义：

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectLabelScope {
    Global,
    Project,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLabelRecord {
    pub id: i64,
    pub name: String,
    pub scope: ProjectLabelScope,
    pub project_id: Option<i64>,
    pub color: String,
    pub agent_profile_id: Option<i64>,
    pub agent_name: Option<String>,
    pub workflow_skill: Option<String>,
}
```

- [ ] **Step 4: 实现 repository 与 service 最小逻辑**

在 `src-tauri/src/db/project_label_repository.rs` 实现：
- `list_labels_by_scope(scope, project_id)`
- `find_label_by_id(id)`
- `find_duplicate_name(name, scope, project_id, excluding_id)`
- `save_label(...)`
- `soft_delete_label(id)`

在 `src-tauri/src/core/settings_service.rs` 实现：
- `validate_project_label_name`
- `validate_project_label_color`
- `validate_project_label_scope`
- `validate_project_label_association`

要求：
- 名称 trim 后为空时报错
- 长度大于 15 报错
- `scope=project` 必须有 `project_id`
- `scope=global` 时若任意全局/项目 label 同名则拒绝
- `workflow_skill.is_some()` 且 `agent_profile_id.is_none()` 时拒绝

- [ ] **Step 5: 接线 commands 与 lib 注册**

在 `src-tauri/src/commands/settings_commands.rs` 增加：

```rust
#[tauri::command]
pub fn list_project_labels(...)

#[tauri::command]
pub fn save_project_label(...)

#[tauri::command]
pub fn delete_project_label(...)
```

并在 `src-tauri/src/lib.rs` 的 `generate_handler!` 中注册。

- [ ] **Step 6: 运行 Rust settings 测试并确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml settings_service -- --nocapture`

Expected: PASS，新增 label 校验测试通过。

### Task 2: 前端 settings commands 与 Labels 页面列表

**Files:**
- Modify: `src/features/settings/settings-commands.ts`
- Modify: `src/features/settings/project-settings-activity.tsx`
- Modify: `src/shared/i18n/messages.ts`
- Modify: `src/app/app.css`
- Test: `src/features/settings/project-settings-activity.test.tsx`

**Interfaces:**
- Consumes:
  - `listProjectLabels(input)`
  - `deleteProjectLabel(input)`
  - `listAgentProfiles({ scope: "project" | "global" })`
- Produces:
  - `ProjectLabelRecord` TS type
  - `SettingsMenu = "general" | "agents" | "labels"`
  - labels 列表渲染和删除交互

- [ ] **Step 1: 为 Labels 菜单和列表写失败测试**

在 `src/features/settings/project-settings-activity.test.tsx` 增加：

```tsx
it("renders settings menu in general agents labels order", async () => {
  renderSettings();
  const nav = await screen.findByRole("navigation", { name: "Settings menu" });
  expect(within(nav).getAllByRole("button").map((button) => button.textContent)).toEqual([
    "General",
    "Agents",
    "Labels",
  ]);
});

it("renders labels page with title, action button and table columns", async () => {
  renderSettings();
  await user.click(screen.getByRole("button", { name: "Labels" }));
  expect(screen.getByRole("heading", { name: "Labels" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "New label" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Scope" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Color" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Workflow Skill" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行前端测试并确认失败**

Run: `pnpm test -- src/features/settings/project-settings-activity.test.tsx`

Expected: FAIL，提示不存在 `Labels` 菜单或相关 mock/文案。

- [ ] **Step 3: 扩展前端 commands 与 mock 类型**

在 `src/features/settings/settings-commands.ts` 中增加：

```ts
export type ProjectLabelScope = "project" | "global";

export interface ProjectLabelRecord {
  id: number;
  name: string;
  scope: ProjectLabelScope;
  projectId: number | null;
  color: string;
  agentProfileId: number | null;
  agentName: string | null;
  workflowSkill: string | null;
}
```

并新增 `listProjectLabels`、`saveProjectLabel`、`deleteProjectLabel`。

- [ ] **Step 4: 实现 Labels 页面列表**

在 `src/features/settings/project-settings-activity.tsx` 中：
- 扩展 `SETTINGS_MENU_ITEMS`
- 增加 labels 的 load state、error state、删除 state
- 在 `activeMenu === "labels"` 时渲染 table
- 复用 `SettingsContentFrame`

`Name` 列展示：

```tsx
<button className="settings-label-table__name-button" type="button">
  <span>{label.name}</span>
  <span className="settings-label-table__agent-copy">{label.agentName ?? "None"}</span>
</button>
```

`Color` 列展示：

```tsx
<span style={{ color: label.color }}>{label.color}</span>
```

- [ ] **Step 5: 补充文案与样式**

在 `src/shared/i18n/messages.ts` 增加 `labels`、`newLabel`、`noLabels`、`labelColor`、`agent`、`none` 等 settings 文案。

在 `src/app/app.css` 增加：
- `settings-label-table`
- `settings-label-table__name-button`
- `settings-label-table__agent-copy`
- `settings-label-table__delete-link`

- [ ] **Step 6: 运行前端测试并确认通过**

Run: `pnpm test -- src/features/settings/project-settings-activity.test.tsx`

Expected: PASS，菜单顺序与 labels 列表测试通过。

### Task 3: Label 弹窗、agent/skill 选择与删除编辑流

**Files:**
- Create: `src/features/settings/project-label-form.tsx`
- Modify: `src/features/settings/project-settings-activity.tsx`
- Modify: `src/app/app.css`
- Test: `src/features/settings/project-settings-activity.test.tsx`

**Interfaces:**
- Consumes:
  - `saveProjectLabel(input)`
  - `listAgentProfiles`
  - `listAgentSkills({ agentType, projectId })`
- Produces:
  - `ProjectLabelForm` dialog
  - 创建、编辑、删除的完整前端交互

- [ ] **Step 1: 为弹窗字段显隐和编辑流写失败测试**

在 `src/features/settings/project-settings-activity.test.tsx` 增加：

```tsx
it("opens new label dialog and hides workflow skill until an agent is selected", async () => {
  renderSettings();
  await user.click(screen.getByRole("button", { name: "Labels" }));
  await user.click(screen.getByRole("button", { name: "New label" }));
  expect(screen.getByRole("dialog", { name: "New label" })).toBeInTheDocument();
  expect(screen.getByLabelText("Name")).toBeInTheDocument();
  expect(screen.getByLabelText("Scope")).toBeInTheDocument();
  expect(screen.getByLabelText("Color")).toBeInTheDocument();
  expect(screen.getByLabelText("Agent")).toHaveValue("None");
  expect(screen.queryByLabelText("Workflow Skill")).not.toBeInTheDocument();
});

it("opens edit dialog when clicking a label name", async () => {
  renderSettingsWithLabels();
  await user.click(screen.getByRole("button", { name: "Urgent" }));
  expect(screen.getByRole("dialog", { name: "Edit label" })).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行前端测试并确认失败**

Run: `pnpm test -- src/features/settings/project-settings-activity.test.tsx`

Expected: FAIL，提示缺少 `ProjectLabelForm` 或 dialog。

- [ ] **Step 3: 实现 ProjectLabelForm 最小弹窗**

在 `src/features/settings/project-label-form.tsx` 中实现：
- `mode: "create" | "edit"`
- `projectId`
- `profiles: AgentProfileRecord[]`
- `label?: ProjectLabelRecord`
- `onSaved`
- `onCancel`

字段顺序：

```tsx
Name
Scope
Color
Agent
Workflow Skill // only when agent selected
```

颜色使用：

```tsx
<input type="color" aria-label="Color" ... />
```

并提供大约 10 个预设色块按钮。

- [ ] **Step 4: 实现 agent/skill 依赖逻辑**

表单逻辑要求：
- agent 下拉默认 `None`
- 选择 `None` 时清空 `workflowSkill`
- 选择具体 agent 后，按 agent 类型和 scope 拉取 skills
- 若 agent 来自全局 profile，则 skill 查询用 `projectId: null`
- 若 agent 来自项目 profile，则 skill 查询用当前 `projectId`

- [ ] **Step 5: 接入保存、编辑与删除刷新**

在 `src/features/settings/project-settings-activity.tsx` 中：
- 新增 `addLabelForm` / `editingLabel`
- 点击 `New label` 打开 create dialog
- 点击名称打开 edit dialog
- 删除成功后从当前列表中移除
- 保存成功后 merge 到当前 labels state

- [ ] **Step 6: 运行前端测试并确认通过**

Run: `pnpm test -- src/features/settings/project-settings-activity.test.tsx`

Expected: PASS，弹窗显隐、编辑和删除测试通过。

### Task 4: 唯一性边界、OpenSpec 回填与完整验证

**Files:**
- Modify: `src/features/settings/project-settings-activity.test.tsx`
- Modify: `src-tauri/src/core/settings_service.rs`
- Modify: `openspec/changes/2026-06-17-add-project-settings-labels/tasks.md`
- Modify: `openspec/specs/settings-ui/spec.md`
- Create: `openspec/specs/project-labels/spec.md`

**Interfaces:**
- Consumes: 前三项任务的实现结果
- Produces: 完整验证证据与已回填 OpenSpec artifacts

- [ ] **Step 1: 为跨 scope 唯一性和 workflow skill 约束补测试**

补充 Rust 测试：

```rust
#[test]
fn save_project_label_rejects_workflow_skill_without_agent() { ... }

#[test]
fn save_project_label_allows_same_project_scope_name_in_other_project() { ... }
```

补充前端测试：

```tsx
it("shows a validation error when label name is longer than fifteen characters", async () => { ... });
```

- [ ] **Step 2: 运行 targeted tests**

Run: `pnpm test -- src/features/settings/project-settings-activity.test.tsx`

Run: `cargo test --manifest-path src-tauri/Cargo.toml settings_service -- --nocapture`

Expected: PASS。

- [ ] **Step 3: 合并 OpenSpec spec delta**

把 change 目录中的：
- `specs/settings-ui/spec.md`
- `specs/project-labels/spec.md`

内容合并到正式：
- `openspec/specs/settings-ui/spec.md`
- `openspec/specs/project-labels/spec.md`

- [ ] **Step 4: 勾选 OpenSpec tasks**

在 `openspec/changes/2026-06-17-add-project-settings-labels/tasks.md` 中勾选已完成任务。

- [ ] **Step 5: 运行最终验证命令**

Run: `pnpm lint`

Run: `pnpm typecheck`

Run: `pnpm test -- src/features/settings/project-settings-activity.test.tsx`

Run: `cargo test --manifest-path src-tauri/Cargo.toml settings_service -- --nocapture`

Expected: 全部 PASS。

- [ ] **Step 6: 自动提交当前任务相关文件**

Run:

```bash
git add src/features/settings/project-settings-activity.tsx \
  src/features/settings/project-label-form.tsx \
  src/features/settings/settings-commands.ts \
  src/shared/i18n/messages.ts \
  src/app/app.css \
  src/features/settings/project-settings-activity.test.tsx \
  src-tauri/migrations/0023_project_labels.sql \
  src-tauri/src/types/project_label.rs \
  src-tauri/src/db/project_label_repository.rs \
  src-tauri/src/db/mod.rs \
  src-tauri/src/db/migrations.rs \
  src-tauri/src/core/settings_service.rs \
  src-tauri/src/commands/settings_commands.rs \
  src-tauri/src/lib.rs \
  openspec/specs/settings-ui/spec.md \
  openspec/specs/project-labels/spec.md \
  openspec/changes/2026-06-17-add-project-settings-labels/tasks.md \
  openspec/changes/2026-06-17-add-project-settings-labels/.onespec.yaml

git commit -m "feat(settings): add project labels settings"
```

Expected: 仅提交本次 labels change 相关文件。
