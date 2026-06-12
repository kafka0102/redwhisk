# Preload Agent Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an in-memory skill index for Codex and Claude skills, preload it asynchronously at app/project lifecycle points, and use it to populate Agent Profile skill selection.

**Architecture:** Add a Rust `agent_skill` module that owns skill discovery, parsing, cache state, refresh APIs, and Tauri DTOs. Store the runtime index in `AppState`, expose fast read-only list commands, trigger refreshes from app setup and project open/create paths, then consume the cached data from the Settings form.

**Tech Stack:** Rust 2021, Tauri 2 commands/events, React 19, TypeScript, Vitest, Cargo tests. No new dependencies.

---

## File Structure

- Create `src-tauri/src/agent_skill/mod.rs`: module exports.
- Create `src-tauri/src/agent_skill/index.rs`: in-memory cache, refresh status, list/filter behavior.
- Create `src-tauri/src/agent_skill/scanner.rs`: filesystem root discovery, recursive root search, `SKILL.md` metadata parsing.
- Create `src-tauri/src/agent_skill/service.rs`: orchestration helpers for refreshing global/project caches and emitting update events.
- Create `src-tauri/src/types/agent_skill.rs`: Tauri DTOs for skill records, list/refresh inputs, list response, event payload, refresh status.
- Modify `src-tauri/src/types/agent_profile.rs`: extend `AgentType` to include `Claude`.
- Modify `src-tauri/src/types/mod.rs`: export `agent_skill`.
- Modify `src-tauri/src/app_state.rs`: add `agent_skills` cache to `AppState`.
- Modify `src-tauri/src/lib.rs`: register `agent_skill` module, start global refresh in setup, register new Tauri commands.
- Modify `src-tauri/src/commands/mod.rs`: export `agent_skill_commands`.
- Create `src-tauri/src/commands/agent_skill_commands.rs`: `list_agent_skills` and `refresh_agent_skills`.
- Modify `src-tauri/src/commands/project_commands.rs`: trigger project refresh after successful create/open.
- Modify `src/features/settings/settings-commands.ts`: extend `AgentType`, add skill DTOs and wrappers.
- Modify `src/features/settings/agent-profile-form.tsx`: add Agent Type control, skill loading, update event subscription, grouped skill options.
- Modify `src/features/settings/project-settings-activity.test.tsx`: keep profile mocks compatible with `agentType`.
- Create or extend frontend tests for `AgentProfileForm` behavior in `src/features/settings/project-settings-activity.test.tsx`.

---

## Task 1: Rust Types And Skill Index Core

**Files:**
- Create: `src-tauri/src/types/agent_skill.rs`
- Create: `src-tauri/src/agent_skill/mod.rs`
- Create: `src-tauri/src/agent_skill/index.rs`
- Modify: `src-tauri/src/types/agent_profile.rs`
- Modify: `src-tauri/src/types/mod.rs`
- Modify: `src-tauri/src/app_state.rs`
- Test: `src-tauri/src/agent_skill/index.rs`

- [ ] **Step 1: Write failing Rust tests for cache list/filter behavior**

Add unit tests in `src-tauri/src/agent_skill/index.rs` under `#[cfg(test)]` before implementation. Cover:

