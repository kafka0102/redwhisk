use std::collections::{HashMap, HashSet};
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
    global_error: Option<String>,
    project_errors: HashMap<i64, String>,
}

impl Default for AgentSkillIndex {
    fn default() -> Self {
        Self {
            inner: Arc::new(RwLock::new(AgentSkillIndexState::default())),
        }
    }
}

impl AgentSkillIndex {
    pub fn list(
        &self,
        agent_type: Option<AgentType>,
        project_id: Option<i64>,
    ) -> AgentSkillListResponse {
        let state = self.inner.read().expect("agent skill index poisoned");
        let global_skills = filter_skills(&state.global_skills, agent_type.as_ref());

        let project_skills = project_id
            .and_then(|id| state.project_skills.get(&id))
            .map(|skills| filter_skills(skills, agent_type.as_ref()))
            .unwrap_or_default();

        let skills = merge_global_with_project(global_skills, project_skills);

        AgentSkillListResponse {
            skills,
            global_status: state.global_status.clone(),
            project_status: project_id
                .and_then(|id| state.project_statuses.get(&id).cloned())
                .unwrap_or_default(),
            last_error: project_id
                .and_then(|id| state.project_errors.get(&id).cloned())
                .or_else(|| state.global_error.clone()),
        }
    }

    pub fn set_global_loading(&self) {
        let mut state = self.inner.write().expect("agent skill index poisoned");
        state.global_status = AgentSkillRefreshStatus::Loading;
        state.global_error = None;
    }

    pub fn set_project_loading(&self, project_id: i64) {
        let mut state = self.inner.write().expect("agent skill index poisoned");
        state
            .project_statuses
            .insert(project_id, AgentSkillRefreshStatus::Loading);
        state.project_errors.remove(&project_id);
    }

    pub fn replace_global(&self, skills: Vec<AgentSkillRecord>) {
        let mut state = self.inner.write().expect("agent skill index poisoned");
        state.global_skills = skills;
        state.global_status = AgentSkillRefreshStatus::Ready;
        state.global_error = None;
    }

    pub fn replace_global_with_error(
        &self,
        skills: Vec<AgentSkillRecord>,
        error: impl Into<String>,
    ) {
        let mut state = self.inner.write().expect("agent skill index poisoned");
        state.global_skills = skills;
        state.global_status = AgentSkillRefreshStatus::Failed;
        state.global_error = Some(error.into());
    }

    pub fn replace_project(&self, project_id: i64, skills: Vec<AgentSkillRecord>) {
        let mut state = self.inner.write().expect("agent skill index poisoned");
        state.project_skills.insert(project_id, skills);
        state
            .project_statuses
            .insert(project_id, AgentSkillRefreshStatus::Ready);
        state.project_errors.remove(&project_id);
    }

    pub fn mark_global_failed(&self, error: impl Into<String>) {
        let mut state = self.inner.write().expect("agent skill index poisoned");
        state.global_status = AgentSkillRefreshStatus::Failed;
        state.global_error = Some(error.into());
    }

    pub fn mark_project_failed(&self, project_id: i64, error: impl Into<String>) {
        let mut state = self.inner.write().expect("agent skill index poisoned");
        state
            .project_statuses
            .insert(project_id, AgentSkillRefreshStatus::Failed);
        state.project_errors.insert(project_id, error.into());
    }
}

fn filter_skills(
    skills: &[AgentSkillRecord],
    agent_type: Option<&AgentType>,
) -> Vec<AgentSkillRecord> {
    skills
        .iter()
        .filter(|skill| {
            agent_type
                .map(|agent_type| &skill.agent_type == agent_type)
                .unwrap_or(true)
        })
        .cloned()
        .collect()
}

