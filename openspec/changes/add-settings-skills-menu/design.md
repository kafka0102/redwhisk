# Skills Settings 技术设计

## 数据模型

### 数据库表

```sql
CREATE TABLE saved_agent_skills (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    scope TEXT NOT NULL, -- 'project' or 'global'
    project_id INTEGER, -- NULL for global
    skill_paths_json TEXT NOT NULL, -- JSON array of { agentType: string, path: string }
    del INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_saved_agent_skills_unique_name 
    ON saved_agent_skills (name, scope, COALESCE(project_id, 0), del)
WHERE del = 0;
```

### Rust 类型

```rust
// src/types/saved_agent_skill.rs
use serde::{Deserialize, Serialize};
use crate::types::agent_profile::AgentType;
use crate::types::agent_skill::AgentSkillScope;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedAgentSkillPath {
    pub agent_type: AgentType,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedAgentSkillRecord {
    pub id: i64,
    pub name: String,
    pub scope: AgentSkillScope,
    pub project_id: Option<i64>,
    pub skill_paths: Vec<SavedAgentSkillPath>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSavedAgentSkillInput {
    pub id: Option<i64>,
    pub name: String,
    pub scope: AgentSkillScope,
    pub project_id: Option<i64>,
    pub skill_paths: Vec<SavedAgentSkillPath>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSavedAgentSkillsInput {
    pub scope: Option<AgentSkillScope>,
    pub project_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedAgentSkillListResponse {
    pub skills: Vec<SavedAgentSkillRecord>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSavedAgentSkillInput {
    pub id: i64,
}
```

## 前端类型

```typescript
// src/features/settings/settings-commands.ts
export interface SavedAgentSkillPath {
  agentType: AgentType;
  path: string;
}

export interface SavedAgentSkillRecord {
  id: number;
  name: string;
  scope: AgentSkillScope;
  projectId: number | null;
  skillPaths: SavedAgentSkillPath[];
}

export interface SaveSavedAgentSkillInput {
  id?: number;
  name: string;
  scope: AgentSkillScope;
  projectId: number | null;
  skillPaths: SavedAgentSkillPath[];
}

export interface ListSavedAgentSkillsInput {
  scope?: AgentSkillScope;
  projectId?: number | null;
}

export interface SavedAgentSkillListResponse {
  skills: SavedAgentSkillRecord[];
}

export interface DeleteSavedAgentSkillInput {
  id: number;
}

export async function listSavedAgentSkills(
  input: ListSavedAgentSkillsInput
): Promise<SavedAgentSkillListResponse> {
  return invokeCommand("list_saved_agent_skills", { input });
}

export async function saveSavedAgentSkill(
  input: SaveSavedAgentSkillInput
): Promise<SavedAgentSkillRecord> {
  return invokeCommand("save_saved_agent_skill", { input });
}

export async function deleteSavedAgentSkill(
  input: DeleteSavedAgentSkillInput
): Promise<void> {
  return invokeCommand("delete_saved_agent_skill", { input });
}
```

## 归一化分组逻辑

前端从 `list_agent_skills` 获取原始数据后，按 name 归一化分组：

```typescript
interface NormalizedSkillGroup {
  name: string;
  paths: Array<{ agentType: AgentType; path: string }>;
}

function normalizeSkillsByGroup(skills: AgentSkillRecord[]): NormalizedSkillGroup[] {
  const groups = new Map<string, NormalizedSkillGroup>();
  
  for (const skill of skills) {
    if (!groups.has(skill.name)) {
      groups.set(skill.name, { name: skill.name, paths: [] });
    }
    groups.get(skill.name)!.paths.push({
      agentType: skill.agentType,
      path: skill.path,
    });
  }
  
  return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));
}
```

## 相对路径处理

保存项目级 skill 时，将绝对路径转换为相对于项目源目录的相对路径：

```rust
// 在 service 层处理
fn make_path_relative_if_project(
    path: &str,
    scope: &AgentSkillScope,
    source_root: Option<&str>
) -> String {
    if scope != &AgentSkillScope::Project {
        return path.to_string();
    }
    
    if let Some(root) = source_root {
        if path.starts_with(root) {
            let relative = path.strip_prefix(root).unwrap_or(path);
            let relative = relative.strip_prefix('/').unwrap_or(relative);
            return format!("./{}", relative);
        }
    }
    
    path.to_string()
}
```

读取时，根据 scope 和 project_id 重建完整路径（前端或后端均可处理）。

## 组件结构

```
src/features/settings/
├── project-settings-activity.tsx (修改：添加 Skills 菜单项)
├── settings-skills-panel.tsx (新增：Skills 页面主组件)
├── saved-agent-skill-form.tsx (新建：新建/编辑 skill form)
└── settings-commands.ts (修改：新增 saved skill commands 类型)

src/shared/i18n/
└── messages.ts (修改：新增 Skills 相关文案)

src-tauri/
├── migrations/
│   └── 0029_saved_agent_skills.sql (新增)
└── src/
    ├── db/
    │   └── saved_agent_skill_repository.rs (新增)
    ├── types/
    │   └── saved_agent_skill.rs (新增)
    └── core/
        └── settings_service.rs (修改：新增 saved skill 方法)
```