```rust
#[test]
fn list_returns_global_and_matching_project_skills_for_agent_type() {
    let index = AgentSkillIndex::default();
    index.replace_global(vec![
        skill("onespec", AgentType::Codex, AgentSkillScope::Global, None, "/tmp/global/codex/onespec/SKILL.md"),
        skill("web-access", AgentType::Claude, AgentSkillScope::Global, None, "/tmp/global/claude/web-access/SKILL.md"),
    ]);
    index.replace_project(
        7,
        vec![skill(
            "project-codex",
            AgentType::Codex,
            AgentSkillScope::Project,
            Some(7),
            "/tmp/repo/.agents/skills/project-codex/SKILL.md",
        )],
    );

    let response = index.list(Some(AgentType::Codex), Some(7));

    assert_eq!(response.skills.len(), 2);
    assert!(response.skills.iter().all(|skill| skill.agent_type == AgentType::Codex));
    assert!(response.skills.iter().any(|skill| skill.scope == AgentSkillScope::Global));
    assert!(response.skills.iter().any(|skill| skill.scope == AgentSkillScope::Project));
}

#[test]
fn list_preserves_duplicate_names_with_distinct_paths() {
    let index = AgentSkillIndex::default();
    index.replace_global(vec![
        skill("review", AgentType::Codex, AgentSkillScope::Global, None, "/tmp/a/review/SKILL.md"),
        skill("review", AgentType::Codex, AgentSkillScope::Global, None, "/tmp/b/review/SKILL.md"),
    ]);

    let response = index.list(Some(AgentType::Codex), None);

    assert_eq!(response.skills.len(), 2);
    assert_ne!(response.skills[0].path, response.skills[1].path);
}
```

Provide a small `skill(...)` helper in the test module that constructs `AgentSkillRecord`.

- [ ] **Step 2: Run the failing Rust test**

Run: `cargo test agent_skill --lib`

Expected: FAIL because `agent_skill` module, DTOs, and `AgentSkillIndex` do not exist.

- [ ] **Step 3: Add DTOs and AgentType extension**

Implement `src-tauri/src/types/agent_skill.rs`:

```rust
use serde::{Deserialize, Serialize};

use crate::types::agent_profile::AgentType;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentSkillScope {
    Project,
    Global,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentSkillRefreshStatus {
    Idle,
    Loading,
    Ready,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkillRecord {
    pub name: String,
    pub path: String,
    pub agent_type: AgentType,
    pub scope: AgentSkillScope,
    pub project_id: Option<i64>,
    pub source_root: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAgentSkillsInput {
    pub agent_type: Option<AgentType>,
    pub project_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshAgentSkillsInput {
    pub project_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkillListResponse {
    pub skills: Vec<AgentSkillRecord>,
    pub global_status: AgentSkillRefreshStatus,
    pub project_status: AgentSkillRefreshStatus,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkillsUpdatedEvent {
    pub scope: AgentSkillScope,
    pub project_id: Option<i64>,
}
```

Modify `src-tauri/src/types/agent_profile.rs`:

```rust
pub enum AgentType {
    Codex,
    Claude,
}
```

Modify `src-tauri/src/types/mod.rs` to export `pub mod agent_skill;`.

- [ ] **Step 4: Implement `AgentSkillIndex` minimally**

Create `src-tauri/src/agent_skill/mod.rs`:

```rust
pub mod index;
pub mod scanner;
pub mod service;
```

Create `src-tauri/src/agent_skill/index.rs` with:

```rust
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use crate::types::agent_profile::AgentType;
use crate::types::agent_skill::{
    AgentSkillListResponse, AgentSkillRecord, AgentSkillRefreshStatus,
};

#[derive(Debug, Clone)]
pub struct AgentSkillIndex {
    inner: Arc<RwLock<AgentSkillIndexState>>,
}

#[derive(Debug, Default)]
struct AgentSkillIndexState {
    global_skills: Vec<AgentSkillRecord>,
    project_skills: HashMap<i64, Vec<AgentSkillRecord>>,
    global_status: AgentSkillRefreshStatus,
    project_statuses: HashMap<i64, AgentSkillRefreshStatus>,
    last_error: Option<String>,
}

impl Default for AgentSkillRefreshStatus {
    fn default() -> Self {
        Self::Idle
    }
}

impl Default for AgentSkillIndex {
    fn default() -> Self {
        Self {
            inner: Arc::new(RwLock::new(AgentSkillIndexState::default())),
        }
    }
}

impl AgentSkillIndex {
    pub fn list(&self, agent_type: Option<AgentType>, project_id: Option<i64>) -> AgentSkillListResponse {
        let state = self.inner.read().expect("agent skill index poisoned");
        let mut skills = Vec::new();

        skills.extend(filter_skills(&state.global_skills, agent_type.as_ref()));
        if let Some(project_id) = project_id {
            if let Some(project_skills) = state.project_skills.get(&project_id) {
                skills.extend(filter_skills(project_skills, agent_type.as_ref()));
            }
        }

        AgentSkillListResponse {
            skills,
            global_status: state.global_status.clone(),
            project_status: project_id
                .and_then(|id| state.project_statuses.get(&id).cloned())
                .unwrap_or(AgentSkillRefreshStatus::Idle),
            last_error: state.last_error.clone(),
        }
    }

    pub fn set_global_loading(&self) {
        self.inner.write().expect("agent skill index poisoned").global_status = AgentSkillRefreshStatus::Loading;
    }

    pub fn set_project_loading(&self, project_id: i64) {
        self.inner
            .write()
            .expect("agent skill index poisoned")
            .project_statuses
            .insert(project_id, AgentSkillRefreshStatus::Loading);
    }

    pub fn replace_global(&self, skills: Vec<AgentSkillRecord>) {
        let mut state = self.inner.write().expect("agent skill index poisoned");
        state.global_skills = skills;
        state.global_status = AgentSkillRefreshStatus::Ready;
        state.last_error = None;
    }

    pub fn replace_project(&self, project_id: i64, skills: Vec<AgentSkillRecord>) {
        let mut state = self.inner.write().expect("agent skill index poisoned");
        state.project_skills.insert(project_id, skills);
        state.project_statuses.insert(project_id, AgentSkillRefreshStatus::Ready);
        state.last_error = None;
    }

    pub fn mark_failed(&self, project_id: Option<i64>, message: String) {
        let mut state = self.inner.write().expect("agent skill index poisoned");
        if let Some(project_id) = project_id {
            state.project_statuses.insert(project_id, AgentSkillRefreshStatus::Failed);
        } else {
            state.global_status = AgentSkillRefreshStatus::Failed;
        }
        state.last_error = Some(message);
    }
}

fn filter_skills(skills: &[AgentSkillRecord], agent_type: Option<&AgentType>) -> Vec<AgentSkillRecord> {
    skills
        .iter()
        .filter(|skill| agent_type.is_none_or(|agent_type| &skill.agent_type == agent_type))
        .cloned()
        .collect()
}
```

If `Option::is_none_or` is unavailable in this Rust version, replace it with `agent_type.map_or(true, |agent_type| &skill.agent_type == agent_type)`.

- [ ] **Step 5: Add cache to `AppState`**

Modify `src-tauri/src/app_state.rs`:

```rust
use crate::agent_skill::index::AgentSkillIndex;

pub struct AppState {
    pub local_data: Mutex<LocalDataService>,
    pub pty_sessions: PtySessionManager,
    pub agent_skills: AgentSkillIndex,
}

impl AppState {
    pub fn new(local_data: LocalDataService) -> Self {
        Self {
            local_data: Mutex::new(local_data),
            pty_sessions: PtySessionManager::new(),
            agent_skills: AgentSkillIndex::default(),
        }
    }
}
```

Modify `src-tauri/src/lib.rs` to add `pub mod agent_skill;`.

- [ ] **Step 6: Run Rust test green**

Run: `cargo test agent_skill --lib`

Expected: PASS for the cache tests.

- [ ] **Step 7: Commit Task 1**

```bash
git add src-tauri/src/types/agent_profile.rs src-tauri/src/types/agent_skill.rs src-tauri/src/types/mod.rs src-tauri/src/agent_skill/mod.rs src-tauri/src/agent_skill/index.rs src-tauri/src/app_state.rs src-tauri/src/lib.rs
git commit -m "feat: add agent skill cache types"
```