/// 合并全局与项目 skill，并按「同一条记录」去重。
///
/// 当某个 skill（以 name + agent_type 唯一标识）在项目内已存在时，视为与全局中的同名同类
/// skill 是同一条记录，优先保留项目路径下的版本，丢弃全局中的重复项；不同 agent_type 的
/// 同名 skill（例如项目 Codex 与全局 Claude）互为独立记录，都会保留。
fn merge_global_with_project(
    global_skills: Vec<AgentSkillRecord>,
    project_skills: Vec<AgentSkillRecord>,
) -> Vec<AgentSkillRecord> {
    let project_keys: HashSet<(&str, &AgentType)> = project_skills
        .iter()
        .map(|skill| (skill.name.as_str(), &skill.agent_type))
        .collect();

    let mut skills: Vec<AgentSkillRecord> = global_skills
        .into_iter()
        .filter(|skill| !project_keys.contains(&(skill.name.as_str(), &skill.agent_type)))
        .collect();
    skills.extend(project_skills);
    skills
}

#[cfg(test)]
mod tests {
    use crate::types::agent_profile::AgentType;
    use crate::types::agent_skill::{AgentSkillRecord, AgentSkillRefreshStatus, AgentSkillScope};

    use super::AgentSkillIndex;

    #[test]
    fn list_returns_global_and_matching_project_skills_for_agent_type() {
        let index = AgentSkillIndex::default();
        index.replace_global(vec![
            skill(
                "onespec",
                AgentType::Codex,
                AgentSkillScope::Global,
                None,
                "/tmp/global/codex/onespec/SKILL.md",
            ),
            skill(
                "web-access",
                AgentType::Claude,
                AgentSkillScope::Global,
                None,
                "/tmp/global/claude/web-access/SKILL.md",
            ),
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
        assert!(response
            .skills
            .iter()
            .all(|skill| skill.agent_type == AgentType::Codex));
        assert!(response
            .skills
            .iter()
            .any(|skill| skill.scope == AgentSkillScope::Global));
        assert!(response
            .skills
            .iter()
            .any(|skill| skill.scope == AgentSkillScope::Project));
    }

    #[test]
    fn list_keeps_global_skill_for_other_agent_type_when_project_has_same_name() {
        let index = AgentSkillIndex::default();
        index.replace_global(vec![skill(
            "review",
            AgentType::Claude,
            AgentSkillScope::Global,
            None,
            "/home/u/.claude/skills/review/SKILL.md",
        )]);
        index.replace_project(
            7,
            vec![skill(
                "review",
                AgentType::Codex,
                AgentSkillScope::Project,
                Some(7),
                "/repo/.agents/skills/review/SKILL.md",
            )],
        );

        let response = index.list(None, Some(7));

        // 项目内 Codex 与全局 Claude 属于不同 agent_type 的同名 skill，互为独立记录，均保留。
        assert_eq!(response.skills.len(), 2);
        assert!(response
            .skills
            .iter()
            .any(|skill| skill.agent_type == AgentType::Claude
                && skill.scope == AgentSkillScope::Global));
        assert!(response
            .skills
            .iter()
            .any(|skill| skill.agent_type == AgentType::Codex
                && skill.scope == AgentSkillScope::Project));
    }

    #[test]
    fn list_dedupes_global_skill_when_project_has_same_name_and_agent_type() {
        let index = AgentSkillIndex::default();
        index.replace_global(vec![skill(
            "review",
            AgentType::Codex,
            AgentSkillScope::Global,
            None,
            "/home/u/.agents/skills/review/SKILL.md",
        )]);
        index.replace_project(
            7,
            vec![skill(
                "review",
                AgentType::Codex,
                AgentSkillScope::Project,
                Some(7),
                "/repo/.agents/skills/review/SKILL.md",
            )],
        );

        let response = index.list(None, Some(7));

        // 项目与全局存在同名同类（Codex）skill，视为同一条记录，优先保留项目路径。
        assert_eq!(response.skills.len(), 1);
        assert_eq!(response.skills[0].scope, AgentSkillScope::Project);
        assert_eq!(
            response.skills[0].path,
            "/repo/.agents/skills/review/SKILL.md"
        );
    }

    #[test]
    fn list_global_scope_keeps_duplicate_names_across_source_roots() {
        let index = AgentSkillIndex::default();
        index.replace_global(vec![
            skill(
                "review",
                AgentType::Codex,
                AgentSkillScope::Global,
                None,
                "/home/u/.agents/skills/review/SKILL.md",
            ),
            skill(
                "review",
                AgentType::Codex,
                AgentSkillScope::Global,
                None,
                "/home/u/.codex/skills/review/SKILL.md",
            ),
        ]);

        let response = index.list(None, None);

        // 全局范围内同名同类但路径不同的 skill 仍为独立记录。
        assert_eq!(response.skills.len(), 2);
        assert_ne!(response.skills[0].path, response.skills[1].path);
    }

    #[test]
    fn list_preserves_duplicate_names_with_distinct_paths() {
        let index = AgentSkillIndex::default();
        index.replace_global(vec![
            skill(
                "review",
                AgentType::Codex,
                AgentSkillScope::Global,
                None,
                "/tmp/a/review/SKILL.md",
            ),
            skill(
                "review",
                AgentType::Codex,
                AgentSkillScope::Global,
                None,
                "/tmp/b/review/SKILL.md",
            ),
        ]);

        let response = index.list(Some(AgentType::Codex), None);

        assert_eq!(response.skills.len(), 2);
        assert_ne!(response.skills[0].path, response.skills[1].path);
    }

    #[test]
    fn project_failed_does_not_override_global_error() {
        let index = AgentSkillIndex::default();
        index.mark_global_failed("global failed");
        index.mark_project_failed(7, "project failed");

        let global_response = index.list(None, None);
        let project_response = index.list(None, Some(7));

        assert_eq!(
            global_response.global_status,
            AgentSkillRefreshStatus::Failed
        );
        assert_eq!(
            global_response.project_status,
            AgentSkillRefreshStatus::Idle
        );
        assert_eq!(global_response.last_error.as_deref(), Some("global failed"));
        assert_eq!(
            project_response.global_status,
            AgentSkillRefreshStatus::Failed
        );
        assert_eq!(
            project_response.project_status,
            AgentSkillRefreshStatus::Failed
        );
        assert_eq!(
            project_response.last_error.as_deref(),
            Some("project failed")
        );
    }

    #[test]
    fn global_replace_does_not_clear_project_error() {
        let index = AgentSkillIndex::default();
        index.mark_project_failed(7, "project failed");

        index.replace_global(vec![skill(
            "onespec",
            AgentType::Codex,
            AgentSkillScope::Global,
            None,
            "/tmp/global/codex/onespec/SKILL.md",
        )]);

        let response = index.list(None, Some(7));

        assert_eq!(response.global_status, AgentSkillRefreshStatus::Ready);
        assert_eq!(response.project_status, AgentSkillRefreshStatus::Failed);
        assert_eq!(response.last_error.as_deref(), Some("project failed"));
    }

    #[test]
    fn list_returns_idle_status_for_unknown_project() {
        let index = AgentSkillIndex::default();
        index.mark_project_failed(7, "project failed");

        let response = index.list(None, Some(8));

        assert_eq!(response.project_status, AgentSkillRefreshStatus::Idle);
        assert_eq!(response.last_error, None);
    }

    fn skill(
        name: &str,
        agent_type: AgentType,
        scope: AgentSkillScope,
        project_id: Option<i64>,
        path: &str,
    ) -> AgentSkillRecord {
        AgentSkillRecord {
            name: name.to_string(),
            path: path.to_string(),
            agent_type,
            scope,
            project_id,
            source_root: path
                .rsplit_once('/')
                .map(|(root, _)| root.to_string())
                .unwrap_or_else(|| path.to_string()),
        }
    }
}