---

## Task 2: Rust Skill Scanner And Refresh Service

**Files:**
- Create: `src-tauri/src/agent_skill/scanner.rs`
- Create: `src-tauri/src/agent_skill/service.rs`
- Modify: `src-tauri/src/commands/agent_skill_commands.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/commands/project_commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/agent_skill/scanner.rs`, `src-tauri/src/agent_skill/service.rs`

- [ ] **Step 1: Write failing scanner tests**

In `src-tauri/src/agent_skill/scanner.rs`, add unit tests first. Use `tempfile::TempDir` which is already present in Rust dev dependencies.

Cover:

```rust
#[test]
fn scans_skill_directories_and_uses_frontmatter_name() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join(".agents/skills");
    write_skill(&root.join("from-dir"), "---\nname: from-frontmatter\ndescription: test\n---\n# Body\n");

    let records = scan_skill_root(
        &root,
        AgentType::Codex,
        AgentSkillScope::Project,
        Some(12),
    );

    assert_eq!(records.len(), 1);
    assert_eq!(records[0].name, "from-frontmatter");
    assert_eq!(records[0].agent_type, AgentType::Codex);
    assert_eq!(records[0].scope, AgentSkillScope::Project);
    assert_eq!(records[0].project_id, Some(12));
}

#[test]
fn falls_back_to_directory_name_when_frontmatter_name_is_missing() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join(".claude/skills");
    write_skill(&root.join("fallback-name"), "# Body\n");

    let records = scan_skill_root(
        &root,
        AgentType::Claude,
        AgentSkillScope::Project,
        Some(9),
    );

    assert_eq!(records[0].name, "fallback-name");
}

#[test]
fn finds_nested_project_skill_roots_without_descending_into_ignored_dirs() {
    let temp = tempfile::tempdir().unwrap();
    write_skill(&temp.path().join("packages/app/.agents/skills/nested"), "---\nname: nested\n---\n");
    write_skill(&temp.path().join("node_modules/pkg/.agents/skills/ignored"), "---\nname: ignored\n---\n");

    let roots = find_project_skill_roots(temp.path(), ".agents/skills");

    assert_eq!(roots.len(), 1);
    assert!(roots[0].ends_with("packages/app/.agents/skills"));
}
```

Use a local `write_skill(path, contents)` test helper that creates directories and writes `SKILL.md`.

- [ ] **Step 2: Run scanner tests and verify red**

Run: `cargo test agent_skill::scanner --lib`

Expected: FAIL because scanner functions are not implemented.

- [ ] **Step 3: Implement scanner**

Implement public functions:

```rust
pub fn scan_global_skills(home_dir: Option<&Path>) -> Vec<AgentSkillRecord>
pub fn scan_project_skills(project_id: i64, project_path: &Path) -> Vec<AgentSkillRecord>
pub fn scan_skill_root(root: &Path, agent_type: AgentType, scope: AgentSkillScope, project_id: Option<i64>) -> Vec<AgentSkillRecord>
pub fn find_project_skill_roots(project_path: &Path, suffix: &str) -> Vec<PathBuf>
```

Rules:

- Global Codex roots: `$HOME/.agents/skills`, `$HOME/.codex/skills`, `$HOME/.codex/superpowers/skills`, `/etc/codex/skills`.
- Global Claude root: `$HOME/.claude/skills`.
- Project Codex direct roots: `<project>/.agents/skills`, `<project>/.codex/skills`.
- Project Claude direct root: `<project>/.claude/skills`.
- Also search nested project roots for suffixes `.agents/skills`, `.codex/skills`, `.claude/skills`.
- Skip directory names: `.git`, `node_modules`, `target`, `dist`, `build`, `.worktrees`.
- Only include `<skills-root>/<skill-dir>/SKILL.md`.
- Record `path` as canonical `SKILL.md` path and `source_root` as canonical root path.
- Parse frontmatter only when file starts with `---`; read lines until closing `---`; parse `name:` by trimming whitespace and optional single/double quotes.
- If no valid frontmatter name, fallback to skill directory name.

- [ ] **Step 4: Run scanner tests green**

Run: `cargo test agent_skill::scanner --lib`

Expected: PASS.

- [ ] **Step 5: Write failing service/command tests**

Add unit tests in `src-tauri/src/agent_skill/service.rs` for refresh orchestration without Tauri app handles:

```rust
#[test]
fn refresh_global_replaces_global_cache() {
    let temp = tempfile::tempdir().unwrap();
    write_skill(&temp.path().join(".agents/skills/onespec"), "---\nname: onespec\n---\n");
    let index = AgentSkillIndex::default();

    AgentSkillService::refresh_global_from_home(&index, Some(temp.path()));

    let response = index.list(Some(AgentType::Codex), None);
    assert_eq!(response.skills.len(), 1);
    assert_eq!(response.skills[0].name, "onespec");
    assert_eq!(response.global_status, AgentSkillRefreshStatus::Ready);
}

#[test]
fn refresh_project_replaces_only_target_project_cache() {
    let project_one = tempfile::tempdir().unwrap();
    let project_two = tempfile::tempdir().unwrap();
    write_skill(&project_one.path().join(".claude/skills/web-access"), "---\nname: web-access\n---\n");
    write_skill(&project_two.path().join(".claude/skills/other"), "---\nname: other\n---\n");
    let index = AgentSkillIndex::default();

    AgentSkillService::refresh_project(&index, 1, project_one.path());
    AgentSkillService::refresh_project(&index, 2, project_two.path());

    let response = index.list(Some(AgentType::Claude), Some(1));
    assert_eq!(response.skills.len(), 1);
    assert_eq!(response.skills[0].name, "web-access");
}
```

- [ ] **Step 6: Implement service**

Implement `src-tauri/src/agent_skill/service.rs`:

```rust
use std::path::Path;

use crate::agent_skill::index::AgentSkillIndex;
use crate::agent_skill::scanner::{scan_global_skills, scan_project_skills};

pub struct AgentSkillService;

impl AgentSkillService {
    pub fn refresh_global_from_home(index: &AgentSkillIndex, home_dir: Option<&Path>) {
        index.set_global_loading();
        let skills = scan_global_skills(home_dir);
        index.replace_global(skills);
    }

    pub fn refresh_project(index: &AgentSkillIndex, project_id: i64, project_path: &Path) {
        index.set_project_loading(project_id);
        let skills = scan_project_skills(project_id, project_path);
        index.replace_project(project_id, skills);
    }
}
```

For production async refresh helpers, use `tauri::async_runtime::spawn` in commands/lib and call these synchronous service methods inside the spawned task.

- [ ] **Step 7: Add Tauri commands**

Create `src-tauri/src/commands/agent_skill_commands.rs`:

```rust
use tauri::State;

use crate::agent_skill::service::AgentSkillService;
use crate::app_state::AppState;
use crate::types::agent_skill::{AgentSkillListResponse, ListAgentSkillsInput, RefreshAgentSkillsInput};
use crate::types::errors::CommandError;

#[tauri::command]
pub fn list_agent_skills(
    state: State<'_, AppState>,
    input: ListAgentSkillsInput,
) -> Result<AgentSkillListResponse, CommandError> {
    Ok(state.agent_skills.list(input.agent_type, input.project_id))
}

#[tauri::command]
pub fn refresh_agent_skills(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: RefreshAgentSkillsInput,
) -> Result<AgentSkillListResponse, CommandError> {
    if let Some(project_id) = input.project_id {
        let project = crate::core::project_service::ProjectService::open_project_for_window_in_data_dir(
            app.path().app_data_dir().map_err(CommandError::from)?,
            crate::types::project::OpenProjectInput { project_id },
        )?;
        trigger_project_skill_refresh(&app, state.agent_skills.clone(), project.id, project.repo_path.clone());
        Ok(state.agent_skills.list(None, Some(project_id)))
    } else {
        trigger_global_skill_refresh(&app, state.agent_skills.clone());
        Ok(state.agent_skills.list(None, None))
    }
}
```

If direct `app.path().app_data_dir().map_err(CommandError::from)?` does not compile because the error mapping differs, mirror existing `prepare_settings_data_dir` error mapping.

Add helper functions in the same file:

```rust
pub fn trigger_global_skill_refresh(app: &tauri::AppHandle, index: AgentSkillIndex) { ... }
pub fn trigger_project_skill_refresh(app: &tauri::AppHandle, index: AgentSkillIndex, project_id: i64, repo_path: String) { ... }
```

Each helper must spawn, refresh, then emit `agent-skills-updated` with `AgentSkillsUpdatedEvent`.

- [ ] **Step 8: Trigger refreshes from app setup and project lifecycle**

Modify `src-tauri/src/lib.rs`:

- Register `commands::agent_skill_commands::list_agent_skills`.
- Register `commands::agent_skill_commands::refresh_agent_skills`.
- In `.setup`, after terminal output sink setup, call `commands::agent_skill_commands::trigger_global_skill_refresh(&app_handle, state.agent_skills.clone());`.

Modify `src-tauri/src/commands/mod.rs`:

```rust
pub mod agent_skill_commands;
```

Modify `src-tauri/src/commands/project_commands.rs`:

- After `ProjectService::create_project_in_data_dir(...)` succeeds, call project refresh helper with returned `project`.
- After `ProjectService::open_project_in_data_dir(...)` succeeds, call project refresh helper with returned `project`.
- Keep command response immediate; do not await scan completion.

- [ ] **Step 9: Run Rust tests**

Run:

```bash
cargo test agent_skill --lib
cargo test
```

Expected: PASS.

- [ ] **Step 10: Commit Task 2**

```bash
git add src-tauri/src/agent_skill src-tauri/src/commands/agent_skill_commands.rs src-tauri/src/commands/mod.rs src-tauri/src/commands/project_commands.rs src-tauri/src/lib.rs
git commit -m "feat: preload agent skill index"
```

---

## Task 3: Frontend Skill Query Wrappers And Agent Profile Form

**Files:**
- Modify: `src/features/settings/settings-commands.ts`
- Modify: `src/features/settings/agent-profile-form.tsx`
- Modify: `src/features/settings/project-settings-activity.test.tsx`
- Test: `src/features/settings/project-settings-activity.test.tsx`

- [ ] **Step 1: Write failing frontend tests**

In `src/features/settings/project-settings-activity.test.tsx`, mock `listAgentSkills` and Tauri event subscribe if needed.

Add tests for:

```ts
it("shows cached Codex skills when creating a project agent", async () => {
  listAgentProfilesMock.mockResolvedValue({ profiles: [] });
  listAgentSkillsMock.mockResolvedValue({
    skills: [
      {
        name: "onespec",
        path: "/repo/.agents/skills/onespec/SKILL.md",
        agentType: "codex",
        scope: "project",
        projectId: 1,
        sourceRoot: "/repo/.agents/skills",
      },
      {
        name: "web-access",
        path: "/Users/me/.claude/skills/web-access/SKILL.md",
        agentType: "claude",
        scope: "global",
        projectId: null,
        sourceRoot: "/Users/me/.claude/skills",
      },
    ],
    globalStatus: "ready",
    projectStatus: "ready",
    lastError: null,
  });

  render(<ProjectSettingsActivity projectId={1} projectName="RedWhisk" completionPolicy="agent_auto_commit" />);
  await user.click(await screen.findByRole("button", { name: "Add project agent" }));

  expect(await screen.findByRole("option", { name: /onespec/ })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /web-access/ })).not.toBeInTheDocument();
});

it("switches skill options when agent type changes to Claude", async () => {
  // listAgentSkills mock returns Codex result for agentType codex and Claude result for claude.
  // Open add dialog, change Agent type to claude, assert Claude skill appears.
});
```

Use existing test helpers and style from this test file.

- [ ] **Step 2: Run failing frontend test**

Run: `pnpm test src/features/settings/project-settings-activity.test.tsx`

Expected: FAIL because wrappers, Agent Type control, and skill loading do not exist.

- [ ] **Step 3: Extend `settings-commands.ts`**

Modify:

```ts
export type AgentType = "codex" | "claude";
export type AgentSkillScope = "project" | "global";
export type AgentSkillRefreshStatus = "idle" | "loading" | "ready" | "failed";

export interface AgentSkillRecord {
  name: string;
  path: string;
  agentType: AgentType;
  scope: AgentSkillScope;
  projectId: number | null;
  sourceRoot: string;
}

export interface ListAgentSkillsInput {
  agentType?: AgentType;
  projectId: number | null;
}

export interface AgentSkillListResponse {
  skills: AgentSkillRecord[];
  globalStatus: AgentSkillRefreshStatus;
  projectStatus: AgentSkillRefreshStatus;
  lastError: string | null;
}

export function listAgentSkills(input: ListAgentSkillsInput): Promise<AgentSkillListResponse> {
  return invokeCommand<AgentSkillListResponse>("list_agent_skills", { input });
}
```

Add `refreshAgentSkills` wrapper only if the UI uses an explicit refresh action; otherwise keep it available for future command tests but no visible button is required.

- [ ] **Step 4: Update `AgentProfileForm`**

Add state:

```ts
const [agentType, setAgentType] = useState<AgentType>(() => profile?.agentType ?? "codex");
const [skills, setSkills] = useState<AgentSkillRecord[]>([]);
const [skillStatusMessage, setSkillStatusMessage] = useState<string | null>(null);
```

Use `agentType` in `saveAgentProfile` instead of hard-coded `"codex"`.

Add Agent Type select before Command:

```tsx
<label className="settings-field">
  <span>Agent type</span>
  <select
    aria-label="Agent type"
    className="settings-input"
    value={agentType}
    onChange={(event) => {
      const nextAgentType = event.target.value as AgentType;
      setAgentType(nextAgentType);
      setDefaultSkill("");
    }}
  >
    <option value="codex">Codex</option>
    <option value="claude">Claude</option>
  </select>
</label>
```

Load skills on mount and when `agentType` / `projectId` changes:

```ts
useEffect(() => {
  let isMounted = true;
  setSkillStatusMessage("Loading skills...");
  void listAgentSkills({ agentType, projectId })
    .then((response) => {
      if (!isMounted) return;
      setSkills(response.skills);
      setSkillStatusMessage(response.lastError ?? null);
    })
    .catch((error: unknown) => {
      if (!isMounted) return;
      setSkillStatusMessage(toCommandError(error).message);
    });
  return () => {
    isMounted = false;
  };
}, [agentType, projectId]);
```

Subscribe to `agent-skills-updated` using `@tauri-apps/api/event` and reload when event scope is global or matches current `projectId`. Keep cleanup by calling the unlisten function.

Render grouped options:

```tsx
<option value="">—</option>
{projectSkills.length > 0 ? (
  <optgroup label="Project">
    {projectSkills.map((skill) => (
      <option key={skill.path} value={skill.name}>
        {skill.name} — {skill.path}
      </option>
    ))}
  </optgroup>
) : null}
{globalSkills.length > 0 ? (
  <optgroup label="Global">
    {globalSkills.map((skill) => (
      <option key={skill.path} value={skill.name}>
        {skill.name} — {skill.path}
      </option>
    ))}
  </optgroup>
) : null}
```

Keep text concise; status can reuse the existing dialog status paragraph by composing command detection and skill loading messages if needed.

- [ ] **Step 5: Run targeted frontend test green**

Run: `pnpm test src/features/settings/project-settings-activity.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/features/settings/settings-commands.ts src/features/settings/agent-profile-form.tsx src/features/settings/project-settings-activity.test.tsx
git commit -m "feat: populate agent skill selector"
```

---

## Task 4: Integration Verification And OpenSpec Backfill

**Files:**
- Modify: `openspec/changes/preload-agent-skills/tasks.md`
- Possibly modify: `openspec/changes/preload-agent-skills/design.md` only if implementation materially differs from approved design
- Modify: `openspec/changes/preload-agent-skills/.onespec.yaml`

- [ ] **Step 1: Run full required verification**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
cd src-tauri && cargo test
cd .. && openspec validate preload-agent-skills --strict
```

Expected: all pass. Note the known Vitest jsdom canvas/CSS warnings if still present, but do not treat them as failures if exit code is 0.

- [ ] **Step 2: Inspect changed files**

Run:

```bash
git status --short
git diff --stat
git diff -- openspec/changes/preload-agent-skills/tasks.md
```

Confirm every changed file is tied to this change.

- [ ] **Step 3: Backfill OpenSpec tasks**

Mark all completed tasks in `openspec/changes/preload-agent-skills/tasks.md`:

```markdown
- [x] 1.1 ...
```

Only check a task after corresponding implementation and verification are complete.

- [ ] **Step 4: Track touched files in OneSpec**

Run:

```bash
ONESPEC_ENV="${ONESPEC_ENV:-$(find . "$HOME"/.codex "$HOME"/.claude "$HOME"/.cursor "$HOME"/.gemini "$HOME"/.copilot "$HOME"/.agents "$HOME"/.config -path '*/onespec/scripts/onespec-env.sh' -type f -print -quit 2>/dev/null)}"
. "$ONESPEC_ENV"
"$ONESPEC_BASH" "$ONESPEC_COMMIT" track preload-agent-skills \
  docs/superpowers/plans/2026-06-12-preload-agent-skills.md \
  src-tauri/src/types/agent_profile.rs \
  src-tauri/src/types/agent_skill.rs \
  src-tauri/src/types/mod.rs \
  src-tauri/src/agent_skill/mod.rs \
  src-tauri/src/agent_skill/index.rs \
  src-tauri/src/agent_skill/scanner.rs \
  src-tauri/src/agent_skill/service.rs \
  src-tauri/src/app_state.rs \
  src-tauri/src/lib.rs \
  src-tauri/src/commands/agent_skill_commands.rs \
  src-tauri/src/commands/mod.rs \
  src-tauri/src/commands/project_commands.rs \
  src/features/settings/settings-commands.ts \
  src/features/settings/agent-profile-form.tsx \
  src/features/settings/project-settings-activity.test.tsx \
  openspec/changes/preload-agent-skills/tasks.md
```

- [ ] **Step 5: Commit final OpenSpec backfill**

```bash
git add openspec/changes/preload-agent-skills/tasks.md openspec/changes/preload-agent-skills/.onespec.yaml docs/superpowers/plans/2026-06-12-preload-agent-skills.md
git commit -m "docs: backfill skill preload implementation status"
```

If the plan file was committed earlier, only commit the changed OpenSpec state/task files.

---

## Self-Review

- Spec coverage: Global preload, project preload, Codex discovery, Claude discovery, cached query API, update event, and frontend skill selection are each covered by Tasks 1-4.
- Placeholder scan: No task uses TBD/TODO/fill-in-later language. Implementation choices are concrete and scoped.
- Type consistency: Rust DTO fields use `snake_case` internally and serialize as `camelCase`; TypeScript mirrors camelCase names. `AgentType` values remain `codex | claude`.
